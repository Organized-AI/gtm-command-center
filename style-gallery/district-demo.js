// The paired server surface exists only in the explicitly synthetic demo.
// A private snapshot must never gain inferred server entities or transport edges.
export function pairedDemo(audit) {
  if(audit.meta?.source_mode!=='sample')return audit;
  const server=[
    ['client:ga4','GA4 request client','client'],['client:http','HTTP request client','client'],
    ['variable:event','Event name','variable'],['variable:client','Client identifier','variable'],['variable:value','Purchase value','variable'],
    ['trigger:purchase','Purchase received','trigger'],['trigger:all','All server events','trigger'],
    ['tag:ga4','GA4 server destination','tag'],['tag:ads','Ads server conversion','tag'],
    ['transformation:privacy','Remove sensitive fields','transformation'],['template:ga4','GA4 server template','template']
  ].map(([id,name,kind])=>({id:'server:'+id,name,kind,surface:'server',risk:'unassessed',flags:[],details:{source:'Synthetic paired-container demo'}}));
  const edges=[
    ['server:client:ga4','server:trigger:all','client_event'],
    ['server:client:ga4','server:trigger:purchase','client_event'],
    ['server:tag:ga4','server:trigger:all','tag_trigger'],
    ['server:tag:ads','server:trigger:purchase','tag_trigger'],
    ['server:tag:ga4','server:variable:event','tag_variable'],
    ['server:tag:ga4','server:variable:client','tag_variable'],
    ['server:tag:ads','server:variable:value','tag_variable'],
    ['server:transformation:privacy','server:variable:client','transformation_variable']
  ];
  const source=audit.nodes.find(n=>n.id==='tag:2')||audit.nodes.find(n=>n.kind==='tag');
  if(source)edges.unshift([source.id,'server:client:ga4','transport']);
  return {...audit,meta:{...audit.meta,container_name:'Northstar · Web + Server',paired_demo:true},nodes:[...audit.nodes.map(n=>({...n,surface:'web'})),...server],edges:[...audit.edges,...edges.map(([from,to,kind])=>({from,to,kind,evidence:'Synthetic web-to-server example. Not discovered from a live container.'}))]};
}
