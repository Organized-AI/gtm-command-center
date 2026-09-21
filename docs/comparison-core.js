// Pure comparison logic shared by the browser and authenticated Worker.
export const GTMComparison = (() => {
  const kinds = new Set(['tag','trigger','variable','builtin','folder','template','client','transformation','zone']);
  const metadata = new Set(['path','fingerprint','tagManagerUrl','accountId','containerId','workspaceId','containerVersionId']);
  const unordered = new Set(['firingTriggerId','blockingTriggerId']);
  const clone = value => JSON.parse(JSON.stringify(value));
  function normalize(value, key='', root=true) {
    if(Array.isArray(value)) {
      let items=value.map(item=>normalize(item,'',false));
      // Parameter maps are keyed; list values deliberately retain their order.
      if(['parameter','map'].includes(key) && items.every(x=>x&&typeof x==='object'&&typeof x.key==='string') && new Set(items.map(x=>x.key)).size===items.length)
        items=items.sort((a,b)=>a.key.localeCompare(b.key));
      if(unordered.has(key))items=items.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return items;
    }
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!root||!metadata.has(k)).map(k=>[k,normalize(value[k],k,false)]));
    return value;
  }
  function authoritative(node){return kinds.has(node.kind)&&!String(node.id_source||'').startsWith('derived')&&node.drift_state!=='removed';}
  function isChanged(node){return ['added','removed','modified'].includes(node.drift_state)&&kinds.has(node.kind);}
  function fieldChanges(before,after,path='$',out=[]) {
    if(JSON.stringify(before)===JSON.stringify(after))return out;
    if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)) {
      for(const key of [...new Set([...Object.keys(before),...Object.keys(after)])].sort())fieldChanges(before[key],after[key],path+'.'+key,out);
    }else out.push({path,before:before===undefined?null:before,after:after===undefined?null:after,before_present:before!==undefined,after_present:after!==undefined});
    return out;
  }
  function identity(audit){const m=audit.selection||audit.meta||{};return [m.accountId||m.account_id,m.containerId||m.container_id].join('/');}
  function compare(before,after,labels={}) {
    if(identity(before)!==identity(after))throw Error('Cannot compare different GTM containers.');
    const previous=new Map((before.nodes||[]).filter(authoritative).map(n=>[n.id,n]));
    const output=clone(after),added=[],removed=[],modified=[];
    output.nodes=output.nodes.filter(n=>n.drift_state!=='removed').map(n=>{delete n.drift_state;n.flags=(n.flags||[]).filter(f=>f!=='risk-escalated');return n;});
    for(const node of output.nodes.filter(authoritative)){
      const old=previous.get(node.id);
      if(!old){node.drift_state='added';added.push({id:node.id,name:node.name,kind:node.kind,before:null,after:clone(node.details||{}),changes:[]});}
      else {
        const changes=fieldChanges(normalize(old.details||{}),normalize(node.details||{}));
        if(changes.length){node.drift_state='modified';modified.push({id:node.id,name:node.name,kind:node.kind,before:clone(old.details||{}),after:clone(node.details||{}),changed_fields:changes.map(c=>c.path),changes});}
      }
      previous.delete(node.id);
    }
    for(const old of previous.values()){
      const ghost=clone(old);ghost.drift_state='removed';output.nodes.push(ghost);
      removed.push({id:old.id,name:old.name,kind:old.kind,before:clone(old.details||{}),after:null,changes:[]});
    }
    const signature=e=>[e.from,e.to,e.kind].join('|'),keys=new Set((after.edges||[]).map(signature));
    output.edges=clone(after.edges||[]);
    for(const edge of before.edges||[])if(!keys.has(signature(edge)))output.edges.push({...clone(edge),drift_state:'removed'});
    output.drift={available:true,added,removed,modified,risk_escalated:[],basis:'full-configuration',before_label:labels.before||'Previous snapshot',after_label:labels.after||'Current snapshot',summary:`${added.length} added · ${removed.length} removed · ${modified.length} modified`};
    output.dimensions=[];output.recommendations=[];output.signals=[];
    output.meta.overall_pct=null;
    return output;
  }
  const colorFor=(node,fallback)=>({added:'#39b878',removed:'#ff625f',modified:'#ffad58'}[node.drift_state]||fallback);
  return {normalize,authoritative,isChanged,fieldChanges,compare,colorFor};
})();
