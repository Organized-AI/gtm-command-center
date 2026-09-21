import * as THREE from 'three';
export class RepairWorker {
  constructor(){
    this.root=new THREE.Group();this.actor=new THREE.Group();this.root.add(this.actor);this.root.visible=false;
    const material=color=>new THREE.MeshStandardMaterial({color,roughness:.5,emissive:color,emissiveIntensity:.12});
    const suit=material(0x9cff00),dark=material(0x17303b),helmet=material(0xffd26d),tool=material(0xc5eaff);
    const part=(geometry,mat,x,y,z,parent=this.actor)=>{const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);parent.add(mesh);return mesh;};
    part(new THREE.BoxGeometry(.85,1.05,.5),suit,0,1.45,0);
    part(new THREE.SphereGeometry(.4,12,8),helmet,0,2.22,0);
    part(new THREE.BoxGeometry(.6,.19,.12),dark,0,2.19,.34);
    part(new THREE.BoxGeometry(.65,.7,.25),dark,0,1.5,-.36);
    this.legs=[-.24,.24].map(x=>part(new THREE.BoxGeometry(.27,.8,.3),dark,x,.52,0));
    this.arm=part(new THREE.BoxGeometry(.22,.85,.25),suit,.59,1.4,.17);this.arm.rotation.x=-.8;
    part(new THREE.BoxGeometry(.22,.7,.25),suit,-.57,1.45,0);
    part(new THREE.CylinderGeometry(.1,.1,.65,8),tool,.7,1.16,.65).rotation.x=Math.PI/2;
    this.sparks=part(new THREE.OctahedronGeometry(.23),new THREE.MeshBasicMaterial({color:0xa7f5ff}),.7,1.05,1);
    this.beacon=part(new THREE.TorusGeometry(1.25,.08,6,32),new THREE.MeshBasicMaterial({color:0x9cff00}),0,.05,0);this.beacon.rotation.x=Math.PI/2;
    this.actor.scale.setScalar(1.65);
  }
  tick(job,curve,reduced=false,motion=true){
    this.root.visible=!!job&&!!curve;if(!this.root.visible)return false;
    const progress=Math.min(1,job.elapsed/7),working=progress>=.3&&progress<.8;
    const t=reduced||!motion?.52:progress<.3?.08+progress/.3*.44:progress<.8?.52:.52+(progress-.8)/.2*.25;
    this.root.position.copy(curve.getPointAt(t));this.root.position.y+=.2;
    const tangent=curve.getTangentAt(t);if(Math.hypot(tangent.x,tangent.z)>.01)this.actor.rotation.y=Math.atan2(tangent.x,tangent.z);
    const phase=job.elapsed*8;
    this.legs.forEach((leg,i)=>leg.rotation.x=reduced||!motion||working?0:Math.sin(phase+i*Math.PI)*.45);
    this.arm.rotation.x=working&&!reduced&&motion?-1.2+Math.sin(phase*.7)*.2:-.8;
    this.sparks.visible=working;this.sparks.scale.setScalar(reduced||!motion?1:1+Math.sin(phase*.5)*.25);
    return true;
  }
}
