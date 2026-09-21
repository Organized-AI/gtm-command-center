import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationDiff,completionReport,completionMarkup,workspaceMarkup} from '../style-gallery/explorer-repair-report.js';
import {createDraft,RepairControls,exportFixPlan} from '../style-gallery/explorer-repairs.js';
import {makeGraph} from '../style-gallery/explorer-model.js';
import {pathKey} from '../style-gallery/explorer-signals.js';
const node={id:'tag:1',kind:'tag',name:'Purchase',details:{name:'Purchase',paused:true}},edge={from:'tag:1',to:'variable:1',kind:'tag_variable'},audit={meta:{container_id:'1'},nodes:[node,{id:'variable:1',name:'Event',kind:'variable'}],edges:[edge]};
const graph=makeGraph(audit);
test('parameter comparison reports leaf values by parameter key and handles adds/removes',()=>{
 const rows=configurationDiff({parameter:[{key:'event',value:'purchase'},{key:'old',value:false}]},{parameter:[{key:'event',value:'lead'},{key:'new',value:null}]});
 assert.equal(rows.length,3);assert.equal(rows[0].path,'parameter[key=event].value');assert.equal(rows[0].before,'purchase');assert.equal(rows[0].after,'lead');
 assert.equal(rows[1].operation,'removed');assert.equal(rows[2].operation,'added');assert.equal(rows[2].hasBefore,false);
 assert.deepEqual(configurationDiff({a:{b:1,c:2}},{a:{c:2,b:1}}),[]);
});
test('parameter reordering is retained and non-keyed arrays are compared exactly',()=>{
 assert.equal(configurationDiff({parameter:[{key:'a'},{key:'b'}]},{parameter:[{key:'b'},{key:'a'}]})[0].path,'parameter.$order');
 assert.equal(configurationDiff({firingTriggerId:['1','2']},{firingTriggerId:['2']})[0].path,'firingTriggerId');
});
test('completion report explains exact edits, user intent, captured evidence, and unchanged runtime health',()=>{
 const draft=createDraft(node,node.details,'{"name":"Purchase","paused":false}');
 const report=completionReport({job:{edge,key:pathKey(edge),kind:'draft',draft,reason:'Enable the reviewed purchase tag'},graph,signal:{health:'failing'},checks:['Preview purchase'],findings:[{title:'Paused',detail:'Captured paused flag'}],sequence:1});
 assert.equal(report.entity.kind,'Tag');assert.equal(report.reason,'Enable the reviewed purchase tag');assert.equal(report.healthAfter,'failing');assert.equal(report.changes[0].before,true);assert.equal(report.changes[0].after,false);assert.match(report.changes[0].impact,/enables/);assert.match(report.result,/No GTM workspace/);
 const html=completionMarkup(report);assert.match(html,/Before this repair/);assert.match(html,/Verification still required/);assert.match(html,/Captured paused flag/);
});
test('repeated repairs retain operation history while workspace changes compare to original snapshot',()=>{
 const prior=globalThis.document;globalThis.document={getElementById:()=>null};
 try{
  const controls=new RepairControls({graph,audit,signals:{signal:()=>({health:'failing'})},onChange:()=>{},onRender:()=>{},onStart:()=>{}});controls.selected=edge;
  const first=createDraft(node,node.details,JSON.stringify({...node.details,paused:false}));
  controls.job={edge,key:pathKey(edge),kind:'draft',draft:first,elapsed:0};controls.tick(8,false);
  const second=createDraft(node,first.after,JSON.stringify({...first.after,name:'Purchase reviewed'}));controls.job={edge,key:pathKey(edge),kind:'draft',draft:second,elapsed:0};controls.tick(8,false);
  assert.equal(controls.history.length,2);assert.equal(controls.history[1].changes.length,1);assert.equal(controls.drafts.get(node.id).changes.length,2);
  assert.match(workspaceMarkup(controls.drafts,graph),/Captured snapshot/);
  const exported=exportFixPlan(audit.meta,controls.drafts,controls.history);assert.equal(exported.repair_history.length,2);
  controls.handle('undo-drafts');assert.ok(controls.history.every(r=>r.state==='discarded'));assert.equal(controls.drafts.size,0);
 }finally{globalThis.document=prior;}
});
test('report escapes supplied names, reasons, evidence, and field values',()=>{
 const draft=createDraft(node,node.details,JSON.stringify({...node.details,name:'<img src=x>'}));
 const report=completionReport({job:{edge,key:pathKey(edge),kind:'draft',draft,reason:'<script>alert(1)</script>'},graph,signal:{health:'unknown'},checks:[],findings:[{title:'<svg>',detail:'<img>'}],sequence:1});
 const html=completionMarkup(report);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);
});
