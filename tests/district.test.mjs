import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGraph,layoutGraph,surfaceOf} from '../style-gallery/explorer-model.js';
import {pairedDemo} from '../style-gallery/district-demo.js';
const sample={meta:{source_mode:'sample'},nodes:[{id:'tag:2',name:'Web purchase',kind:'tag'},{id:'variable:1',name:'Value',kind:'variable'}],edges:[]};
test('paired sample supplies two explicit surfaces and a real graph edge for packet rendering',()=>{
  const fixture=pairedDemo(sample),g=makeGraph(fixture),layout=layoutGraph(g,'district');
  assert.equal(layout.buildings.length,1);assert.equal(layout.buildings[0].surface,'combined');assert.equal(layout.buildings[0].count,g.nodes.length);
  assert.equal(g.edges.filter(e=>e.kind==='transport').length,1);
  for(const e of g.edges.filter(e=>e.kind==='transport')){assert.equal(surfaceOf(g.byId.get(e.from),g),'web');assert.equal(surfaceOf(g.byId.get(e.to),g),'server');}
  assert.equal(sample.nodes.length,2);
});
test('private single-surface snapshots never acquire invented server data or packets',()=>{
  const audit={...sample,meta:{source_mode:'direct-api',usage_context:['server']}};
  assert.equal(pairedDemo(audit),audit);
  const g=makeGraph(audit),layout=layoutGraph(g,'district',false,{surfacesSeparated:true});
  assert.equal(layout.buildings.find(b=>b.surface==='web').count,0);
  assert.equal(layout.buildings.find(b=>b.surface==='server').count,2);
  assert.equal(g.edges.length,0);
});
test('all entities remain inside their own surface floor in normal, exploded, and pulled layouts',()=>{
  const g=makeGraph(pairedDemo(sample));
  for(const exploded of [false,true])for(const selectedFloor of [null,'server:tags']){
    const layout=layoutGraph(g,'district',exploded,{selectedFloor,surfacesSeparated:true});
    assert.equal(layout.positions.size,g.nodes.length);
    assert.equal(new Set(layout.districts.flatMap(d=>d.nodeIds)).size,g.nodes.length);
    for(const d of layout.districts)for(const id of d.nodeIds){const p=layout.positions.get(id);assert.equal(surfaceOf(g.byId.get(id),g),d.surface);assert.ok(Math.abs(p.x-d.x)+1.3<d.width/2);assert.ok(Math.abs(p.z-d.z)+1.3<d.depth/2);assert.ok(p.y-p.height/2>d.y);}
  }
});
test('expanding one building leaves the other building unchanged',()=>{
  const g=makeGraph(pairedDemo(sample)),normal=layoutGraph(g,'district',false,{surfacesSeparated:true}),expanded=layoutGraph(g,'district',false,{surfacesSeparated:true,expandedBuildings:new Set(['server'])});
  for(const n of g.nodes.filter(n=>surfaceOf(n,g)==='web'))assert.deepEqual(expanded.positions.get(n.id),normal.positions.get(n.id));
  assert.notDeepEqual(expanded.positions.get('server:tag:ga4'),normal.positions.get('server:tag:ga4'));
});
test('shared surface separation control switches District between one combined container and two surface containers',()=>{
  const g=makeGraph(pairedDemo(sample));
  const combined=layoutGraph(g,'district'),separated=layoutGraph(g,'district',false,{surfacesSeparated:true});
  assert.equal(combined.buildings.length,1);assert.equal(combined.buildings[0].surface,'combined');
  assert.deepEqual(separated.buildings.map(b=>b.surface),['web','server']);
  assert.equal(combined.positions.size,g.nodes.length);assert.equal(separated.positions.size,g.nodes.length);
  assert.equal(new Set(combined.districts.flatMap(d=>d.nodeIds)).size,g.nodes.length);
  assert.equal(new Set(separated.districts.flatMap(d=>d.nodeIds)).size,g.nodes.length);
  assert.ok(combined.districts.every(d=>d.surface==='combined'&&d.id.startsWith('combined:')));
  for(const floor of separated.districts)for(const id of floor.nodeIds)assert.equal(surfaceOf(g.byId.get(id),g),floor.surface);
  assert.deepEqual([...combined.positions.keys()].sort(),[...separated.positions.keys()].sort());
  assert.deepEqual(g.edges,makeGraph(pairedDemo(sample)).edges);
});
