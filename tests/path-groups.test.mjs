import test from 'node:test';
import assert from 'node:assert/strict';
import {pathGroup,groupPaths,PATH_GROUPS} from '../style-gallery/explorer-path-groups.js';
import {districtRoutes} from '../style-gallery/explorer-district-routes.js';
const edge={from:'a',to:'b',kind:'tag_variable'};
test('health groups require current measurements; missing and stale measurements remain unknown',()=>{
  for(const health of ['healthy','degraded','failing']){
    assert.equal(pathGroup(edge,{health}),health);
    assert.equal(pathGroup(edge,{health,stale:true}),'unknown');
  }
  for(const signal of [null,undefined,{}, {health:'unknown'}, {health:'invalid'}])assert.equal(pathGroup(edge,signal),'unknown');
});
test('blocking and context relationships are never misclassified as health failures',()=>{
  assert.equal(pathGroup({...edge,kind:'tag_trigger_blocking'},{health:'failing'}),'blocking');
  for(const kind of ['folder_member','version_next'])assert.equal(pathGroup({...edge,kind},{health:'failing'}),'context');
});
test('groups partition supplied paths exactly once without adding paths',()=>{
  const edges=[edge,{...edge,to:'c'},{...edge,to:'d',kind:'folder_member'},{...edge,to:'e',kind:'tag_trigger_blocking'}];
  const groups=groupPaths(edges,e=>e===edge?{health:'healthy'}:undefined);
  assert.deepEqual(Object.keys(groups),Object.keys(PATH_GROUPS));
  assert.equal(groups.healthy.length,1);assert.equal(groups.unknown.length,1);assert.equal(groups.context.length,1);assert.equal(groups.blocking.length,1);
  assert.equal(new Set(Object.values(groups).flat()).size,edges.length);
  assert.equal(Object.values(groups).flat().length,edges.length);
});
test('status groups occupy ordered lanes with a larger gap between groups and stable routing',()=>{
  const nodes=['a','b','c','d','e'],positions=new Map(nodes.map((id,i)=>[id,{x:i*5,y:2,z:0,height:2}]));
  const floors=[{id:'web:tags',surface:'web',x:10,y:0,z:0,width:40,depth:20,nodeIds:nodes}];
  const edges=nodes.slice(1).map(to=>({...edge,to})),key=e=>JSON.stringify([e.from,e.to,e.kind]);
  const statuses=new Map(edges.map((e,i)=>[key(e),['healthy','failing','failing','unknown'][i]]));
  const routes=districtRoutes(edges,positions,floors,statuses),lane=e=>Math.max(...routes.get(key(e)).map(p=>p.z));
  const failing=[lane(edges[1]),lane(edges[2])].sort((a,b)=>a-b);
  assert.ok(lane(edges[0])-failing[1]>(failing[1]-failing[0])*3);
  assert.ok(lane(edges[3])>lane(edges[0]));
  assert.deepEqual(routes,districtRoutes([...edges].reverse(),positions,floors,statuses));
});
