import { isDependency } from './explorer-model.js';

export const HEALTH = {
  healthy: { label:'Healthy', color:'#64dca7', glow:.12 },
  degraded: { label:'Degraded', color:'#efbc61', glow:.22 },
  failing: { label:'Failing', color:'#f17d8d', glow:.34 },
  unknown: { label:'Unknown', color:'#7e8b9d', glow:0 }
};
export const STALE_AFTER_MS = 15 * 60 * 1000;
export const pathKey = edge => JSON.stringify([edge.from,edge.to,edge.kind]);
export const isSignalPath = edge => isDependency(edge) && edge.kind !== 'tag_trigger_blocking';
const missing = value => value === null || value === undefined;
function metric(value, name, integer = false) {
  if(missing(value))return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||(integer&&!Number.isSafeInteger(value)))throw Error(`${name} must be a nonnegative ${integer?'integer':'number'} or null.`);
  return value;
}
export function parseTelemetry(input, graph, meta, now = Date.now()) {
  if(input?.schema_version!==1||!Array.isArray(input.edges))throw Error('Expected path telemetry schema_version 1 and an edges array.');
  if(![meta.container_id,meta.public_id].filter(Boolean).map(String).includes(String(input.container_id)))throw Error('This file belongs to a different container.');
  if(meta.account_id!=null&&String(input.account_id)!==String(meta.account_id))throw Error('This file belongs to a different account.');
  if(meta.workspace_id!=null&&String(input.workspace_id)!==String(meta.workspace_id))throw Error('This file belongs to a different workspace.');
  const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if(typeof input.window_start!=='string'||typeof input.window_end!=='string'||!iso.test(input.window_start)||!iso.test(input.window_end))throw Error('Measurement timestamps must be ISO-8601 strings with a timezone.');
  const start=Date.parse(input.window_start),end=Date.parse(input.window_end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>now+120000)throw Error('Supply a valid measurement window; its end must follow its start and cannot be in the future.');
  if(typeof input.source!=='string'||!input.source.trim()||input.source.length>200)throw Error('Supply a measurement source (up to 200 characters).');
  if(input.edges.length>10000)throw Error('The measurement file exceeds 10,000 paths.');
  const known=new Set(graph.edges.filter(isSignalPath).map(pathKey)),records=new Map();
  for(const row of input.edges){
    if(!row||typeof row!=='object')throw Error('Invalid path record.');
    const key=pathKey(row);
    if(!known.has(key))throw Error('A path does not match this snapshot, or describes a blocking/context relationship. Use the template for the current container.');
    if(records.has(key))throw Error('A path appears more than once.');
    const traffic=metric(row.traffic_count,'traffic_count',true),fires=metric(row.fire_count,'fire_count',true),importance=metric(row.importance,'importance');
    if(importance!==null&&importance>1)throw Error('importance must be between 0 and 1.');
    const health=row.health??'unknown';
    if(!Object.hasOwn(HEALTH,health))throw Error('health must be healthy, degraded, failing, or unknown.');
    const evidence=row.evidence??'';
    if(typeof evidence!=='string'||evidence.length>2000)throw Error('evidence must be text (up to 2,000 characters).');
    if((importance!==null||health!=='unknown')&&!evidence.trim())throw Error('Health and importance require an evidence/basis explanation.');
    records.set(key,{traffic,fires,importance,health,evidence});
  }
  return {records,source:input.source.trim(),start,end,durationMinutes:(end-start)/60000,demo:false};
}

export function demoTelemetry(graph) {
  const records=new Map();
  graph.edges.filter(isSignalPath).forEach((edge,i)=>{
    const inactive=graph.byId.get(edge.from)?.paused||graph.byId.get(edge.to)?.paused;
    const traffic=inactive?0:[2400,360,1200,80,0,6800][i%6];
    const health=['healthy','healthy','degraded','failing','unknown'][i%5];
    const fires=traffic===0?0:Math.round(traffic*(health==='failing'?.02:health==='degraded'?.7:.95));
    records.set(pathKey(edge),{traffic,fires,importance:[.2,.55,.8,1,.35][i%5],health,evidence:'Simulated one-minute scenario for demonstrating path signals. Not measured GTM traffic or a real health assessment.'});
  });
  return {records,source:'Simulated one-minute scenario',start:null,end:null,durationMinutes:1,demo:true};
}

export function describeSignal(edge, dataset, now = Date.now()) {
  const record=isSignalPath(edge)?dataset?.records.get(pathKey(edge)):null;
  const stale=!!dataset&&!dataset.demo&&now-dataset.end>STALE_AFTER_MS;
  const health=stale?'unknown':record?.health||'unknown';
  const rate=record?.fires!=null?record.fires/dataset.durationMinutes:null;
  const traffic=record?.traffic??null,importance=record?.importance??null;
  return {
    traffic,fires:record?.fires??null,rate,importance,health,reportedHealth:record?.health||'unknown',
    evidence:record?.evidence||'',stale,available:!!record,demo:!!dataset?.demo,
    color:HEALTH[health].color,glow:HEALTH[health].glow,
    radius:importance===null?.045:.045+importance*.2,
    packetCount:stale||!traffic?0:Math.min(12,Math.max(1,Math.ceil(Math.log10(traffic+1)*2.4))),
    speed:stale||!rate?0:Math.min(.32,.025+Math.log10(rate+1)*.06)
  };
}

export function telemetryTemplate(graph,meta) {
  return {
    schema_version:1,account_id:meta.account_id,container_id:meta.public_id||meta.container_id,workspace_id:meta.workspace_id,
    source:'Replace with your measurement source',window_start:'Replace with ISO-8601 measurement start',window_end:'Replace with ISO-8601 measurement end',
    edges:graph.edges.filter(isSignalPath).map(e=>({from:e.from,to:e.to,kind:e.kind,traffic_count:null,fire_count:null,importance:null,health:'unknown',evidence:''}))
  };
}
