import {isDependency} from './explorer-model.js';
export const PATH_GROUPS = {
  failing:{label:'Failing',color:'#f17d8d',rank:0},
  degraded:{label:'Degraded',color:'#efbc61',rank:1},
  healthy:{label:'Healthy',color:'#64dca7',rank:2},
  unknown:{label:'Unknown',color:'#96a4b5',rank:3},
  blocking:{label:'Blocking rules',color:'#ce9fce',rank:4},
  context:{label:'Context',color:'#718096',rank:5}
};
export function pathGroup(edge,signal){
  if(edge.kind==='tag_trigger_blocking')return 'blocking';
  if(!isDependency(edge))return 'context';
  return signal&&!signal.stale&&['failing','degraded','healthy'].includes(signal.health)?signal.health:'unknown';
}
export function groupPaths(edges,describe){
  const groups=Object.fromEntries(Object.keys(PATH_GROUPS).map(k=>[k,[]]));
  for(const edge of edges)groups[pathGroup(edge,describe(edge))].push(edge);
  return groups;
}
