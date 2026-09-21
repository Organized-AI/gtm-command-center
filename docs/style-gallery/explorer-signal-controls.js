import { HEALTH, STALE_AFTER_MS, pathKey, isSignalPath, parseTelemetry, demoTelemetry, describeSignal, telemetryTemplate } from './explorer-signals.js';
import { signalEdge } from './explorer-model.js';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value==null?'Not measured':new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value);

export class SignalControls {
  constructor({graph,meta,onChange,onPick,reduced}) {
    Object.assign(this,{graph,meta,onChange,onPick});
    this.demo=meta.source_mode==='sample'?demoTelemetry(graph):null;
    this.imported=null;this.mode=this.demo?'demo':'configuration';this.motion=!reduced;this.ticket=0;
    this.edgeByKey=new Map(graph.edges.filter(isSignalPath).map(e=>[pathKey(e),e]));
    $('signal-mode').replaceChildren(new Option('Configuration only','configuration'));
    if(this.demo)$('signal-mode').add(new Option('Simulated demo signals','demo'));
    const importedOption=new Option('Imported measurements','imported');importedOption.disabled=true;$('signal-mode').add(importedOption);
    $('signal-mode').value=this.mode;
    $('path-select').replaceChildren(new Option('Choose a path to inspect…',''));
    for(const [key,e] of this.edgeByKey){const directed=signalEdge(e);$('path-select').add(new Option(`${graph.byId.get(directed.from).name} → ${graph.byId.get(directed.to).name}`,key));}
    const toggle=()=>this.open($('path-panel').hidden);
    $('path-settings').addEventListener('click',toggle);$('path-badge').addEventListener('click',toggle);
    $('close-path-panel').addEventListener('click',()=>this.open(false));
    $('signal-mode').addEventListener('change',()=>{this.mode=$('signal-mode').value;this.render();onChange();});
    $('path-select').addEventListener('change',()=>{if($('path-select').value){onPick($('path-select').value);this.open(false);}});
    $('signal-motion').disabled=reduced;$('signal-motion').setAttribute('aria-pressed',String(this.motion));
    if(reduced)$('signal-motion').title='Motion disabled by your reduced-motion preference';
    $('signal-motion').addEventListener('click',()=>{this.motion=!this.motion;this.render();onChange();});
    $('import-signals').addEventListener('click',()=>$('signal-file').click());
    $('signal-file').addEventListener('change',async()=>{
      const file=$('signal-file').files[0],ticket=++this.ticket;if(!file)return;
      $('signal-error').hidden=true;
      try {
        if(file.size>2*1024*1024)throw Error('Use a telemetry file smaller than 2 MB.');
        const candidate=parseTelemetry(JSON.parse(await file.text()),graph,meta);
        if(ticket!==this.ticket)return;
        this.imported=candidate;this.mode='imported';importedOption.disabled=false;$('signal-mode').value='imported';this.render();onChange();
      } catch(error){if(ticket===this.ticket){$('signal-error').hidden=false;$('signal-error').textContent=`${error.message} The previous data is unchanged.`;}}
      finally {if(ticket===this.ticket)$('signal-file').value='';}
    });
    $('clear-signals').addEventListener('click',()=>{this.ticket++;this.imported=null;this.mode='configuration';importedOption.disabled=true;$('signal-mode').value=this.mode;this.render();onChange();});
    $('signal-template').addEventListener('click',()=>{
      const blob=new Blob([JSON.stringify(telemetryTemplate(graph,meta),null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='path-telemetry-template.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    this.render();
  }
  get active(){return this.mode!=='configuration';}
  get dataset(){return this.mode==='demo'?this.demo:this.mode==='imported'?this.imported:null;}
  get stale(){return !!this.dataset&&!this.dataset.demo&&Date.now()-this.dataset.end>STALE_AFTER_MS;}
  signal(edge){return describeSignal(edge,this.dataset);}
  open(value){$('path-panel').hidden=!value;for(const id of ['path-settings','path-badge'])$(id).setAttribute('aria-expanded',String(value));}
  syncSelection(key){$('path-select').value=key||'';}
  visible(ids){for(const option of $('path-select').options){const e=this.edgeByKey.get(option.value);if(e)option.disabled=!ids.has(e.from)||!ids.has(e.to);}}
  render(){
    const dataset=this.dataset,stale=this.stale;
    $('path-badge').textContent=!this.active?'PATHS · NO RUNTIME DATA':this.mode==='demo'?'PATHS · SIMULATED SIGNALS':stale?'PATHS · STALE MEASUREMENTS':'PATHS · IMPORTED SNAPSHOT';
    $('path-badge').dataset.mode=this.mode;
    $('signal-motion').setAttribute('aria-pressed',String(this.motion));$('signal-motion').textContent=this.motion?'Pause motion':'Resume motion';
    $('clear-signals').hidden=!this.imported;
    $('signal-source').textContent=!dataset?'No traffic collector is connected. Configuration links remain neutral.':dataset.demo?'Illustrative one-minute scenario. Traffic, firing, importance, and health are all simulated.':`${dataset.source} · ${dataset.records.size}/${this.edgeByKey.size} mapped paths · ${new Date(dataset.start).toLocaleString()} — ${new Date(dataset.end).toLocaleString()}. Imported, not independently verified.${stale?' Stale: health is neutral and packets are hidden after 15 minutes.':''}`;
    $('signal-motion').hidden=!this.active;
    $('signal-claim').textContent=this.mode==='demo'?'Path signals are simulated. Entity details still describe the configuration snapshot.':this.mode==='imported'?'Path signals use a user-imported measurement snapshot, not a live feed. Unmeasured paths remain unknown.':'Configuration relationships, not runtime firing. No event volume or success rate is inferred.';
    this.lastStale=stale;
  }
  refreshFreshness(){if(this.stale===this.lastStale)return false;this.render();return true;}
  tooltip(edge){
    const m=this.signal(edge),d=signalEdge(edge);
    return `${esc(this.graph.byId.get(d.from).name)} → ${esc(this.graph.byId.get(d.to).name)}<span>${this.mode==='demo'?'SIMULATED · ':''}${number(m.traffic)} observations · ${number(m.rate)} fires/min · ${m.stale?'Stale':HEALTH[m.health].label}</span>`;
  }
  inspector(edge){
    const m=this.signal(edge),d=signalEdge(edge),source=this.graph.byId.get(d.from),target=this.graph.byId.get(d.to),dataset=this.dataset;
    return `<span class="detail-kind" style="--kind-color:${m.color}">PATH SIGNALS / ${this.mode==='demo'?'SIMULATED':this.mode==='imported'?'IMPORTED':'UNMEASURED'}</span>
      <h2>${esc(source.name)}<span class="path-direction">↓</span>${esc(target.name)}</h2>
      <div class="detail-id">${esc(edge.kind)}</div>
      <div class="path-health" style="--health-color:${m.color}">${m.stale?'Stale · last reported '+esc(HEALTH[m.reportedHealth].label):esc(HEALTH[m.health].label)}</div>
      <dl class="detail-meta"><dt>Traffic / window</dt><dd>${number(m.traffic)}</dd><dt>Firing / minute</dt><dd>${number(m.rate)}</dd><dt>Fires / window</dt><dd>${number(m.fires)}</dd><dt>Importance</dt><dd>${m.importance==null?'Not supplied':Math.round(m.importance*100)+' / 100'}</dd></dl>
      <p class="lead">${dataset?.demo?'These values are simulated, not observed.':dataset?`${esc(dataset.source)}<br>${esc(new Date(dataset.start).toLocaleString())} — ${esc(new Date(dataset.end).toLocaleString())}<br>Imported snapshot; not independently verified.`:'No measurements for this path. Configuration connectivity is not used as a substitute for traffic, frequency, importance, or health.'}</p>
      ${m.evidence?`<div class="detail-section"><h3>HEALTH / IMPORTANCE BASIS</h3><p class="lead">${esc(m.evidence)}</p></div>`:''}
      <div class="detail-section"><h3>PATH ENDPOINTS</h3><button class="connection" data-node="${esc(source.id)}">Inspect ${esc(source.name)} <span class="arrow">↗</span></button><button class="connection" data-node="${esc(target.id)}">Inspect ${esc(target.name)} <span class="arrow">↗</span></button></div>
      <div class="view-explainer"><strong>How to read this path</strong>Packet density = traffic. Packet speed = firing frequency. Thickness = supplied importance. Color and glow = reported tracking health.<br><br>Visual scales are compressed and capped. One packet is not one event. Stationary packets mean paused motion, reduced motion, or zero/unknown firing rate.</div>`;
  }
}
