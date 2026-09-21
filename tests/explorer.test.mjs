import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeGraph, visibleNodes, layoutGraph, signalEdge, relationLabel, needsAttention, isDependency, NETWORK_BASE_Y } from '../style-gallery/explorer-model.js';

const audit = { nodes: [
  { id:'tag:1',name:'Purchase <script>',kind:'tag',type:'gaawe',risk:'unassessed' },
  { id:'trigger:1',name:'Purchase event',kind:'trigger' },
  { id:'trigger:2',name:'Consent denied',kind:'trigger' },
  { id:'variable:1',name:'Revenue',kind:'variable' },
  { id:'folder:1',name:'Analytics',kind:'folder' },
  { id:'tag:2',name:'Paused legacy',kind:'tag',paused:true,risk:'high',flags:['orphan'] },
  { id:'variable:2',name:'Unused value',kind:'variable' }
], edges: [
  { from:'tag:1',to:'trigger:1',kind:'tag_trigger' },
  { from:'tag:1',to:'trigger:2',kind:'tag_trigger_blocking' },
  { from:'tag:1',to:'variable:1',kind:'tag_variable' },
  { from:'folder:1',to:'tag:1',kind:'folder_member' },
  { from:'tag:2',to:'gone',kind:'tag_variable' }
] };
const graph = makeGraph(audit);
const defaults = { search:'',scope:'all',selected:null,isolate:false };
test('graph retains configuration directions and drops dangling edges',()=>{
  assert.equal(graph.nodes.length,7);assert.equal(graph.edges.length,4);
  assert.equal(graph.adjacency.get('tag:1').size,4);assert.equal(graph.dependencies.get('tag:1').size,3);
  assert.equal(graph.dependencies.get('folder:1').size,0);
  assert.equal(graph.edges[0].from,'tag:1');
});
test('search and filters preserve actual counts without mutating the graph',()=>{
  assert.equal(visibleNodes(graph,{...defaults,search:'REVENUE'}).length,1);
  assert.equal(visibleNodes(graph,{...defaults,scope:'attention'}).length,1);
  assert.equal(visibleNodes(graph,{...defaults,scope:'paused'})[0].id,'tag:2');
  assert.equal(visibleNodes(graph,{...defaults,search:'nothing'}).length,0);
  assert.equal(visibleNodes(graph,{...defaults,scope:'isolated'}).length,3);
  assert.equal(visibleNodes(graph,{...defaults,selected:'tag:1',isolate:true}).length,5);
  assert.equal(graph.nodes.length,7);
});
test('all perspectives assign deterministic finite coordinates to every entity',()=>{
  for(const view of ['district','network','flow','container','observatory'])for(const exploded of [false,true]){
    const layout=layoutGraph(graph,view,exploded);
    assert.equal(layout.positions.size,7);
    for(const p of layout.positions.values())for(const value of Object.values(p))assert.ok(Number.isFinite(value));
    assert.deepEqual(layout,layoutGraph(graph,view,exploded));
  }
  assert.notDeepEqual(layoutGraph(graph,'district').positions,layoutGraph(graph,'network').positions);
  assert.notDeepEqual(layoutGraph(graph,'district').positions,layoutGraph(graph,'district',true).positions);
});
test('flow direction and relation labels distinguish firing, blocking, and context',()=>{
  assert.deepEqual(signalEdge(graph.edges[0]),{from:'trigger:1',to:'tag:1',kind:'tag_trigger'});
  assert.equal(signalEdge(graph.edges[1]).from,'trigger:2');
  assert.equal(signalEdge(graph.edges[2]).from,'variable:1');
  assert.equal(signalEdge(graph.edges[3]).from,'folder:1');
  assert.equal(relationLabel(graph.edges[1],'tag:1'),'Blocked by');
  assert.equal(relationLabel(graph.edges[1],'trigger:2'),'Blocks tag');
  assert.equal(relationLabel(graph.edges[2],'variable:1'),'Referenced by');
  assert.equal(isDependency(graph.edges[3]),false);
  assert.equal(graph.edges[0].from,'tag:1');
});
test('network nodes of every type share a baseline, including exploded mode',()=>{
  for(const exploded of [false,true]){
    const layout=layoutGraph(graph,'network',exploded);
    for(const p of layout.positions.values())assert.ok(Math.abs(p.y-p.height/2-NETWORK_BASE_Y)<1e-9);
    for(const district of layout.districts)assert.equal(district.y,NETWORK_BASE_Y);
  }
});
test('observatory crowns and towers encode inventory and dependencies on shared scales',()=>{
  const {districts,positions}=layoutGraph(graph,'observatory');
  const areaScales=districts.map(d=>d.capRadius*d.capRadius/d.count);
  assert.ok(areaScales.every(s=>Math.abs(s-areaScales[0])<1e-9));
  const scales=[];
  for(const d of districts){
    const nodes=graph.nodes.filter(n=>n.kind===d.kind);
    const total=nodes.reduce((sum,n)=>sum+graph.dependencies.get(n.id).size,0);
    assert.equal(d.dependencyTotal,total);
    if(total)scales.push((d.height-6)/total);else assert.equal(d.height,6);
    for(const n of nodes){const p=positions.get(n.id);assert.ok(Math.hypot(p.x,p.z)<d.platformRadius);assert.ok(p.y+p.height/2<d.height+1);}
  }
  assert.ok(scales.every(s=>Math.abs(s-scales[0])<1e-9));
  assert.equal(layoutGraph(makeGraph({}),'observatory').positions.size,0);
  const exploded=layoutGraph(graph,'observatory',true);
  for(let i=0;i<districts.length;i++){assert.equal(exploded.districts[i].height,districts[i].height);assert.equal(exploded.districts[i].capRadius,districts[i].capRadius);}
});
test('container floors separate types, fit entities and expand vertically',()=>{
  const normal=layoutGraph(graph,'container'),expanded=layoutGraph(graph,'container',true);
  assert.equal(normal.districts.length,new Set(graph.nodes.map(n=>n.kind)).size);
  for(const node of graph.nodes){
    const p=normal.positions.get(node.id),floor=normal.districts.find(d=>d.kind===node.kind);
    assert.ok(p.y-p.height/2>floor.y);
    assert.ok(Math.abs(p.x)+1.3<floor.width/2);
    assert.ok(Math.abs(p.z)+1.3<floor.depth/2);
    assert.equal(expanded.positions.get(node.id).x,p.x);
    assert.equal(expanded.positions.get(node.id).y, floor.y*1.6+1.8);
  }
  assert.equal(layoutGraph(makeGraph({}),'container').positions.size,0);
});
test('network peers do not gain arbitrary elevation from ordering or names',()=>{
  const peers=makeGraph({nodes:Array.from({length:7},(_,i)=>({id:`tag:${i}`,name:`Peer ${i}`,kind:'tag'}))});
  const before=layoutGraph(peers,'network').positions;
  assert.equal(new Set([...before.values()].map(p=>p.y)).size,1);
  for(const n of peers.nodes)n.name=`Renamed ${7-Number(n.id.split(':')[1])}`;
  const after=layoutGraph(peers,'network').positions;
  for(const [id,p] of before){assert.equal(after.get(id).y,p.y);assert.equal(after.get(id).height,p.height);}
});
test('network size still grows with dependency count and keeps the existing cap',()=>{
  const dense=makeGraph({nodes:[{id:'hub',kind:'tag'},{id:'unused',kind:'tag'},...Array.from({length:20},(_,i)=>({id:`v:${i}`,kind:'variable'}))],edges:Array.from({length:20},(_,i)=>({from:'hub',to:`v:${i}`,kind:'tag_variable'}))});
  const p=layoutGraph(dense,'network').positions;
  assert.equal(p.get('hub').height,5);assert.equal(p.get('unused').height,2);assert.ok(Math.abs(p.get('v:0').height-2.28)<1e-9);
  for(const node of p.values())assert.ok(Math.abs(node.y-node.height/2-NETWORK_BASE_Y)<1e-9);
});
test('risk is never inferred from an unassessed snapshot or system-reference flag',()=>{
  assert.equal(needsAttention({risk:'unassessed',flags:['system-trigger']}),false);
  assert.equal(needsAttention({risk:'unassessed',flags:['unresolved-reference']}),true);
  assert.equal(needsAttention({risk:'critical'}),true);
});
test('removed drift ghosts are excluded from the current container inventory',()=>{
  const g=makeGraph({nodes:[{id:'old',kind:'tag',drift_state:'removed'},{id:'new',kind:'tag',drift_state:'added'}],edges:[{from:'old',to:'new',kind:'tag_setup'}]});
  assert.equal(g.nodes.length,1);assert.equal(g.nodes[0].id,'new');assert.equal(g.edges.length,0);
});
test('empty, unknown types, duplicate IDs, cycles, and large containers stay valid',()=>{
  assert.equal(makeGraph({}).nodes.length,0);
  for(const view of ['district','network','flow'])assert.equal(layoutGraph(makeGraph({}),view).positions.size,0);
  const large=makeGraph({nodes:Array.from({length:600},(_,i)=>({id:`n:${i}`,kind:i%2?'tag':'future-kind',name:`Entity ${i}`}))});
  for(const view of ['district','network','flow'])assert.equal(layoutGraph(large,view).positions.size,600);
  const cycle=makeGraph({nodes:[{id:'a',kind:'variable'},{id:'a',kind:'tag'},{id:'b',kind:'variable'}],edges:[{from:'a',to:'b',kind:'variable_variable'},{from:'b',to:'a',kind:'variable_variable'},{from:'a',to:'a',kind:'variable_variable'}]});
  assert.equal(cycle.nodes.length,2);assert.equal(cycle.edges.length,3);
  assert.equal(layoutGraph(cycle,'flow').positions.size,2);
});
test('build embeds only the existing synthetic fixture and bundles local imports',async()=>{
  const html=await readFile(new URL('../docs/style-gallery/explorer.html',import.meta.url),'utf8');
  assert.match(html,/"source_mode":"sample"/);
  assert.match(html,/const AUDIT=\{/);
  assert.match(html,/\/vendor\/three.module.js/);
  assert.equal(html.includes('PRIVATE_TEST_ACCESS_TOKEN'),false);
  const js=await readFile(new URL('../docs/style-gallery/explorer.js',import.meta.url),'utf8');
  assert.doesNotMatch(js,/localStorage|sessionStorage|fetch\(/);
  const root=await readFile(new URL('../docs/google-signin.js',import.meta.url),'utf8');
  assert.match(root,/\/api\/gtm\/gallery\/explorer.html\?snapshot=/);
});
