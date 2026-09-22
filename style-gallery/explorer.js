import {RepairControls} from './explorer-repairs.js';
import {RepairWorker} from './explorer-repair-worker.js';
import {PATH_GROUPS,pathGroup,groupPaths} from './explorer-path-groups.js';
import { districtRoutes } from './explorer-district-routes.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeGraph, visibleNodes, layoutGraph, kindMeta, kindOrder, needsAttention, signalEdge, relationLabel, isDependency, surfaceOf } from './explorer-model.js';
import { entityGeometry, entityIcon, entitySymbols } from './explorer-geometry.js';
import { pathKey, isSignalPath } from './explorer-signals.js';
import { PathVisual } from './explorer-path-visual.js';
import { SignalControls } from './explorer-signal-controls.js';
import { buildDistrict } from './explorer-district.js';
import { buildObservatory } from './explorer-observatory.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const VIEWS = {
  district: { kicker: '01 / WEB + SERVER DISTRICT', description: 'Two surfaces. One connected measurement system.', caption: 'Dedicated route lanes · workers schematic · packets use selected signal data', title: 'Web GTM → Server GTM', explain: 'Two buildings separate the web and server surfaces. Floors organize entity types, not importance. Click a floor to pull it out and inspect its elements, or expand either building. Workers are schematic activity; packet motion uses the selected simulated or imported signal data. Missing containers stay empty.' },
  flow: { kicker: '03 / SIGNAL FLOW', description: 'From data sources to conditions to tags. Follow the configuration.', caption: 'Variable → consumer · Trigger → tag · dashed red = blocking', title: 'Follow the signal.', explain: 'An explanatory configuration map, not a runtime timeline. Variables point to consumers; firing and blocking triggers point to tags. Context relationships stay separate.' }
};

