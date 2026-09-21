import * as THREE from 'three';
import { kindMeta } from './explorer-model.js';

// Reference-inspired instrument: shared disc, radial sectors, masts and crowns.
// These structures summarize the snapshot; the original entities remain pickable.
export function buildObservatory(parent, districts, fitPoints) {
  const clusters=new Map();
  if(!districts.length)return clusters;
  const radius=districts[0].platformRadius;
  const lineMaterial=(color,opacity=.3)=>new THREE.LineBasicMaterial({color,transparent:true,opacity});
  const line=(group,points,color,opacity)=>{const object=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),lineMaterial(color,opacity));group.add(object);return object;};
  const ring=(group,r,y,color,opacity=.4)=>{
    const points=Array.from({length:97},(_,i)=>new THREE.Vector3(Math.cos(i/96*Math.PI*2)*r,y,Math.sin(i/96*Math.PI*2)*r));
    return line(group,points,color,opacity);
  };
  const disc=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,.7,128),new THREE.MeshStandardMaterial({color:0x152331,metalness:.65,roughness:.55}));
  disc.position.y=-.5;parent.add(disc);
  for(const fraction of [.24,.5,.76,1])ring(parent,radius*fraction,0,0x6d8ba5,fraction===1?.65:.16);
  for(let i=0;i<districts.length;i++){
    const a=districts[i].angle-Math.PI/districts.length;
    line(parent,[new THREE.Vector3(0,.05,0),new THREE.Vector3(Math.cos(a)*radius,.05,Math.sin(a)*radius)],0x7891a6,.26);
  }
  for(let i=0;i<72;i++){
    const a=i/72*Math.PI*2,r=radius-(i%6? .5:1.4);
    line(parent,[new THREE.Vector3(Math.cos(a)*r,.05,Math.sin(a)*r),new THREE.Vector3(Math.cos(a)*radius,.05,Math.sin(a)*radius)],0x9bb2c5,i%6?.22:.55);
  }
  const hub=new THREE.Mesh(new THREE.SphereGeometry(3,32,20),new THREE.MeshStandardMaterial({color:0x263b4d,metalness:.8,roughness:.27}));
  hub.position.y=2;parent.add(hub);ring(parent,3.8,.1,0x93b6cf,.8);
  for(const d of districts){
    const group=new THREE.Group();group.position.set(d.x,0,d.z);parent.add(group);clusters.set(d.kind,group);
    const color=kindMeta(d.kind).color;
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.14,.38,d.height,12),new THREE.MeshStandardMaterial({color,metalness:.7,roughness:.38,transparent:true,opacity:.6}));
    mast.position.y=d.height/2;group.add(mast);
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(d.capRadius,d.capRadius,.18,64),new THREE.MeshStandardMaterial({color,metalness:.35,roughness:.45,transparent:true,opacity:.8,side:THREE.DoubleSide}));
    cap.position.y=d.height;group.add(cap);
    ring(group,d.capRadius,d.height+.12,color,.9);
    ring(group,d.capRadius,d.height-2,color,.45);
    ring(group,2.1,.1,color,.8);
    ring(group,d.orbit,Math.max(1,d.height*.48),color,.13);
    for(let y=4;y<d.height;y+=4)line(group,[new THREE.Vector3(-.4,y,0),new THREE.Vector3(.4,y,0)],color,.65);
    group.traverse(o=>{if(o.material)o.userData.baseOpacity=o.material.opacity;});
    for(const dx of [-d.capRadius,d.capRadius])for(const dz of [-d.capRadius,d.capRadius])fitPoints.push(new THREE.Vector3(d.x+dx,d.height+3,d.z+dz));
  }
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2;fitPoints.push(new THREE.Vector3(Math.cos(a)*radius,0,Math.sin(a)*radius));}
  return clusters;
}
