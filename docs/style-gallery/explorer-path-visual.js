import * as THREE from 'three';

export class PathVisual {
  constructor(key) {
    this.root=new THREE.Group();this.curve=null;this.signal=null;this.radius=.045;
    const material=(opacity,glow=false)=>new THREE.MeshBasicMaterial({color:0x7e8b9d,transparent:true,opacity,depthWrite:false,toneMapped:false,blending:glow?THREE.AdditiveBlending:THREE.NormalBlending});
    this.core=new THREE.Mesh(new THREE.BufferGeometry(),material(.6));this.core.userData.pathKey=key;
    this.glow=new THREE.Mesh(new THREE.BufferGeometry(),material(0,true));
    this.packets=new THREE.InstancedMesh(new THREE.SphereGeometry(.18,8,6),material(.95),12);
    this.halos=new THREE.InstancedMesh(new THREE.SphereGeometry(.42,8,6),material(.22,true),12);
    this.packets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.packets.frustumCulled=false;this.halos.frustumCulled=false;
    this.packets.count=0;this.halos.count=0;this.root.add(this.glow,this.core,this.halos,this.packets);
    this.matrix=new THREE.Matrix4();this.point=new THREE.Vector3();
  }
  setCurve(curve) {
    this.curve=curve;
    this.core.geometry.dispose();this.glow.geometry.dispose();
    this.core.geometry=new THREE.TubeGeometry(curve,Math.max(24,(curve.curves?.length||0)*6),this.radius,6,false);
    this.glow.geometry=new THREE.TubeGeometry(curve,Math.max(24,(curve.curves?.length||0)*6),this.radius*3.1,6,false);
  }
  setSignal(signal,{visible=true,opacity=1}={}) {
    this.signal=signal;this.root.visible=visible;this.opacity=opacity;
    if(this.radius!==signal.radius){this.radius=signal.radius;if(this.curve)this.setCurve(this.curve);}
    for(const mesh of [this.core,this.glow,this.packets,this.halos])mesh.material.color.set(signal.color);
    this.core.material.opacity=.72*opacity;this.glow.material.opacity=signal.glow*opacity;
    this.packets.material.color.lerp(new THREE.Color(0xffffff),.55);
    this.packets.material.opacity=.95*opacity;this.halos.material.opacity=.24*opacity;
    this.packets.count=signal.packetCount;this.halos.count=signal.packetCount;
  }
  tick(time,{reduced=false}={}) {
    if(!this.root.visible||!this.curve||!this.signal)return false;
    const {packetCount,speed,health,glow}=this.signal;
    for(let i=0;i<packetCount;i++){
      const t=(i/packetCount+(reduced?0:time*speed))%1;
      this.point.copy(this.curve.getPointAt(t));this.matrix.makeTranslation(this.point.x,this.point.y,this.point.z);
      this.packets.setMatrixAt(i,this.matrix);this.halos.setMatrixAt(i,this.matrix);
    }
    this.packets.instanceMatrix.needsUpdate=true;this.halos.instanceMatrix.needsUpdate=true;
    this.glow.material.opacity=glow*this.opacity*(health==='failing'&&!reduced?.8+.2*Math.sin(time*2):1);
    return !reduced&&(packetCount>0&&speed>0||health==='failing');
  }
}
