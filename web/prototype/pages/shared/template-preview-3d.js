import * as THREE from 'three';
import { getAsset } from './asset-library-data.js';

const SPECS = {
  'wide-living': { width:9, depth:5.5, shape:'rect', windows:['back-floor'] },
  'long-living': { width:5, depth:9, shape:'rect', windows:['back-floor','left'] },
  'square-lounge': { width:8, depth:7, shape:'rect', windows:['back-large','left-large'] },
  'l-living': { width:8, depth:7, shape:'l', windows:['back-large'] },
  'bay-bedroom': { width:4.2, depth:6.15, shape:'rect', windows:['back-bay'] },
  'standard-bedroom': { width:5, depth:5, shape:'rect', windows:['back'], furnished:'bed' },
};
const FALLBACKS=Object.fromEntries(Object.keys(SPECS).map(id=>[id,new URL(`../../assets/scenes/templates/${id==='standard-bedroom'?'corner-bedroom':id}.png`,import.meta.url).href]));

const active = new WeakMap();
const textureLoader = new THREE.TextureLoader();
let floorTexturePromise;
let viewTexturePromise;

function loadTexture(url, repeat) {
  return new Promise((resolve) => textureLoader.load(url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    if (repeat) texture.repeat.set(...repeat);
    resolve(texture);
  }, undefined, () => resolve(null)));
}

function floorTexture() {
  return floorTexturePromise ||= loadTexture(new URL('../../assets/floors/light-natural-oak-clean.webp', import.meta.url).href, [2.8, 2.8]);
}

function viewTexture() {
  return viewTexturePromise ||= loadTexture(new URL('../../assets/scenes/window-views/day.webp', import.meta.url).href);
}

function coverTexture(texture, targetAspect) {
  const copy = texture.clone();
  const imageAspect = (texture.image?.width || 1) / (texture.image?.height || 1);
  let visibleX = 1;
  let visibleY = 1;
  if (targetAspect > imageAspect) visibleY = imageAspect / targetAspect;
  else visibleX = targetAspect / imageAspect;
  copy.repeat.set(visibleX, visibleY);
  copy.offset.set((1 - visibleX) / 2, (1 - visibleY) / 2);
  copy.needsUpdate = true;
  return copy;
}

function addBox(group, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addWindow(group, side, spec, materials, kind = 'standard') {
  const floorWindow = kind === 'floor';
  const bayWindow = kind === 'bay';
  const largeWindow = kind === 'large';
  const width = floorWindow ? Math.min(5.7, spec.width * .72) : largeWindow ? Math.min(3.8, spec.width * .55) : Math.min(2.45, spec.width * .42);
  const height = floorWindow ? 2.48 : largeWindow ? 2.08 : 1.55;
  const sill = floorWindow ? .08 : largeWindow ? .38 : bayWindow ? .7 : .82;
  const y = sill + height / 2;
  const frameDepth = .11;
  const frame = new THREE.Group();
  const horizontal = side === 'back' || side === 'front';
  frame.position.set(side === 'left' ? -spec.width/2+.071 : side === 'right' ? spec.width/2-.071 : 0, y, side === 'back' ? -spec.depth/2+.071 : side === 'front' ? spec.depth/2-.071 : 0);
  frame.rotation.y = horizontal ? 0 : Math.PI/2;
  const viewMaterial = materials.view.clone();
  const view = new THREE.Mesh(new THREE.PlaneGeometry(width-.12, height-.12), viewMaterial);
  view.userData.windowAspect = (width - .12) / (height - .12);
  materials.windowViews.push(view);
  view.position.z = .065;
  frame.add(view);
  const bar = (w,h,x=0,yy=0) => { const item=new THREE.Mesh(new THREE.BoxGeometry(w,h,frameDepth),materials.frame);item.position.set(x,yy,.08);item.castShadow=true;frame.add(item); };
  bar(width,.055,0,height/2);bar(width,.055,0,-height/2);bar(.055,height,-width/2,0);bar(.055,height,width/2,0);
  for (const ratio of floorWindow ? [-.25,0,.25] : [0]) bar(.038,height-.08,width*ratio,0);
  if (bayWindow) {
    addBox(frame,[width,.15,.54],[0,-height/2-.02,.2],materials.cushion);
  }
  group.add(frame);
}

function createFloor(spec, material) {
  if (spec.shape !== 'l') {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(spec.width,.12,spec.depth),material);
    floor.position.y = -.06;
    return floor;
  }
  const shape = new THREE.Shape();
  shape.moveTo(-4,-3.5);shape.lineTo(1,-3.5);shape.lineTo(1,-.5);shape.lineTo(4,-.5);shape.lineTo(4,3.5);shape.lineTo(-4,3.5);shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:false});
  geometry.rotateX(Math.PI/2);
  const floor = new THREE.Mesh(geometry,material);
  floor.position.y = 0;
  return floor;
}

