import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {makeGraph} from '../style-gallery/explorer-model.js';
import {HEALTH,STALE_AFTER_MS,pathKey,isSignalPath,parseTelemetry,demoTelemetry,describeSignal,telemetryTemplate} from '../style-gallery/explorer-signals.js';
import {PathVisual} from '../style-gallery/explorer-path-visual.js';
import {SignalControls} from '../style-gallery/explorer-signal-controls.js';

const now=Date.parse('2026-09-14T21:00:00Z');
const meta={container_id:'17',public_id:'GTM-TEST',workspace_id:'3',source_mode:'direct-api'};
const edge={from:'tag:1',to:'trigger:1',kind:'tag_trigger'};
const graph=makeGraph({nodes:[{id:'tag:1',name:'Purchase',kind:'tag'},{id:'trigger:1',name:'Purchase event',kind:'trigger'},{id:'folder:1',name:'Analytics',kind:'folder'},{id:'tag:2',name:'Paused',kind:'tag',paused:true}],edges:[edge,{from:'tag:2',to:'trigger:1',kind:'tag_trigger'},{from:'folder:1',to:'tag:1',kind:'folder_member'},{from:'tag:1',to:'trigger:1',kind:'tag_trigger_blocking'}]});
const file=()=>({schema_version:1,container_id:'GTM-TEST',workspace_id:'3',source:'Test collector',window_start:'2026-09-14T20:58:00Z',window_end:'2026-09-14T21:00:00Z',edges:[{...edge,traffic_count:1200,fire_count:60,importance:.8,health:'healthy',evidence:'Test: synthetic collector sample and explicit business priority.'}]});

