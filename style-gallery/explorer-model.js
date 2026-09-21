export const KINDS = {
  tag: { label: 'Tags', singular: 'Tag', color: '#f5d85d', shape: 'cube', shapeLabel: 'Cube' },
  trigger: { label: 'Triggers', singular: 'Trigger', color: '#65b8f3', shape: 'diamond', shapeLabel: 'Diamond / octahedron' },
  variable: { label: 'Variables', singular: 'Variable', color: '#b596ed', shape: 'cylinder', shapeLabel: 'Cylinder' },
  builtin: { label: 'Built-in variables', singular: 'Built-in', color: '#5dd6c5', shape: 'sphere', shapeLabel: 'Sphere' },
  folder: { label: 'Folders', singular: 'Folder', color: '#edac6a', shape: 'folder', shapeLabel: 'Tabbed folder' },
  template: { label: 'Templates', singular: 'Template', color: '#8bd0a3', shape: 'triangular-prism', shapeLabel: 'Triangular prism' },
  client: { label: 'Clients', singular: 'Client', color: '#e994bf', shape: 'cone', shapeLabel: 'Cone' },
  transformation: { label: 'Transformations', singular: 'Transformation', color: '#9fd788', shape: 'hourglass', shapeLabel: 'Hourglass' },
  zone: { label: 'Zones', singular: 'Zone', color: '#97bcec', shape: 'ring', shapeLabel: 'Ring / torus' },
  version: { label: 'Versions', singular: 'Version', color: '#a8b5c6', shape: 'stack', shapeLabel: 'Stacked discs' },
  workspace: { label: 'Workspaces', singular: 'Workspace', color: '#c6b5df', shape: 'hexagonal-prism', shapeLabel: 'Hexagonal prism' },
  permission: { label: 'Permissions', singular: 'Permission', color: '#adbaa9', shape: 'shield', shapeLabel: 'Shield' },
  environment: { label: 'Environments', singular: 'Environment', color: '#d8ba86', shape: 'pyramid', shapeLabel: 'Pyramid' }
};
const GENERIC = { label: 'Other', singular: 'Element', color: '#98a8ba', shape: 'polyhedron', shapeLabel: 'Polyhedron' };
export const kindMeta = kind => Object.hasOwn(KINDS,kind) ? KINDS[kind] : GENERIC;
export const kindOrder = kind => { const i = Object.keys(KINDS).indexOf(kind); return i < 0 ? 99 : i; };
export const isDependency = edge => !['folder_member', 'version_next'].includes(edge.kind);
export const needsAttention = node => ['critical', 'high'].includes(node.risk) || (node.flags || []).some(flag => !['system-trigger', 'system-variable'].includes(flag));
export function makeGraph(audit) {
  const nodes = [], byId = new Map();
  for (const raw of audit.nodes || []) {
    // Drift ghosts are available in the classic Drift view, not current inventory.
    if (!raw?.id || raw.drift_state === 'removed' || byId.has(raw.id)) continue;
    const node = { ...raw, name: String(raw.name || raw.id), flags: Array.isArray(raw.flags) ? raw.flags : [] };
    nodes.push(node); byId.set(node.id, node);
  }
  const edges = (audit.edges || []).filter(e => byId.has(e.from) && byId.has(e.to));
  const adjacency = new Map(nodes.map(n => [n.id, new Set()]));
  const dependencies = new Map(nodes.map(n => [n.id, new Set()]));
  const byEdge = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    adjacency.get(e.from).add(e.to); adjacency.get(e.to).add(e.from);
    byEdge.get(e.from).push(e); if (e.from !== e.to) byEdge.get(e.to).push(e);
    if (isDependency(e)) { dependencies.get(e.from).add(e.to); dependencies.get(e.to).add(e.from); }
  }
  return { nodes, edges, byId, adjacency, dependencies, byEdge, meta: audit.meta || {}, selection: audit.selection || {} };
}
export function visibleNodes(graph, state) {
  const query = state.search.trim().toLowerCase();
  return graph.nodes.filter(n => {
    if (query && !`${n.name} ${n.id} ${n.type} ${n.kind}`.toLowerCase().includes(query)) return false;
    if (state.scope === 'attention' && !needsAttention(n)) return false;
    if (state.scope === 'isolated' && graph.dependencies.get(n.id).size) return false;
    if (state.scope === 'paused' && !n.paused) return false;
    if ((state.isolate || state.scope === 'connected') && state.selected && n.id !== state.selected && !graph.adjacency.get(state.selected)?.has(n.id)) return false;
    return true;
  });
}
// Signal direction is explanatory: variable → consumer; trigger → firing tag.
// Raw GTM reference direction is kept in the inspector and the input graph.
export function signalEdge(edge) {
  if (edge.kind === 'tag_trigger' || edge.kind === 'tag_trigger_blocking' || edge.kind === 'tag_setup' || edge.kind.endsWith('_variable')) return { ...edge, from: edge.to, to: edge.from };
  return edge;
}
export function relationLabel(edge, id) {
  const owner = edge.from === id;
  const labels = {
    tag_trigger: ['Fires on', 'Fires tag'], tag_trigger_blocking: ['Blocked by', 'Blocks tag'],
    tag_setup: ['Setup tag', 'Runs before'], tag_teardown: ['Teardown tag', 'Runs after'],
    folder_member: ['Contains', 'In folder'], version_next: ['Next version', 'Previous version'], transport: ['Sends to server', 'Receives from web'], client_event: ['Creates event for', 'Receives client event']
  };
  if (labels[edge.kind]) return labels[edge.kind][owner ? 0 : 1];
  if (edge.kind.endsWith('_variable')) return owner ? 'References variable' : 'Referenced by';
  return owner ? 'References' : 'Referenced by';
}
const groupNodes = nodes => {
  const groups = new Map();
  [...nodes].sort((a,b) => kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name)).forEach(n => {
    if (!groups.has(n.kind)) groups.set(n.kind, []);
    groups.get(n.kind).push(n);
  });
  return [...groups];
};
export const NETWORK_BASE_Y = 1;
export function surfaceOf(node, graph) {
  if (node.surface === 'server' || node.surface === 'web') return node.surface;
  const contexts = graph.meta?.usage_context || graph.selection?.usageContext || [];
  return contexts.includes('server') ? 'server' : 'web';
}
export function layoutGraph(graph, view, exploded = false, layoutState = {}) {
  const districtState = layoutState;
  const positions = new Map(), districts = [], groups = groupNodes(graph.nodes), gap = exploded ? 1.6 : 1;
  if (view === 'district') {
    const buildings = [];
    const floorKinds = [
      {id:'context', name:'Container context', kinds:['folder','version','workspace','permission','environment','zone']},
      {id:'clients', name:'Clients + ingestion', kinds:['client']},
      {id:'variables', name:'Variables + data', kinds:['variable','builtin']},
      {id:'triggers', name:'Triggers + conditions', kinds:['trigger']},
      {id:'tags', name:'Tags + destinations', kinds:['tag']},
      {id:'processing', name:'Processing + templates', kinds:['transformation','template']},
      {id:'other', name:'Other elements', kinds:[]}
    ];
    const assigned = new Set(floorKinds.flatMap(f=>f.kinds));
    const surfaces=['web','server'];
    const maxCount=Math.max(1,...surfaces.flatMap(surface=>floorKinds.map(f=>graph.nodes.filter(n=>surfaceOf(n,graph)===surface&&(f.id==='other'?!assigned.has(n.kind):f.kinds.includes(n.kind))).length)));
    const columns=Math.max(3,Math.ceil(Math.sqrt(maxCount)*1.25));
    const rows=Math.max(2,Math.ceil(maxCount/columns));
    const width=columns*5.8+9,depth=rows*5.8+10;
    surfaces.forEach((surface,index)=>{
      const ns=graph.nodes.filter(n=>surfaceOf(n,graph)===surface);
      const spread=exploded||districtState.expandedBuildings?.has(surface);
      const spacing=Math.max(1,Math.min(3,Number(districtState.spacing)||1));
      const pitch=spread?7.4+spacing:5.8;
      const floorWidth=columns*pitch+9,floorDepth=rows*pitch+10;
      const rise=spread?14+spacing*4:8.5;
      const x=(index?1:-1)*(width*.65+12),z=0;
      const floors=floorKinds.map(f=>({...f,nodes:ns.filter(n=>f.id==='other'?!assigned.has(n.kind):f.kinds.includes(n.kind))})).filter(f=>f.nodes.length);
      const building={surface,name:surface==='web'?'GTM / WEB':'SERVER-SIDE GTM',x,z,width,depth,count:ns.length,height:Math.max(5,floors.length*rise+3)};
      buildings.push(building);
      floors.forEach((floor,level)=>{
        const id=surface+':'+floor.id;
        const pulled=districtState.selectedFloor===id;
        const fx=x+(spread?(index?1:-1)*((floorWidth-width)/2+level*(3+spacing*2)):0)+(pulled?(index?1:-1)*(floorWidth*.45+8):0);
        const fz=z+(spread?level*(2+spacing):0)+(pulled?floorDepth*.8:0),y=2+level*rise;
        const d={id,surface,name:floor.name,kind:floor.nodes[0].kind,x:fx,y,z:fz,width:floorWidth,depth:floorDepth,count:floor.nodes.length,level,nodeIds:floor.nodes.map(n=>n.id)};
        districts.push(d);
        floor.nodes.sort((a,b)=>a.name.localeCompare(b.name)).forEach((n,j)=>positions.set(n.id,{x:fx+(j%columns-(columns-1)/2)*pitch,y:y+2.35,z:fz+(Math.floor(j/columns)-(rows-1)/2)*pitch,height:3.6}));
      });
    });
    return {positions,districts,buildings};
  } else if (view === 'observatory') {
    const maxCount=Math.max(1,...groups.map(([,ns])=>ns.length));
    const orbit=Math.max(5,Math.sqrt(maxCount)*2.5);
    const radius=Math.max(26,groups.length*(orbit+4)/Math.PI)*gap;
    const totals=groups.map(([,ns])=>ns.reduce((sum,n)=>sum+graph.dependencies.get(n.id).size,0));
    const maxTotal=Math.max(1,...totals),heightScale=32/maxTotal;
    groups.forEach(([kind,ns],i)=>{
      const angle=i/Math.max(1,groups.length)*Math.PI*2-Math.PI/2;
      const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
      const height=6+totals[i]*heightScale,capRadius=2.1*Math.sqrt(ns.length);
      districts.push({name:kindMeta(kind).label,kind,x,y:0,z,width:0,depth:0,count:ns.length,height,capRadius,orbit,angle,dependencyTotal:totals[i],platformRadius:radius+orbit+9});
      ns.forEach((n,j)=>{
        const a=j*2.39996323, r=3+(orbit-3)*Math.sqrt((j+.5)/ns.length);
        positions.set(n.id,{x:x+Math.cos(a)*r,y:2+(j+.5)/ns.length*Math.max(4,height-3),z:z+Math.sin(a)*r,height:1.5});
      });
    });
  } else if (view === 'container') {
    // One storey per entity type; floor order is organizational, not importance.
    const order = ['permission','environment','workspace','version','folder','builtin','variable','client','trigger','template','transformation','tag','zone'];
    const floors = [...groups].sort(([a],[b]) => (order.indexOf(a)<0?99:order.indexOf(a))-(order.indexOf(b)<0?99:order.indexOf(b)));
    const columns = Math.max(3, Math.ceil(Math.sqrt(Math.max(1,...groups.map(([,ns])=>ns.length))*1.5)));
    const rows = Math.max(2, ...groups.map(([,ns])=>Math.ceil(ns.length/columns)));
    const width = columns*5+10, depth = rows*5+8;
    floors.forEach(([kind,ns],i)=>{
      const y=i*12*gap;
      districts.push({name:kindMeta(kind).label,kind,x:0,y,z:0,width,depth,count:ns.length,level:i});
      ns.forEach((n,j)=>positions.set(n.id,{x:(j%columns-(columns-1)/2)*5,y:y+1.8,z:(Math.floor(j/columns)-(rows-1)/2)*5,height:3}));
    });
  } else if (view === 'network') {
    const radius = Math.max(22, Math.sqrt(graph.nodes.length) * 5.2) * gap;
    groups.forEach(([kind, ns], i) => {
      const angle = i / Math.max(1, groups.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      districts.push({ name: kindMeta(kind).label, kind, x, y: NETWORK_BASE_Y, z, width: 0, depth: 0, count: ns.length });
      ns.forEach((n,j) => {
        const a = j * 2.39996323, r = 3 + Math.sqrt(j) * 4.3;
        const scale = 1 + Math.min(1.5, graph.dependencies.get(n.id).size * .14);
        // Size still encodes dependency count. All bases share one plane;
        // neither alphabetical position nor connectivity lifts a node above it.
        positions.set(n.id, { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, y: NETWORK_BASE_Y + scale, height: 2 * scale });
      });
    });
  } else {
    const lanes = [
      { name: '01 / DATA SOURCES', kinds: ['variable', 'builtin'], kind: 'variable' },
      { name: '02 / CONDITIONS', kinds: ['trigger', 'client'], kind: 'trigger' },
      { name: '03 / TAGS & PROCESSING', kinds: ['tag', 'transformation', 'template'], kind: 'tag' },
      { name: '04 / CONTAINER CONTEXT', kinds: [], kind: 'folder' }
    ];
    const assigned = new Set(lanes.flatMap(l => l.kinds));
    const matchesLane = (node,lane) => lane.kinds.length ? lane.kinds.includes(node.kind) : !assigned.has(node.kind);
    const width = 16;
    if (view === 'flow' && layoutState.flowSeparated) {
      const surfaces = ['web','server'];
      const grouped = surfaces.map(surface => lanes.map(lane => graph.nodes.filter(n => surfaceOf(n,graph) === surface && matchesLane(n,lane)).sort((a,b)=>a.name.localeCompare(b.name))));
      const surfaceDepths = grouped.map(surfaceGroups => Math.max(18,...surfaceGroups.map(ns => Math.ceil(ns.length / 2) * 6 + 8)));
      const separation = (surfaceDepths[0] + surfaceDepths[1]) / 2 + 18;
      surfaces.forEach((surface,surfaceIndex) => {
        const centerZ = (surfaceIndex ? 1 : -1) * separation / 2;
        lanes.forEach((lane,i) => {
          const nodes = grouped[surfaceIndex][i], depth = surfaceDepths[surfaceIndex];
          const x = (i - 1.5) * 24 * gap;
          districts.push({name:`${surface === 'web' ? 'WEB GTM' : 'SERVER GTM'} · ${lane.name}`,kind:lane.kind,surface,x,y:0,z:centerZ,width,depth,count:nodes.length});
          nodes.forEach((n,j) => positions.set(n.id,{x:x+(j%2-.5)*6,y:3,z:centerZ+(Math.floor(j/2)-(Math.ceil(nodes.length/2)-1)/2)*6,height:4}));
        });
      });
    } else {
      const grouped = lanes.map(l => graph.nodes.filter(n => matchesLane(n,l)).sort((a,b)=>a.name.localeCompare(b.name)));
      const depth = Math.max(20, ...grouped.map(ns => Math.ceil(ns.length / 2) * 6 + 8));
      lanes.forEach((lane,i) => {
        const x = (i - 1.5) * 24 * gap;
        districts.push({ name: lane.name, kind: lane.kind, x, y: 0, z: 0, width, depth, count: grouped[i].length });
        grouped[i].forEach((n,j) => positions.set(n.id, { x: x + (j % 2 - .5) * 6, y: 3, z: (Math.floor(j / 2) - (Math.ceil(grouped[i].length / 2) - 1) / 2) * 6, height: 4 }));
      });
    }
  }
  return { positions, districts };
}
