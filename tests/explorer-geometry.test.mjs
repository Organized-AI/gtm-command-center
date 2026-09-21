import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { KINDS, kindMeta } from '../style-gallery/explorer-model.js';
import { entityGeometry, entityIcon, entitySymbol, entitySymbols } from '../style-gallery/explorer-geometry.js';

test('every entity-key type has a unique shape and preserves its existing color',()=>{
  const colors={tag:'#f5d85d',trigger:'#65b8f3',variable:'#b596ed',builtin:'#5dd6c5',folder:'#edac6a',template:'#8bd0a3',client:'#e994bf',transformation:'#9fd788',zone:'#97bcec',version:'#a8b5c6',workspace:'#c6b5df',permission:'#adbaa9',environment:'#d8ba86'};
  assert.equal(new Set(Object.values(KINDS).map(k=>k.shape)).size,Object.keys(KINDS).length);
  for(const [kind,color] of Object.entries(colors)){assert.equal(kindMeta(kind).color,color);assert.ok(kindMeta(kind).shapeLabel);}
  assert.equal(kindMeta('unknown').shape,'polyhedron');assert.equal(kindMeta('__proto__').shape,'polyhedron');
});
test('distinct geometries fit existing camera, sizing, and link-anchor contracts',()=>{
  const hashes=new Set();
  for(const kind of [...Object.keys(KINDS),'unknown']) {
    const geometry=entityGeometry(kind),box=geometry.boundingBox;
    assert.ok(Math.abs(box.min.y+1)<1e-6,kind);assert.ok(Math.abs(box.max.y-1)<1e-6,kind);
    for(const axis of ['x','z']){assert.ok(box.max[axis]<=1.301,kind);assert.ok(box.min[axis]>=-1.301,kind);}
    for(const attr of Object.values(geometry.attributes))assert.ok(attr.array.every(Number.isFinite),kind);
    hashes.add(createHash('sha256').update(Buffer.from(geometry.attributes.position.array.buffer)).digest('hex'));
    geometry.dispose();
  }
  assert.equal(hashes.size,Object.keys(KINDS).length+1);
});
test('every shape remains raycast-selectable without a rectangular top cap',()=>{
  for(const kind of Object.keys(KINDS)) {
    const geometry=entityGeometry(kind),surface=geometry.index?geometry.toNonIndexed():geometry;
    const p=surface.attributes.position;
    let origin,normal;
    for(let i=0;i<p.count;i+=3){
      const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
      normal=b.clone().sub(a).cross(c.clone().sub(a));
      if(normal.lengthSq()<1e-10)continue;
      normal.normalize();origin=a.add(b).add(c).multiplyScalar(1/3).addScaledVector(normal,6);break;
    }
    const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld();
    const raycaster=new THREE.Raycaster(origin,normal.negate());
    assert.ok(raycaster.intersectObject(mesh).length>0,kind);
    if(surface!==geometry)surface.dispose();geometry.dispose();material.dispose();
  }
});
test('legend miniatures use the same shape IDs and contain visible finite projections',()=>{
  const symbols=entitySymbols();
  assert.equal((symbols.match(/<symbol /g)||[]).length,Object.keys(KINDS).length+1);
  for(const kind of [...Object.keys(KINDS),'unknown']) {
    const symbol=entitySymbol(kind),icon=entityIcon(kind);
    assert.ok(symbol.includes(`id="atlas-shape-${kindMeta(kind).shape}"`));
    assert.ok(icon.includes(`href="#atlas-shape-${kindMeta(kind).shape}"`));
    assert.match(symbol,/<polygon /);assert.doesNotMatch(symbol,/NaN|Infinity|undefined/);
  }
});
