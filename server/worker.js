import { appIdentity, clerkEnabled, publicAuthConfig, ownsConnection, clerkResponseHeaders } from './clerk-auth.js';
import {GTMComparison} from './comparison-core.js';
// Cloudflare Pages advanced-mode Worker. All GTM operations are GET-only.
const GTM_SCOPE = 'https://www.googleapis.com/auth/tagmanager.readonly';
const SCOPES = ['openid', 'email', 'profile', GTM_SCOPE];
const SESSION_COOKIE = '__Host-gtm-session';
const FLOW_COOKIE = '__Host-gtm-oauth';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USER_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GTM_URL = 'https://tagmanager.googleapis.com/tagmanager/v2/';
const encoder = new TextEncoder();

class Problem extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', ...extra}});
}
function b64(bytes) { let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function unb64(text) { return Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0)); }
function random() { return b64(crypto.getRandomValues(new Uint8Array(32))); }
async function digest(value) { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))); }
async function key(env) {
  const raw = unb64(env.SESSION_ENCRYPTION_KEY);
  if(raw.length !== 32) throw new Problem(503,'setup_required','Session protection is not configured.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function seal(env, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)}, await key(env), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({iv:b64(iv),body:b64(new Uint8Array(body))});
}
async function unseal(env, text, context) {
  const data = JSON.parse(text);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(data.iv),additionalData:encoder.encode(context)},await key(env),unb64(data.body));
  return JSON.parse(new TextDecoder().decode(plain));
}
function cookies(request) {
  return Object.fromEntries((request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>{const at=s.indexOf('=');return [s.slice(0,at),s.slice(at+1)];}));
}
function cookie(name,value,maxAge) { return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`; }
function configured(env) { return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_ENCRYPTION_KEY && env.GTM_SESSIONS && env.APP_ORIGIN); }
function origin(env) {
  const url=new URL(env.APP_ORIGIN);
  if(url.protocol!=='https:' || url.pathname!=='/') throw new Problem(503,'setup_required','The application origin is not configured.');
  return url.origin;
}
function requireSetup(request,env) {
  if(!configured(env)) throw new Problem(503,'setup_required','Google Sign-in needs the website OAuth client configuration.');
  if(new URL(request.url).origin!==origin(env)) throw new Problem(403,'wrong_origin','Sign in on the production site, not a preview deployment.');
}
function only(request,method) { if(request.method!==method)throw new Problem(405,'method_not_allowed','This HTTP method is not supported.'); }
function identifier(value) { if(typeof value!=='string'||!/^\d{1,25}$/.test(value))throw new Problem(400,'invalid_target','A numeric GTM resource ID is required.');return value; }
async function readSession(request,env) {
  const identity=await appIdentity(request,env);
  const id=cookies(request)[SESSION_COOKIE];
  if(!id || !/^[A-Za-z0-9_-]{43}$/.test(id))throw new Problem(401,'sign_in_required','Sign in with Google to continue.');
  const storageKey='session:'+await digest(id),stored=await env.GTM_SESSIONS.get(storageKey);
  if(!stored)throw new Problem(401,'sign_in_required','Your session has expired. Sign in again.');
  let session;
  try {session=await unseal(env,stored,storageKey);} catch {throw new Problem(401,'sign_in_required','Your session is invalid. Sign in again.');}
  if(!session.expiresAt || session.expiresAt<=Date.now())throw new Problem(401,'sign_in_required','Your session has expired. Sign in again.');
  if(!ownsConnection(identity,session))throw new Problem(401,'connection_owner_mismatch','Connect Google Tag Manager for this signed-in account.');
  return {session,storageKey};
}
function requireCsrf(request,env,session) {
  if(request.headers.get('Origin')!==origin(env) || request.headers.get('X-CSRF-Token')!==session.csrf)throw new Problem(403,'csrf_failed','The request could not be verified. Reload the page.');
}
async function upstream(url,options={}) {
  // Workers supports manual/follow, not redirect:error. Never follow a redirect
  // with an OAuth client secret, authorization code, or bearer token attached.
  let response;
  try {response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch {throw new Problem(502,'google_unavailable','Google is unavailable. Start a new sign-in and try again.');}
  if(response.status>=300 && response.status<400) {
    await response.body?.cancel();
    throw new Problem(502,'google_redirect_rejected','Google returned an unexpected redirect. The request was stopped to protect your credentials.');
  }
  return response;
}
async function gtmGet(session,path) {
  // Caller paths are constructed only by the fixed routes below, never passed through.
  await new Promise(resolve=>setTimeout(resolve,4100)); // Conservative GTM project quota pacing.
  const response=await upstream(GTM_URL+path,{headers:{Authorization:`Bearer ${session.accessToken}`,Accept:'application/json'}});
  if(response.status===401)throw new Problem(401,'sign_in_required','Google access expired. Sign in again.');
  if(response.status===403)throw new Problem(403,'gtm_access_denied','Google denied GTM access. Check Tag Manager permissions, API enablement, and the read-only consent grant.');
  if(response.status===404)throw new Problem(404,'target_not_found','That GTM resource is not available to this Google account.');
  if(!response.ok)throw new Problem(response.status===429?429:502,'gtm_request_failed','GTM could not complete the request. Try again later.');
  return response.json();
}
async function list(session,path,field) {
  let pageToken;const items=[],seen=new Set();
  for(let page=0;page<100;page++) {
    const data=await gtmGet(session,path+(pageToken?'?pageToken='+encodeURIComponent(pageToken):''));
    if(data[field]!==undefined && !Array.isArray(data[field]))throw new Problem(502,'invalid_response','GTM returned an unexpected response.');
    items.push(...(data[field]||[]));
    pageToken=data.nextPageToken;
    if(!pageToken)return items;
    if(typeof pageToken!=='string'||seen.has(pageToken))throw new Problem(502,'pagination_failed','GTM pagination did not complete.');
    seen.add(pageToken);
  }
  throw new Problem(502,'pagination_limit','The GTM list exceeded the safe page limit. No partial list was returned.');
}
async function start(request,env) {
  const identity=await appIdentity(request,env);
  const state=random(),browserNonce=random(),verifier=random();
  const storageKey='oauth:'+await digest(state);
  await env.GTM_SESSIONS.put(storageKey,await seal(env,{browserHash:await digest(browserNonce),verifier,appUserId:identity?.userId,appSessionId:identity?.sessionId,expiresAt:Date.now()+600000},storageKey),{expirationTtl:600});
  const url=new URL(AUTH_URL);
  url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin(env)+'/api/auth/callback',response_type:'code',scope:SCOPES.join(' '),state,code_challenge:await digest(verifier),code_challenge_method:'S256',access_type:'online',prompt:'select_account consent'}).toString();
  return new Response(null,{status:302,headers:{Location:url.toString(),'Set-Cookie':cookie(FLOW_COOKIE,browserNonce,600),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
async function callback(request,env) {
  const url=new URL(request.url),state=url.searchParams.get('state'),nonce=cookies(request)[FLOW_COOKIE];
  if(!state||!nonce||!/^[A-Za-z0-9_-]{43}$/.test(state))throw new Problem(400,'invalid_oauth_state','The sign-in request is invalid or expired. Start again.');
  const storageKey='oauth:'+await digest(state),stored=await env.GTM_SESSIONS.get(storageKey);
  if(!stored)throw new Problem(400,'invalid_oauth_state','The sign-in request expired. Start again.');
  let flow;try {flow=await unseal(env,stored,storageKey);}catch{throw new Problem(400,'invalid_oauth_state','Invalid sign-in request.');}
  if(flow.expiresAt<=Date.now()||flow.browserHash!==await digest(nonce))throw new Problem(400,'invalid_oauth_state','The sign-in request does not match this browser.');
  const identity=await appIdentity(request,env);
  if(!ownsConnection(identity,flow))throw new Problem(401,'connection_owner_mismatch','Your signed-in account changed. Start the Google connection again.');
  await env.GTM_SESSIONS.delete(storageKey);
  if(url.searchParams.has('error'))return new Response(null,{status:302,headers:{Location:origin(env)+'/?gtm_auth=cancelled#google-connection','Set-Cookie':cookie(FLOW_COOKIE,'',0),'Cache-Control':'no-store'}});
  const code=url.searchParams.get('code');if(!code)throw new Problem(400,'missing_code','Google did not return an authorization code.');
  const tokenResponse=await upstream(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:origin(env)+'/api/auth/callback',grant_type:'authorization_code',code_verifier:flow.verifier})});
  if(!tokenResponse.ok)throw new Problem(401,'exchange_failed','Google Sign-in could not be completed. Start again.');
  const token=await tokenResponse.json();
  if(!token.access_token || !String(token.scope||'').split(' ').includes(GTM_SCOPE))throw new Problem(403,'gtm_consent_required','Grant the read-only Google Tag Manager permission to connect GTM.');
  const userResponse=await upstream(USER_URL,{headers:{Authorization:`Bearer ${token.access_token}`}});
  if(!userResponse.ok)throw new Problem(401,'identity_failed','Google identity could not be verified.');
  const user=await userResponse.json();
  if(!user.sub)throw new Problem(401,'identity_failed','Google did not provide an account identity.');
  const ttl=Math.min(3600,Number(token.expires_in)||0)-60;
  if(ttl<60)throw new Problem(401,'exchange_failed','Google returned an expired access token.');
  const session={appUserId:identity?.userId,appSessionId:identity?.sessionId,user:{id:user.sub,name:user.name||'',email:user.email||''},accessToken:token.access_token,csrf:random(),expiresAt:Date.now()+ttl*1000,selection:null};
  const id=random(),sessionKey='session:'+await digest(id);
  await env.GTM_SESSIONS.put(sessionKey,await seal(env,session,sessionKey),{expirationTtl:ttl});
  const oldId=cookies(request)[SESSION_COOKIE];
  if(oldId && /^[A-Za-z0-9_-]{43}$/.test(oldId))await env.GTM_SESSIONS.delete('session:'+await digest(oldId));
  const headers=new Headers({Location:origin(env)+'/#google-connection','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  headers.append('Set-Cookie',cookie(SESSION_COOKIE,id,ttl));headers.append('Set-Cookie',cookie(FLOW_COOKIE,'',0));
  return new Response(null,{status:302,headers});
}

const LIVE_STYLES=['structured-2d','structured-3d','axonometric-2d','axonometric-3d','spatial-2d','spatial-3d','utility-2d','utility-3d','explorer'];
function targetKey(selection) {return [selection.accountId,selection.containerId,selection.workspaceId].join('/');}
function snapshotSummary(audit,id) {return {ready:true,snapshotId:id,capturedAt:audit.meta.run_at,selection:audit.selection,counts:audit.summary.node_counts,note:'Read-only GTM snapshot; audit scores are not assessed.'};}
async function readSnapshot(request,env,session,storageKey,id) {
  if(!session.selection)throw new Problem(409,'select_workspace','Connect a GTM workspace first.');
  if(!id){
    const pointerKey='gallery-ref:'+storageKey,stored=await env.GTM_SESSIONS.get(pointerKey);
    if(!stored)return null;
    const pointer=await unseal(env,stored,pointerKey);
    if(pointer.target!==targetKey(session.selection))return null;
    id=pointer.id;
  }
  if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw new Problem(400,'invalid_snapshot','Invalid snapshot identifier.');
  const key='gallery:'+storageKey+':'+id,stored=await env.GTM_SESSIONS.get(key);
  if(!stored)return null;
  const audit=await unseal(env,stored,key);
  if(targetKey(audit.selection)!==targetKey(session.selection))throw new Problem(409,'target_changed','The selected workspace has changed. Refresh the gallery.');
  return {id,audit};
}
async function collectWorkspace(session) {
  const {accountId,containerId,workspaceId}=session.selection;
  const base=`accounts/${identifier(accountId)}/containers/${identifier(containerId)}`,ws=base+`/workspaces/${identifier(workspaceId)}`;
  const container=await gtmGet(session,base);
  if(container.accountId!==accountId||container.containerId!==containerId)throw new Problem(502,'target_mismatch','Unexpected GTM container returned.');
  const raw={tags:[],triggers:[],variables:[],builtIns:[],folders:[],templates:[],versions:[],clients:[],transformations:[],zones:[],workspaces:[],environments:[],permissions:[]},notes=[];
  for(const [out,path,field,feature,optional] of [
    ['tags',ws+'/tags','tag',null,false],['triggers',ws+'/triggers','trigger',null,false],
    ['variables',ws+'/variables','variable',null,false],['builtIns',ws+'/built_in_variables','builtInVariable','supportBuiltInVariables',true],
    ['folders',ws+'/folders','folder','supportFolders',true],['templates',ws+'/templates','template','supportTemplates',true],
    ['clients',ws+'/clients','client','supportClients',true],['transformations',ws+'/transformations','transformation','supportTransformations',true],
    ['zones',ws+'/zones','zone','supportZones',true],['versions',base+'/version_headers','containerVersionHeader','supportVersions',true]
  ]) {
    if(feature&&container.features?.[feature]===false){notes.push(out+': not supported by this container.');continue;}
    try{raw[out]=await list(session,path,field);}
    catch(error){if(optional&&[403,404].includes(error.status)){notes.push(out+': unavailable to this session.');}else throw error;}
  }
  notes.push('Audit scores have not been assessed. Configuration relationships do not prove runtime firing.','Version headers show count history, not a full historical snapshot.');
  return {raw,notes,container};
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!['fingerprint','path','tagManagerUrl','accountId','containerId','workspaceId'].includes(k)).map(k=>[k,stable(value[k])]));
  return value;
}
export function buildLiveAudit(selection,raw,notes=[],previous=null) {
  const nodes=[],edges=[],inventory=[],byId=new Map(),names=new Map(),edgeKeys=new Set();
  const specs={tags:['tag','tagId'],triggers:['trigger','triggerId'],variables:['variable','variableId'],builtIns:['builtin','type'],folders:['folder','folderId'],templates:['template','templateId'],versions:['version','containerVersionId'],clients:['client','clientId'],transformations:['transformation','transformationId'],zones:['zone','zoneId']};
  function addNode(kind,id,entity,collection,index,flags=[]){
    const node={id:`${kind}:${id}`,provider_id:String(id),id_source:flags.length?'derived-reference':'provider',kind,collection,raw_index:index,name:entity.name||String(id),type:entity.type||kind,paused:!!entity.paused,parent_folder_id:entity.parentFolderId||null,risk:'unassessed',flags,details:entity};
    nodes.push(node);byId.set(node.id,node);if(['variable','builtin'].includes(kind))names.set(node.name,node.id);return node;
  }
  for(const [collection,[kind,idKey]] of Object.entries(specs))for(const [index,entity] of (raw[collection]||[]).entries()){
    if(!entity||typeof entity!=='object')continue;
    const id=entity[idKey]??entity.name??`index-${index}`;
    addNode(kind,id,entity,collection,index);
  }
  const systems={'2147479553':'All Pages (system)','2147479572':'Consent Initialization - All Pages (system)','2147479573':'Initialization - All Pages (system)'};
  function edge(from,to,kind,evidence){const key=[from,to,kind].join('|');if(!edgeKeys.has(key)){edgeKeys.add(key);edges.push({id:`edge:${edges.length}`,from,to,kind,evidence});}}
  function references(value,out=new Set()){
    if(typeof value==='string')for(const m of value.matchAll(/{{\s*([^{}]+?)\s*}}/g))out.add(m[1]);
    else if(Array.isArray(value))value.forEach(x=>references(x,out));
    else if(value&&typeof value==='object')Object.values(value).forEach(x=>references(x,out));
    return out;
  }
  function parameters(items,node,path='parameter'){
    for(const [i,p] of (items||[]).entries()){
      if(!p||typeof p!=='object')continue;
      const location=`${path}[${i}]`;
      if(p.key!==undefined&&p.value!==undefined)inventory.push({entity_id:node.id,entity_name:node.name,entity_kind:node.kind,key:p.key,value:p.value,value_type:p.type,path:location,references:[...references(p.value)]});
      if(Array.isArray(p.list))parameters(p.list,node,location+'.list');
      if(Array.isArray(p.map))parameters(p.map,node,location+'.map');
    }
  }
  for(const node of [...nodes]){
    const entity=node.details;
    if(node.kind==='tag'){
      for(const [field,kind] of [['firingTriggerId','tag_trigger'],['blockingTriggerId','tag_trigger_blocking']])for(const id of entity[field]||[]){
        if(!byId.has('trigger:'+id))addNode('trigger',id,{name:systems[id]||`Unresolved trigger ${id}`,type:systems[id]?'system':'unresolved'},'derived_triggers',null,[systems[id]?'system-trigger':'unresolved-reference']);
        edge(node.id,'trigger:'+id,kind,field);
      }
      for(const [field,kind] of [['setupTag','tag_setup'],['teardownTag','tag_teardown']])for(const item of entity[field]||[])if(byId.has('tag:'+item.tagName))edge(node.id,'tag:'+item.tagName,kind,field);
    }
    if(entity.parentFolderId && byId.has('folder:'+entity.parentFolderId))edge('folder:'+entity.parentFolderId,node.id,'folder_member','parentFolderId');
    for(const ref of references(entity)){
      let target=names.get(ref);
      if(!target){
        const special=['_event','_url','_hostname','_path','_referrer'].includes(ref);
        target=addNode(special?'builtin':'variable','reference-'+ref,{name:ref,type:special?'system':'unresolved'},'derived_variables',null,[special?'system-variable':'unresolved-reference']).id;
      }
      edge(node.id,target,node.kind+'_variable','{{'+ref+'}}');
    }
    parameters(entity.parameter,node);
  }
  const drift={available:!!previous,added:[],removed:[],modified:[],risk_escalated:[],summary:previous?'Compared with the previous snapshot in this session.':'No previous snapshot for this workspace in this session.'};
  if(previous){
    const before=new Map(previous.nodes.filter(n=>n.kind!=='version'&&n.drift_state!=='removed').map(n=>[n.id,n]));
    for(const node of nodes.filter(n=>n.kind!=='version')){
      const old=before.get(node.id);
      if(!old){node.drift_state='added';drift.added.push({id:node.id,name:node.name});}
      else if(JSON.stringify(stable(old.details))!==JSON.stringify(stable(node.details))){node.drift_state='modified';drift.modified.push({id:node.id,name:node.name,changed_fields:Object.keys({...old.details,...node.details}).filter(k=>JSON.stringify(stable(old.details[k]))!==JSON.stringify(stable(node.details[k])))});}
      before.delete(node.id);
    }
    for(const old of before.values()){const ghost={...old,drift_state:'removed'};nodes.push(ghost);drift.removed.push({id:old.id,name:old.name});}
  }
  const points=(raw.versions||[]).map(v=>({id:String(v.containerVersionId),name:v.name||'Unnamed version',description:v.description||'',num_tags:Number(v.numTags)||0,num_triggers:Number(v.numTriggers)||0,num_variables:Number(v.numVariables)||0})).sort((a,b)=>Number(a.id)-Number(b.id));
  const counts={};for(const node of nodes)if(node.drift_state!=='removed')counts[node.kind]=(counts[node.kind]||0)+1;
  return {schema_version:'2.0',selection,meta:{client_name:selection.containerName,container_name:selection.containerName,account_id:selection.accountId,container_id:selection.containerId,public_id:selection.publicId,workspace_id:selection.workspaceId,run_at:new Date().toISOString(),source_mode:'direct-api',usage_context:selection.usageContext||[],overall_pct:null,source_notes:notes},entities_raw:raw,rows:[],counts:{},merge_context:{},nodes,edges,parameter_inventory:inventory,dimensions:[],signals:[],recommendations:[],history:{points,spikes:[],weak_version_ids:[],claim_boundary:'GTM version header count history only.'},drift,summary:{node_counts:counts,overall_pct:null,recommendation_count:0}};
}
export function replaceEmbeddedJson(html,name,value) {
  const marker=`const ${name}=`,at=html.indexOf(marker);
  if(at<0)throw new Problem(500,'template_invalid','Gallery template is unavailable.');
  const start=at+marker.length;let depth=0,inString=false,escape=false,end=-1;
  for(let i=start;i<html.length;i++){
    const c=html[i];
    if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;}
    else if(c==='"')inString=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(depth===0){end=i+1;break;}}
  }
  if(end<0)throw new Problem(500,'template_invalid','Gallery template is invalid.');
  JSON.parse(html.slice(start,end));
  return html.slice(0,start)+JSON.stringify(value).replaceAll('<','\\u003c')+html.slice(end);
}
async function privateGallery(request,env,session,storageKey,style) {
  const found=await readSnapshot(request,env,session,storageKey,new URL(request.url).searchParams.get('snapshot'));
  if(!found)throw new Problem(409,'snapshot_required','Refresh the connected workspace gallery first.');
  const {id,audit}=found,index=style==='index';
  const response=await env.ASSETS.fetch(new Request(origin(env)+'/style-gallery/'+(index?'index':style)+'.html'));
  if(!response.ok)throw new Problem(500,'template_unavailable','Gallery template is unavailable.');
  let html=await response.text();
  if(index){
    const views={};for(const family of ['axonometric','structured','spatial','utility'])views[family]=Object.fromEntries(['2d','3d'].map(d=>[d,`/api/gtm/gallery/${family}-${d}.html?snapshot=${id}`]));
    html=replaceEmbeddedJson(html,'CONFIG',{client:'Private GTM snapshot',container:audit.meta.container_name,labels:{axonometric:'Axonometric Building',structured:'Structured Container',spatial:'Free-form Spatial',utility:'Utility Style'},views,atlas:`/api/gtm/gallery/explorer.html?snapshot=${id}`});
  }else {
    const versions=versionChoices(audit);
    html=replaceEmbeddedJson(html,'AUDIT',{...audit,version_browser:{snapshot_id:id,compare_url:'/api/gtm/versions/compare',versions,default_before:versions[0]?.id||'',default_after:'workspace'}});
  }
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'; object-src 'none'; base-uri 'none'"}});
}

function versionChoices(audit){
  return (audit.entities_raw.versions||[]).filter(v=>!v.deleted && /^\d+$/.test(String(v.containerVersionId)) && Number(v.containerVersionId)>0).map(v=>({id:String(v.containerVersionId),name:v.name||'Unnamed version',description:v.description||''})).sort((a,b)=>Number(b.id)-Number(a.id));
}
async function versionAudit(env,session,storageKey,snapshot,id){
  if(id==='workspace'){
    if((snapshot.audit.meta.source_notes||[]).some(n=>n.includes('unavailable to this session')))throw new Problem(409,'incomplete_snapshot','Some workspace collections could not be read. Refresh with complete access before comparing.');
    return snapshot.audit;
  }
  identifier(id);
  if(!versionChoices(snapshot.audit).some(v=>v.id===id))throw new Problem(400,'unknown_version','Choose a version listed in the captured container history.');
  const cacheKey='version:'+storageKey+':'+snapshot.id+':'+id;
  const cached=await env.GTM_SESSIONS.get(cacheKey);
  if(cached)return unseal(env,cached,cacheKey);
  const s=session.selection,path=`accounts/${identifier(s.accountId)}/containers/${identifier(s.containerId)}/versions/${id}`;
  const version=await gtmGet(session,path);
  if(version.accountId!==s.accountId||version.containerId!==s.containerId||String(version.containerVersionId)!==id)throw new Problem(502,'version_mismatch','Google returned an unexpected container version.');
  const raw={};
  const mapping={tags:'tag',triggers:'trigger',variables:'variable',builtIns:'builtInVariable',folders:'folder',templates:'customTemplate',clients:'client',transformations:'transformation',zones:'zone'};
  for(const [out,key] of Object.entries(mapping)){
    if(version[key]!==undefined&&!Array.isArray(version[key]))throw new Problem(502,'invalid_version','Invalid GTM full-version response.');
    raw[out]=version[key]||[];
  }
  raw.versions=snapshot.audit.entities_raw.versions;
  const audit=buildLiveAudit(s,raw,['Full GTM container version; no runtime firing claims.']);
  audit.meta.version_id=id;audit.meta.version_name=version.name||'';
  if(JSON.stringify(audit).length>4000000)throw new Problem(413,'version_too_large','This version exceeds the interactive comparison size limit.');
  const ttl=Math.floor((session.expiresAt-Date.now())/1000);
  if(ttl<60)throw new Problem(401,'sign_in_required','Sign in again to compare versions.');
  await env.GTM_SESSIONS.put(cacheKey,await seal(env,audit,cacheKey),{expirationTtl:ttl});
  return audit;
}

const worker = {
  async fetch(request,env) {
    const url=new URL(request.url),route=url.pathname;
    if(!route.startsWith('/api/'))return env.ASSETS.fetch(request);
    try {
      if(route==='/api/auth/config'){
        only(request,'GET');
        return json({...publicAuthConfig(env),googleConfigured:configured(env)});
      }
      if(route==='/api/auth/status') {
        only(request,'GET');
        if(!configured(env))return json({configured:false,signedIn:false,message:'Google Sign-in setup is pending. The site owner must configure the Web OAuth client.'});
        requireSetup(request,env);
        if(clerkEnabled(env)){
          try {await appIdentity(request,env);} catch(error){
            if(error.status===401)return json({configured:true,signedIn:false,appSignedIn:false,provider:'clerk'});
            throw error;
          }
        }
        try {const {session}=await readSession(request,env);return json({configured:true,signedIn:true,appSignedIn:clerkEnabled(env),provider:clerkEnabled(env)?'clerk':'google',user:session.user,csrfToken:session.csrf,selection:session.selection,expiresAt:session.expiresAt});}
        catch(e){if(e.status===401)return json({configured:true,signedIn:false,appSignedIn:clerkEnabled(env),provider:clerkEnabled(env)?'clerk':'google'});throw e;}
      }
      requireSetup(request,env);
      if(route==='/api/auth/start'){only(request,'GET');return await start(request,env);}
      if(route==='/api/auth/callback'){only(request,'GET');return await callback(request,env);}
      const {session,storageKey}=await readSession(request,env);
      if(route==='/api/gtm/versions/compare'){
        only(request,'GET');
        const snapshot=await readSnapshot(request,env,session,storageKey,url.searchParams.get('snapshot'));
        if(!snapshot)throw new Problem(409,'snapshot_required','Refresh your connected gallery first.');
        const beforeId=url.searchParams.get('before'),afterId=url.searchParams.get('after');
        if(!beforeId||!afterId||beforeId===afterId)throw new Problem(400,'invalid_comparison','Select two different versions.');
        const before=await versionAudit(env,session,storageKey,snapshot,beforeId);
        const after=await versionAudit(env,session,storageKey,snapshot,afterId);
        const fresh=await readSession(request,env);
        if(!fresh.session.selection||targetKey(fresh.session.selection)!==targetKey(session.selection))throw new Problem(409,'target_changed','The selected workspace changed. Reload the gallery.');
        const label=id=>id==='workspace'?`Workspace ${session.selection.workspaceId} (captured ${snapshot.audit.meta.run_at})`:`Version ${id}`;
        const audit=GTMComparison.compare(before,after,{before:label(beforeId),after:label(afterId)});
        audit.version_browser={snapshot_id:snapshot.id,compare_url:'/api/gtm/versions/compare',versions:versionChoices(snapshot.audit),default_before:beforeId,default_after:afterId};
        return json({audit});
      }
      if(route==='/api/gtm/gallery'){
        only(request,'GET');if(!session.selection)return json({ready:false});
        const found=await readSnapshot(request,env,session,storageKey,null);
        return json(found?snapshotSummary(found.audit,found.id):{ready:false});
      }
      if(route==='/api/gtm/gallery/refresh'){
        only(request,'POST');requireCsrf(request,env,session);
        if(!session.selection)throw new Problem(409,'select_workspace','Connect a GTM workspace first.');
        const previous=await readSnapshot(request,env,session,storageKey,null);
        if(previous && Date.now()-Date.parse(previous.audit.meta.run_at)<15000)return json(snapshotSummary(previous.audit,previous.id));
        const {raw,notes,container}=await collectWorkspace(session);
        const latest=await readSession(request,env);
        if(!latest.session.selection||targetKey(latest.session.selection)!==targetKey(session.selection))throw new Problem(409,'target_changed','The workspace selection changed during collection. Refresh the current selection.');
        const audit=buildLiveAudit({...session.selection,containerName:container.name,publicId:container.publicId},raw,notes,previous?.audit);
        if(JSON.stringify(audit).length>4000000)throw new Problem(413,'snapshot_too_large','This container exceeds the interactive snapshot size limit.');
        const id=random(),key='gallery:'+storageKey+':'+id,ttl=Math.floor((session.expiresAt-Date.now())/1000);
        if(ttl<60)throw new Problem(401,'sign_in_required','Sign in again before collecting the workspace.');
        await env.GTM_SESSIONS.put(key,await seal(env,audit,key),{expirationTtl:ttl});
        const refKey='gallery-ref:'+storageKey;
        await env.GTM_SESSIONS.put(refKey,await seal(env,{id,target:targetKey(session.selection)},refKey),{expirationTtl:ttl});
        return json(snapshotSummary(audit,id));
      }
      if(route.startsWith('/api/gtm/gallery/')){
        only(request,'GET');const style=route.slice('/api/gtm/gallery/'.length).replace(/\.html$/,'')||'index';
        if(style!=='index'&&!LIVE_STYLES.includes(style))throw new Problem(404,'not_found','Unknown gallery style.');
        return await privateGallery(request,env,session,storageKey,style);
      }
      if(route==='/api/auth/logout') {
        only(request,'POST');requireCsrf(request,env,session);
        await env.GTM_SESSIONS.delete(storageKey);
        return json({signedOut:true},200,{'Set-Cookie':cookie(SESSION_COOKIE,'',0)});
      }
      if(route==='/api/gtm/accounts') {
        only(request,'GET');const rows=await list(session,'accounts','account');
        return json({accounts:rows.map(x=>({accountId:x.accountId,name:x.name||x.accountId}))});
      }
      if(route==='/api/gtm/containers') {
        only(request,'GET');const accountId=identifier(url.searchParams.get('accountId'));
        const rows=await list(session,`accounts/${accountId}/containers`,'container');
        return json({containers:rows.map(x=>({accountId:x.accountId,containerId:x.containerId,name:x.name,publicId:x.publicId,usageContext:x.usageContext}))});
      }
      if(route==='/api/gtm/workspaces') {
        only(request,'GET');const accountId=identifier(url.searchParams.get('accountId')),containerId=identifier(url.searchParams.get('containerId'));
        const rows=await list(session,`accounts/${accountId}/containers/${containerId}/workspaces`,'workspace');
        return json({workspaces:rows.map(x=>({workspaceId:x.workspaceId,name:x.name}))});
      }
      if(route==='/api/gtm/selection') {
        only(request,'POST');requireCsrf(request,env,session);
        if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Problem(415,'json_required','JSON is required.');
        const raw=await request.text();if(raw.length>2048)throw new Problem(413,'body_too_large','The request is too large.');
        let body;try{body=JSON.parse(raw);}catch{throw new Problem(400,'invalid_json','Invalid JSON.');}
        if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['accountId','containerId','workspaceId'].includes(k)))throw new Problem(400,'invalid_target','Unexpected target fields.');
        const accountId=identifier(body.accountId),containerId=identifier(body.containerId),workspaceId=identifier(body.workspaceId);
        const base=`accounts/${accountId}/containers/${containerId}`;
        const container=await gtmGet(session,base),workspace=await gtmGet(session,base+`/workspaces/${workspaceId}`);
        if(container.accountId!==accountId||container.containerId!==containerId||workspace.accountId!==accountId||workspace.containerId!==containerId||workspace.workspaceId!==workspaceId)throw new Problem(502,'target_mismatch','Google returned an unexpected target.');
        session.selection={accountId,containerId,workspaceId,containerName:container.name,publicId:container.publicId,usageContext:container.usageContext||[],workspaceName:workspace.name};
        const ttl=Math.floor((session.expiresAt-Date.now())/1000);
        if(ttl<60)throw new Problem(401,'sign_in_required','Sign in again before connecting this workspace.');
        await env.GTM_SESSIONS.put(storageKey,await seal(env,session,storageKey),{expirationTtl:ttl});
        return json({connected:true,selection:session.selection,mode:'read-only'});
      }
      throw new Problem(404,'not_found','Unknown API operation.');
    } catch(error) {
      if(error instanceof Response)return error;
      if(['app_sign_in_required','app_auth_setup_required'].includes(error.code))return json({error:{code:error.code,message:error.message}},error.status);
      // Never return Google token responses, exception stacks, secrets, or callback codes.
      return json({error:{code:error instanceof Problem?error.code:'internal_error',message:error instanceof Problem?error.message:'The request could not be completed.'}},error instanceof Problem?error.status:500);
    }
  }
};


export default {
  async fetch(request,env) {
    const response=await worker.fetch(request,env);
    const authHeaders=clerkResponseHeaders(request);
    if(!authHeaders?.has('set-cookie'))return response;
    // A completed Clerk handshake may refresh its cookies. Preserve them on
    // the same response that serves the private document, including errors.
    const headers=new Headers(response.headers);
    for(const value of authHeaders.getSetCookie())headers.append('Set-Cookie',value);
    headers.set('Cache-Control','no-store, private');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }
};
