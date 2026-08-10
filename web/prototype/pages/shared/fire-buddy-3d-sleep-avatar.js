import { createFireBuddy3DAvatar } from './fire-buddy-3d-avatar.js';

function makeClosedEye(THREE,x,resources) {
  const curve=new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x-.105,-.16,.87),
    new THREE.Vector3(x,-.225,.90),
    new THREE.Vector3(x+.105,-.16,.87)
  );
  const geometry=new THREE.TubeGeometry(curve,18,.018,8,false);
  // A matte curve prevents the seated model's eye-glint look from appearing
  // as white dots on closed eyelids.
  const material=new THREE.MeshBasicMaterial({color:'#3e241c'});
  resources.push(geometry,material);
  return new THREE.Mesh(geometry,material);
}

function makeSleepSmile(THREE,resources) {
  const curve=new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-.10,-.39,.86),
    new THREE.Vector3(0,-.45,.885),
    new THREE.Vector3(.10,-.39,.86)
  );
  const geometry=new THREE.TubeGeometry(curve,18,.019,8,false);
  const material=new THREE.MeshBasicMaterial({color:'#f04d24'});
  resources.push(geometry,material);
  return new THREE.Mesh(geometry,material);
}

function makeZSprite(THREE,label,size,resources) {
  if (typeof document==='undefined') return null;
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=128;
  const context=canvas.getContext('2d');
  context.clearRect(0,0,128,128);
  context.font='800 82px system-ui, sans-serif';
  context.textAlign='center';
  context.textBaseline='middle';
  context.lineWidth=8;
  context.strokeStyle='rgba(255,255,255,.92)';
  context.strokeText(label,64,66);
  context.fillStyle='#a86531';
  context.fillText(label,64,66);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,opacity:0});
  resources.push(texture,material);
  const sprite=new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  return sprite;
}

export function createFireBuddy3DSleepAvatar({THREE,scale=.5,showZ=true}={}) {
  if (!THREE) throw new Error('createFireBuddy3DSleepAvatar requires THREE');

  const base=createFireBuddy3DAvatar({THREE,scale:1});
  const root=new THREE.Group();
  root.name='fire-buddy-3d-sleep-avatar';
  root.scale.setScalar(scale);
  root.add(base.root);

  const resources=[];
  const character=base.root.children.find(child=>child.isGroup);
  if (!character) throw new Error('Fire Buddy sleep pose could not find character root');

  const leftArm=character.getObjectByName('left-arm');
  const rightArm=character.getObjectByName('right-arm');
  const leftFoot=character.getObjectByName('left-foot');
  const rightFoot=character.getObjectByName('right-foot');

  // Replace the awake face without changing the shared model implementation.
  // Keep references because base.update() normally reveals the awake mouth.
  const awakeFaceParts=[];
  for (const child of character.children) {
    if (!child.isMesh) continue;
    const {x,y,z}=child.position;
    const isAwakeEye=Math.abs(Math.abs(x)-.28)<.04 && y>-.25 && y<-.08 && z>.78;
    const isAwakeMouth=child.geometry?.type==='TubeGeometry' && y===0;
    if (isAwakeEye || isAwakeMouth) {
      child.visible=false;
      awakeFaceParts.push(child);
    }
  }
  const leftClosedEye=makeClosedEye(THREE,-.28,resources);
  const rightClosedEye=makeClosedEye(THREE,.28,resources);
  const sleepSmile=makeSleepSmile(THREE,resources);
  character.add(leftClosedEye,rightClosedEye,sleepSmile);

  const zSprites=[];
  if (showZ) {
    const small=makeZSprite(THREE,'Z',.34,resources);
    const large=makeZSprite(THREE,'Z',.48,resources);
    if (small && large) {
      small.position.set(.76,1.54,-.38);
      large.position.set(1.08,1.92,-.68);
      small.userData.sleepBaseY=1.54;
      large.userData.sleepBaseY=1.92;
      root.add(small,large);
      zSprites.push(small,large);
    }
  }

  let disposed=false;
  const update=(time=(globalThis.performance?.now?.()??Date.now())/1000)=>{
    if (disposed) return;
    base.update('sit',time,0,.016);
    for (const part of awakeFaceParts) part.visible=false;

    // Side-prone sleep: the two small shapes in front are forepaws. The larger
    // rounded shape at the back is a hind foot whose root overlaps the body.
    const breathe=Math.sin(time*1.35);
    const sleepyTwitch=Math.sin(time*2.55)*.011+Math.sin(time*.72)*.006;
    character.rotation.set(-.06+sleepyTwitch*.55,.04,.22+sleepyTwitch*1.15);
    character.position.set(-.03+sleepyTwitch*.30,.92+breathe*.027+sleepyTwitch*.52,.02);
    // Preserve the seated avatar's flame proportions. Sleeping is conveyed by
    // the lean and limb placement, never by flattening or widening the body.
    character.scale.set(1-breathe*.006,1+breathe*.014,1-breathe*.004);

    leftArm?.position.set(-.43,-.79,.70);
    rightArm?.position.set(.25,-.78,.74);
    if (leftArm) {
      leftArm.rotation.set(-.10,0,.12);
      leftArm.scale.set(.92,.76,.98);
    }
    if (rightArm) {
      rightArm.rotation.set(-.12,0,-.10);
      rightArm.scale.set(.96,.79,1.02);
    }
    // The far hind foot only peeks out below the near one. Both overlap the
    // body silhouette so the round heel reads as connected, not pasted on.
    leftFoot?.position.set(.70,-.88,-.22);
    rightFoot?.position.set(.88,-.85,.04);
    if (leftFoot) {
      leftFoot.rotation.set(.08,Math.PI/2,-.08);
      leftFoot.scale.set(1,.76,.96);
    }
    if (rightFoot) {
      // Rotate the sole plane toward the outside (+X). Its rounded heel stays
      // buried in the body while the flat end points away from the character.
      rightFoot.rotation.set(.02,Math.PI/2,-.10);
      rightFoot.scale.set(1,.76,.96);
    }

    const shadow=base.root.children.find(child=>child.isMesh && child.geometry?.type==='CircleGeometry');
    if (shadow) {
      shadow.visible=true;
      shadow.scale.set(1.62,.72,1);
      shadow.material.opacity=.17+breathe*.012;
    }

    zSprites.forEach((sprite,index)=>{
      const phase=(time*.22+index*.46)%1;
      const envelope=Math.sin(phase*Math.PI);
      sprite.material.opacity=envelope*.58;
      sprite.position.y=sprite.userData.sleepBaseY+phase*(index?.16:.12);
      sprite.scale.setScalar((index?.48:.34)*(1+phase*.12));
    });
  };

  const dispose=()=>{
    if (disposed) return;
    disposed=true;
    root.parent?.remove(root);
    for (const resource of resources) resource.dispose?.();
    base.dispose();
    root.clear();
  };

  update(0);
  return {root,update,dispose,get disposed(){return disposed;}};
}
