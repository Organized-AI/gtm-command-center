import {kindMeta,signalEdge} from './explorer-model.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const labels={name:'Name',type:'Entity type',paused:'Paused',parameter:'Parameters',firingTriggerId:'Firing triggers',blockingTriggerId:'Blocking triggers',setupTag:'Setup tags',teardownTag:'Teardown tags',consentSettings:'Consent settings',tagFiringOption:'Tag firing option',notes:'Notes',parentFolderId:'Folder'};
export function fieldLabel(path){return path.replace(/^[^.[]+/,key=>labels[key]||key).replace(/\[key=([^\]]+)\]/g,' / $1').replaceAll('.',' / ');}
export function configurationDiff(before,after){
  const rows=[];
  const visit=(a,b,path,hasA=true,hasB=true)=>{
    if(hasA&&hasB&&same(a,b))return;
    if(!hasA||!hasB){rows.push({path,label:fieldLabel(path),operation:hasA?'removed':'added',before:a,after:b,hasBefore:hasA,hasAfter:hasB});return;}
    if(object(a)&&object(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))visit(a[key],b[key],path?path+'.'+key:key,Object.hasOwn(a,key),Object.hasOwn(b,key));return;}
    const keyed=arr=>Array.isArray(arr)&&arr.every(v=>object(v)&&typeof v.key==='string')&&new Set(arr.map(v=>v.key)).size===arr.length;
    if(keyed(a)&&keyed(b)){
      const am=new Map(a.map(v=>[v.key,v])),bm=new Map(b.map(v=>[v.key,v]));
      for(const key of new Set([...am.keys(),...bm.keys()]))visit(am.get(key),bm.get(key),`${path}[key=${key}]`,am.has(key),bm.has(key));
      const commonA=a.map(v=>v.key).filter(k=>bm.has(k)),commonB=b.map(v=>v.key).filter(k=>am.has(k));
      if(!same(commonA,commonB))rows.push({path:path+'.$order',label:fieldLabel(path)+' / order',operation:'modified',before:a.map(v=>v.key),after:b.map(v=>v.key),hasBefore:true,hasAfter:true});
      return;
    }
    rows.push({path,label:fieldLabel(path),operation:'modified',before:a,after:b,hasBefore:true,hasAfter:true});
  };visit(before,after,'');return rows;
}
function impact(row){
  if(row.path==='paused')return row.after===false?'The draft enables this entity. Verify firing conditions and consent before applying it.':'The draft changes whether this entity can run. Confirm that this is intentional.';
  if(row.path==='name')return 'Renames the entity for identification. A name change alone does not establish a tracking repair.';
  if(row.path.startsWith('firingTriggerId'))return 'Changes which triggers can fire this tag. Test both matching and nonmatching events.';
  if(row.path.startsWith('blockingTriggerId'))return 'Changes blocking conditions. Verify events that should remain blocked.';
  if(row.path.startsWith('consent'))return 'Changes consent-related configuration. Verify denied and granted consent states.';
  if(row.path.startsWith('parameter'))return 'Changes an input to this entity. Confirm the resolved value and the consuming tag or trigger in GTM Preview.';
  return 'Changes the captured configuration shown here. Validate the intended behavior in GTM Preview before publishing.';
}
export function completionReport({job,graph,signal,checks,findings,sequence,recordBefore,recordAfter}){
  const directed=signalEdge(job.edge),node=job.draft&&graph.byId.get(job.draft.nodeId),simulation=job.kind==='simulation';
  const changes=simulation?configurationDiff(recordBefore,recordAfter):configurationDiff(job.draft.before,job.draft.after);
  return {sequence,completedAt:new Date().toISOString(),pathKey:job.key,kind:job.kind,state:'completed',entity:node?{id:node.id,name:node.name,kind:kindMeta(node.kind).singular}:null,pathName:[directed.from,directed.to].map(id=>graph.byId.get(id).name).join(' → '),reason:job.reason|| (simulation?'Demonstrate the worker repair and its visual health transition.':'Manually reviewed configuration edit. The intended outcome must be verified in GTM Preview.'),findings:findings.map(f=>({...f})),changes:changes.map(row=>({...row,impact:simulation?'Updates only the in-memory demo measurement; no tag, trigger, variable, or live traffic is changed.':impact(row)})),before:simulation?recordBefore:job.draft.before,after:simulation?recordAfter:job.draft.after,healthBefore:simulation?recordBefore.health:signal.health,healthAfter:simulation?recordAfter.health:signal.health,checks:[...checks],result:simulation?'Simulation complete. No GTM configuration was modified.':'Local draft updated. No GTM workspace was modified or published.',validation:simulation?'No configuration or runtime validation was performed.':'Local JSON and identity checks passed. Runtime behavior has not been verified.'};
}
const format=(value,present)=>!present?'Not set':typeof value==='string'?value:JSON.stringify(value,null,2);
export function diffMarkup(rows,beforeLabel='Before this repair',afterLabel='After this repair'){
  return `<div class="repair-diff" role="table" aria-label="Configuration changes"><div class="repair-diff-head" role="row"><span role="columnheader">Field / change</span><span role="columnheader">${esc(beforeLabel)}</span><span role="columnheader">${esc(afterLabel)}</span></div>${rows.map(row=>`<div class="repair-diff-row" role="row"><div role="cell"><strong>${esc(row.label)}</strong><span class="change-operation ${row.operation}">${esc(row.operation)}</span><code>${esc(row.path)}</code></div><pre role="cell" class="change-before">${esc(format(row.before,row.hasBefore))}</pre><pre role="cell" class="change-after">${esc(format(row.after,row.hasAfter))}</pre></div>${row.impact?`<p class="change-impact">${esc(row.impact)}</p>`:''}`).join('')}</div>`;
}
export function completionMarkup(report){
  const simulation=report.kind==='simulation';
  return `<section class="repair-completion" aria-label="Repair completion report"><div class="repair-report-heading"><span>REPAIR ${report.sequence} / ${esc(report.state.toUpperCase())}</span><span class="badge">${simulation?'SIMULATION':'LOCAL DRAFT'}</span></div><h3>${simulation?'Simulation change summary':'Workspace change review'}</h3><p class="repair-path-name">${esc(report.entity?.name||report.pathName)}</p><dl class="repair-report-meta"><dt>Change type</dt><dd>${simulation?'Demo measurement modified':esc(report.entity.kind)+' modified'}</dd><dt>Completed</dt><dd>${esc(new Date(report.completedAt).toLocaleString())}</dd><dt>Publication</dt><dd>Not published</dd><dt>Path health</dt><dd>${esc(report.healthBefore)} → ${esc(report.healthAfter)}${simulation?' (simulated)':' (not remeasured)'}</dd></dl><p class="repair-result">${esc(report.state==='completed'?report.result:report.state==='undone'?'This simulation was undone; the original demo measurement was restored.':'This local draft was discarded. GTM remains unchanged.')}</p><h4>Why this change was made</h4><p>${esc(report.reason)}</p><details><summary>Audit evidence at the time of repair</summary>${report.findings.map(f=>`<p><strong>${esc(f.title)}</strong><br>${esc(f.detail)}</p>`).join('')}</details><h4>What changed / ${report.changes.length} field${report.changes.length===1?'':'s'}</h4>${diffMarkup(report.changes)}<h4>Verification still required</h4><p>${simulation?'No real configuration or runtime check was performed.':esc(report.validation)}</p><ol>${report.checks.map(check=>`<li>${esc(check)}</li>`).join('')}<li>Capture fresh measurements to verify the path’s actual health.</li></ol><details><summary>Full before / after ${simulation?'demo record':'configuration'}</summary><h4>Before</h4><pre>${esc(JSON.stringify(report.before,null,2))}</pre><h4>After</h4><pre>${esc(JSON.stringify(report.after,null,2))}</pre></details><p class="repair-history-note">Reports and drafts stay in this tab. Export the change report to keep them before reloading.</p></section>`;
}
export function workspaceMarkup(drafts,graph){
  return `<details class="workspace-changes"><summary>Workspace changes / ${drafts.size} modified entit${drafts.size===1?'y':'ies'}</summary><p>Captured snapshot → current local draft. Repeated edits are combined here. These changes have not been sent to GTM.</p>${[...drafts.values()].map(d=>`<section><h4>${esc(kindMeta(graph.byId.get(d.nodeId).kind).singular)} / ${esc(d.name)} <span class="change-operation modified">Modified</span></h4>${diffMarkup(configurationDiff(d.before,d.after),'Captured snapshot','Current draft')}</section>`).join('')}</details>`;
}