function addProjectPlacement(group, placement) {
  const asset=getAsset(placement.assetId)||{},primitive=asset.primitive||'plant',dimensions=asset.dimensions||[.7,.7,.7],color=asset.color||asset.accent||'#b89b79';
  const item=new THREE.Group(),material=new THREE.MeshStandardMaterial({color,roughness:.72}),accent=new THREE.MeshStandardMaterial({color:asset.accent||'#e2d1ba',roughness:.84}),[w,h,d]=dimensions;
  if(primitive==='table'){addBox(item,[w,.1,d],[0,h-.05,0],material);[-1,1].forEach(x=>[-1,1].forEach(z=>addBox(item,[.07,h-.1,.07],[x*w*.38,(h-.1)/2,z*d*.38],accent)));}
  else if(primitive==='chair'){addBox(item,[w,.14,d],[0,h*.48,0],material);addBox(item,[w,.5,.1],[0,h*.72,d*.42],accent);}
  else if(primitive==='sofa'){addBox(item,[w,h*.48,d],[0,h*.24,0],material);addBox(item,[w*.92,h*.48,d*.2],[0,h*.66,d*.38],accent);}
  else if(primitive==='bed'){addBox(item,[w,h*.38,d],[0,h*.19,0],material);addBox(item,[w*.94,h*.24,d*.86],[0,h*.48,-d*.04],accent);}
  else if(primitive==='cabinet'){addBox(item,[w,h,d],[0,h/2,0],material);}
  else if(primitive==='lamp'){addBox(item,[w*.5,.08,d*.5],[0,.04,0],material);addBox(item,[.06,h*.72,.06],[0,h*.4,0],accent);addBox(item,[w,h*.25,d],[0,h*.84,0],material);}
  else {addBox(item,[w*.55,h*.32,d*.55],[0,h*.16,0],accent);const crown=new THREE.Mesh(new THREE.SphereGeometry(Math.max(w,d)*.42,10,7),material);crown.scale.y=Math.max(1,h/Math.max(w,d)*.72);crown.position.y=h*.68;item.add(crown);}
  const position=placement.position||{},rotation=placement.rotation||{},scale=placement.scale||{};item.position.set(position.x||0,position.y||0,position.z||0);item.rotation.set(rotation.x||0,rotation.y||0,rotation.z||0);item.scale.set(scale.x||1,scale.y||1,scale.z||1);group.add(item);
}

