function createFlameGeometry(THREE) {
  const rings = [
    { y:-.91, r:.43, cx: .00, depth:.70 },
    { y:-.80, r:.72, cx: .00, depth:.76 },
    { y:-.57, r:.91, cx: .00, depth:.80 },
    { y:-.25, r:1.00, cx: .01, depth:.82 },
    { y: .08, r:.97, cx: .03, depth:.84 },
    { y: .37, r:.86, cx: .03, depth:.86 },
    { y: .60, r:.69, cx:-.02, depth:.86 },
    { y: .79, r:.50, cx:-.10, depth:.84 },
    { y: .98, r:.30, cx:-.19, depth:.80 },
    { y:1.13, r:.13, cx:-.22, depth:.76 },
    { y:1.19, r:.025,cx:-.19, depth:.70 }
  ];
  const segments = 72;
  const vertices = [];
  const indices = [];
  for (const ring of rings) {
    for (let segment=0; segment<segments; segment+=1) {
      const angle=segment/segments*Math.PI*2;
      vertices.push(ring.cx+Math.cos(angle)*ring.r,ring.y,Math.sin(angle)*ring.r*ring.depth);
    }
  }
  for (let ring=0;ring<rings.length-1;ring+=1) {
    for (let segment=0;segment<segments;segment+=1) {
      const next=(segment+1)%segments;
      const a=ring*segments+segment;
      const b=ring*segments+next;
      const c=(ring+1)*segments+next;
      const d=(ring+1)*segments+segment;
      indices.push(a,d,b,b,d,c);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);
  const positions=geometry.attributes.position;
  const colors=[];
  const low=new THREE.Color('#ff7518');
  const middle=new THREE.Color('#ff9b19');
  const high=new THREE.Color('#ffe13b');
  for (let index=0;index<positions.count;index+=1) {
    const t=THREE.MathUtils.clamp((positions.getY(index)+.91)/2.1,0,1);
    const color=t<.48?low.clone().lerp(middle,t/.48):middle.clone().lerp(high,(t-.48)/.52);
    colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createFireBuddy3DAvatar({ THREE, scale=.5 }={}) {
  if (!THREE) throw new Error('createFireBuddy3DAvatar requires THREE');
  const root=new THREE.Group();
  root.name='fire-buddy-3d-avatar';
  root.scale.setScalar(scale);
  const resources=[];
  const contactShadowGeometry=new THREE.CircleGeometry(.72,48);
  const contactShadowMaterial=new THREE.MeshBasicMaterial({color:'#6f4028',transparent:true,opacity:.2,depthWrite:false});
  resources.push(contactShadowGeometry,contactShadowMaterial);
  const contactShadow=new THREE.Mesh(contactShadowGeometry,contactShadowMaterial);
  contactShadow.rotation.x=-Math.PI/2;
  contactShadow.position.y=.006;
  root.add(contactShadow);
  const character=new THREE.Group();
  root.add(character);
  const material=(options)=>{const value=new THREE.MeshPhysicalMaterial(options);resources.push(value);return value;};
  const bodyGeometry=createFlameGeometry(THREE);resources.push(bodyGeometry);
  const body=new THREE.Mesh(bodyGeometry,material({
    vertexColors:true,roughness:.34,metalness:0,clearcoat:.42,clearcoatRoughness:.3,
    sheen:.18,sheenColor:new THREE.Color('#ffca58')
  }));
  body.castShadow=true;
  character.add(body);

  const limbMaterial=material({color:'#ff8c20',roughness:.36,clearcoat:.32,clearcoatRoughness:.32});
  const blobGeometry=new THREE.SphereGeometry(1,36,24);resources.push(blobGeometry);
  const makeArm=(name,position,rotation)=>{
    const pivot=new THREE.Group();pivot.name=name;pivot.position.set(...position);pivot.rotation.z=rotation;
    const mesh=new THREE.Mesh(blobGeometry,limbMaterial);mesh.scale.set(.21,.36,.19);mesh.castShadow=true;pivot.add(mesh);character.add(pivot);
    return pivot;
  };
  const leftArm=makeArm('left-arm',[-.89,-.44,.02],-.22);
  const rightArm=makeArm('right-arm',[.89,-.44,.02],.22);

  const footGeometry=new THREE.SphereGeometry(1,40,28,Math.PI,Math.PI,0,Math.PI);resources.push(footGeometry);
  const soleGeometry=new THREE.CircleGeometry(1,48);resources.push(soleGeometry);
  const soleMaterial=material({color:'#ff9821',roughness:.4,clearcoat:.22,clearcoatRoughness:.38});
  const makeFoot=(name)=>{
    const pivot=new THREE.Group();pivot.name=name;
    const heel=new THREE.Mesh(footGeometry,limbMaterial);heel.scale.set(.31,.35,.28);heel.castShadow=true;pivot.add(heel);
    const sole=new THREE.Mesh(soleGeometry,soleMaterial);sole.scale.set(.31,.35,1);sole.position.z=.012;pivot.add(sole);
    character.add(pivot);return pivot;
  };
  const leftFoot=makeFoot('left-foot');
  const rightFoot=makeFoot('right-foot');

  const eyeMaterial=material({color:'#3e241c',roughness:.14,clearcoat:.75,clearcoatRoughness:.12});
  const eyeGeometry=new THREE.SphereGeometry(.105,24,16);resources.push(eyeGeometry);
  const glintGeometry=new THREE.SphereGeometry(.022,12,8);resources.push(glintGeometry);
  const glintMaterial=new THREE.MeshBasicMaterial({color:'#fff6dd'});resources.push(glintMaterial);
  const eyes=[];
  const glints=[];
  for (const x of [-.28,.28]) {
    const eye=new THREE.Mesh(eyeGeometry,eyeMaterial);eye.scale.set(.92,1.08,.48);eye.position.set(x,-.17,.815);character.add(eye);
    const glint=new THREE.Mesh(glintGeometry,glintMaterial);glint.position.set(x-.025,-.13,.865);character.add(glint);
    eyes.push(eye);
    glints.push(glint);
  }
  const smileCurve=new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-.14,-.40,.835),new THREE.Vector3(0,-.53,.885),new THREE.Vector3(.14,-.40,.835)
  );
  const mouthMaterial=material({color:'#f04d24',roughness:.3,clearcoat:.35,clearcoatRoughness:.28});
  const smileGeometry=new THREE.TubeGeometry(smileCurve,24,.026,10,false);resources.push(smileGeometry);
  const smile=new THREE.Mesh(smileGeometry,mouthMaterial);character.add(smile);
  const oMouthGeometry=new THREE.TorusGeometry(.075,.024,12,28);resources.push(oMouthGeometry);
  const oMouth=new THREE.Mesh(oMouthGeometry,mouthMaterial);
  oMouth.position.set(0,-.45,.86);
  oMouth.scale.set(.82,1.18,.7);
  oMouth.visible=false;
  character.add(oMouth);

  let state='walk';
  let sitMix=0;
  let facing=0;
  let reactionStarted=-Infinity;
  let reactionUntil=-Infinity;
  let reactionDuration=1.85;
  let reactionHeading=null;
  let reactionSide=1;
  const react=(kind='furniture',options={},time=(globalThis.performance?.now?.()??Date.now())/1000)=>{
    if (kind!=='furniture') return false;
    reactionStarted=time;
    reactionDuration=Number.isFinite(options.duration)?options.duration:1.85;
    reactionUntil=time+reactionDuration;
    reactionHeading=Number.isFinite(options.heading)?options.heading:null;
    reactionSide=Number(options.side)<0?-1:1;
    return true;
  };
  const update=(nextState,time,heading=null,delta=.016)=>{
    state=nextState==='sit'?'sit':'walk';
    const targetSit=state==='sit'?1:0;
    sitMix=THREE.MathUtils.lerp(sitMix,targetSit,1-Math.exp(-delta*10));
    const reacting=time<reactionUntil;
    const desiredHeading=reacting&&Number.isFinite(reactionHeading)?reactionHeading:heading;
    if (Number.isFinite(desiredHeading)) facing=THREE.MathUtils.lerp(facing,desiredHeading,1-Math.exp(-delta*12));
    root.rotation.y=facing;
    const step=reacting?0:Math.sin(time*7.4);
    const walkAmount=1-sitMix;
    const breathe=Math.sin(time*2)*.012;
    const walkY=1.20;
    const sitY=1.21+Math.sin(time*2)*.012;
    character.position.y=THREE.MathUtils.lerp(walkY,sitY,sitMix)+Math.abs(step)*.014*walkAmount;
    character.rotation.z=step*.025*walkAmount;
    character.scale.set(1-breathe*.42,1+breathe,1-breathe*.25);
    contactShadow.scale.setScalar(THREE.MathUtils.lerp(.92,1.08,sitMix)-Math.abs(step)*.025*walkAmount);
    contactShadow.material.opacity=THREE.MathUtils.lerp(.18,.24,sitMix);
    const leftLift=Math.max(0,step)*.10*(1-sitMix);
    const rightLift=Math.max(0,-step)*.10*(1-sitMix);
    leftFoot.position.set(
      THREE.MathUtils.lerp(-.48,-.52,sitMix),
      THREE.MathUtils.lerp(-1.188+leftLift,-.86,sitMix),
      THREE.MathUtils.lerp(.08+step*.045,.74,sitMix)
    );
    rightFoot.position.set(
      THREE.MathUtils.lerp(.48,.52,sitMix),
      THREE.MathUtils.lerp(-1.188+rightLift,-.86,sitMix),
      THREE.MathUtils.lerp(.08-step*.045,.74,sitMix)
    );
    leftFoot.rotation.x=THREE.MathUtils.lerp(Math.PI/2,0,sitMix);
    rightFoot.rotation.x=THREE.MathUtils.lerp(Math.PI/2,0,sitMix);
    leftFoot.rotation.z=THREE.MathUtils.lerp(0,-.08,sitMix);
    rightFoot.rotation.z=THREE.MathUtils.lerp(0,.08,sitMix);
    leftArm.rotation.z=THREE.MathUtils.lerp(-.58-step*.13,-.22,sitMix);
    rightArm.rotation.z=THREE.MathUtils.lerp(.58-step*.13,.22,sitMix);
    leftArm.rotation.x=0;
    rightArm.rotation.x=0;
    leftArm.position.set(-.89,-.44,.02);
    rightArm.position.set(.89,-.44,.02);
    if (reacting) {
      const progress=THREE.MathUtils.clamp((time-reactionStarted)/reactionDuration,0,1);
      const envelope=Math.sin(progress*Math.PI);
      const doublePoke=.86+.14*Math.sin(progress*Math.PI*4);
      const reach=envelope*doublePoke;
      const pokingArm=reactionSide<0?leftArm:rightArm;
      const restingArm=reactionSide<0?rightArm:leftArm;
      character.rotation.x=-.025*envelope;
      restingArm.rotation.z=reactionSide<0?.30:-.30;
      pokingArm.rotation.x=0;
      pokingArm.rotation.z=-reactionSide*(.24+1.05*reach);
      pokingArm.position.set(reactionSide*(.84+.48*reach),-.38,.10+.08*reach);
      smile.visible=false;
      oMouth.visible=true;
    } else {
      character.rotation.x=0;
      smile.visible=true;
      oMouth.visible=false;
    }
    const blinkClock=time%4.8;
    const blinkDistance=Math.abs(blinkClock-4.48);
    const eyeOpen=blinkDistance<.16?THREE.MathUtils.lerp(.12,1,blinkDistance/.16):1;
    for (const eye of eyes) eye.scale.y=1.08*eyeOpen;
    for (const glint of glints) glint.visible=eyeOpen>.45;
    smile.scale.y=1+Math.sin(time*1.35)*.035;
  };
  const dispose=()=>{
    root.parent?.remove(root);
    for (const resource of resources) resource.dispose?.();
    root.clear();
  };
  update('walk',0,0,1);
  return {root,update,react,dispose,get state(){return state;}};
}
