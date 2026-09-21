import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPath,createDraft,exportFixPlan,RepairControls} from '../style-gallery/explorer-repairs.js';
import {makeGraph} from '../style-gallery/explorer-model.js';
import {pathKey} from '../style-gallery/explorer-signals.js';
const node={id:'tag:1',name:'Purchase',kind:'tag',paused:true,details:{tagId:'1',fingerprint:'revision-1',paused:true,name:'Purchase'}};
const edge={from:'tag:1',to:'variable:1',kind:'tag_variable'};
const audit={meta:{source_mode:'direct-api',container_id:'c'},nodes:[node,{id:'variable:1',kind:'variable',name:'Amount'}],edges:[edge],recommendations:[]};
test('audit explains supplied health and paused endpoints without inventing a cause',()=>{
 const report=auditPath(makeGraph(audit),edge,{health:'failing',evidence:'Destination rejected event'});
 assert.ok(report.findings.some(f=>f.detail==='Destination rejected event'));assert.ok(report.findings.some(f=>f.title==='Purchase is paused'));
 assert.match(report.rootCause,/not proof/);assert.ok(report.checks.length>1);
 const stale=auditPath(makeGraph(audit),edge,{health:'failing',stale:true});assert.equal(stale.findings[0].title,'Measurements are stale');
});
test('draft review records actual changed fields and never mutates the captured configuration',()=>{
 const draft=createDraft(node,node.details,JSON.stringify({...node.details,paused:false}));
 assert.deepEqual(draft.changes,[{field:'paused',before:true,after:false,operation:'replace'}]);assert.equal(node.details.paused,true);assert.equal(draft.after.paused,false);
 assert.throws(()=>createDraft(node,node.details,JSON.stringify({name:'Purchase',paused:true,fingerprint:'revision-1',tagId:'1'})),/Change at least one/);
});
test('identity changes, invalid JSON, unsafe keys, and malformed known fields are rejected',()=>{
 for(const text of ['[]','null','{',JSON.stringify({...node.details,tagId:'2'}),JSON.stringify({...node.details,paused:'false'}),JSON.stringify({...node.details,parameter:{}}),'{"__proto__":{}}'])assert.throws(()=>createDraft(node,node.details,text));
});
test('export is a scoped review plan and cannot claim a live update',()=>{
 const draft=createDraft(node,node.details,JSON.stringify({...node.details,paused:false}));
 const plan=exportFixPlan(audit.meta,new Map([[node.id,draft]]));
 assert.equal(plan.status,'local-draft-not-applied-to-gtm');assert.equal(plan.container_id,'c');assert.equal(plan.changes[0].before.fingerprint,'revision-1');assert.ok(plan.instructions.some(s=>s.includes('fresh measurements')));
});
test('draft completion preserves measured path health, and cancellation preserves all drafts',()=>{
 const prior=globalThis.document;globalThis.document={getElementById:()=>null};
 try{
   const record={health:'failing'},signals={signal:()=>record};let changes=0;
   const controls=new RepairControls({graph:makeGraph(audit),audit,signals,onChange:()=>changes++,onRender:()=>{},onStart:()=>{}});
   controls.selected=edge;
   const draft=createDraft(node,node.details,JSON.stringify({...node.details,paused:false}));
   controls.job={edge,key:pathKey(edge),kind:'draft',draft,elapsed:0};controls.tick(.5,true);
   assert.equal(changes,1);assert.equal(controls.drafts.size,1);assert.equal(record.health,'failing');assert.equal(node.details.paused,true);
   controls.job={edge,key:pathKey(edge),kind:'draft',draft,elapsed:0};controls.handle('cancel');assert.equal(controls.job,null);assert.equal(controls.drafts.size,1);
 }finally{globalThis.document=prior;}
});
test('simulated repair changes only the demo record and supports undo',()=>{
 const prior=globalThis.document;globalThis.document={getElementById:()=>null};
 try{
   const record={health:'failing',fires:2},key=pathKey(edge),signals={mode:'demo',demo:{records:new Map([[key,record]])},signal:()=>record};
   const controls=new RepairControls({graph:makeGraph(audit),audit,signals,onChange:()=>{},onStart:()=>{},onRender:()=>{}});controls.selected=edge;
   controls.handle('simulate');controls.tick(8,false);assert.equal(signals.demo.records.get(key).health,'healthy');assert.equal(record.health,'failing');assert.equal(controls.drafts.size,0);
   controls.handle('undo-simulation');assert.deepEqual(signals.demo.records.get(key),record);
   signals.mode='imported';controls.handle('simulate');assert.equal(controls.job,null);
 }finally{globalThis.document=prior;}
});
test('repair worker moves along the route and stays static with reduced motion',async()=>{
 const THREE=await import('three');const {RepairWorker}=await import('../style-gallery/explorer-repair-worker.js');
 const worker=new RepairWorker(),curve=new THREE.LineCurve3(new THREE.Vector3(0,0,0),new THREE.Vector3(40,0,0));
 worker.tick({elapsed:1},curve);const first=worker.root.position.x;worker.tick({elapsed:2},curve);assert.ok(worker.root.position.x>first);
 worker.tick({elapsed:1},curve,true);const staticPosition=worker.root.position.clone();worker.tick({elapsed:5},curve,true);assert.deepEqual(worker.root.position,staticPosition);assert.ok(worker.legs.every(leg=>leg.rotation.x===0));
 worker.tick(null,curve);assert.equal(worker.root.visible,false);
});