export async function renderTemplatePreview(canvas, templateId, project=null) {
  if (!canvas || active.has(canvas)) return;
  const spec = SPECS[templateId];
  if (!spec) return;
  const runtime={cancelled:false,cleanup:null};active.set(canvas,runtime);
  canvas.style.backgroundImage=`url("${FALLBACKS[templateId]}")`;
  canvas.style.backgroundSize='cover';canvas.style.backgroundPosition='center';canvas.style.backgroundRepeat='no-repeat';
  const width = Math.max(120, canvas.clientWidth || 180), height = Math.max(86, canvas.clientHeight || 110);
  const renderCanvas=document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({canvas:renderCanvas,antialias:true,alpha:true,powerPreference:'low-power',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(width,height,false);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f6f1e7');
  const span=Math.max(spec.width,spec.depth),camera=new THREE.OrthographicCamera(-span*.72,span*.72,span*.48,-span*.48,.1,60);camera.position.set(span*.78,span*.66,span*.9);camera.lookAt(0,.62,0);
  scene.add(new THREE.HemisphereLight('#fff9ec','#8b765e',1.55));
  const sun=new THREE.DirectionalLight('#fff1d5',3.4);sun.position.set(-5,9,7);sun.castShadow=true;sun.shadow.mapSize.set(512,512);sun.shadow.camera.left=sun.shadow.camera.bottom=-10;sun.shadow.camera.right=sun.shadow.camera.top=10;scene.add(sun);
  const group=new THREE.Group();scene.add(group);
  const floorMat=new THREE.MeshStandardMaterial({color:'#c69a67',roughness:.62,metalness:0});
  const wallMat=new THREE.MeshStandardMaterial({color:project?.finishes?.wallColor||'#f2ede3',roughness:.92,side:THREE.DoubleSide});
  const trimMat=new THREE.MeshStandardMaterial({color:'#faf7f0',roughness:.8});
  const frameMat=new THREE.MeshStandardMaterial({color:'#29343a',roughness:.32,metalness:.28});
  const viewMat=new THREE.MeshBasicMaterial({color:'#b9d1df',side:THREE.DoubleSide});
  const cushionMat=new THREE.MeshStandardMaterial({color:'#eee6d8',roughness:.88});
  const floor=createFloor(spec,floorMat);floor.receiveShadow=true;group.add(floor);
  const h=2.8,t=.13;
  const addWallWithOpening=(side,span)=>{const entry=spec.windows.find(item=>item.split('-')[0]===side);if(!entry){addBox(group,side==='back'?[span,h,t]:[t,h,span],side==='back'?[0,h/2,-spec.depth/2]:[-spec.width/2,h/2,0],wallMat);return;}const kind=entry.split('-')[1]||'standard',floorWindow=kind==='floor',bayWindow=kind==='bay',largeWindow=kind==='large',openingWidth=floorWindow?Math.min(5.7,spec.width*.72):largeWindow?Math.min(3.8,spec.width*.55):Math.min(2.45,spec.width*.42),openingHeight=floorWindow?2.48:largeWindow?2.08:1.55,sill=floorWindow ? .08 : largeWindow ? .38 : bayWindow ? .7 : .82,top=sill+openingHeight,sideWidth=(span-openingWidth)/2,box=(length,height,y,offset)=>addBox(group,side==='back'?[length,height,t]:[t,height,length],side==='back'?[offset,y,-spec.depth/2]:[-spec.width/2,y,offset],wallMat);if(sideWidth>0){box(sideWidth,h,h/2,-(openingWidth+sideWidth)/2);box(sideWidth,h,h/2,(openingWidth+sideWidth)/2);}if(sill>0)box(openingWidth,sill,sill/2,0);if(top<h)box(openingWidth,h-top,(h+top)/2,0);};
  addWallWithOpening('back',spec.width);
  addWallWithOpening('left',spec.depth);
  addBox(group,[spec.width,.12,.24],[0,h-.06,-spec.depth/2+.05],trimMat);
  addBox(group,[.24,.12,spec.depth],[-spec.width/2+.05,h-.06,0],trimMat);
  const materials={view:viewMat,frame:frameMat,cushion:cushionMat,windowViews:[]};
  spec.windows.forEach((entry)=>{const [side,kind='standard']=entry.split('-');addWindow(group,side,spec,materials,kind);});
  if(project?.placements?.length)project.placements.forEach(placement=>addProjectPlacement(group,placement));
  else if(spec.furnished==='bed'){
    const bed=new THREE.Group(),wood=new THREE.MeshStandardMaterial({color:'#8c725c',roughness:.72}),linen=new THREE.MeshStandardMaterial({color:'#e8ded0',roughness:.92});
    addBox(bed,[1.8,.28,2.05],[0,.2,0],wood);addBox(bed,[1.68,.18,1.78],[0,.43,-.05],linen);addBox(bed,[1.8,.62,.12],[0,.42,.97],wood);bed.position.set(.65,0,.35);bed.castShadow=true;group.add(bed);
  }
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.ShadowMaterial({color:'#765f48',opacity:.13}));ground.rotation.x=-Math.PI/2;ground.position.y=-.13;ground.receiveShadow=true;scene.add(ground);
  const draw=()=>{renderer.render(scene,camera);if(!runtime.cancelled)canvas.style.backgroundImage=`url("${renderCanvas.toDataURL('image/webp',.86)}")`;};draw();
  let cleaned=false;const cleanup=()=>{if(cleaned)return;cleaned=true;scene.traverse((object)=>{if(object.isMesh){object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(material=>material?.dispose());else object.material?.dispose();}});renderer.dispose();renderer.forceContextLoss?.();};
  runtime.cleanup=cleanup;
  const [wood,landscape]=await Promise.all([floorTexture(),viewTexture()]);
  if(!runtime.cancelled){
    if (wood) { floorMat.map=wood;floorMat.color.set('#ffffff');floorMat.needsUpdate=true; }
    if (landscape) {
      materials.windowViews.forEach((view)=>{
        view.material.map=coverTexture(landscape,view.userData.windowAspect);
        view.material.color.set('#ffffff');
        view.material.needsUpdate=true;
      });
    }
    draw();
  }
  cleanup();runtime.cleanup=null;
}

export function renderTemplatePreviews(root=document, projects=[]) {
  const projectMap=new Map(projects.map(project=>[project.id,project]));
  root.querySelectorAll('canvas[data-template-preview]').forEach((canvas)=>renderTemplatePreview(canvas,canvas.dataset.templatePreview,projectMap.get(canvas.dataset.projectPreview)||null));
}

export function disposeTemplatePreviews(root=document) {
  root.querySelectorAll('canvas[data-template-preview]').forEach((canvas)=>{
    const runtime=active.get(canvas);
    if (!runtime) return;
    runtime.cancelled=true;runtime.cleanup?.();canvas.style.backgroundImage='';active.delete(canvas);
  });
}
