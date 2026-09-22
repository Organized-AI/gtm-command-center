import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGraph,layoutGraph,signalEdge} from '../style-gallery/explorer-model.js';
import {pairedDemo} from '../style-gallery/district-demo.js';
import {districtRoutes} from '../style-gallery/explorer-district-routes.js';
const key=e=>JSON.stringify([e.from,e.to,e.kind]);
const graph=makeGraph(pairedDemo({meta:{source_mode:'sample'},nodes:[{id:'tag:2',name:'Purchase',kind:'tag'},{id:'variable:1',name:'Amount',kind:'variable'},{id:'trigger:1',name:'Purchase',kind:'trigger'}],edges:[{from:'tag:2',to:'variable:1',kind:'tag_variable'},{from:'tag:2',to:'trigger:1',kind:'tag_trigger'}]}));
test('routed edges retain exact endpoints with finite orthogonal segments in all expansion modes',()=>{
  for(const exploded of [false,true])for(const spacing of [1,2,3]){
    const layout=layoutGraph(graph,'district',exploded,{spacing,selectedFloor:'server:tags',surfacesSeparated:true}),edges=graph.edges.map(signalEdge),routes=districtRoutes(edges,layout.positions,layout.districts);
    assert.equal(routes.size,edges.length);
    for(const edge of edges){const route=routes.get(key(edge)),a=layout.positions.get(edge.from),b=layout.positions.get(edge.to);
      assert.deepEqual(route[0],{x:a.x,y:a.y+a.height/2,z:a.z});assert.deepEqual(route.at(-1),{x:b.x,y:b.y+b.height/2,z:b.z});
      route.forEach((p,i)=>{assert.ok(Object.values(p).every(Number.isFinite));if(i){const q=route[i-1];assert.equal(['x','y','z'].filter(k=>Math.abs(p[k]-q[k])>1e-6).length,1);}});
    }
    assert.deepEqual(routes,districtRoutes(edges.slice().reverse(),layout.positions,layout.districts));
  }
});
test('inter-floor vertical risers stay outside container shells and routes get distinct lanes',()=>{
  const layout=layoutGraph(graph,'district',true,{spacing:3,surfacesSeparated:true}),edges=graph.edges.map(signalEdge),routes=districtRoutes(edges,layout.positions,layout.districts),front=Math.max(...layout.districts.map(f=>f.z+f.depth/2));
  const lanes=[];
  for(const edge of edges){const route=routes.get(key(edge));assert.ok(Math.max(...route.map(p=>p.z))>front);lanes.push(Math.max(...route.map(p=>p.z)));}
  const webEdges=edges.filter(e=>!e.from.startsWith('server:')&&!e.to.startsWith('server:'));
  assert.equal(new Set(webEdges.map(e=>Math.max(...routes.get(key(e)).map(p=>p.z)))).size,webEdges.length);
});
test('maximum spread increases floor separation, entity spacing, and pull-out distance',()=>{
  const normal=layoutGraph(graph,'district',false,{surfacesSeparated:true}),wide=layoutGraph(graph,'district',true,{spacing:3,surfacesSeparated:true}),selected=layoutGraph(graph,'district',true,{spacing:3,selectedFloor:'server:tags',surfacesSeparated:true});
  const a=normal.districts.find(d=>d.id==='server:tags'),b=wide.districts.find(d=>d.id==='server:tags'),c=selected.districts.find(d=>d.id==='server:tags');
  assert.ok(b.y>a.y*2);assert.ok(b.width>a.width);assert.ok(b.depth>a.depth);assert.ok(c.x-b.x>b.width*.4);assert.ok(c.z-b.z>b.depth*.7);
});
test('self references produce a visible loop and missing nodes do not invent routes',()=>{
  const layout=layoutGraph(graph,'district',false,{surfacesSeparated:true}),edge={from:'tag:2',to:'tag:2',kind:'tag_setup'},routes=districtRoutes([edge,{from:'missing',to:'tag:2',kind:'tag_setup'}],layout.positions,layout.districts);
  assert.equal(routes.size,1);const route=routes.get(key(edge));assert.deepEqual(route[0],route.at(-1));assert.ok(route.length>=6);assert.ok(route.some(p=>p.x!==route[0].x));
});