export function boot(audit) {
  document.body.insertAdjacentHTML('beforeend',entitySymbols());
  const graph = makeGraph(audit);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const initial = location.hash.slice(1);
  const initialView=Object.hasOwn(VIEWS,initial)?initial:'district';
  const state = { view: initialView, search: '', scope: 'all', selected: null, selectedPath:null, isolate: false, exploded: initialView==='district', surfacesSeparated: false, edges: true, labels: true, rotate: false, top: false };
  state.cluster='all';
  $('explode-toggle').setAttribute('aria-pressed',String(state.exploded));
  if (!Object.hasOwn(VIEWS, initial)) history.replaceState(null,'',location.pathname + location.search + '#district');
  const meta = audit.meta || {};
  const isPrivate = meta.source_mode === 'direct-api';
  let visible = graph.nodes, visibleIds = new Set(visible.map(n => n.id));
  let renderer, scene, camera, controls, world, connectionGroup, groundGroup, resizeObserver;
  let frameId, lastFrame = 0, needsFrame = true, cameraTween = null, layoutAnimating = false, disposed = false;
  let viewRadius = 55;
  let signalTime=0,lastSignalCheck=0;
  let fitPoints = [];
  const objects = new Map(), labelItems = [], linkItems = [];
  let clusterObjects=new Map();
  let districtVisual=null,districtLayout=null,districtTime=0;
  const districtState={expandedBuildings:new Set(),selectedFloor:null,spacing:1,routeScope:'all',healthFilter:'all',groupPinned:false,groupSelection:null,workers:!reduced.matches};
  const clusterRelevant=id=>state.view!=='observatory'||state.cluster==='all'||graph.byId.get(id)?.kind===state.cluster;
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  const temp = new THREE.Vector3();
  let hovered = null, pointerStart = null;
  const requestRender = () => { needsFrame = true; };
  const getNeighbors = () => graph.adjacency.get(state.selected) || new Set();
  const relevant = id => state.selectedPath ? [signals.edgeByKey.get(state.selectedPath)?.from,signals.edgeByKey.get(state.selectedPath)?.to].includes(id) : !state.selected || id === state.selected || getNeighbors().has(id);
  const degree = id => graph.dependencies.get(id)?.size || 0;
  const statistics = () => ({ dependencies: graph.edges.filter(isDependency).length, attention: graph.nodes.filter(needsAttention).length });
  const signals=new SignalControls({graph,meta,onChange:refreshSignals,onPick:selectPath,reduced:reduced.matches});

  const repairWorker=new RepairWorker();
  const repairs=new RepairControls({graph,audit,signals,onRender:()=>{renderInspector();$('inspector-content').scrollTop=0;},onStart:focusRepairPath,onChange:()=>{districtState.healthFilter='all';refreshSignals();if(state.selectedPath)focusRepairPath(signals.edgeByKey.get(state.selectedPath));}});
  function focusRepairPath(edge){
    state.selectedPath=pathKey(edge);state.selected=null;state.edges=true;$('edges-toggle').setAttribute('aria-pressed','true');
    districtState.healthFilter='all';districtState.routeScope='all';$('district-routes').value='all';
    updateVisible();
    const item=linkItems.find(item=>pathKey(item.edge)===pathKey(edge));
    if(!camera||!item?.pathVisual?.curve)return;
    const saved=fitPoints;
    const route=item.pathVisual.curve.getPoints(64);
    fitPoints=route.flatMap(p=>[p.clone().addScalar(4),p.clone().addScalar(-4)]);
    fitCamera();fitPoints=saved;
  }

  function districtStatusMap(){return new Map(linkItems.map(item=>[pathKey(item.directed),pathGroup(item.edge,signals.signal(item.edge))]));}
  function scopedDistrictEdges(){
    const surface=id=>surfaceOf(graph.byId.get(id),graph);
    return graph.edges.filter(e=>visibleIds.has(e.from)&&visibleIds.has(e.to)&&(districtState.routeScope!=='transport'||surface(e.from)!==surface(e.to)));
  }
  function renderPathGroups(){
    if(!['district','flow'].includes(state.view))return;
    const groups=groupPaths(scopedDistrictEdges(),e=>signals.signal(e));
    const focused=document.activeElement?.closest('#district-health button')?.dataset.health;
    const source=!signals.active?'UNMEASURED':signals.mode==='demo'?'SIMULATED':signals.stale?'STALE · HEALTH UNKNOWN':'IMPORTED SNAPSHOT';
    $('district-health-source').textContent=source+(!state.edges?' · PATHS HIDDEN':'');
    const total=Object.values(groups).reduce((sum,list)=>sum+list.length,0);
    $('district-health').innerHTML=`<button data-health="all" aria-pressed="${districtState.healthFilter==='all'}"><span>All routes</span><strong>${total}</strong></button>`+Object.entries(PATH_GROUPS).map(([id,g])=>`<button data-health="${id}" style="--health-color:${g.color}" aria-pressed="${districtState.healthFilter===id}" ${groups[id].length?'':'disabled'}><span>${g.label}</span><strong>${groups[id].length}</strong></button>`).join('');
    if(focused)$('district-health').querySelector(`[data-health="${focused}"]`)?.focus({preventScroll:true});
  }
  function refreshSignals(){
    if(scene&&state.view==='district'){
      rebuildLayout();
      if(districtState.selectedFloor)focusDistrictFloor();else fitCamera();
    }
    for(const item of linkItems)item.directed=signals.active||state.view==='flow'?signalEdge(item.edge):item.edge;
    updateLinkGeometry();updateVisible();renderInspector();requestRender();
  }
  function selectPath(key){
    if(!signals.edgeByKey.has(key))return;
    districtState.groupPinned=false;
    if(districtState.selectedFloor){districtState.selectedFloor=null;if(scene&&state.view==='district'){rebuildLayout();fitCamera();}}
    state.selectedPath=key;state.selected=null;state.isolate=false;
    if(state.scope==='connected'){state.scope='all';$('scope').value='all';}
    signals.syncSelection(key);updateVisible();renderInspector();
    $('inspector-content').scrollTop=0;$('inspector').classList.add('open');$('inventory').classList.remove('open');
  }

  $('container-title').textContent = meta.container_name || 'GTM Container';
  $('container-meta').textContent = [meta.public_id || meta.container_id, meta.workspace_id ? `Workspace ${meta.workspace_id}` : ''].filter(Boolean).join(' / ');
  $('source-badge').textContent = isPrivate ? 'PRIVATE SNAPSHOT' : 'DEMO / SYNTHETIC DATA';
  $('source-badge').dataset.private = String(isPrivate);
  $('status-source').textContent = isPrivate ? 'Private · read only' : 'Northstar demo';
  $('total-count').textContent = graph.nodes.length;

  function renderList() {
    const groups = new Map();
    visible.slice().sort((a,b) => kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name)).forEach(node => {
      if (!groups.has(node.kind)) groups.set(node.kind, []);
      groups.get(node.kind).push(node);
    });
    $('entity-list').innerHTML = [...groups].map(([kind, ns]) => `<section class="entity-group" style="--kind-color:${kindMeta(kind).color}"><h2 class="group-heading" title="${esc(kindMeta(kind).shapeLabel)}">${entityIcon(kind)}${esc(kindMeta(kind).label)}<span class="group-count">${ns.length}</span></h2>${ns.map(n => `<button class="entity-row" data-node="${esc(n.id)}" aria-pressed="${state.selected === n.id}" title="${esc(n.name)}"><span class="entity-name">${esc(n.name)}</span>${needsAttention(n) ? '<span class="flag-mark" aria-label="Flagged">!</span>' : n.paused ? '<span class="flag-mark" aria-label="Paused">Ⅱ</span>' : ''}</button>`).join('')}</section>`).join('');
    $('result-count').textContent = `${visible.length} of ${graph.nodes.length} elements`;
  }

  function syncGroupSelection(){
    const rows=$('inspector-content').querySelectorAll('[data-group-route]');
    let selected=false;
    for(const row of rows){const active=row.dataset.groupRoute===districtState.groupSelection;row.setAttribute('aria-pressed',String(active));if(active)selected=true;}
    const inspect=$('inspect-group-selection');if(inspect)inspect.disabled=!selected;
  }
  function selectGroupRoute(key){
    const edge=scopedDistrictEdges().find(e=>pathKey(e)===key);if(!edge)return;
    districtState.groupSelection=key;
    state.selectedPath=isSignalPath(edge)?key:null;state.selected=isSignalPath(edge)?null:edge.from;state.isolate=false;
    signals.syncSelection(state.selectedPath);updateVisible();syncGroupSelection();requestRender();
  }

  function renderInspector() {
    if(['district','flow'].includes(state.view)&&districtState.groupPinned&&districtState.healthFilter!=='all'){
      const id=districtState.healthFilter,g=PATH_GROUPS[id],edges=groupPaths(scopedDistrictEdges(),e=>signals.signal(e))[id];
      $('clear-selection').hidden=false;$('inspector-heading').textContent='PATH STATUS GROUP';
      const claim=id==='blocking'?'These are configured blocking rules, not tracking failures.':id==='context'?'Organizational relationships do not have a tracking-health status.':id==='unknown'?'No current health assessment is available for these paths. Missing or stale data is not classified as failure.':signals.mode==='demo'?'These health values are simulated for the demo.':'Health comes from the selected imported measurement snapshot.';
      const content=`<span class="detail-kind" style="--kind-color:${g.color}">ROUTE GROUP / ${signals.mode==='demo'?'SIMULATED':signals.active?'IMPORTED':'UNMEASURED'}</span><h2>${g.label} / ${edges.length}</h2><p class="lead">${claim}</p><p class="lead">Select a route to highlight it in the diagram. This list stays open.</p><button id="inspect-group-selection" class="group-inspect-button" disabled>Inspect selected route</button><div class="detail-section">${edges.map(e=>{const d=signalEdge(e);return `<button class="connection" data-group-route="${esc(pathKey(e))}" aria-pressed="false"><span><span class="relation">${esc(graph.byId.get(d.from).name)}</span>→ ${esc(graph.byId.get(d.to).name)}</span><span class="arrow">↗</span></button>`;}).join('')||'<p class="lead">No paths in this group for the current scope.</p>'}</div>`;
      const panel=$('inspector-content');
      if(panel.dataset.groupContent!==content||!panel.querySelector('#inspect-group-selection')){panel.innerHTML=content;panel.dataset.groupContent=content;}
      syncGroupSelection();return;
    }

    const selectedEdge=signals.edgeByKey.get(state.selectedPath);
    if(selectedEdge){
      $('clear-selection').hidden=false;$('inspector-heading').textContent='PATH INSPECTOR';
      $('inspector-content').innerHTML=repairs.markup(selectedEdge)+signals.inspector(selectedEdge);return;
    }
    if(state.view==='district'&&districtState.selectedFloor&&districtLayout){
      const floor=districtLayout.districts.find(d=>d.id===districtState.selectedFloor);
      if(floor){
        $('clear-selection').hidden=false;$('inspector-heading').textContent='FLOOR INSPECTOR';
        const floorSurface=floor.surface==='combined'?'COMBINED GTM':floor.surface==='web'?'WEB GTM':'SERVER-SIDE GTM';
        $('inspector-content').innerHTML=`<span class="overview-kicker">${floorSurface} / FLOOR ${floor.level+1}</span><h2>${esc(floor.name)}</h2><p class="lead">${floor.count} elements on this floor. Select an element to inspect its configuration and connections.</p><div class="detail-section">${floor.nodeIds.map(id=>{const node=graph.byId.get(id);return `<button class="connection" data-node="${esc(id)}">${entityIcon(node.kind)}<span>${esc(node.name)}</span><span class="arrow">↗</span></button>`;}).join('')}</div><p class="lead">Workers illustrate activity, not measured execution. ${isPrivate?'This surface comes from the supplied snapshot.':'This is a synthetic two-container example.'}</p>`;return;
      }
    }
    const n = graph.byId.get(state.selected);
    $('clear-selection').hidden = !n;
    $('inspector-heading').textContent = n ? 'ELEMENT INSPECTOR' : 'CONTAINER OVERVIEW';
    if (!n) {
      const stats = statistics();
      const kinds = [...new Set(graph.nodes.map(n => n.kind))].sort((a,b) => kindOrder(a) - kindOrder(b));
      const date = meta.run_at && !Number.isNaN(Date.parse(meta.run_at)) ? new Date(meta.run_at).toLocaleString() : 'Not supplied';
      const districtTitle=state.surfacesSeparated?'Web GTM → Server GTM':'One GTM container';
      const districtExplain=state.surfacesSeparated?'Web and server surfaces have separate container buildings. Floors organize entity types, not importance. Click a floor to pull it out and inspect its elements, or expand either building.':'Web and server elements share one container building. Floors organize entity types across both surfaces. Use Split Web / Server to inspect each container independently.';
      const title=state.view==='district'?districtTitle:VIEWS[state.view].title,explain=state.view==='district'?districtExplain:VIEWS[state.view].explain;
      $('inspector-content').innerHTML = `<span class="overview-kicker">ONE SNAPSHOT. TWO PERSPECTIVES.</span><h2>${title}</h2><p class="lead">A spatial index of your tags, triggers, variables, and the relationships that connect them.</p><div class="summary-grid"><div class="summary-stat"><strong>${graph.nodes.length}</strong><span>Elements</span></div><div class="summary-stat"><strong>${graph.edges.length}</strong><span>Relationships</span></div><div class="summary-stat"><strong>${stats.dependencies}</strong><span>Dependency links</span></div><div class="summary-stat"><strong>${stats.attention}</strong><span>Flagged / high risk</span></div></div><div class="detail-section"><h3>ENTITY KEY</h3>${kinds.map(kind => `<div class="legend-row" style="--kind-color:${kindMeta(kind).color}"><i class="swatch"></i>${esc(kindMeta(kind).label)}<span class="legend-value">${graph.nodes.filter(n=>n.kind===kind).length}</span></div>`).join('')}</div><div class="view-explainer"><strong>${esc(VIEWS[state.view].kicker.slice(5))}</strong>${esc(explain)}</div><div class="detail-section"><h3>SNAPSHOT PROVENANCE</h3><p class="lead">${isPrivate ? 'Captured from your connected GTM workspace. Session-protected; not a live event stream.' : 'Northstar synthetic fixture, not your connected container.'}<br><br>${esc(date)}${meta.overall_pct === null ? '<br>Audit score: unassessed.' : ''}</p></div>`;
      const rows=$('inspector-content').querySelectorAll('.legend-row');
      rows.forEach((row,index)=>{
        const kind=kinds[index],km=kindMeta(kind);
        row.innerHTML=`${entityIcon(kind)}<span class="legend-copy"><span>${esc(km.label)}</span><span class="legend-shape">${esc(km.shapeLabel)}</span></span><span class="legend-value">${graph.nodes.filter(n=>n.kind===kind).length}</span>`;
      });
      return;
    }
    const km = kindMeta(n.kind);
    const edges = graph.byEdge.get(n.id) || [];
    const dependencyEdges = edges.filter(isDependency), contextEdges = edges.filter(e => !isDependency(e));
    const edgeButtons = list => list.map(e => {
      const other = graph.byId.get(e.from === n.id ? e.to : e.from);
      return `<button class="connection" data-node="${esc(other.id)}" style="--kind-color:${kindMeta(other.kind).color}">${entityIcon(other.kind)}<span><span class="relation">${esc(relationLabel(e,n.id))}${e.kind === 'tag_trigger_blocking' ? ' / BLOCKING' : ''}</span>${esc(other.name)}</span><span class="arrow" aria-hidden="true">↗</span></button>`;
    }).join('');
    const recs = (audit.recommendations || []).filter(r => (r.entity_ids || []).includes(n.id));
    const risk = n.risk || 'unassessed';
    $('inspector-content').innerHTML = `<span class="detail-kind" style="--kind-color:${km.color}"><i class="swatch"></i>${esc(km.singular)}</span><h2>${esc(n.name)}</h2><div class="detail-id">${esc(n.id)}</div><div class="badges"><span class="badge ${['high','critical'].includes(risk)?'warning':''}">${esc(risk)}${risk === 'unassessed' ? '' : ' risk'}</span>${n.paused ? '<span class="badge warning">Paused</span>' : ''}${n.drift_state ? `<span class="badge">${esc(n.drift_state)}</span>` : ''}${n.flags.map(f => `<span class="badge warning">${esc(f)}</span>`).join('')}</div><dl class="detail-meta"><dt>Type</dt><dd>${esc(n.type || n.kind)}</dd><dt>Dependencies</dt><dd>${degree(n.id)}</dd><dt>All neighbors</dt><dd>${graph.adjacency.get(n.id).size}</dd><dt>Source</dt><dd>${isPrivate ? 'Private snapshot' : 'Demo fixture'}</dd></dl><div class="detail-actions"><button id="focus-node">Focus element</button><button id="inspect-isolate">${state.isolate?'Show all':'Isolate neighbors'}</button></div><div class="detail-section"><h3>DEPENDENCIES / ${dependencyEdges.length}</h3>${edgeButtons(dependencyEdges) || '<p class="lead">No dependencies detected in this snapshot. Indirect or custom-code references may not be discoverable.</p>'}</div>${contextEdges.length ? `<div class="detail-section"><h3>CONTAINER CONTEXT / ${contextEdges.length}</h3>${edgeButtons(contextEdges)}</div>` : ''}${recs.length ? `<div class="detail-section"><h3>AUDIT NOTES</h3>${recs.map(r=>`<div class="recommendation"><strong>${esc(r.title)}</strong>${esc(r.action || r.why || '')}</div>`).join('')}</div>` : ''}<details><summary>Raw configuration</summary><pre>${esc(JSON.stringify(n.details || {},null,2))}</pre></details>`;
    if(dependencyEdges.some(isSignalPath))$('inspector-content').insertAdjacentHTML('beforeend',`<div class="detail-section"><h3>AUDIT CONNECTED PATHS</h3>${dependencyEdges.filter(isSignalPath).map(e=>`<button class="connection" data-path="${esc(pathKey(e))}">${esc(graph.byId.get(signalEdge(e).from).name)} → ${esc(graph.byId.get(signalEdge(e).to).name)} · ${esc(signals.signal(e).health)}</button>`).join('')}</div>`);
    $('inspector-content').querySelector('.detail-kind').innerHTML=`${entityIcon(n.kind)}${esc(km.singular)}`;
    $('inspector-content').querySelector('.detail-meta').insertAdjacentHTML('afterbegin',`<dt>Geometry</dt><dd>${esc(km.shapeLabel)}</dd>`);
  }

  function updateVisible() {
    visible = visibleNodes(graph, state); visibleIds = new Set(visible.map(n=>n.id));
    for (const [id,o] of objects) {
      o.group.visible = visibleIds.has(id);
      const selected = state.selected === id, connected = relevant(id)&&clusterRelevant(id), node = graph.byId.get(id);
      const base = new THREE.Color(kindMeta(node.kind).color);
      o.material.color.copy(base).multiplyScalar(selected ? .95 : connected ? .56 : .12);
      o.material.emissive.copy(base).multiplyScalar(selected ? .5 : connected ? .11 : .015);
      o.outline.material.color.copy(base).multiplyScalar(connected ? .78 : .16);
      o.ring.visible = selected;
    }
    for(const [kind,group] of clusterObjects){
      const faded=state.cluster!=='all'&&state.cluster!==kind;
      group.traverse(o=>{if(o.material){o.material.transparent=true;o.material.opacity=o.userData.baseOpacity*(faded?.09:1);}});
    }
    updateLinks();
    $('empty-state').hidden = visible.length > 0;
    $('status-counts').textContent = `${visible.length} elements / ${graph.edges.filter(e=>visibleIds.has(e.from)&&visibleIds.has(e.to)).length} links`;
    $('status-selection').textContent = state.selected ? graph.byId.get(state.selected).name : 'Select any element to inspect';
    if(state.selectedPath){const e=signalEdge(signals.edgeByKey.get(state.selectedPath));$('status-selection').textContent=`${graph.byId.get(e.from).name} → ${graph.byId.get(e.to).name}`;}
    signals.visible(visibleIds);
    $('isolate-toggle').disabled = !state.selected;
    $('isolate-toggle').setAttribute('aria-pressed',String(state.isolate));
    renderList(); requestRender();
  }
  function select(id, focus = false) {
    districtState.groupPinned=false;
    if (id && !graph.byId.has(id)) return;
    state.selectedPath=null;signals.syncSelection(null);
    if(districtState.selectedFloor){districtState.selectedFloor=null;if(scene&&state.view==='district'){rebuildLayout();if(id)focusNode(id);else fitCamera();}}
    if(!id&&districtState.healthFilter!=='all'){districtState.healthFilter='all';}
    state.selected = id;
    if (!id) { state.isolate = false; if (state.scope === 'connected') { state.scope = 'all'; $('scope').value='all'; } }
    updateVisible(); renderInspector();
    $('inspector-content').scrollTop=0;
    $('inspector').classList.toggle('open', !!id);
    $('inventory').classList.remove('open');
    if (focus && id) focusNode(id);
  }
  function resetFilters() {
    state.search = ''; state.scope = 'all'; state.isolate = false;
    $('search').value = ''; $('scope').value = 'all'; updateVisible(); renderInspector();
  }
  function toggleIsolate() { if (!state.selected) return; state.isolate = !state.isolate; updateVisible(); renderInspector(); }
  function setView(view, writeHash = true) {
    if (!Object.hasOwn(VIEWS, view)) { view = 'district'; writeHash = true; }
    state.view=view; state.top=false;
    $('cluster-focus').hidden=view!=='observatory';
    $('atlas').dataset.view=view;
    $('district-controls').hidden=!['district','flow'].includes(view);
    if(camera){
      const previous=camera;
      camera=['container','district'].includes(view)?new THREE.OrthographicCamera(-50,50,50,-50,.1,10000):new THREE.PerspectiveCamera(42,1,.1,10000);
      camera.position.copy(previous.position);camera.quaternion.copy(previous.quaternion);
      controls.object=camera;cameraTween=null;resize();
    }
    if (writeHash) history.replaceState(null,'',location.pathname + location.search + '#' + view);
    document.querySelectorAll('button[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
    const activeTab=document.querySelector(`button[data-view="${view}"]`);
    if(activeTab){const nav=activeTab.parentElement;nav.scrollLeft+=activeTab.getBoundingClientRect().right-nav.getBoundingClientRect().right+6;}
    $('view-kicker').textContent=VIEWS[view].kicker;
    $('view-description').textContent=VIEWS[view].description;
    $('layout-caption').textContent=VIEWS[view].caption;
    $('top-view').setAttribute('aria-pressed','false');
    if (scene) { rebuildLayout(); fitCamera(); }
    renderInspector(); requestRender();
  }
  function clearGroup(group) {
    group.traverse(obj => { obj.geometry?.dispose(); if(obj.material) (Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>{m.map?.dispose();m.dispose();}); });
    group.clear();
  }
  function makeLabel(text, kind, nodeId = null) {
    const el=document.createElement(nodeId?'button':'div');
    el.className='world-label'+(nodeId?' node-label':'');
    if(nodeId){el.type='button';el.addEventListener('click',()=>select(nodeId,true));}
    el.textContent=text; el.style.setProperty('--kind-color',kindMeta(kind).color);
    $('labels').append(el);
    const item={ el, nodeId, position:new THREE.Vector3(), width:0 };
    labelItems.push(item); return item;
  }
  function rebuildLayout() {
    const layout=layoutGraph(graph,state.view,state.exploded,{...districtState,surfacesSeparated:state.surfacesSeparated});
    const {positions,districts}=layout;
    districtLayout=state.view==='district'?layout:null;
    const priorFloors=new Map([...(districtVisual?.floors||[])].map(([id,g])=>[id,g.position.clone()]));
    districtVisual=null;
    clearGroup(groundGroup); clearGroup(connectionGroup); linkItems.length=0;clusterObjects.clear();
    $('labels').replaceChildren(); labelItems.length=0;
    const points=[...positions.values()];
    fitPoints=[];
    for(const p of points)for(const dx of [-2,2])for(const dz of [-2,2])for(const dy of [-p.height/2,p.height/2+3])fitPoints.push(new THREE.Vector3(p.x+dx,p.y+dy,p.z+dz));
    for(const d of districts)for(const dx of [-1,1])for(const dz of [-1,1])fitPoints.push(new THREE.Vector3(d.x+dx*(d.width/2+2),d.y,d.z+dz*(d.depth/2+2)));
    const maxXZ=Math.max(20,...points.map(p=>Math.max(Math.abs(p.x),Math.abs(p.z))));
    viewRadius=maxXZ*1.32;
    const gridSize=Math.ceil(viewRadius*3/10)*10;
    const grid=new THREE.GridHelper(gridSize, Math.min(80,gridSize/5), 0x253443, 0x1a2531);
    grid.position.y=-.18; grid.material.transparent=true; grid.material.opacity=.38;
    if(state.view==='observatory'){grid.geometry.dispose();grid.material.dispose();clusterObjects=buildObservatory(groundGroup,districts,fitPoints);}else groundGroup.add(grid);
    if(state.view==='district'){
      districtVisual=buildDistrict(groundGroup,layout,fitPoints,districtState.selectedFloor,reduced.matches?new Map():priorFloors);
      if(!state.exploded)for(const b of layout.buildings){const label=makeLabel(`${b.name} · ${b.count?b.count+' ELEMENTS':'NOT CONNECTED'}`,b.surface==='web'?'trigger':b.surface==='server'?'template':'tag');label.el.classList.add('building-label');label.el.style.setProperty('--kind-color',b.surface==='web'?'#00d5e8':b.surface==='server'?'#9cff00':'#f5d85d');label.position.set(b.x,1,b.depth/2+6);fitPoints.push(label.position.clone());}
      for(const d of districts){
        const prefix=d.surface==='combined'?'C':d.surface==='web'?'W':'S',label=makeLabel(`${prefix}${String(d.level+1).padStart(2,'0')} / ${d.name}`,d.kind);
        label.floorId=d.id;label.el.classList.add('floor-label',`surface-${d.surface}`);label.position.set(d.x,d.y+1.1,d.z+d.depth/2+2.5);
      }
      $('district-floor').innerHTML='<option value="">Inspect a floor…</option>'+districts.map(d=>`<option value="${esc(d.id)}">${d.surface==='combined'?'Combined':d.surface==='web'?'Web':'Server'} / ${esc(d.name)} (${d.count})</option>`).join('');
      $('district-floor').value=districtState.selectedFloor||'';
      for(const surface of ['web','server']){const b=layout.buildings.find(b=>b.surface===surface),button=$('district-'+surface);button.disabled=!state.surfacesSeparated||!b?.count;button.title=state.surfacesSeparated?'Expand this container independently':'Split Web / Server to expand containers independently';button.setAttribute('aria-pressed',String(state.surfacesSeparated&&(state.exploded||districtState.expandedBuildings.has(surface))));}
    }
    for(const d of state.view==='district'?[]:districts) {
      if(d.width) {
        const geometry=new THREE.BoxGeometry(d.width,.55,d.depth);
        const mat=new THREE.MeshStandardMaterial({color:state.view==='container'?kindMeta(d.kind).color:0x17212c,metalness:.35,roughness:.8,transparent:state.view==='container',opacity:state.view==='container'?.16:1,depthWrite:state.view!=='container'});
        const plate=new THREE.Mesh(geometry,mat); plate.position.set(d.x,d.y,d.z);groundGroup.add(plate);
        const rim=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:kindMeta(d.kind).color,transparent:true,opacity:.23}));
        rim.position.copy(plate.position);groundGroup.add(rim);
        // A colored front edge marks the district without coloring the floor.
        const rail=new THREE.Mesh(new THREE.BoxGeometry(d.width,.08,.12),new THREE.MeshBasicMaterial({color:kindMeta(d.kind).color}));
        rail.position.set(d.x,d.y+.32,d.z+d.depth/2);groundGroup.add(rail);
      } else if(state.view!=='observatory') {
        const ring=new THREE.Mesh(new THREE.RingGeometry(7,7.08,64),new THREE.MeshBasicMaterial({color:kindMeta(d.kind).color,transparent:true,opacity:.18,side:THREE.DoubleSide}));
        ring.rotation.x=-Math.PI/2;ring.position.set(d.x,d.y,d.z);groundGroup.add(ring);
      }
      const label=makeLabel(`${state.view==='container'?String(d.level).padStart(2,'0')+' / ':''}${d.name}  /  ${d.count}`,d.kind);
      label.position.set(d.x,d.y+.6,d.z+(d.depth?d.depth/2+1.5:10));
      if(state.view==='observatory'){
        label.position.set(d.x, d.height+2.5, d.z);
        label.el.textContent=`${d.name} / ${d.count} · ${d.dependencyTotal} DEP`;
        label.kind=d.kind;
      }
      if(state.view==='container'){
        label.position.set(d.width/2+30,d.y+.6,0);
        label.el.style.color=kindMeta(d.kind).color;
        fitPoints.push(label.position.clone().add(new THREE.Vector3(12,0,0)));
      }
    }
    if(state.view==='container'&&districts.length){
      const floor=districts[0],height=districts.at(-1).y+7;
      const frameGeometry=new THREE.BoxGeometry(floor.width,height,floor.depth);
      const frame=new THREE.LineSegments(new THREE.EdgesGeometry(frameGeometry),new THREE.LineDashedMaterial({color:0x8ea9c2,transparent:true,opacity:.35,dashSize:.7,gapSize:.5}));
      frameGeometry.dispose();frame.position.y=height/2;frame.computeLineDistances();groundGroup.add(frame);
      for(const x of [-floor.width/2,floor.width/2])for(const z of [-floor.depth/2,floor.depth/2])fitPoints.push(new THREE.Vector3(x,height,z));
    }
    for(const n of graph.nodes) {
      const p=positions.get(n.id),o=objects.get(n.id);
      o.target.set(p.x,p.y,p.z);
      o.targetScale.set(state.view==='district'?1.65:state.view==='network'?p.height/2:1,p.height/2,state.view==='district'?1.65:state.view==='network'?p.height/2:1);
      if(!o.initialized || reduced.matches) { o.group.position.copy(o.target);o.shape.scale.copy(o.targetScale);o.initialized=true; }
      o.label=makeLabel(n.name,n.kind,n.id);
    }
    for(const edge of graph.edges) {
      const directed=state.view==='flow'||signals.active?signalEdge(edge):edge;
      const blocked=edge.kind==='tag_trigger_blocking';
      const context=!isDependency(edge);
      const material=blocked ? new THREE.LineDashedMaterial({color:0xef858b,dashSize:.65,gapSize:.4,transparent:true,opacity:.6}) : new THREE.LineBasicMaterial({color:context?0x718096:kindMeta(graph.byId.get(directed.from).kind).color,transparent:true,opacity:.35});
      const line=new THREE.Line(new THREE.BufferGeometry(),material);connectionGroup.add(line);
      const arrow=new THREE.Mesh(new THREE.ConeGeometry(.22,.75,5),new THREE.MeshBasicMaterial({color:blocked?0xef858b:kindMeta(graph.byId.get(directed.from).kind).color,transparent:true,opacity:.65}));
      const pathVisual=isSignalPath(edge)?new PathVisual(pathKey(edge)):null;
      if(pathVisual)connectionGroup.add(pathVisual.root);
      connectionGroup.add(arrow);linkItems.push({edge,directed,line,arrow,context,pathVisual});
    }
    if(state.view==='district'){
      for(const route of districtRoutes(linkItems.map(item=>item.directed),positions,districts,districtStatusMap()).values())for(const p of route)fitPoints.push(new THREE.Vector3(p.x,p.y,p.z));
    }
    layoutAnimating=!reduced.matches;
    updateLinkGeometry(); updateVisible();
  }
  function updateLinkGeometry() {
    const shaftExtent=state.view==='container'?Math.max(12,...[...objects.values()].map(o=>Math.abs(o.target.x)))+5:0;
    let pathIndex=0,routedDistrict=new Map();
    if(state.view==='district'&&districtLayout){
      const currentPositions=new Map([...objects].map(([id,o])=>[id,{x:o.group.position.x,y:o.group.position.y,z:o.group.position.z,height:o.shape.scale.y*2}]));
      const currentFloors=districtLayout.districts.map(d=>{const p=districtVisual?.floors.get(d.id)?.position;return p?{...d,x:p.x,y:p.y,z:p.z}:d;});
      routedDistrict=districtRoutes(linkItems.map(item=>item.directed),currentPositions,currentFloors,districtStatusMap());
    }
    for(const item of linkItems) {
      const a=objects.get(item.directed.from),b=objects.get(item.directed.to);
      const start=a.group.position.clone(),end=b.group.position.clone();
      start.y+=a.shape.scale.y;end.y+=b.shape.scale.y;
      const distance=start.distanceTo(end);
      const mid=start.clone().lerp(end,.5);mid.y+=Math.min(18,distance*.2)+(state.view==='network'?2:0);
      // A self-reference uses an offset loop, not a zero-length path.
      if(item.directed.from===item.directed.to) { mid.x+=4;mid.y+=5;end.x+=.1; }
      let curve=new THREE.QuadraticBezierCurve3(start,mid,end);
      if(state.view==='district'){
        const routed=routedDistrict.get(pathKey(item.directed));
        if(routed){
          const vertices=routed.map(p=>new THREE.Vector3(p.x,p.y,p.z));curve=new THREE.CurvePath();let cursor=vertices[0];
          for(let i=1;i<vertices.length-1;i++){
            const before=vertices[i-1],corner=vertices[i],after=vertices[i+1],radius=Math.min(.65,before.distanceTo(corner)*.25,after.distanceTo(corner)*.25);
            const entry=corner.clone().lerp(before,radius/corner.distanceTo(before)),exit=corner.clone().lerp(after,radius/corner.distanceTo(after));
            if(cursor.distanceTo(entry)>.001)curve.add(new THREE.LineCurve3(cursor,entry));
            curve.add(new THREE.QuadraticBezierCurve3(entry,corner,exit));cursor=exit;
          }
          if(cursor.distanceTo(vertices.at(-1))>.001)curve.add(new THREE.LineCurve3(cursor,vertices.at(-1)));
        }
      }
      if(state.view==='container'&&item.directed.from!==item.directed.to){
        const index=pathIndex++,shaftX=(index%2?1:-1)*(shaftExtent+(index%5)*.65);
        const shaftZ=(index%7-3)*1.1;
        curve=new THREE.CurvePath();
        const route=[start,new THREE.Vector3(shaftX,start.y,shaftZ),new THREE.Vector3(shaftX,end.y,shaftZ),end];
        for(let i=1;i<route.length;i++)if(route[i-1].distanceTo(route[i])>.001)curve.add(new THREE.LineCurve3(route[i-1],route[i]));
      }
      item.pathVisual?.setCurve(curve);
      item.line.geometry.dispose();item.line.geometry=new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(24,(curve.curves?.length||0)*6)));
      if(item.line.material.isLineDashedMaterial)item.line.computeLineDistances();
      item.arrow.position.copy(curve.getPoint(.76));
      item.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),curve.getTangent(.76).normalize());
    }
  }
  function updateLinks() {
    for(const item of linkItems) {
      const floorIds=state.view==='district'&&districtState.selectedFloor?new Set(districtLayout?.districts.find(d=>d.id===districtState.selectedFloor)?.nodeIds||[]):null;
      const e=item.edge, active=['district','flow'].includes(state.view)&&districtState.groupPinned&&districtState.groupSelection?pathKey(e)===districtState.groupSelection:floorIds?(floorIds.has(item.edge.from)||floorIds.has(item.edge.to)):state.selectedPath?pathKey(e)===state.selectedPath:state.selected&&(e.from===state.selected||e.to===state.selected);
      const clusterFocused=state.view==='observatory'&&state.cluster!=='all';
      const clusterActive=clusterRelevant(e.from)||clusterRelevant(e.to);
      const selected=!!(state.selected||state.selectedPath||floorIds);
      const transportOnly=state.view==='district'&&districtState.routeScope==='transport';
      const surface=id=>surfaceOf(graph.byId.get(id),graph);
      const statusShown=!['district','flow'].includes(state.view)||districtState.healthFilter==='all'||pathGroup(e,signals.signal(e))===districtState.healthFilter;
      const shown=state.edges&&statusShown&&visibleIds.has(e.from)&&visibleIds.has(e.to)&&(!transportOnly||surface(e.from)!==surface(e.to));
      const signalShown=signals.active&&!!item.pathVisual;
      item.line.visible=shown&&!signalShown;item.arrow.visible=shown&&!item.context&&(!!active||state.view==='flow'||signalShown);
      item.line.material.opacity=selected?(active?.9:.035):(item.context?.18:.4);
      const baseColor=['district','flow'].includes(state.view)?PATH_GROUPS[pathGroup(e,signals.signal(e))].color:e.kind==='tag_trigger_blocking'?'#ef858b':'#7e8b9d';
      item.line.material.color.set(baseColor);
      item.arrow.material.color.set(baseColor);
      item.arrow.material.opacity=selected?(active?.95:.08):.6;
      if(clusterFocused&&!clusterActive){item.line.material.opacity*=.08;item.arrow.material.opacity*=.08;}
      if(item.pathVisual){const descriptor=signals.signal(e);item.pathVisual.setSignal(descriptor,{visible:shown&&signalShown,opacity:(selected?(active?1:.09):1)*(clusterFocused&&!clusterActive?.08:1)});item.arrow.material.color.set(descriptor.color);}
    }
    renderPathGroups();
  }
  function cameraTo(position,target,duration=.65) {
    if(reduced.matches){camera.position.copy(position);controls.target.copy(target);controls.update();return;}
    cameraTween={from:camera.position.clone(),to:position,fromTarget:controls.target.clone(),toTarget:target,start:performance.now(),duration:duration*1000};requestRender();
  }
  function fitCamera() {
    if(!camera)return;
    const width=$('stage').clientWidth,height=Math.max(1,$('stage').clientHeight);
    const aspect=width/height,top=['district','flow'].includes(state.view)?Math.min(height*.5,$('district-controls').offsetTop+$('district-controls').offsetHeight+16):state.view==='observatory'&&$('atlas').classList.contains('canvas-only')&&width>960?40:Math.min(170,height*.3),bottom=$('stage').querySelector('.scene-bottom').offsetHeight+10;
    const usableY=Math.max(.25,(height-top-bottom)/height);
    const bounds=new THREE.Box3().setFromPoints(fitPoints.length?fitPoints:[new THREE.Vector3(-10,0,-10),new THREE.Vector3(10,10,10)]);
    const target=bounds.getCenter(new THREE.Vector3());
    const direction=(state.top?new THREE.Vector3(0,1,.0001):state.view==='district'?new THREE.Vector3(.45,.75,1.35):state.view==='container'?new THREE.Vector3(1,.8,1):state.view==='flow'?new THREE.Vector3(.18,1.28,1.8):new THREE.Vector3(1.12,1.16,1.35)).normalize();
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
    const up=new THREE.Vector3().crossVectors(direction,right).normalize();
    if(camera.isOrthographicCamera){
      let halfHeight=10;
      for(const point of fitPoints){const q=point.clone().sub(target);halfHeight=Math.max(halfHeight,Math.abs(q.dot(right))/(aspect*.82),Math.abs(q.dot(up))/usableY);}
      camera.userData.halfHeight=halfHeight*1.08;camera.zoom=1;resize();
      cameraTo(target.clone().addScaledVector(direction,Math.max(200,bounds.getSize(new THREE.Vector3()).length()*2)),target);return;
    }
    const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    let distance=20;
    for(const point of fitPoints){const q=point.clone().sub(target),z=q.dot(direction);distance=Math.max(distance,z+Math.abs(q.dot(right))/(tangent*aspect*.9),z+Math.abs(q.dot(up))/(tangent*usableY));}
    distance*=1.07;
    cameraTo(target.clone().addScaledVector(direction,distance),target);
    controls.maxDistance=Math.max(500,distance*6);
  }
  function focusNode(id) {
    const o=objects.get(id);if(!o||!camera)return;
    const target=o.target.clone();
    if(camera.isOrthographicCamera){camera.zoom=Math.max(1,(camera.userData.halfHeight||50)/12);camera.updateProjectionMatrix();}
    const direction=camera.position.clone().sub(controls.target).normalize();
    cameraTo(target.clone().addScaledVector(direction,Math.max(20,o.shape.scale.y*5)),target);
  }
  function resize() {
    if(!renderer)return;
    const {width,height}=$('stage').getBoundingClientRect();
    camera.aspect=width/Math.max(1,height);
    if(camera.isOrthographicCamera){const h=camera.userData.halfHeight||50;camera.left=-h*camera.aspect;camera.right=h*camera.aspect;camera.top=h;camera.bottom=-h;}
    const top=['district','flow'].includes(state.view)?Math.min(height*.5,$('district-controls').offsetTop+$('district-controls').offsetHeight+16):state.view==='observatory'&&$('atlas').classList.contains('canvas-only')&&width>960?40:Math.min(170,height*.3),bottom=$('stage').querySelector('.scene-bottom').offsetHeight+10;
    camera.setViewOffset(width,height,0,-(top-bottom)/2,width,height);
    camera.updateProjectionMatrix();renderer.setSize(width,height,false);requestRender();
  }
  function updateLabels() {
    const width=$('stage').clientWidth,height=$('stage').clientHeight,occupied=[];
    const sorted=[...labelItems].sort((a,b)=>{
      const rank=x=>x.nodeId===state.selected?0:x.nodeId===hovered?1:!x.nodeId?2:3;
      return rank(a)-rank(b) || (degree(b.nodeId)||0)-(degree(a.nodeId)||0);
    });
    let labelsShown=0;
    for(const item of sorted) {
      const {el,nodeId}=item;
      const selected=nodeId===state.selected,hover=nodeId===hovered;
      let show=state.labels||selected||hover;
      if(item.kind&&state.view==='observatory'&&state.cluster!=='all'&&state.cluster!==item.kind)show=false;
      if(nodeId){const o=objects.get(nodeId);show=show&&o.group.visible&&((relevant(nodeId)&&clusterRelevant(nodeId))||hover||selected);item.position.copy(o.group.position);item.position.y+=o.shape.scale.y+2.4;}
      if(state.view==='district'&&nodeId&&!selected&&!hover&&!districtLayout?.districts.find(d=>d.id===districtState.selectedFloor)?.nodeIds.includes(nodeId))show=false;
      if(nodeId&&!selected&&!hover&&labelsShown>Math.max(8,Math.floor(width*height/25000)))show=false;
      temp.copy(item.position).project(camera);
      const x=(temp.x*.5+.5)*width,y=(-temp.y*.5+.5)*height;
      const w=nodeId?Math.min(170,item.el.textContent.length*5.8+20):item.el.textContent.length*5+16,h=24;
      const minY=['district','flow'].includes(state.view)?$('district-controls').offsetTop+$('district-controls').offsetHeight+8:state.view==='observatory'&&$('atlas').classList.contains('canvas-only')&&width>960&&x>400?65:170;
      if(temp.z>1||temp.z< -1||x<w/2+8||x>width-w/2-8||y<minY||y>height-115)show=false;
      const box={l:x-w/2,r:x+w/2,t:y-h/2,b:y+h/2};
      if(show&&!item.floorId&&occupied.some(b=>box.l<b.r+5&&box.r>b.l-5&&box.t<b.b+5&&box.b>b.t-5))show=false;
      el.hidden=!show;
      if(show){occupied.push(box);if(nodeId)labelsShown++;el.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;el.classList.toggle('selected-label',selected);}
    }
  }
  function loop(now) {
    if(disposed)return;
    frameId=requestAnimationFrame(loop);
    if(document.hidden)return;
    const delta=Math.min(.05,(now-lastFrame)/1000||.016);lastFrame=now;
    if(now-lastSignalCheck>30000){lastSignalCheck=now;if(signals.refreshFreshness())refreshSignals();}
    let moving=false;
    if(cameraTween){
      const progress=Math.min(1,(now-cameraTween.start)/cameraTween.duration),t=1-Math.pow(1-progress,3);
      camera.position.lerpVectors(cameraTween.from,cameraTween.to,t);controls.target.lerpVectors(cameraTween.fromTarget,cameraTween.toTarget,t);
      if(progress===1)cameraTween=null;moving=true;
    }
    if(layoutAnimating){
      let maxDistance=0;
      for(const o of objects.values()){
        o.group.position.lerp(o.target,.16);o.shape.scale.lerp(o.targetScale,.16);
        maxDistance=Math.max(maxDistance,o.group.position.distanceTo(o.target),o.shape.scale.distanceTo(o.targetScale));
      }
      if(maxDistance<.015){for(const o of objects.values()){o.group.position.copy(o.target);o.shape.scale.copy(o.targetScale);}layoutAnimating=false;}
      updateLinkGeometry();moving=true;
    }
    const workerMotion=state.view==='district'&&districtState.workers&&!reduced.matches;
    if(workerMotion)districtTime+=delta;
    if(districtVisual){const actorMoving=districtVisual.tick(districtTime,workerMotion,reduced.matches);moving=actorMoving||moving;}
    const repairing=repairs.tick(delta,reduced.matches);
    $('district-repair-status').hidden=!repairs.job;
    if(repairs.job)$('district-repair-status').textContent=repairs.job.kind==='simulation'?'WORKER / SIMULATED REPAIR':'WORKER / APPLYING LOCAL DRAFT';
    const repairItem=repairs.job&&linkItems.find(item=>pathKey(item.edge)===repairs.job.key);
    repairWorker.tick(state.view==='district'?repairs.job:null,repairItem?.pathVisual?.curve,reduced.matches,signals.motion);
    if(repairing)moving=true;
    controls.autoRotate=state.rotate&&!reduced.matches&&!cameraTween;
    moving=controls.update(delta)||moving;
    const signalMotion=signals.active&&signals.motion&&state.edges&&!reduced.matches;
    if(signalMotion)signalTime+=delta;
    if(needsFrame||moving||signalMotion)for(const item of linkItems){const animated=item.pathVisual?.tick(signalTime,{reduced:reduced.matches});moving=!!(animated&&signalMotion)||moving;}
    if(needsFrame||moving||controls.autoRotate){renderer.render(scene,camera);updateLabels();needsFrame=false;}
  }
  function pick(event) {
    const rect=renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects([...objects.values()].filter(o=>o.group.visible).map(o=>o.mesh),false)[0];
    if(hit)return hit.object.userData.nodeId;
    // Screen-space padding makes small projected shapes selectable without huge overlapping meshes.
    let nearest=null,best=event.pointerType==='touch'?24:18;
    for(const [id,o] of objects){if(!o.group.visible)continue;const p=o.group.position.clone().project(camera);if(p.z< -1||p.z>1)continue;const distance=Math.hypot((p.x*.5+.5)*rect.width-(event.clientX-rect.left),(-p.y*.5+.5)*rect.height-(event.clientY-rect.top));if(distance<best){best=distance;nearest=id;}}
    return nearest;
  }
  function pickPath(){
    if(!state.edges)return null;
    const meshes=linkItems.filter(item=>item.pathVisual?.root.visible).map(item=>item.pathVisual.core);
    const hit=raycaster.intersectObjects(meshes,false)[0];if(hit)return hit.object.userData.pathKey;
    const width=$('stage').clientWidth,height=$('stage').clientHeight;
    let nearest=null,best=9;
    for(const item of linkItems){if(!item.pathVisual?.curve||!(item.pathVisual.root.visible||item.line.visible))continue;
      const points=item.pathVisual.curve.getPoints(80).map(p=>p.project(camera));
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue;
        const ax=(a.x-pointer.x)*width/2,ay=(a.y-pointer.y)*height/2,bx=(b.x-pointer.x)*width/2,by=(b.y-pointer.y)*height/2,dx=bx-ax,dy=by-ay;
        const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1))),distance=Math.hypot(ax+t*dx,ay+t*dy);
        if(distance<best){best=distance;nearest=pathKey(item.edge);}
      }
    }
    return nearest;
  }
  function createScene() {
    scene=new THREE.Scene();
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x0b0e13,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.45;
    $('scene').append(renderer.domElement);
    camera=new THREE.PerspectiveCamera(42,1,.1,10000);camera.position.set(90,90,110);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=5;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.45;
    controls.addEventListener('start',()=>{cameraTween=null;});controls.addEventListener('change',requestRender);
    scene.add(new THREE.HemisphereLight(0xc3daed,0x17202b,2));
    const key=new THREE.DirectionalLight(0xfff3dc,3.8);key.position.set(30,80,40);scene.add(key);
    const fill=new THREE.DirectionalLight(0x5d94c5,2);fill.position.set(-40,20,-20);scene.add(fill);
    world=new THREE.Group();groundGroup=new THREE.Group();connectionGroup=new THREE.Group();scene.add(groundGroup,connectionGroup,world,repairWorker.root);
    for(const n of graph.nodes) {
      const group=new THREE.Group(),shape=new THREE.Group();group.add(shape);world.add(group);
      const geometry=entityGeometry(n.kind);
      const material=new THREE.MeshStandardMaterial({color:kindMeta(n.kind).color,metalness:.5,roughness:.35,emissive:kindMeta(n.kind).color,emissiveIntensity:1});
      const mesh=new THREE.Mesh(geometry,material);mesh.userData.nodeId=n.id;shape.add(mesh);
      const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:kindMeta(n.kind).color,transparent:true,opacity:.6}));shape.add(outline);
      const ring=new THREE.Mesh(new THREE.RingGeometry(1.8,2,48),new THREE.MeshBasicMaterial({color:0xf5d85d,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=-1.04;ring.visible=false;shape.add(ring);
      objects.set(n.id,{group,shape,mesh,material,outline,ring,target:new THREE.Vector3(),targetScale:new THREE.Vector3(1,1,1),initialized:false});
    }
    resizeObserver=new ResizeObserver(()=>{resize();if(state.view==='district'&&districtState.selectedFloor)focusDistrictFloor();else fitCamera();});resizeObserver.observe($('stage'));resize();
    renderer.domElement.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};});
    renderer.domElement.addEventListener('pointerup',e=>{if(pointerStart&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<5&&e.button===0){const id=pick(e),key=!id&&pickPath();if(key)selectPath(key);else if(id)select(id);else if(state.view==='district'){const hit=raycaster.intersectObjects(districtVisual?.hits||[],false)[0];if(hit?.object.userData.floorId)selectDistrictFloor(hit.object.userData.floorId);else if(hit?.object.userData.building)toggleBuilding(hit.object.userData.building);else select(null);}else select(null);}pointerStart=null;});
    renderer.domElement.addEventListener('pointermove',e=>{
      if(e.buttons)return;
      const id=pick(e),key=!id&&pickPath();hovered=id;const districtHit=state.view==='district'&&raycaster.intersectObjects(districtVisual?.hits||[],false).length>0;renderer.domElement.style.cursor=id||key||districtHit?'pointer':'grab';
      $('hover-tooltip').hidden=!id&&!key;
      if(id){const n=graph.byId.get(id),rect=$('stage').getBoundingClientRect();$('hover-tooltip').innerHTML=`${esc(n.name)}<span>${esc(kindMeta(n.kind).singular)} · ${degree(id)} dependencies</span>`;$('hover-tooltip').style.left=`${Math.max(8,Math.min(rect.width-238,e.clientX-rect.left+14))}px`;$('hover-tooltip').style.top=`${Math.max(8,Math.min(rect.height-65,e.clientY-rect.top+14))}px`;}
      if(key){const rect=$('stage').getBoundingClientRect();$('hover-tooltip').innerHTML=signals.tooltip(signals.edgeByKey.get(key));$('hover-tooltip').style.left=`${Math.max(8,Math.min(rect.width-238,e.clientX-rect.left+14))}px`;$('hover-tooltip').style.top=`${Math.max(8,Math.min(rect.height-85,e.clientY-rect.top+14))}px`;}
      requestRender();
    });
    renderer.domElement.addEventListener('pointerleave',()=>{hovered=null;$('hover-tooltip').hidden=true;requestRender();});
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();$('scene-error').hidden=false;$('scene-error').textContent='The 3D graphics context was lost. Reload to restore it. Your container is unchanged, and the Explorer and inspector remain available.';});
    renderer.domElement.addEventListener('webglcontextrestored',()=>{$('scene-error').hidden=true;requestRender();});
    setView(state.view,false);frameId=requestAnimationFrame(loop);
  }

  function selectDistrictFloor(id){
    districtState.groupPinned=false;
    districtState.selectedFloor=districtState.selectedFloor===id?null:id;
    state.selected=null;state.selectedPath=null;signals.syncSelection(null);
    if(scene){rebuildLayout();if(districtState.selectedFloor)focusDistrictFloor();else fitCamera();}renderInspector();
    $('inspector').classList.toggle('open',!!districtState.selectedFloor);
  }
  function focusDistrictFloor(){
    const floor=districtLayout?.districts.find(d=>d.id===districtState.selectedFloor);if(!floor||!camera)return;
    const target=new THREE.Vector3(floor.x,floor.y+3,floor.z);
    if(camera.isOrthographicCamera){camera.userData.halfHeight=Math.max(floor.depth*.8,floor.width/(camera.aspect||1)*.7,16);camera.zoom=1;resize();}
    const direction=new THREE.Vector3(.35,.9,1.35).normalize();cameraTo(target.clone().addScaledVector(direction,200),target);
  }
  function toggleBuilding(surface){
    if(districtState.expandedBuildings.has(surface))districtState.expandedBuildings.delete(surface);else districtState.expandedBuildings.add(surface);
    state.exploded=false;$('explode-toggle').setAttribute('aria-pressed','false');
    if(scene){rebuildLayout();fitCamera();}renderInspector();
  }
  for(const surface of ['web','server'])$('district-'+surface).addEventListener('click',()=>toggleBuilding(surface));
  $('district-spacing').addEventListener('change',e=>{districtState.spacing=Number(e.target.value);state.exploded=true;$('explode-toggle').setAttribute('aria-pressed','true');if(scene){rebuildLayout();if(districtState.selectedFloor)focusDistrictFloor();else fitCamera();}renderInspector();});
  $('district-routes').addEventListener('change',e=>{districtState.routeScope=e.target.value;updateLinks();renderInspector();requestRender();});
  $('district-health').addEventListener('click',e=>{
    const button=e.target.closest('[data-health]');if(!button)return;
    districtState.healthFilter=button.dataset.health;districtState.groupPinned=button.dataset.health!=='all';districtState.groupSelection=null;state.selected=null;state.selectedPath=null;signals.syncSelection(null);
    if(districtState.selectedFloor){districtState.selectedFloor=null;if(scene){rebuildLayout();fitCamera();}}
    updateVisible();renderInspector();$('inspector').classList.toggle('open',districtState.healthFilter!=='all');
  });
  $('district-floor').addEventListener('change',e=>selectDistrictFloor(e.target.value));
  $('district-workers').addEventListener('click',()=>{districtState.workers=!districtState.workers;$('district-workers').setAttribute('aria-pressed',String(districtState.workers));requestRender();});
  $('district-workers').disabled=reduced.matches;
  document.querySelectorAll('button[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('cluster-select').innerHTML='<option value="all">All entity types</option>'+[...new Set(graph.nodes.map(n=>n.kind))].sort((a,b)=>kindOrder(a)-kindOrder(b)).map(kind=>`<option value="${esc(kind)}">${esc(kindMeta(kind).label)}</option>`).join('');
  $('cluster-select').addEventListener('change',e=>{state.cluster=e.target.value;select(null);});
  $('search').addEventListener('input',e=>{state.search=e.target.value;updateVisible();});
  $('scope').addEventListener('change',e=>{state.scope=e.target.value;updateVisible();});
  $('entity-list').addEventListener('click',e=>{const button=e.target.closest('[data-node]');if(button)select(button.dataset.node);});
  $('inspector-content').addEventListener('click',e=>{
    const groupRoute=e.target.closest('[data-group-route]');if(groupRoute){selectGroupRoute(groupRoute.dataset.groupRoute);return;}
    if(e.target.closest('#inspect-group-selection')){const edge=graph.edges.find(edge=>pathKey(edge)===districtState.groupSelection);if(edge){if(isSignalPath(edge))selectPath(pathKey(edge));else select(edge.from);}return;}
    const repair=e.target.closest('[data-repair]');if(repair){repairs.handle(repair.dataset.repair);requestRender();return;}
    const path=e.target.closest('[data-path]');if(path){selectPath(path.dataset.path);return;}
    const button=e.target.closest('[data-node]');if(button)select(button.dataset.node);
    else if(e.target.closest('#focus-node'))focusNode(state.selected);
    else if(e.target.closest('#inspect-isolate'))toggleIsolate();
  });
  $('inspector-content').addEventListener('change',e=>{if(e.target.id==='repair-node')repairs.changeNode(e.target.value);});
  $('district-audit').addEventListener('click',()=>{const candidates=(state.view==='district'?scopedDistrictEdges():graph.edges.filter(e=>visibleIds.has(e.from)&&visibleIds.has(e.to))).filter(isSignalPath);const edge=candidates.find(e=>pathKey(e)===state.selectedPath)||candidates.find(e=>signals.signal(e).health==='failing')||candidates.find(e=>signals.signal(e).health==='degraded')||candidates[0];if(edge){selectPath(pathKey(edge));focusRepairPath(edge);}});
  $('clear-selection').addEventListener('click',()=>select(null));
  $('clear-filters').addEventListener('click',resetFilters);$('empty-clear').addEventListener('click',resetFilters);
  $('isolate-toggle').addEventListener('click',toggleIsolate);
  const flowSurfaces=new Set(graph.nodes.map(node=>surfaceOf(node,graph)));
  $('flow-separate').disabled=flowSurfaces.size<2;
  if(flowSurfaces.size<2)$('flow-separate').title='This snapshot contains only one GTM surface';
  $('flow-separate').addEventListener('click',()=>{
    state.surfacesSeparated=!state.surfacesSeparated;
    districtState.selectedFloor=null;
    $('flow-separate').setAttribute('aria-pressed',String(state.surfacesSeparated));
    $('flow-separate').textContent=state.surfacesSeparated?'Combine Containers':'Split Web / Server';
    $('flow-separate').title=state.surfacesSeparated?'Combine Web and Server-side GTM into one container':'Split into Web GTM and Server-side GTM containers';
    if(scene){rebuildLayout();fitCamera();}
    renderInspector();
    requestRender();
  });
  for(const [id,key] of [['edges-toggle','edges'],['labels-toggle','labels'],['rotate-toggle','rotate'],['explode-toggle','exploded']]) {
    $(id).addEventListener('click',()=>{state[key]=!state[key];$(id).setAttribute('aria-pressed',String(state[key]));if(key==='exploded'&&scene){rebuildLayout();fitCamera();}updateLinks();requestRender();});
  }
  if(reduced.matches){$('rotate-toggle').disabled=true;$('rotate-toggle').title='Auto orbit disabled for reduced motion';}
  reduced.addEventListener('change',()=>{
    if(reduced.matches){signals.motion=false;state.rotate=false;$('rotate-toggle').setAttribute('aria-pressed','false');}
    $('district-workers').disabled=reduced.matches;
    if(reduced.matches){districtState.workers=false;$('district-workers').setAttribute('aria-pressed','false');}
    $('signal-motion').disabled=reduced.matches;$('rotate-toggle').disabled=reduced.matches;
    signals.render();requestRender();
  });
  $('home-view').addEventListener('click',()=>{state.top=false;$('top-view').setAttribute('aria-pressed','false');fitCamera();});
  $('top-view').addEventListener('click',()=>{state.top=!state.top;$('top-view').setAttribute('aria-pressed',String(state.top));fitCamera();});
  for(const [id,factor] of [['zoom-in',.78],['zoom-out',1.28]])$(id).addEventListener('click',()=>{if(camera?.isOrthographicCamera){camera.zoom=Math.max(.1,Math.min(40,camera.zoom/factor));camera.updateProjectionMatrix();requestRender();}else if(camera)cameraTo(camera.position.clone().sub(controls.target).multiplyScalar(factor).add(controls.target),controls.target.clone(),.2);});
  $('fullscreen').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else throw Error('unavailable');}
    catch{$('status-selection').textContent='Browser full screen unavailable. This page already fills the available window.';}
  });
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit full screen':'Enter full screen');resize();});
  $('shortcuts').addEventListener('click',()=>$('help-dialog').showModal());
  $('canvas-mode').addEventListener('click',()=>{const on=$('atlas').classList.toggle('canvas-only');$('canvas-mode').setAttribute('aria-pressed',String(on));resize();fitCamera();});
  $('toggle-inventory').addEventListener('click',()=>$('inventory').classList.toggle('open'));
  $('close-inventory').addEventListener('click',()=>$('inventory').classList.remove('open'));
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||$('help-dialog').open)return;
    if(e.key==='/'){e.preventDefault();$('inventory').classList.add('open');$('search').focus();}
    else if(e.key==='1'||e.key==='3')setView(e.key==='1'?'district':'flow');
    else if(e.key.toLowerCase()==='r')$('home-view').click();
    else if(e.key.toLowerCase()==='t')$('top-view').click();
    else if(e.key.toLowerCase()==='f')$('fullscreen').click();
    else if(e.key.toLowerCase()==='m')$('canvas-mode').click();
    else if(e.key==='Escape'){select(null);$('inventory').classList.remove('open');signals.open(false);}
    else if(e.key==='?')$('help-dialog').showModal();
  });
  window.addEventListener('hashchange',()=>setView(location.hash.slice(1),false));
  renderList();renderInspector();
  try { createScene(); }
  catch(error) {
    console.error('Container Atlas renderer unavailable:',error);
    scene=null;
    $('scene-error').hidden=false;
    $('scene-error').textContent='3D rendering is unavailable in this browser. Enable hardware acceleration or use another browser. You can still explore every element and its relationships in the Explorer and inspector.';
    setView(state.view,false);updateVisible();
  }
  window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;cancelAnimationFrame(frameId);resizeObserver?.disconnect();controls?.dispose();if(scene)clearGroup(scene);renderer?.dispose();});
}
