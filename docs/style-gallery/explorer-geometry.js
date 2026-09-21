import * as THREE from 'three';
import { KINDS, kindMeta } from './explorer-model.js';

function extrudedOutline(points, depth) {
  const shape = new THREE.Shape(points.map(([x,y]) => new THREE.Vector2(x,y)));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, steps:1, bevelEnabled:true, bevelSegments:1, bevelSize:.055, bevelThickness:.055 });
}

// Every shape has the same centered two-unit height. Existing degree scaling,
// camera bounds, link anchors, and all three layouts therefore stay compatible.
export function entityGeometry(kind, { miniature = false } = {}) {
  const segments = miniature ? 12 : 24;
  let geometry;
  switch (kindMeta(kind).shape) {
    case 'cube': geometry = new THREE.BoxGeometry(2.1,2,2.1); break;
    case 'diamond': geometry = new THREE.OctahedronGeometry(1.4); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(1.12,1.12,2,segments); break;
    case 'sphere': geometry = new THREE.SphereGeometry(1,segments,miniature?8:16); break;
    case 'folder': geometry = extrudedOutline([[-1.25,-.8],[1.25,-.8],[1.25,.65],[-.05,.65],[-.3,1],[-1.25,1]], .8); break;
    case 'triangular-prism': geometry = new THREE.CylinderGeometry(1.25,1.25,2,3).rotateY(Math.PI/6); break;
    case 'cone': geometry = new THREE.ConeGeometry(1.25,2,segments); break;
    case 'hourglass': geometry = new THREE.LatheGeometry([[0,-1],[1.15,-1],[1.15,-.85],[.3,0],[1.15,.85],[1.15,1],[0,1]].map(([x,y])=>new THREE.Vector2(x,y)),segments); break;
    case 'ring': geometry = new THREE.TorusGeometry(.78,.22,miniature?6:10,segments); break;
    case 'stack': geometry = new THREE.LatheGeometry([[0,-1],[1.2,-1],[1.2,-.5],[.35,-.5],[.35,-.25],[1.2,-.25],[1.2,.25],[.35,.25],[.35,.5],[1.2,.5],[1.2,1],[0,1]].map(([x,y])=>new THREE.Vector2(x,y)),segments); break;
    case 'hexagonal-prism': geometry = new THREE.CylinderGeometry(1.2,1.2,2,6); break;
    case 'shield': geometry = extrudedOutline([[-1.05,1],[1.05,1],[.95,-.1],[.65,-.6],[0,-1],[-.65,-.6],[-.95,-.1]], .65); break;
    case 'pyramid': geometry = new THREE.ConeGeometry(1.3,2,4).rotateY(Math.PI/4); break;
    default: geometry = new THREE.DodecahedronGeometry(1.25);
  }
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  geometry.center();
  geometry.scale(Math.min(1,2.6/size.x),2/size.y,Math.min(1,2.6/size.z));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// The Entity Key is projected from the same geometry factory as the actual
// meshes, rather than a second, potentially mismatched set of symbolic icons.
export function entitySymbol(kind) {
  const geometry = entityGeometry(kind, { miniature:true });
  const surface = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = surface.getAttribute('position');
  const direction = new THREE.Vector3(3,2.4,5).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction,right).normalize();
  const light = new THREE.Vector3(-.6,1,.8).normalize();
  const project = point => `${(16+point.dot(right)*9.2).toFixed(2)},${(16-point.dot(up)*9.2).toFixed(2)}`;
  const triangles = [];
  for(let i=0;i<position.count;i+=3) {
    const a=new THREE.Vector3().fromBufferAttribute(position,i),b=new THREE.Vector3().fromBufferAttribute(position,i+1),c=new THREE.Vector3().fromBufferAttribute(position,i+2);
    const normal=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    if(normal.dot(direction)<=0)continue;
    const opacity=(.42+.53*Math.max(0,normal.dot(light))).toFixed(2);
    triangles.push({ depth:a.clone().add(b).add(c).dot(direction),svg:`<polygon points="${project(a)} ${project(b)} ${project(c)}" fill="currentColor" fill-opacity="${opacity}"/>` });
  }
  triangles.sort((a,b)=>a.depth-b.depth);
  if(surface!==geometry)surface.dispose();
  geometry.dispose();
  return `<symbol id="atlas-shape-${kindMeta(kind).shape}" viewBox="0 0 32 32">${triangles.map(t=>t.svg).join('')}</symbol>`;
}

export function entitySymbols() {
  return `<svg class="entity-symbols" width="0" height="0" aria-hidden="true"><defs>${[...Object.keys(KINDS),'unknown'].map(entitySymbol).join('')}</defs></svg>`;
}

export function entityIcon(kind) {
  return `<svg class="entity-shape" viewBox="0 0 32 32" aria-hidden="true"><use href="#atlas-shape-${kindMeta(kind).shape}"/></svg>`;
}
