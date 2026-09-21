import * as THREE from 'three';
const colors={web:0x00d5e8,server:0x9cff00};
function slabGeometry(width,depth,height=.55){
  const r=1.2,w=width/2,d=depth/2,s=new THREE.Shape();
  s.moveTo(-w+r,-d);s.lineTo(w-r,-d);s.quadraticCurveTo(w,-d,w,-d+r);s.lineTo(w,d-r);s.quadraticCurveTo(w,d,w-r,d);s.lineTo(-w+r,d);s.quadraticCurveTo(-w,d,-w,d-r);s.lineTo(-w,-d+r);s.quadraticCurveTo(-w,-d,-w+r,-d);
  const geo=new THREE.ExtrudeGeometry(s,{depth:height,bevelEnabled:false,curveSegments:5});geo.rotateX(-Math.PI/2);geo.translate(0,-height/2,0);return geo;
}
export function buildDistrict(parent,layout,fitPoints,selectedFloor,priorFloors=new Map()){
  const actors=[],hits=[],floors=new Map();
  const metal=new THREE.MeshStandardMaterial({color:0x657782,metalness:.65,roughness:.48});
  const darkMetal=new THREE.MeshStandardMaterial({color:0x172b38,metalness:.5,roughness:.62});
  function box(group,w,h,d,x,y,z,material=metal){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);group.add(mesh);return mesh;}
  function nameplate(group,text,width,x,y,z,accent){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#08121b';ctx.fillRect(0,0,512,80);ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.strokeRect(2,2,508,76);ctx.fillStyle=accent;ctx.font='bold 24px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,41,480);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,width*80/512),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));mesh.position.set(x,y,z);group.add(mesh);
  }
  function slab(group,w,d,y,color,opacity=1){
    const geo=slabGeometry(w,d),mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.75,metalness:.22,transparent:opacity<1,opacity}));mesh.position.y=y;group.add(mesh);
    const rim=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:0xa6bac7,transparent:true,opacity:.38}));rim.position.copy(mesh.position);group.add(rim);return mesh;
  }
  for(const b of layout.buildings){
    const group=new THREE.Group();group.position.set(b.x,0,b.z);parent.add(group);
    const base=slab(group,b.width+5,b.depth+5,0,0x101e28);base.userData.building=b.surface;hits.push(base);
    const baseOutlineGeometry=new THREE.BoxGeometry(b.width+5,.1,b.depth+5);
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(baseOutlineGeometry),new THREE.LineBasicMaterial({color:colors[b.surface],transparent:true,opacity:.5}));outline.position.y=.35;group.add(outline);baseOutlineGeometry.dispose();
    const accentMat=new THREE.MeshBasicMaterial({color:colors[b.surface]});
    for(const x of [-b.width/2-1,b.width/2+1])for(const z of [-b.depth/2-1,b.depth/2+1]){box(group,1.4,.8,1.4,x,.6,z,darkMetal);box(group,.55,.12,.55,x,1.06,z,accentMat);}
    box(group,7,1.8,2.2,0,1.25,b.depth/2+1.7,darkMetal);
    nameplate(group,b.surface==='web'?'GTM · WEB CONTAINER':'GTM · SERVER CONTAINER',b.width*.8,0,1.5,b.depth/2+2.9,b.surface==='web'?'#00d5e8':'#9cff00');
    for(let i=0;i<4;i++)box(group,.45,.3,.12,(i-1.5)*1.1,2,b.depth/2+2.85,accentMat);
    if(!b.count){slab(group,b.width,b.depth,2,0x1a2630,.3);}
    for(const dx of [-1,1])for(const dz of [-1,1])fitPoints.push(new THREE.Vector3(b.x+dx*(b.width/2+4),0,b.z+dz*(b.depth/2+4)));
  }
  for(const floor of layout.districts){
    const group=new THREE.Group();group.position.set(floor.x,floor.y,floor.z);parent.add(group);floors.set(floor.id,group);group.userData.target=group.position.clone();if(priorFloors.has(floor.id))group.position.copy(priorFloors.get(floor.id));
    const selected=selectedFloor===floor.id,accent=selected?0x9cff00:colors[floor.surface];
    const plate=slab(group,floor.width,floor.depth,0,selected?0x465738:0x344451);plate.userData.floorId=floor.id;hits.push(plate);
    const rail=new THREE.Mesh(new THREE.BoxGeometry(floor.width-2,.15,.16),new THREE.MeshBasicMaterial({color:accent}));rail.position.set(0,.4,floor.depth/2-.55);group.add(rail);
    const w=floor.width,d=floor.depth;
    const cornerMat=new THREE.MeshStandardMaterial({color:accent,metalness:.5,roughness:.45});
    const skinMat=new THREE.MeshStandardMaterial({color:floor.surface==='web'?0x254454:0x364936,metalness:.42,roughness:.64});
    // Cutaway container modules: ISO-like corner castings, a ribbed rear skin,
    // and open front/side bays keep the entities and walking lanes inspectable.
    for(const x of [-w/2+.45,w/2-.45])for(const z of [-d/2+.45,d/2-.45]){
      box(group,.38,5.9,.38,x,3.2,z);
      for(const y of [.55,6.1]){box(group,.95,.6,.95,x,y,z,cornerMat);box(group,.33,.12,.33,x,y+.31,z,darkMetal);}
    }
    for(const z of [-d/2+.4,d/2-.4])box(group,w-.6,.3,.3,0,6.35,z);
    for(const x of [-w/2+.4,w/2-.4])box(group,.3,.3,d-.6,x,6.35,0);
    box(group,w-1.5,5.25,.18,0,3.3,-d/2+.5,skinMat);
    const ribCount=Math.floor((w-2)/1.15),ribs=new THREE.InstancedMesh(new THREE.BoxGeometry(.16,5.15,.2),metal,ribCount),matrix=new THREE.Matrix4();
    for(let i=0;i<ribCount;i++){matrix.makeTranslation(-w/2+1.3+i*1.15,3.3,-d/2+.68);ribs.setMatrixAt(i,matrix);}group.add(ribs);
    // Low clear panels read as an enclosure without hiding the people or data.
    const glass=new THREE.MeshStandardMaterial({color:accent,transparent:true,opacity:.1,depthWrite:false,roughness:.18,metalness:.1,side:THREE.DoubleSide});
    for(const x of [-w/2+.5,w/2-.5])box(group,.08,2.15,d-2,x,1.7,0,glass);
    box(group,w-2,.12,.12,0,2.8,d/2-.5);
    for(let x=-w/2+3;x<w/2-2;x+=5)box(group,.08,2.4,.08,x,1.65,d/2-.5);
    // Floor panel seams and perimeter guide lights echo the source's tiny workstations.
    const seamMat=new THREE.MeshBasicMaterial({color:0x1e313f,transparent:true,opacity:.5});
    for(let x=-w/2+4.5;x<w/2;x+=4.5)box(group,.025,.025,d-3,x,.29,0,seamMat);
    for(let z=-d/2+4.5;z<d/2;z+=4.5)box(group,w-3,.025,.025,0,.3,z,seamMat);
    nameplate(group,`${floor.surface==='web'?'W':'S'}${String(floor.level+1).padStart(2,'0')} / ${floor.name.toUpperCase()}`,Math.min(18,w-6),0,4.9,-d/2+.82,floor.surface==='web'?'#62ddeb':'#b9f16b');
    const lightMat=new THREE.MeshBasicMaterial({color:accent});
    for(const x of [-w/2+2,w/2-2])for(const z of [-d/2+2,d/2-2])box(group,.35,.06,.7,x,.35,z,lightMat);
    // The equipment occupies the rear service lane; it is architectural detail,
    // never a representation of extra container entities or measured capacity.
    for(const x of [-w/2+3,w/2-3]){
      box(group,1.5,2.2,1.05,x,1.5,-d/2+2,darkMetal);
      for(let slot=0;slot<4;slot++){box(group,1.05,.12,.07,x,.9+slot*.4,-d/2+2.57);box(group,.12,.12,.08,x+.52,.9+slot*.4,-d/2+2.62,lightMat);}
    }
    const stripeGeo=new THREE.BoxGeometry(.16,.025,1.2),stripeMat=new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.4});
    for(let x=-floor.width/2+2;x<floor.width/2-1;x+=2){const stripe=new THREE.Mesh(stripeGeo,stripeMat);stripe.position.set(x,.31,floor.depth/2-1.8);group.add(stripe);}
    const count=Math.min(4,floor.count);
    for(let i=0;i<count;i++){
      const worker=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:accent,roughness:.5,emissive:accent,emissiveIntensity:.12});
      const body=new THREE.Mesh(new THREE.CapsuleGeometry(.23,.55,3,6),mat);body.position.y=.66;worker.add(body);
      const head=new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),new THREE.MeshStandardMaterial({color:0xe6f1f4}));head.position.y=1.3;worker.add(head);
      const pack=new THREE.Mesh(new THREE.BoxGeometry(.4,.5,.25),new THREE.MeshStandardMaterial({color:0x243242}));pack.position.set(0,.72,-.25);worker.add(pack);
      const limbs=[];
      for(const side of [-1,1]){
        const arm=new THREE.Group();arm.position.set(side*.34,1,0);const sleeve=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.32,2,5),mat);sleeve.position.y=-.19;arm.add(sleeve);worker.add(arm);limbs.push({group:arm,sign:side});
        const leg=new THREE.Group();leg.position.set(side*.13,.44,0);const boot=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.25,2,5),darkMetal);boot.position.y=-.17;leg.add(boot);worker.add(leg);limbs.push({group:leg,sign:-side});
      }
      const visor=new THREE.Mesh(new THREE.BoxGeometry(.33,.12,.08),darkMetal);visor.position.set(0,1.31,.22);worker.add(visor);
      worker.scale.setScalar(1.4);group.add(worker);actors.push({worker,limbs,floor,phase:i/count,speed:.045+(i%2)*.013});
    }
    for(const dx of [-1,1])for(const dz of [-1,1])fitPoints.push(new THREE.Vector3(floor.x+dx*(floor.width/2+3),floor.y+7,floor.z+dz*(floor.depth/2+3)));
  }
  return {hits,floors,tick(time,animate,reduced=false){
    let moving=false;for(const group of floors.values()){const target=group.userData.target;if(reduced||group.position.distanceTo(target)<.01)group.position.copy(target);else{group.position.lerp(target,.16);moving=true;}}
    for(const a of actors){
      const {width,depth}=a.floor,w=width-3,d=depth-3,length=2*(w+d),t=(time*a.speed+a.phase)%1*length;
      let x,z,angle;
      if(t<w){x=-w/2+t;z=-d/2;angle=Math.PI/2;}
      else if(t<w+d){x=w/2;z=-d/2+t-w;angle=0;}
      else if(t<2*w+d){x=w/2-(t-w-d);z=d/2;angle=-Math.PI/2;}
      else{x=-w/2;z=d/2-(t-2*w-d);angle=Math.PI;}
      a.worker.position.set(x,.4+(animate?Math.sin(time*10+a.phase*12)*.035:0),z);a.worker.rotation.y=angle;for(const limb of a.limbs)limb.group.rotation.x=animate?Math.sin(time*8+a.phase*12)*.38*limb.sign:0;
    }
    return moving||(animate&&actors.length>0);
  }};
}
