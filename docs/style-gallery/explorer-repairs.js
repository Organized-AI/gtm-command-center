import {completionReport,completionMarkup,configurationDiff,diffMarkup,workspaceMarkup} from './explorer-repair-report.js';
import {signalEdge} from './explorer-model.js';
import {pathKey} from './explorer-signals.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const identity=['accountId','containerId','workspaceId','tagId','triggerId','variableId','clientId','transformationId','templateId','path','fingerprint','tagManagerUrl'];
export function auditPath(graph,edge,signal,recommendations=[]){
  const d=signalEdge(edge),nodes=[...new Set([d.from,d.to])].map(id=>graph.byId.get(id));
  const findings=[];
  if(signal.stale)findings.push({title:'Measurements are stale',detail:'Import a fresh measurement window before judging the result of a repair.'});
  else if(['failing','degraded'].includes(signal.health))findings.push({title:signal.demo?'Simulated unhealthy path':'Reported unhealthy path',detail:signal.evidence||'The measurement source reports an unhealthy path. A root cause has not been established.'});
  else if(signal.health==='unknown')findings.push({title:'Health is unmeasured',detail:'Collect a fresh preview or measurement sample. Connectivity alone cannot establish that a path works.'});
  for(const node of nodes){
    if(node.paused||node.details?.paused)findings.push({title:`${node.name} is paused`,detail:'Confirm whether this is intentional before enabling it. A paused tag can be a deliberate safeguard.'});
    for(const flag of node.flags||[])if(!['system-trigger','system-variable'].includes(flag))findings.push({title:`${node.name}: ${flag}`,detail:'This flag comes from the captured configuration. Inspect the endpoint and its references before changing it.'});
  }
  for(const r of recommendations.filter(r=>(r.entity_ids||[]).some(id=>nodes.some(n=>n.id===id))))findings.push({title:r.title,detail:r.action||r.why||'Review the recommendation against the current workspace.'});
  if(!findings.length)findings.push({title:'No issue identified by this snapshot',detail:'Use GTM Preview to verify inputs, trigger conditions, consent, and the destination response.'});
  const checks=edge.kind==='transport'?['Check the web tag’s server endpoint URL.','Verify the server client claims the request and preserves the expected event name.','Verify the destination response and consent handling.']:edge.kind.includes('variable')?['Check the referenced variable exists and resolves to the expected value.','Preview the consuming tag or trigger with representative event data.','Verify consent and destination delivery.']:['Check firing and blocking conditions in GTM Preview.','Verify tag sequencing, consent, and required parameters.','Confirm delivery at the destination.'];
  return {nodes,findings,checks,rootCause:'Health is evidence to investigate, not proof of a specific configuration defect.'};
}
export function createDraft(node,before,text){
  if(typeof text!=='string'||text.length>100000)throw Error('Use a configuration smaller than 100 KB.');
  let after;try{after=JSON.parse(text);}catch{throw Error('Enter valid JSON before reviewing the change.');}
  if(!after||Array.isArray(after)||typeof after!=='object')throw Error('Configuration must be a JSON object.');
  const inspect=value=>{if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw Error('Unsupported configuration key.');inspect(v);}};inspect(after);
  for(const key of identity)if(!same(before[key],after[key]))throw Error(`Keep ${key} unchanged. It identifies the captured entity or revision.`);
  if('paused' in after&&typeof after.paused!=='boolean')throw Error('paused must be true or false.');
  if('name' in after&&(typeof after.name!=='string'||!after.name.trim()))throw Error('Name must be nonempty text.');
  if('parameter' in after&&!Array.isArray(after.parameter))throw Error('parameter must be an array.');
  const changes=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!same(before[key],after[key])).map(field=>({field,before:before[field],after:after[field],operation:!(field in after)?'remove':!(field in before)?'add':'replace'}));
  if(!changes.length)throw Error('Change at least one configuration value before reviewing.');
  return {nodeId:node.id,name:node.name,before:clone(before),after:clone(after),changes};
}
export function exportFixPlan(meta,drafts,history=[]){
  return {schema_version:1,kind:'gtm-reviewed-fix-plan',status:'local-draft-not-applied-to-gtm',container_id:meta.container_id||meta.public_id,account_id:meta.account_id,workspace_id:meta.workspace_id,snapshot_at:meta.run_at,created_at:new Date().toISOString(),changes:[...drafts.values()].map(clone),repair_history:clone(history),instructions:['Review each change against the current GTM workspace and its fingerprint.','Apply the reviewed fields in GTM. This file is a fix plan, not a GTM container import.','Use GTM Preview to verify expected behavior before publishing.','Import fresh measurements; a local draft does not prove a path is healthy.']};
}
export class RepairControls {
  constructor({graph,audit,signals,onChange,onStart,onRender}){Object.assign(this,{graph,audit,signals,onChange,onStart,onRender});this.selected=null;this.review=null;this.job=null;this.drafts=new Map();this.simulations=new Map();this.message='';this.history=[];this.reviewReason='';}
  markup(edge){
    this.selected=edge;const key=pathKey(edge),report=auditPath(this.graph,edge,this.signals.signal(edge),this.audit.recommendations),signal=this.signals.signal(edge);
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const history=this.history.filter(r=>r.pathKey===key).slice().reverse();
    const nodes=report.nodes.filter(n=>['tag','trigger','variable','client','transformation'].includes(n.kind));
    return `${history.length?'<div class="repair-report-actions"><button data-repair="expand-report">Expand change review</button><button data-repair="export">Export change report</button></div>'+completionMarkup(history[0]):''}${history.length>1?`<details class="repair-history"><summary>Earlier repairs / ${history.length-1}</summary>${history.slice(1).map(completionMarkup).join('')}</details>`:''}<section class="repair-panel" aria-label="Path audit and fixes"><span class="repair-kicker">AUDIT → REVIEW → IMPLEMENT → VERIFY</span><h3>Repair workbench</h3><p class="repair-path-name">${report.nodes.map(n=>esc(n.name)).join(' → ')}</p><p class="lead">${this.signals.mode==='demo'?'Demo container. Simulations affect only this tab.':'GTM connection is read-only. Changes are staged locally for review and export.'}</p>${report.findings.map(f=>`<div class="repair-finding"><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div>`).join('')}<details><summary>Verification checklist</summary><ol>${report.checks.map(c=>`<li>${esc(c)}</li>`).join('')}</ol><p>${report.rootCause}</p></details>
      <div class="repair-actions"><button data-repair="focus">Focus this path</button>${this.signals.mode==='demo'&&['failing','degraded'].includes(signal.health)?'<button data-repair="simulate" class="repair-primary" '+(this.job?'disabled':'')+'>Simulate worker repair</button>':''}${this.simulations.has(key)?'<button data-repair="undo-simulation">Undo simulation</button>':''}</div>
      ${nodes.length?`<details class="repair-editor"><summary>Edit a configuration fix</summary><p>Choose an endpoint, edit its configuration, and review the exact changes. Nothing is sent to GTM.</p><label for="repair-node">Endpoint</label><select id="repair-node">${nodes.map(n=>`<option value="${esc(n.id)}">${esc(n.name)}${this.drafts.has(n.id)?' · draft':''}</option>`).join('')}</select><label for="repair-json">Proposed configuration (JSON)</label><textarea id="repair-json" spellcheck="false">${esc(JSON.stringify(this.drafts.get(nodes[0].id)?.after||nodes[0].details||{},null,2))}</textarea><label for="repair-reason">Reason and intended outcome</label><textarea id="repair-reason" class="repair-reason" placeholder="Explain the issue this edit addresses and the result you expect."></textarea><button data-repair="review" ${this.job?'disabled':''}>Review changes</button><div id="repair-review"></div></details>`:''}
      <div id="repair-message" role="status">${esc(this.job?'Worker is applying a local repair…':this.message)}</div><div id="repair-progress" ${this.job?'':'hidden'}><progress max="100" value="0" aria-label="Repair progress"></progress><span>Preparing repair</span><button data-repair="cancel">Cancel repair</button></div>
      ${this.drafts.size?workspaceMarkup(this.drafts,this.graph):''}${this.drafts.size?`<div class="repair-draft-summary"><strong>${this.drafts.size} local configuration draft${this.drafts.size===1?'':'s'}</strong><p>Not applied to GTM. Runtime health still needs verification.</p><button data-repair="export">Export fix plan</button><button data-repair="undo-drafts" ${this.job?'disabled':''}>Discard drafts</button></div>`:''}</section>`;
  }
  changeNode(id){const node=this.graph.byId.get(id);if(!node)return;document.getElementById('repair-json').value=JSON.stringify(this.drafts.get(id)?.after||node.details||{},null,2);this.review=null;document.getElementById('repair-review').replaceChildren();}
  handle(action){
    const edge=this.selected;if(!edge)return;
    const message=text=>{this.message=text;const el=document.getElementById('repair-message');if(el)el.textContent=text;};
    try{
      if(action==='expand-report'){
        const report=this.history.filter(r=>r.pathKey===pathKey(edge)).at(-1);if(!report)return;
        const dialog=document.createElement('dialog');dialog.className='repair-change-dialog';dialog.setAttribute('aria-label','Workspace change review');
        const close=document.createElement('button');close.textContent='Close change review';close.className='repair-dialog-close';close.addEventListener('click',()=>dialog.close());dialog.append(close);
        dialog.insertAdjacentHTML('beforeend',completionMarkup(report)+(this.drafts.size?workspaceMarkup(this.drafts,this.graph):''));
        dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return;
      }
      if(action==='focus'){this.onStart(edge,false);return;}
      if(action==='cancel'){this.job=null;this.review=null;message('Repair canceled. No draft or measurement was changed.');this.onRender();return;}
      if(action==='export'){const url=URL.createObjectURL(new Blob([JSON.stringify(exportFixPlan(this.audit.meta,this.drafts,this.history),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='gtm-reviewed-fix-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
      if(this.job)throw Error('Finish or cancel the current repair first.');
      if(action==='undo-drafts'){for(const report of this.history)if(report.kind==='draft'&&report.state==='completed')report.state='discarded';this.drafts.clear();this.review=null;message('Local configuration drafts discarded. GTM is unchanged.');this.onRender();return;}
      if(action==='undo-simulation'){const key=pathKey(edge),old=this.simulations.get(key);if(old){this.signals.demo.records.set(key,old);this.simulations.delete(key);for(const report of this.history)if(report.kind==='simulation'&&report.pathKey===key&&report.state==='completed')report.state='undone';message('Original simulated measurement restored.');this.onChange();}return;}
      if(action==='review'){
        const node=this.graph.byId.get(document.getElementById('repair-node').value),before=this.drafts.get(node.id)?.after||node.details||{};
        this.review=createDraft(node,before,document.getElementById('repair-json').value);
        const host=document.getElementById('repair-review');host.replaceChildren();
        this.reviewReason=document.getElementById('repair-reason').value.trim();
        if(!this.reviewReason||this.reviewReason.length>2000){this.review=null;throw Error('Describe the reason and intended outcome in 1–2,000 characters.');}
        const heading=document.createElement('h4');heading.textContent='Proposed workspace change';host.append(heading);
        host.insertAdjacentHTML('beforeend',diffMarkup(configurationDiff(this.review.before,this.review.after),'Current local draft','Proposed change'));
        const reason=document.createElement('p');reason.textContent='Reason: '+this.reviewReason;host.append(reason);
        const button=document.createElement('button');button.dataset.repair='apply';button.className='repair-primary';button.textContent='Apply to local draft';host.append(button);message('Review complete. Applying creates a local draft; it does not alter GTM.');return;
      }
      if(action==='apply'){
        if(!this.review)throw Error('Review the configuration changes first.');
        const node=this.graph.byId.get(document.getElementById('repair-node').value);
        const current=createDraft(node,this.drafts.get(node.id)?.after||node.details||{},document.getElementById('repair-json').value);
        if(!same(current,this.review)||document.getElementById('repair-reason').value.trim()!==this.reviewReason)throw Error('The editor changed. Review the updated configuration again.');
        this.job={key:pathKey(edge),edge,elapsed:0,kind:'draft',draft:clone(current),reason:this.reviewReason};
      }else if(action==='simulate'){
        const signal=this.signals.signal(edge);if(this.signals.mode!=='demo'||!['failing','degraded'].includes(signal.health))throw Error('Simulations are available only for unhealthy demo paths.');
        this.job={key:pathKey(edge),edge,elapsed:0,kind:'simulation'};
      }else return;
      this.job.signalAtStart=clone(this.signals.signal(edge));
      this.job.auditReport=auditPath(this.graph,edge,this.signals.signal(edge),this.audit.recommendations);
      this.review=null;this.message='';this.onStart(edge,true);this.onRender();
    }catch(error){message(error.message);}
  }
  tick(delta,reduced){
    if(!this.job)return false;
    const job=this.job;job.elapsed+=delta;const progress=Math.min(1,job.elapsed/(reduced?.4:7));
    const host=document.getElementById('repair-progress');if(host){host.hidden=false;host.querySelector('progress').value=progress*100;host.querySelector('span').textContent=progress<.3?'Worker approaching path':progress<.8?'Implementing local repair':'Checking local result';}
    if(progress<1)return true;
    const auditReport=job.auditReport||auditPath(this.graph,job.edge,this.signals.signal(job.edge),this.audit.recommendations);
    let recordBefore,recordAfter;
    if(job.kind==='simulation'){
      const record=this.signals.demo.records.get(job.key);if(record){recordBefore=clone(record);if(!this.simulations.has(job.key))this.simulations.set(job.key,clone(record));this.signals.demo.records.set(job.key,{...record,health:'healthy',evidence:'Simulated repair completed in this tab. This is not a measured or live GTM result.'});recordAfter=clone(this.signals.demo.records.get(job.key));}
      this.message='Demo repair complete. Health is simulated; GTM is unchanged.';
    }else{
      const original=this.drafts.get(job.draft.nodeId)?.before||job.draft.before;
      const node=this.graph.byId.get(job.draft.nodeId);
      // A second edit is consolidated against the original snapshot for export.
      if(same(original,job.draft.after))this.drafts.delete(node.id);
      else this.drafts.set(node.id,createDraft(node,original,JSON.stringify(job.draft.after)));
      this.message='Local draft implemented. Export the plan to apply in GTM, then verify with fresh measurements.';
    }
    this.history.push(completionReport({job,graph:this.graph,signal:job.signalAtStart||this.signals.signal(job.edge),checks:auditReport.checks,findings:auditReport.findings,sequence:this.history.length+1,recordBefore,recordAfter}));
    this.job=null;this.onChange();this.onRender();return true;
  }
}
