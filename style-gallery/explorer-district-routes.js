import {PATH_GROUPS} from './explorer-path-groups.js';
// Dedicated service lanes keep routes outside the container shells. This module
// only routes supplied edges; it never creates a relationship or traffic value.
const key=e=>JSON.stringify([e.from,e.to,e.kind]);
const point=(x,y,z)=>({x,y,z});
export function districtRoutes(edges,positions,floors,statuses=new Map()){
  const membership=new Map(floors.flatMap(f=>f.nodeIds.map(id=>[id,f])));
  const front=Math.max(0,...floors.map(f=>f.z+f.depth/2));
  const extents={};
  for(const surface of ['web','server']){
    const own=floors.filter(f=>f.surface===surface);
    extents[surface]=surface==='web'?Math.min(0,...own.map(f=>f.x-f.width/2)):Math.max(0,...own.map(f=>f.x+f.width/2));
  }
  const status=e=>statuses.get(key(e))||'unknown';
  const sorted=[...edges].sort((a,b)=>(PATH_GROUPS[status(a)]?.rank??3)-(PATH_GROUPS[status(b)]?.rank??3)||key(a).localeCompare(key(b)));
  const lastGroup={};
  const counters={web:0,server:0,transport:0},ports=new Map(),routes=new Map();
  for(const edge of sorted){
    const a=positions.get(edge.from),b=positions.get(edge.to),fa=membership.get(edge.from),fb=membership.get(edge.to);
    if(!a||!b||!fa||!fb)continue;
    const crossing=fa.surface!==fb.surface,bucket=crossing?'transport':fa.surface;
    if(lastGroup[bucket]&&lastGroup[bucket]!==status(edge))counters[bucket]+=3;
    lastGroup[bucket]=status(edge);
    const rank=counters[bucket]++;
    const takePort=id=>{const n=ports.get(id)||0;ports.set(id,n+1);return n;};
    const start=point(a.x,a.y+a.height/2,a.z),end=point(b.x,b.y+b.height/2,b.z);
    const liftA=point(start.x,Math.max(start.y+.7,fa.y+4.1)+takePort(edge.from)*.13,start.z);
    const liftB=point(end.x,Math.max(end.y+.7,fb.y+4.1)+takePort(edge.to)*.13,end.z);
    const laneZ=front+4+rank*.85+(crossing?Math.max(counters.web,counters.server)*.85+4:0);
    let points;
    if(crossing){
      // Web/server transport runs along its own low front bridge.
      const bridgeY=1.2+rank*.7;
      points=[start,liftA,point(start.x,liftA.y,laneZ),point(start.x,bridgeY,laneZ),point(end.x,bridgeY,laneZ),point(end.x,liftB.y,laneZ),liftB,end];
    }else if(fa.id===fb.id&&edge.from!==edge.to){
      points=[start,liftA,point(start.x,liftA.y,laneZ),point(end.x,liftA.y,laneZ),point(end.x,liftB.y,laneZ),liftB,end];
    }else{
      const direction=fa.surface==='web'?-1:1,shaftX=extents[fa.surface]+direction*(3+rank*.85);
      points=[start,liftA,point(start.x,liftA.y,laneZ),point(shaftX,liftA.y,laneZ),point(shaftX,liftB.y,laneZ),point(end.x,liftB.y,laneZ),liftB,end];
      if(edge.from===edge.to)points.splice(4,0,point(shaftX,liftA.y+2,laneZ),point(end.x,liftA.y+2,laneZ));
    }
    routes.set(key(edge),points.filter((p,i,list)=>!i||Math.hypot(p.x-list[i-1].x,p.y-list[i-1].y,p.z-list[i-1].z)>.001));
  }
  return routes;
}