test('missing measurements stay neutral; connectivity is never used as a runtime proxy',()=>{
  const s=describeSignal(edge,null,now);
  assert.equal(s.traffic,null);assert.equal(s.rate,null);assert.equal(s.importance,null);assert.equal(s.health,'unknown');
  assert.equal(s.packetCount,0);assert.equal(s.speed,0);assert.equal(s.glow,0);assert.equal(s.color,HEALTH.unknown.color);
});
test('measured rate uses the actual time window, and zero is different from missing',()=>{
  const data=parseTelemetry(file(),graph,meta,now),s=describeSignal(edge,data,now);
  assert.equal(s.rate,30);assert.equal(s.traffic,1200);assert.equal(s.health,'healthy');assert.ok(s.packetCount>0);assert.ok(s.speed>0);
  const zero=file();Object.assign(zero.edges[0],{traffic_count:0,fire_count:0,importance:0});
  const z=describeSignal(edge,parseTelemetry(zero,graph,meta,now),now);
  assert.equal(z.traffic,0);assert.equal(z.rate,0);assert.equal(z.packetCount,0);assert.equal(z.speed,0);assert.equal(z.radius,.045);
});
test('importance changes thickness only; traffic and frequency have separate visual channels',()=>{
  const base=file(),a=describeSignal(edge,parseTelemetry(base,graph,meta,now),now);
  base.edges[0].importance=1;const b=describeSignal(edge,parseTelemetry(base,graph,meta,now),now);
  assert.ok(b.radius>a.radius);assert.equal(b.packetCount,a.packetCount);assert.equal(b.speed,a.speed);
  base.edges[0].traffic_count=10000000;const c=describeSignal(edge,parseTelemetry(base,graph,meta,now),now);
  assert.equal(c.packetCount,12);assert.equal(c.speed,b.speed);
  base.edges[0].fire_count=10000;const d=describeSignal(edge,parseTelemetry(base,graph,meta,now),now);
  assert.ok(d.speed>c.speed);assert.equal(d.radius,c.radius);
});
test('stale data keeps its historical values but loses live-looking health and packets',()=>{
  const data=parseTelemetry(file(),graph,meta,now),s=describeSignal(edge,data,now+STALE_AFTER_MS+1);
  assert.equal(s.stale,true);assert.equal(s.reportedHealth,'healthy');assert.equal(s.health,'unknown');assert.equal(s.glow,0);
  assert.equal(s.packetCount,0);assert.equal(s.speed,0);assert.equal(s.traffic,1200);
});
test('imports reject wrong targets, unmatched paths, duplicates, and non-signal relationships',()=>{
  for(const change of [x=>x.container_id='other',x=>x.workspace_id='4',x=>x.edges[0].to='missing',x=>x.edges.push({...x.edges[0]}),x=>x.edges[0].kind='tag_trigger_blocking',x=>x.edges[0]={from:'folder:1',to:'tag:1',kind:'folder_member'}]){
    const x=file();change(x);assert.throws(()=>parseTelemetry(x,graph,meta,now));
  }
  assert.equal(isSignalPath(graph.edges[2]),false);assert.equal(isSignalPath(graph.edges[3]),false);
  assert.throws(()=>parseTelemetry({...file(),account_id:'other'},graph,{...meta,account_id:'123'},now),/different account/);
});
test('imports reject invalid windows, unsafe values, and unsupported assessments',()=>{
  for(const change of [x=>x.window_start=x.window_end,x=>x.window_end='2028-01-01T00:00:00Z',x=>x.window_end='9/14/26',x=>x.edges[0].traffic_count=-1,x=>x.edges[0].fire_count=Infinity,x=>x.edges[0].fire_count='100',x=>x.edges[0].fire_count=.5,x=>x.edges[0].importance=1.1,x=>x.edges[0].health='__proto__',x=>x.edges[0].evidence='',x=>x.source='']){
    const x=file();change(x);assert.throws(()=>parseTelemetry(x,graph,meta,now));
  }
});
test('partial coverage and unknown fields are not backfilled with fabricated data',()=>{
  const x=file();Object.assign(x.edges[0],{traffic_count:null,fire_count:null,importance:null,health:'unknown',evidence:''});
  const data=parseTelemetry(x,graph,meta,now);
  assert.equal(describeSignal(edge,data,now).packetCount,0);assert.equal(describeSignal(graph.edges[1],data,now).available,false);
  assert.equal(describeSignal(graph.edges[1],data,now).health,'unknown');
});
test('demo values are deterministic, explicitly simulated, and absent from blocking/context paths',()=>{
  assert.deepEqual(demoTelemetry(graph),demoTelemetry(graph));
  const data=demoTelemetry(graph);assert.equal(data.demo,true);assert.equal(data.start,null);assert.equal(data.records.size,2);
  assert.equal(data.records.get(pathKey(graph.edges[1])).traffic,0);assert.equal(data.records.has(pathKey(graph.edges[3])),false);
  assert.match(data.records.get(pathKey(edge)).evidence,/Simulated/);
});
test('downloadable templates provide exact path IDs but contain no invented measurements',()=>{
  const template=telemetryTemplate(graph,meta);assert.equal(template.edges.length,2);
  assert.equal(template.container_id,meta.public_id);assert.equal(template.workspace_id,'3');
  assert.equal(template.edges[0].traffic_count,null);assert.equal(template.edges[0].fire_count,null);assert.equal(template.edges[0].importance,null);
  assert.throws(()=>parseTelemetry(template,graph,meta,now));
});
test('path packets animate on curves, respect reduced motion, and disappear when Paths is hidden',()=>{
  const visual=new PathVisual(pathKey(edge)),data=demoTelemetry(graph);
  visual.setCurve(new THREE.QuadraticBezierCurve3(new THREE.Vector3(),new THREE.Vector3(5,5,0),new THREE.Vector3(10,0,0)));
  visual.setSignal(describeSignal(edge,data,now));
  assert.equal(visual.tick(0),true);const first=visual.packets.instanceMatrix.array.slice();
  visual.tick(1);assert.notDeepEqual(visual.packets.instanceMatrix.array,first);
  visual.tick(0,{reduced:true});const still=visual.packets.instanceMatrix.array.slice();visual.tick(20,{reduced:true});
  assert.deepEqual(visual.packets.instanceMatrix.array,still);
  visual.setSignal(describeSignal(edge,null,now));assert.equal(visual.packets.count,0);assert.equal(visual.glow.material.opacity,0);
  visual.setSignal(describeSignal(edge,data,now),{visible:false});assert.equal(visual.tick(100),false);
  visual.root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

function withControls(meta,run){
  const savedDocument=globalThis.document,savedOption=globalThis.Option;
  class Element{constructor(){this.options=[];this.dataset={};this.listeners={};this.hidden=false;this.attrs={};this.value='';}setAttribute(k,v){this.attrs[k]=v;}replaceChildren(...items){this.options=items;}add(item){this.options.push(item);}addEventListener(k,fn){this.listeners[k]=fn;}}
  const elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
  globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;this.disabled=false;}};
  const controls=new SignalControls({graph,meta,onChange(){},onPick(){},reduced:false});
  return Promise.resolve().then(()=>run(controls,elements)).finally(()=>{globalThis.document=savedDocument;globalThis.Option=savedOption;});
}
test('private snapshots never start simulated signals, while public demo labels are explicit',async()=>{
  await withControls(meta,(controls,elements)=>{assert.equal(controls.active,false);assert.equal(controls.demo,null);assert.match(elements.get('path-badge').textContent,/NO RUNTIME DATA/);assert.equal(elements.get('signal-mode').options.some(o=>o.value==='demo'),false);});
  await withControls({...meta,source_mode:'sample'},(controls,elements)=>{assert.equal(controls.mode,'demo');assert.match(elements.get('path-badge').textContent,/SIMULATED/);assert.match(elements.get('signal-source').textContent,/all simulated/);});
});
test('invalid imports leave the previous accepted dataset untouched and report the error',async()=>{
  await withControls(meta,async(controls,elements)=>{
    const x=file();x.window_end=new Date().toISOString();x.window_start=new Date(Date.now()-120000).toISOString();
    elements.get('signal-file').files=[{size:100,text:async()=>JSON.stringify(x)}];await elements.get('signal-file').listeners.change();
    assert.equal(controls.mode,'imported');const accepted=controls.imported;
    x.container_id='wrong';elements.get('signal-file').files=[{size:100,text:async()=>JSON.stringify(x)}];await elements.get('signal-file').listeners.change();
    assert.equal(controls.imported,accepted);assert.equal(controls.mode,'imported');assert.match(elements.get('signal-error').textContent,/different container/);
  });
});
test('path inspector escapes user-supplied source and evidence text',async()=>{
  await withControls(meta,controls=>{
    const x=file();x.source='<script>bad()</script>';x.edges[0].evidence='<img onerror=bad()>';
    controls.imported=parseTelemetry(x,graph,meta,now);controls.mode='imported';
    const html=controls.inspector(edge);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img onerror'));assert.ok(html.includes('&lt;script&gt;'));
  });
});
