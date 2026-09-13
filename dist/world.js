import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {DayPlayback} from './playback.js';
import {PRODUCTS,PERSONALITIES,gameMoney} from './engine.js';

const COLORS=[0x72b8dc,0xdd796a,0xa27c5c,0xe8be62,0xc9a3da,0x88b780];
const SPOTS=[-7.2,-2.4,2.4,7.2];
const SKINS=[0xe9b58f,0xae7652,0x734b38,0xf6d0b1];
const SHIRTS=[0xe7aa61,0x658ca8,0xc87885,0x8ca778,0x9b89b2,0xe4d7b0];
const NAMES=['Robin','Avery','Mika','Jules','Sam','Riley','Alex','Casey','Taylor','Morgan','Noor','Jamie'];
const clamp=THREE.MathUtils.clamp;

export class PlazaWorld {
  constructor(host,{onSelect,onReceipt,onProgress,onComplete}={}){
    this.host=host;this.callbacks={onSelect,onReceipt,onProgress,onComplete};
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xb6d6d8);this.scene.fog=new THREE.Fog(0xb6d6d8,48,105);
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.domElement.setAttribute('aria-label','Interactive 3D Autobazar. Drag to orbit, scroll to zoom, click a machine or customer to inspect.');
    this.renderer.domElement.tabIndex=0;host.append(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(40,1,.1,140);this.camera.position.set(17,19,26);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,.6,0);
    this.controls.enableDamping=true;this.controls.minDistance=7;this.controls.maxDistance=48;this.controls.maxPolarAngle=Math.PI*.46;
    this.controls.minPolarAngle=.18;this.controls.maxTargetRadius=12;this.controls.update();this.controls.saveState();
    this.geometry=new Map();this.materials=new Map();this.textures=new Set();this.npcs=[];this.floaters=[];this.machines=[];this.pickables=[];this.clouds=[];
    this.playback=new DayPlayback();this.paused=false;this.speed=1;this.weather='Mild';this.time=0;this.lastStamp=0;this.reportTimer=0;
    this.hemi=new THREE.HemisphereLight(0xe5f3ff,0x7b8865,2.6);this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xffedcd,3.5);this.sun.position.set(-10,22,10);this.sun.castShadow=true;
    Object.assign(this.sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:.5,far:65});this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.0006;this.scene.add(this.sun);
    this.buildPlaza();PERSONALITIES.forEach((a,i)=>this.buildMachine(a,i));this.buildWeather();this.buildVisitors();
    this.pointer=new THREE.Vector2();this.ray=new THREE.Raycaster();
    this.down=e=>{this.downPoint=[e.clientX,e.clientY];};
    this.up=e=>{if(this.downPoint&&Math.hypot(e.clientX-this.downPoint[0],e.clientY-this.downPoint[1])<5)this.pick(e);};
    this.renderer.domElement.addEventListener('pointerdown',this.down);this.renderer.domElement.addEventListener('pointerup',this.up);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
    this.visibility=()=>{this.lastStamp=0;};document.addEventListener('visibilitychange',this.visibility);
    this.renderer.setAnimationLoop(stamp=>this.frame(stamp));
  }
  mat(color,extra={}){const key=JSON.stringify([color,extra]);if(!this.materials.has(key))this.materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.7,...extra}));return this.materials.get(key);}
  shape(kind,args){const key=kind+args.join(',');if(!this.geometry.has(key))this.geometry.set(key,new THREE[kind](...args));return this.geometry.get(key);}
  mesh(parent,kind,args,material,x=0,y=0,z=0){const m=new THREE.Mesh(this.shape(kind,args),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  box(parent,w,h,d,color,x=0,y=0,z=0,extra={}){return this.mesh(parent,'BoxGeometry',[w,h,d],this.mat(color,extra),x,y,z);}
  ball(parent,r,color,x=0,y=0,z=0){return this.mesh(parent,'SphereGeometry',[r,10,7],this.mat(color),x,y,z);}
  cylinder(parent,r1,r2,h,color,x=0,y=0,z=0,segments=12){return this.mesh(parent,'CylinderGeometry',[r1,r2,h,segments],this.mat(color),x,y,z);}
  label(text,color='#f7f2dc',width=3){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const c=canvas.getContext('2d');
    c.fillStyle='#243a35';c.beginPath();c.roundRect(4,8,504,112,22);c.fill();c.fillStyle=color;c.font='bold 51px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,64,465);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.textures.add(texture);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:true}));sprite.scale.set(width,width/4,1);return sprite;
  }
  buildPlaza(){
    const s=this.scene;
    this.box(s,28,1.2,22,0x617d57,0,-.78,0);this.box(s,27.6,.16,21.6,0xa7b987,0,-.1,0);
    this.box(s,22,.1,15.6,0xded3b8,0,.02,.6);this.box(s,28,.08,3,0xd9ccb2,0,.025,6);
    // Inlaid paths and expansion joints, kept shallow so characters walk on the surface.
    for(let x=-10;x<=10;x+=2)this.box(s,.024,.015,15.6,0xc2b799,x,.082,.6);
    for(let z=-6;z<=8;z+=2)this.box(s,22,.015,.024,0xc2b799,0,.083,z);
    this.box(s,21,.22,3.3,0x9caa97,0,.16,-2.5);this.box(s,21.2,.09,.22,0xf2ead1,0,.31,-.8);
    // Café backdrop, striped awning and windows.
    this.box(s,9,4,2.6,0xe6bc9c,0,2,-8.4);this.box(s,9.5,.3,3,0x476659,0,4.16,-8.4);
    for(const x of [-2.9,0,2.9]){this.box(s,2.1,1.8,.08,0x324c4b,x,2.3,-7.04);this.box(s,.07,1.8,.12,0xf3debb,x,2.3,-6.98);}
    for(let i=0;i<12;i++){const awning=this.box(s,.76,.12,1.7,i%2?0xf4e7c6:0xda886c,-4.18+i*.76,3.42,-6.5);awning.rotation.x=.14;}
    const sign=this.label('THE DAILY GRIND','#f1d19c',4.5);sign.position.set(0,4.75,-8);s.add(sign);
    for(const [x,z,scale] of [[-11,-7,1.3],[11,-7,1.25],[-12,1,1.1],[12,1,1.15],[-11,8,.9],[11,8,.95]])this.tree(x,z,scale);
    for(const [x,z] of [[-8,6],[8,6]])this.bench(x,z);
    for(const x of [-10,10]){this.cylinder(s,.08,.12,4.3,0x344b40,x,2.15,-4.8);this.ball(s,.28,0xffe6a4,x,4.35,-4.8);this.cylinder(s,.5,.24,.2,0x344b40,x,4.65,-4.8);}
    for(const x of [-5.5,5.5]){this.cylinder(s,.7,.5,.55,0xb47f5d,x,.34,6.9);for(let i=0;i<6;i++)this.ball(s,.34,0x688557,x+Math.sin(i)*.35,.78,6.9+Math.cos(i)*.35);}
    // Bistro tables and parasols behind the machines.
    for(const x of [-7,7]){
      this.cylinder(s,.08,.1,1.15,0x5d6955,x,.58,-6.4);this.cylinder(s,.8,.8,.1,0xddba83,x,1.2,-6.4);
      this.cylinder(s,.035,.035,3,0x706a58,x,1.5,-6.4);this.cylinder(s,0,1.5,.5,x<0?0xc5b8cc:0xe3af77,x,3,-6.4,10);
      for(const dx of [-1,1])this.box(s,.48,.65,.48,0x536f5c,x+dx,.32,-6.4);
    }
    // Bike rack and a small parked delivery van at the rear edge.
    this.box(s,2.4,1.3,1.15,0xe7d9b1,-10,.8,-9);this.box(s,.7,.95,1.13,0xb86e58,-8.75,.63,-9);
    this.box(s,.03,.48,.88,0x597d83,-8.37,1.03,-9);
    for(const x of [-10.6,-8.8])for(const z of [-9.63,-8.37]){const w=this.cylinder(s,.29,.29,.15,0x30413c,x,.3,z);w.rotation.x=Math.PI/2;}
    const entry=this.label('AUTOBAZAR','#ffffff',4.3);entry.position.set(0,.52,9.6);s.add(entry);
  }
  tree(x,z,size){const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(size);this.scene.add(g);this.cylinder(g,.16,.25,2.3,0x826d4d,0,1.15);this.ball(g,1.15,0x759360,0,2.9);this.ball(g,.95,0x8da76e,-.55,3.5,.1);this.ball(g,.8,0x657f55,.65,3.45,-.2);}
  bench(x,z){const g=new THREE.Group();g.position.set(x,0,z);this.scene.add(g);for(let i=0;i<3;i++)this.box(g,2.25,.11,.16,0xb29163,0,.65,-.24+i*.2);for(let i=0;i<3;i++)this.box(g,2.25,.18,.1,0xb29163,0,.92+i*.22,-.38);for(const dx of [-.85,.85])this.box(g,.12,.7,.65,0x425c4e,dx,.32);}
  buildMachine(agent,index){
    const g=new THREE.Group();g.position.set(SPOTS[index],.28,-2.6);g.userData={kind:'machine',id:agent.id};this.scene.add(g);this.pickables.push(g);
    const color=new THREE.Color(agent.color);
    this.box(g,2.6,3.85,1.45,color,0,1.94);this.box(g,2.68,.18,1.53,0xf5ead0,0,3.9);
    this.box(g,2.4,.3,1.3,0x283d36,0,.18);this.box(g,1.75,2.38,.09,0x273d3d,-.28,2.17,.77);
    for(const y of [1.33,2.02,2.72])this.box(g,1.7,.06,.38,0xe6d9b8,-.28,y,.87);
    const products=[];
    PRODUCTS.forEach((p,i)=>{const row=Math.floor(i/2),col=i%2;const slots=[];for(let n=0;n<3;n++){
      const px=-.93+col*.82+n*.21,py=2.78-row*.69;
      const slot=new THREE.Group();g.add(slot);
      if(p.category==='drink'){this.cylinder(slot,.079,.084,.38,COLORS[i],px,py+.21,.88,8);this.cylinder(slot,.052,.052,.055,0xf2ead3,px,py+.43,.88,8);}else this.box(slot,.15,.34,.12,COLORS[i],px,py+.2,.9);
      slots.push(slot);
    }products.push(slots);});
    this.box(g,1.76,2.43,.025,0xa2dae2,-.28,2.17,1.06,{transparent:true,opacity:.13,roughness:.15,depthWrite:false});
    this.box(g,.43,.6,.08,0x223f3f,1,2.83,.78);this.box(g,.31,.17,.09,0x9ce6c4,1,2.98,.84,{emissive:0x5bb78c,emissiveIntensity:.45});
    for(let row=0;row<3;row++)for(let col=0;col<2;col++)this.ball(g,.045,0xf5edc9,.9+col*.18,2.68-row*.17,.85);
    this.box(g,.32,.06,.1,0x23302d,1,1.86,.82);this.box(g,1.73,.42,.12,0x172924,-.28,.73,.8);
    this.box(g,1.67,.06,.38,0x43594b,-.28,.51,.92);
    const title=this.label(agent.name.toUpperCase(),agent.color,2.1);title.position.set(0,4.45,0);g.add(title);
    const selection=this.mesh(g,'RingGeometry',[1.6,1.72,48],new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.85}),0,-.15,0);selection.rotation.x=-Math.PI/2;selection.visible=false;
    const status=this.label('WAITING','#eee3c9',1.6);status.position.set(0,3.6,.85);status.scale.y=.36;g.add(status);
    const closed=this.label('CLOSED','#eee3c9',1.6);closed.position.copy(status.position);closed.scale.y=.36;closed.visible=false;g.add(closed);
    this.machines.push({g,products,selection,status,closed,title,labelName:agent.name,agent,stock:{},flash:0});
  }
  buildWeather(){
    for(let i=0;i<7;i++){
      const g=new THREE.Group();g.position.set(-22+i*7,12+(i%3)*1.3,-15-(i%2)*5);
      for(let j=0;j<4;j++)this.ball(g,1.1+j%2*.4,0xf7f6df,j*1.4,Math.sin(j)*.3,0).scale.set(1.5,.65,1);
      this.scene.add(g);this.clouds.push(g);
    }
    const positions=new Float32Array(720*6);
    for(let i=0;i<720;i++){const o=i*6;positions[o]=(Math.random()-.5)*40;positions[o+1]=Math.random()*18;positions[o+2]=(Math.random()-.5)*28;positions[o+3]=positions[o]-.08;positions[o+4]=positions[o+1]+.4;positions[o+5]=positions[o+2];}
    this.rainGeometry=new THREE.BufferGeometry();this.rainGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.rain=new THREE.LineSegments(this.rainGeometry,new THREE.LineBasicMaterial({color:0xd7e8ef,transparent:true,opacity:.5}));this.rain.visible=false;this.scene.add(this.rain);
    this.puddles=[];for(const [x,z] of [[-6,2],[4,5],[8,1],[-2,7]]){const m=this.mesh(this.scene,'CircleGeometry',[.75,24],this.mat(0x8bb8bf,{transparent:true,opacity:.38,roughness:.06}),x,.1,z);m.rotation.x=-Math.PI/2;m.scale.x=1.8;m.visible=false;this.puddles.push(m);}
  }
  character(index){
    const g=new THREE.Group(),skin=SKINS[index%4],shirt=SHIRTS[index%6];
    const torso=this.box(g,.39,.47,.27,shirt,0,.95,0);
    this.ball(g,.24,skin,0,1.47,0);const hair=this.ball(g,.245,[0x41372f,0x8a5d3c,0xcfab70][index%3],0,1.55,-.04);hair.scale.y=.7;
    for(const x of [-.085,.085])this.ball(g,.023,0x293331,x,1.48,.215);
    const legs=[],arms=[];
    for(const side of [-1,1]){const leg=new THREE.Group();leg.position.set(side*.115,.71,0);g.add(leg);this.box(leg,.15,.43,.16,0x465b62,0,-.23);this.box(leg,.17,.12,.26,0xefe2bf,0,-.46,.045);legs.push(leg);
      const arm=new THREE.Group();arm.position.set(side*.25,1.15,0);g.add(arm);this.box(arm,.12,.27,.15,shirt,0,-.12);this.ball(arm,.075,skin,0,-.31);arms.push(arm);}
    if(index%3===0){this.box(g,.33,.37,.17,0xb77d50,0,1.0,-.24);this.box(g,.39,.09,.05,0x87613e,0,1.16,-.34);}
    if(index%4===0){this.cylinder(g,.24,.24,.12,0xe4c685,0,1.74);this.cylinder(g,.32,.32,.035,0xe4c685,0,1.7);}
    const bag=this.box(g,.21,.27,.13,0xdcb876,.35,.67,.12);bag.visible=false;
    const umbrella=new THREE.Group();g.add(umbrella);this.cylinder(umbrella,.024,.024,1,0x667d7c,.3,1.55);this.cylinder(umbrella,0,.77,.34,shirt,.3,2.1,0,10);umbrella.visible=this.weather==='Rainy';
    g.scale.setScalar(.9+index%3*.045);this.scene.add(g);return {g,torso,legs,arms,bag,umbrella};
  }
  buildVisitors(){this.visitors=Array.from({length:5},(_,i)=>this.character(i+50));}
  setState(state){
    this.state=state;this.weather=state.weather;this.rain.visible=this.weather==='Rainy';this.puddles.forEach(p=>p.visible=this.rain.visible);
    const sky=this.weather==='Rainy'?0x819ca6:this.weather==='Hot'?0xe1d7b5:0xb6d6d8;this.scene.background.set(sky);this.scene.fog.color.set(sky);
    this.sun.intensity=this.weather==='Rainy'?1.1:3.5;this.hemi.intensity=this.weather==='Rainy'?2:2.6;
    this.machines.forEach((m,i)=>{
      m.agent=state.agents[i];m.stock={...m.agent.inventory};this.updateStock(m);m.status.visible=!m.agent.registered;m.closed.visible=m.agent.registered&&!m.agent.active;
      const labelName=state.mode==='remote'&&!m.agent.registered?'Open seat':m.agent.name;
      if(m.labelName!==labelName){m.g.remove(m.title);this.textures.delete(m.title.material.map);m.title.material.map.dispose();m.title.material.dispose();m.title=this.label(labelName.toUpperCase(),m.agent.color,2.1);m.title.position.set(0,4.45,0);m.g.add(m.title);m.labelName=labelName;}
    });
    this.visitors.forEach(v=>{v.g.visible=state.day===0;v.umbrella.visible=this.rain.visible;});
  }
  updateStock(m){PRODUCTS.forEach((p,i)=>m.products[i].forEach((mesh,n)=>{mesh.visible=(m.stock[p.id]||0)>n*10;}));}
  loadDay(state){
    this.clearActors();this.setState(state);this.playback.load(state.customerTransactions);
    this.machines.forEach(m=>{for(const p of PRODUCTS)m.stock[p.id]+=m.agent.lastSales[p.id];this.updateStock(m);});
    this.npcs=this.playback.receipts.map((receipt,i)=>({receipt,i,actor:null}));this.doneNotified=false;
  }
  clearActors(){for(const n of this.npcs)if(n.actor)this.scene.remove(n.actor.g);this.npcs=[];for(const f of this.floaters)this.removeFloater(f);this.floaters=[];this.playback.reset();}
  reset(state){this.clearActors();this.setState(state);this.home();}
  selectMachine(id,focus=true){this.machines.forEach(m=>{m.selection.visible=m.agent.id===id;});if(focus){const m=this.machines.find(m=>m.agent.id===id);this.focusTo=new THREE.Vector3(m.g.position.x,1.7,m.g.position.z);this.cameraTo=new THREE.Vector3(m.g.position.x+4.5,7,m.g.position.z+9);}}
  home(){this.focusTo=new THREE.Vector3(0,.6,0);this.cameraTo=new THREE.Vector3(17,19,26);this.controls.autoRotate=false;}
  pick(e){const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);
    const hit=this.ray.intersectObjects([...this.pickables,...this.npcs.filter(n=>n.actor?.g.visible).map(n=>n.actor.g)],true)[0];if(!hit)return;
    let object=hit.object;while(object&&!object.userData.kind)object=object.parent;if(!object)return;
    if(object.userData.kind==='machine')this.selectMachine(object.userData.id);
    this.callbacks.onSelect?.(object.userData);
  }
  spawn(n){const a=this.character(n.i+this.state.day*7);a.bag.material=this.mat(COLORS[PRODUCTS.findIndex(p=>p.id===n.receipt.product)]);a.g.userData={kind:'customer',name:NAMES[(n.i+this.state.day)%NAMES.length],receipt:n.receipt};n.actor=a;}
  updateNpc(n,t){
    const age=t-n.i*.48;if(age<0||age>8){if(n.actor){n.actor.g.visible=false;n.actor.g.userData.status='Left the plaza with purchase';}return;}
    if(!n.actor)this.spawn(n);const a=n.actor;a.g.visible=true;
    const index=PERSONALITIES.findIndex(p=>p.id===n.receipt.agent),x=SPOTS[index],side=index<2?-1:1,lane=(n.i%3-1)*.16;
    const start=new THREE.Vector3(side*12,.1,6+lane),corner=new THREE.Vector3(x+lane,.1,3.4),end=new THREE.Vector3(x+.2+lane,.1,-.6);
    const walk=age<3.7||age>4.7;let point,direction;
    if(age<2.1){point=start.clone().lerp(corner,age/2.1);direction=corner.clone().sub(start);}
    else if(age<3.7){point=corner.clone().lerp(end,(age-2.1)/1.6);direction=end.clone().sub(corner);}
    else if(age<4.7){point=end;direction=new THREE.Vector3(0,0,-1);}
    else if(age<6){point=end.clone().lerp(corner,(age-4.7)/1.3);direction=corner.clone().sub(end);}
    else{point=corner.clone().lerp(start,(age-6)/2);direction=start.clone().sub(corner);}
    a.g.position.copy(point);a.g.rotation.y=Math.atan2(direction.x,direction.z);
    a.legs.forEach((leg,i)=>leg.rotation.x=walk?Math.sin(age*13+i*Math.PI)*.6:0);
    a.arms.forEach((arm,i)=>arm.rotation.x=walk?Math.sin(age*13+i*Math.PI+Math.PI)*.4:(i===1?-1:0));
    a.torso.position.y=.95+(walk?Math.abs(Math.sin(age*13))*.035:0);a.bag.visible=age>=4;
    a.g.userData.status=age<3.7?'Walking to the machine':age<4?'Choosing a product':age<4.7?'Collecting purchase':'Leaving with purchase';
  }
  purchase(receipt){const m=this.machines.find(m=>m.agent.id===receipt.agent);m.stock[receipt.product]=Math.max(0,m.stock[receipt.product]-1);this.updateStock(m);m.flash=1;
    const sprite=this.label(`+${gameMoney(receipt.payment)}`,m.agent.color,1.5);sprite.position.set(m.g.position.x,3.5,-1.3);this.scene.add(sprite);this.floaters.push({sprite,life:0});this.callbacks.onReceipt?.(receipt);
  }
  removeFloater(f){this.scene.remove(f.sprite);const texture=f.sprite.material.map;this.textures.delete(texture);texture.dispose();f.sprite.material.dispose();}
  skip(){if(!this.playback.active)return;for(const receipt of this.playback.advance(this.playback.duration))this.purchase(receipt);this.report();this.finish();}
  report(){this.callbacks.onProgress?.({progress:this.playback.progress,time:this.playback.time,total:this.playback.receipts.length,shown:this.playback.cursor,active:this.playback.active});}
  finish(){if(this.doneNotified)return;this.doneNotified=true;this.npcs.forEach(n=>{if(n.actor)n.actor.g.visible=false;});this.callbacks.onComplete?.();}
  frame(stamp){
    if(document.hidden){this.lastStamp=0;return;}const dt=this.lastStamp?Math.min((stamp-this.lastStamp)/1000,.06):0;this.lastStamp=stamp;if(!this.paused)this.time+=dt;
    if(this.focusTo){this.controls.target.lerp(this.focusTo,.08);this.camera.position.lerp(this.cameraTo,.08);if(this.camera.position.distanceTo(this.cameraTo)<.03){this.focusTo=null;this.cameraTo=null;}}
    this.controls.update(dt);
    if(this.playback.active&&!this.paused){
      const events=this.playback.advance(dt*this.speed);for(const e of events)this.purchase(e);
      for(const n of this.npcs)this.updateNpc(n,this.playback.time);
      const p=this.playback.progress;this.sun.position.set(-12+24*p,20-7*p,12);this.sun.color.set(this.weather==='Rainy'?0xe2e9ef:p>.7?0xffd0a0:0xffedcd);
      this.reportTimer+=dt;if(this.reportTimer>.1){this.report();this.reportTimer=0;}
      if(!this.playback.active){this.report();this.finish();}
    }
    if(!this.paused){
      this.clouds.forEach((c,i)=>{c.position.x+=dt*(.14+i*.015);if(c.position.x>32)c.position.x=-32;});
      this.visitors.forEach((v,i)=>{if(!v.g.visible)return;const t=this.time*.25+i;v.g.position.set(Math.sin(t)*9,.1,5+Math.cos(t*.8)*1.1);v.g.rotation.y=Math.cos(t)>0?Math.PI/2:-Math.PI/2;v.legs.forEach((l,j)=>l.rotation.x=Math.sin(this.time*6+j*Math.PI)*.45);});
      if(this.rain.visible){const p=this.rainGeometry.attributes.position.array;for(let i=0;i<p.length;i+=6){p[i+1]-=dt*15;p[i+4]-=dt*15;if(p[i+1]<0){p[i+1]=18;p[i+4]=18.4;}}this.rainGeometry.attributes.position.needsUpdate=true;}
      for(let i=this.floaters.length-1;i>=0;i--){const f=this.floaters[i];f.life+=dt*this.speed;f.sprite.position.y+=dt*this.speed*.7;f.sprite.material.opacity=Math.max(0,1-f.life/1.5);if(f.life>=1.5){this.removeFloater(f);this.floaters.splice(i,1);}}
    }
    this.renderer.render(this.scene,this.camera);
  }
  resize(){
    const {width,height}=this.host.getBoundingClientRect();if(!width||!height)return;this.camera.aspect=width/height;
    // Preserve the plaza's horizontal framing on portrait screens. Orbit and
    // zoom still work normally, including when focusing an individual machine.
    this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(20))/Math.min(1,this.camera.aspect/1.1)));
    this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);
  }
  dispose(){this.renderer.setAnimationLoop(null);this.resizeObserver.disconnect();document.removeEventListener('visibilitychange',this.visibility);this.controls.dispose();this.clearActors();this.scene.traverse(o=>{if(o.material?.isSpriteMaterial)o.material.dispose();});this.machines.forEach(m=>m.selection.material.dispose());for(const t of this.textures)t.dispose();for(const g of this.geometry.values())g.dispose();for(const m of this.materials.values())m.dispose();this.rainGeometry.dispose();this.rain.material.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
