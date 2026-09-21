import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';

import worker, { buildLiveAudit, replaceEmbeddedJson } from '../server/worker.js';
// Exercise the same request code without spending real quota-pacing time in unit tests.
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===4100?0:ms,...args);
const ORIGIN='https://gtm-command-center-96l.pages.dev';
const SCOPE='https://www.googleapis.com/auth/tagmanager.readonly';
class MemoryKV {
  values=new Map();
  async get(k){return this.values.get(k)||null;}
  async put(k,v){this.values.set(k,v);}
  async delete(k){this.values.delete(k);}
}
function env(){return {APP_ORIGIN:ORIGIN,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url'),GTM_SESSIONS:new MemoryKV(),ASSETS:{fetch:async()=>new Response('static')}};}
function req(path,options={}){return new Request(ORIGIN+path,options);}
const result=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
async function login(e,token){
  const auth=token?{Authorization:'Bearer '+token}:{};
  const start=await worker.fetch(req('/api/auth/start',{headers:auth}),e);
  assert.equal(start.status,302);
  const google=new URL(start.headers.get('Location'));
  assert.equal(google.origin,'https://accounts.google.com');
  assert.equal(google.searchParams.get('scope'),'openid email profile '+SCOPE);
  assert.equal(google.searchParams.get('access_type'),'online');
  assert.equal(google.searchParams.get('code_challenge_method'),'S256');
  const flowCookie=start.headers.get('Set-Cookie').split(';')[0];
  const savedFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.redirect,'manual','Cloudflare outbound requests must not use unsupported redirect:error');
    if(url==='https://oauth2.googleapis.com/token'){
      assert.equal(options.method,'POST');
      assert.equal(options.body.get('redirect_uri'),ORIGIN+'/api/auth/callback');
      assert.ok(options.body.get('code_verifier'));
      return result({access_token:'PRIVATE_TEST_ACCESS_TOKEN',scope:'openid email profile '+SCOPE,expires_in:3600});
    }
    if(url==='https://openidconnect.googleapis.com/v1/userinfo')return result({sub:'person-1',email:'test@example.com',name:'Test User'});
    throw Error('Unexpected outgoing URL');
  };
  let callback;
  try{callback=await worker.fetch(req('/api/auth/callback?'+new URLSearchParams({state:google.searchParams.get('state'),code:'test-code'}),{headers:{...auth,Cookie:flowCookie}}),e);}finally{globalThis.fetch=savedFetch;}
  assert.equal(callback.status,302);
  const sessionCookie=callback.headers.getSetCookie().find(c=>c.startsWith('__Host-gtm-session=')).split(';')[0];
  assert.match(callback.headers.getSetCookie().find(c=>c.startsWith('__Host-gtm-session=')),/Secure; HttpOnly; SameSite=Lax/);
  const status=await worker.fetch(req('/api/auth/status',{headers:{...auth,Cookie:sessionCookie}}),e);
  const data=await status.json();assert.equal(data.signedIn,true);assert.equal(data.user.id,'person-1');
  assert.equal(JSON.stringify(data).includes('PRIVATE_TEST_ACCESS_TOKEN'),false);
  assert.equal([...e.GTM_SESSIONS.values.values()].join('').includes('PRIVATE_TEST_ACCESS_TOKEN'),false);
  return {cookie:sessionCookie,csrf:data.csrfToken,flowCookie,state:google.searchParams.get('state')};
}

test('unconfigured sign-in fails closed; static pages still work',async()=>{
  const e=env();delete e.GOOGLE_CLIENT_SECRET;
  const status=await worker.fetch(req('/api/auth/status'),e);
  assert.deepEqual((await status.json()).configured,false);
  assert.equal((await worker.fetch(req('/api/auth/start'),e)).status,503);
  assert.equal(await (await worker.fetch(req('/'),e)).text(),'static');
});
test('unauthenticated account requests never call Google',async()=>{
  assert.equal((await worker.fetch(req('/api/gtm/accounts'),env())).status,401);
});
test('production origin is mandatory',async()=>{
  const response=await worker.fetch(new Request('https://untrusted.example/api/auth/start'),env());
  assert.equal(response.status,403);
});
test('OAuth state is bound to the initiating browser',async()=>{
  const e=env(),response=await worker.fetch(req('/api/auth/start'),e);
  const state=new URL(response.headers.get('Location')).searchParams.get('state');
  assert.equal((await worker.fetch(req('/api/auth/callback?state='+state+'&code=x'),e)).status,400);
  assert.equal((await worker.fetch(req('/api/auth/callback?state='+state+'&code=x',{headers:{Cookie:'__Host-gtm-oauth=wrong'}}),e)).status,400);
});
test('full mocked sign-in encrypts tokens and consumes OAuth state',async()=>{
  const e=env(),l=await login(e);
  assert.equal((await worker.fetch(req('/api/auth/callback?state='+l.state+'&code=x',{headers:{Cookie:l.flowCookie}}),e)).status,400);
});
test('account pagination, selection validation and method allowlist',async()=>{
  const e=env(),l=await login(e),saved=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(url);assert.equal(options.method,undefined); // GTM requests default to GET.
    if(url.endsWith('/accounts'))return result({account:[{accountId:'1',name:'First'}],nextPageToken:'two'});
    if(url.endsWith('/accounts?pageToken=two'))return result({account:[{accountId:'2',name:'Second'}]});
    if(url.endsWith('/accounts/1/containers/2'))return result({accountId:'1',containerId:'2',name:'Demo',publicId:'GTM-DEMO'});
    if(url.endsWith('/accounts/1/containers/2/workspaces/3'))return result({accountId:'1',containerId:'2',workspaceId:'3',name:'Default'});
    throw Error('Unexpected request '+url);
  };
  try{
    const list=await worker.fetch(req('/api/gtm/accounts',{headers:{Cookie:l.cookie}}),e);
    assert.equal((await list.json()).accounts.length,2);
    assert.match(list.headers.get('Cache-Control'),/no-store/);
    const headers={Cookie:l.cookie,Origin:ORIGIN,'X-CSRF-Token':l.csrf,'Content-Type':'application/json'};
    const response=await worker.fetch(req('/api/gtm/selection',{method:'POST',headers,body:JSON.stringify({accountId:'1',containerId:'2',workspaceId:'3'})}),e);
    assert.equal(response.status,200);assert.equal((await response.json()).selection.workspaceId,'3');
    assert.equal((await worker.fetch(req('/api/gtm/publish',{method:'POST',headers}),e)).status,404);
    assert.equal((await worker.fetch(req('/api/gtm/accounts',{method:'DELETE',headers}),e)).status,405);
    const status=await worker.fetch(req('/api/auth/status',{headers:{Cookie:l.cookie}}),e);
    assert.equal((await status.json()).selection.containerId,'2');
    assert.equal(calls.length,4);
  }finally{globalThis.fetch=saved;}
});
test('cross-origin POST and traversal IDs fail before any Google call',async()=>{
  const e=env(),l=await login(e),saved=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('No upstream request allowed');};
  try{
    const body=JSON.stringify({accountId:'1',containerId:'2',workspaceId:'3'});
    assert.equal((await worker.fetch(req('/api/gtm/selection',{method:'POST',headers:{Cookie:l.cookie,Origin:'https://evil.example','X-CSRF-Token':l.csrf,'Content-Type':'application/json'},body}),e)).status,403);
    assert.equal((await worker.fetch(req('/api/gtm/containers?accountId=../2',{headers:{Cookie:l.cookie}}),e)).status,400);
    assert.equal((await worker.fetch(req('/api/auth/logout',{method:'POST',headers:{Cookie:l.cookie,Origin:ORIGIN}}),e)).status,403);
  }finally{globalThis.fetch=saved;}
});
test('repeated pagination token fails, no partial success',async()=>{
  const e=env(),l=await login(e),saved=globalThis.fetch;
  globalThis.fetch=async()=>result({account:[],nextPageToken:'repeat'});
  try{assert.equal((await worker.fetch(req('/api/gtm/accounts',{headers:{Cookie:l.cookie}}),e)).status,502);}finally{globalThis.fetch=saved;}
});
test('logout removes only that session and clears its cookie',async()=>{
  const e=env(),l=await login(e);
  const response=await worker.fetch(req('/api/auth/logout',{method:'POST',headers:{Cookie:l.cookie,Origin:ORIGIN,'X-CSRF-Token':l.csrf}}),e);
  assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await worker.fetch(req('/api/gtm/accounts',{headers:{Cookie:l.cookie}}),e)).status,401);
});
test('expired sessions are rejected even when KV still contains the record',async()=>{
  const e=env(),l=await login(e),now=Date.now;
  Date.now=()=>now()+4000000;
  try{assert.equal((await worker.fetch(req('/api/gtm/accounts',{headers:{Cookie:l.cookie}}),e)).status,401);}finally{Date.now=now;}
});
test('selection cannot be saved when Google returns mismatching target IDs',async()=>{
  const e=env(),l=await login(e),saved=globalThis.fetch;
  globalThis.fetch=async()=>result({accountId:'999',containerId:'2',workspaceId:'3'});
  try{
    const response=await worker.fetch(req('/api/gtm/selection',{method:'POST',headers:{Cookie:l.cookie,Origin:ORIGIN,'X-CSRF-Token':l.csrf,'Content-Type':'application/json'},body:JSON.stringify({accountId:'1',containerId:'2',workspaceId:'3'})}),e);
    assert.equal(response.status,502);
    const status=await worker.fetch(req('/api/auth/status',{headers:{Cookie:l.cookie}}),e);
    assert.equal((await status.json()).selection,null);
  }finally{globalThis.fetch=saved;}
});
test('OAuth token redirects are rejected without forwarding credentials',async()=>{
  const e=env(),start=await worker.fetch(req('/api/auth/start'),e);
  const state=new URL(start.headers.get('Location')).searchParams.get('state');
  const flowCookie=start.headers.get('Set-Cookie').split(';')[0];
  const saved=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});
  };
  try {
    const response=await worker.fetch(req('/api/auth/callback?state='+state+'&code=private-test-code',{headers:{Cookie:flowCookie}}),e);
    assert.equal(response.status,502);
    const text=await response.text();assert.equal(JSON.parse(text).error.code,'google_redirect_rejected');
    assert.equal(text.includes('private-test-code'),false);assert.equal(text.includes('test-secret'),false);
    assert.deepEqual(calls,['https://oauth2.googleapis.com/token']);
  }finally{globalThis.fetch=saved;}
});
test('transport failures are sanitized without leaking OAuth request details',async()=>{
  const e=env(),start=await worker.fetch(req('/api/auth/start'),e);
  const state=new URL(start.headers.get('Location')).searchParams.get('state');
  const flowCookie=start.headers.get('Set-Cookie').split(';')[0],saved=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('network failure with private-test-code and test-secret');};
  try {
    const response=await worker.fetch(req('/api/auth/callback?state='+state+'&code=private-test-code',{headers:{Cookie:flowCookie}}),e);
    assert.equal(response.status,502);const text=await response.text();
    assert.equal(JSON.parse(text).error.code,'google_unavailable');
    assert.equal(text.includes('private-test-code'),false);assert.equal(text.includes('test-secret'),false);
  }finally{globalThis.fetch=saved;}
});

function privateGoogleMock(url){
  const path=new URL(url).pathname.replace('/tagmanager/v2/','');
  const features={supportClients:false,supportTransformations:false,supportZones:false};
  if(path==='accounts/1/containers/2')return result({accountId:'1',containerId:'2',name:'Private Client',publicId:'GTM-PRIVATE',features});
  if(path==='accounts/1/containers/2/workspaces/3')return result({accountId:'1',containerId:'2',workspaceId:'3',name:'Main'});
  if(path==='accounts/1/containers/2/workspaces/4')return result({accountId:'1',containerId:'2',workspaceId:'4',name:'Other'});
  if(path.endsWith('/tags'))return result({tag:[{tagId:'7',name:'Private Purchase',type:'gaawe',firingTriggerId:['2147479553'],parameter:[{key:'nested',type:'list',list:[{type:'map',map:[{key:'value',value:'{{Revenue}}'}]}]}]}]});
  if(path.endsWith('/triggers'))return result({trigger:[]});
  if(path.endsWith('/variables'))return result({variable:[{variableId:'8',name:'Revenue',type:'v',parameter:[{key:'name',value:'ecommerce.value'}]}]});
  if(path.endsWith('/built_in_variables'))return result({builtInVariable:[]});
  if(path.endsWith('/folders'))return result({folder:[]});
  if(path.endsWith('/templates'))return result({template:[{templateId:'9',name:'Private Template',templateData:'</script><script>notExecutable()</script>'+'x'.repeat(180000)}]});
  if(path.endsWith('/version_headers'))return result({containerVersionHeader:[{containerVersionId:'4',name:'Baseline',numTags:'2',numTriggers:'0',numVariables:'0'},{containerVersionId:'5',name:'Release',numTags:'2',numTriggers:'0',numVariables:'0'}]});
  throw Error('Unexpected GTM request '+path);
}
async function choose(e,l,workspaceId='3'){
  return worker.fetch(req('/api/gtm/selection',{method:'POST',headers:{Cookie:l.cookie,Origin:ORIGIN,'X-CSRF-Token':l.csrf,'Content-Type':'application/json'},body:JSON.stringify({accountId:'1',containerId:'2',workspaceId})}),e);
}
test('private gallery uses selected real data; classic views and Atlas are isolated and non-cacheable',async()=>{
  const e=env(),l=await login(e),other=await login(e),saved=globalThis.fetch;
  e.ASSETS.fetch=async request=>{
    const file=new URL(request.url).pathname.split('/').pop();
    return new Response(await readFile(new URL('../docs/style-gallery/'+file,import.meta.url),'utf8'));
  };
  globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');return privateGoogleMock(url);};
  try{
    assert.equal((await choose(e,l)).status,200);
    const headers={Cookie:l.cookie,Origin:ORIGIN,'X-CSRF-Token':l.csrf};
    const response=await worker.fetch(req('/api/gtm/gallery/refresh',{method:'POST',headers}),e);
    assert.equal(response.status,200);const meta=await response.json();
    assert.equal(meta.ready,true);assert.equal(meta.counts.tag,1);assert.equal(meta.counts.trigger,1);
    assert.equal([...e.GTM_SESSIONS.values.values()].join('').includes('Private Purchase'),false);
    const query='?snapshot='+meta.snapshotId;
    for(const style of ['structured-2d','structured-3d','axonometric-2d','axonometric-3d','spatial-2d','spatial-3d','utility-2d','utility-3d','explorer']){
      const page=await worker.fetch(req('/api/gtm/gallery/'+style+'.html'+query,{headers:{Cookie:l.cookie}}),e);
      assert.equal(page.status,200);assert.match(page.headers.get('Cache-Control'),/no-store/);
      const text=await page.text();assert.ok(text.includes('Private Purchase'));assert.ok(!text.includes('Northstar Demo'));assert.ok(!text.includes('PRIVATE_TEST_ACCESS_TOKEN'));assert.ok(!text.includes('</script><script>notExecutable()'));
      assert.equal((await worker.fetch(req('/api/gtm/gallery/'+style+'.html'+query),e)).status,401);
      assert.equal((await worker.fetch(req('/api/gtm/gallery/'+style+'.html'+query,{headers:{Cookie:other.cookie}}),e)).status,409);
    }
    const index=await worker.fetch(req('/api/gtm/gallery/index.html'+query,{headers:{Cookie:l.cookie}}),e);
    const indexText=await index.text();
    assert.ok(indexText.includes('/api/gtm/gallery/utility-3d.html?snapshot='));
    assert.ok(indexText.includes('/api/gtm/gallery/explorer.html?snapshot='));
    assert.equal((await worker.fetch(req('/api/gtm/gallery/index.html'+query),e)).status,401);
    await choose(e,other);
    assert.equal((await worker.fetch(req('/api/gtm/gallery/index.html'+query,{headers:{Cookie:other.cookie}}),e)).status,409);
    await choose(e,l,'4');
    assert.equal((await worker.fetch(req('/api/gtm/gallery/index.html'+query,{headers:{Cookie:l.cookie}}),e)).status,409);
    const current=await worker.fetch(req('/api/gtm/gallery',{headers:{Cookie:l.cookie}}),e);assert.equal((await current.json()).ready,false);
  }finally{globalThis.fetch=saved;}
});
test('snapshot collection requires CSRF and core read failures never create a partial gallery',async()=>{
  const e=env(),l=await login(e),saved=globalThis.fetch;
  globalThis.fetch=async url=>privateGoogleMock(url);
  try{
    await choose(e,l);
    assert.equal((await worker.fetch(req('/api/gtm/gallery/refresh',{method:'POST',headers:{Cookie:l.cookie}}),e)).status,403);
    globalThis.fetch=async url=>url.endsWith('/tags')?result({},403):privateGoogleMock(url);
    assert.equal((await worker.fetch(req('/api/gtm/gallery/refresh',{method:'POST',headers:{Cookie:l.cookie,Origin:ORIGIN,'X-CSRF-Token':l.csrf}}),e)).status,403);
    assert.equal([...e.GTM_SESSIONS.values.keys()].some(k=>k.startsWith('gallery:')),false);
  }finally{globalThis.fetch=saved;}
});
test('live audit preserves raw data, indexes nested parameters and does not invent scores',()=>{
  const selection={accountId:'1',containerId:'2',workspaceId:'3',containerName:'Private'};
  const raw={tags:[{tagId:'1',name:'Revenue tag',firingTriggerId:['2147479553'],parameter:[{type:'list',list:[{type:'map',map:[{key:'revenue',value:'{{Revenue}}'}]}]}]}],variables:[{variableId:'2',name:'Revenue'}],versions:[]};
  const original=JSON.stringify(raw),audit=buildLiveAudit(selection,raw);
  assert.equal(JSON.stringify(raw),original);assert.deepEqual(audit.dimensions,[]);assert.equal(audit.meta.overall_pct,null);
  assert.ok(audit.edges.some(e=>e.to==='variable:2'));assert.ok(audit.edges.some(e=>e.to==='trigger:2147479553'));assert.equal(audit.parameter_inventory[0].key,'revenue');
  const newRaw=structuredClone(raw);newRaw.tags[0].name='Renamed';
  const next=buildLiveAudit(selection,newRaw,[],audit);assert.equal(next.drift.available,true);assert.equal(next.drift.modified.length,1);
});
test('full-version comparisons are scoped, cached and show actual changes instead of count deltas',async()=>{
  const e=env(),l=await login(e),other=await login(e),saved=globalThis.fetch,versionCalls=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.redirect,'manual');assert.equal(options.method,undefined);
    if(url.endsWith('/versions/4')){versionCalls.push('4');return result({accountId:'1',containerId:'2',containerVersionId:'4',tag:[{tagId:'1',name:'Before',fingerprint:'old'},{tagId:'2',name:'Removed'}]});}
    if(url.endsWith('/versions/5')){versionCalls.push('5');return result({accountId:'1',containerId:'2',containerVersionId:'5',tag:[{tagId:'1',name:'After',fingerprint:'new'},{tagId:'3',name:'Added'}]});}
    return privateGoogleMock(url);
  };
  try{
    await choose(e,l);await choose(e,other);
    const capture=await worker.fetch(req('/api/gtm/gallery/refresh',{method:'POST',headers:{Cookie:l.cookie,Origin:ORIGIN,'X-CSRF-Token':l.csrf}}),e),snapshot=(await capture.json()).snapshotId;
    const path='/api/gtm/versions/compare?'+new URLSearchParams({snapshot,before:'4',after:'5'});
    const response=await worker.fetch(req(path,{headers:{Cookie:l.cookie}}),e);
    assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);
    const data=await response.json();assert.equal(data.audit.drift.added.length,1);assert.equal(data.audit.drift.removed.length,1);assert.equal(data.audit.drift.modified.length,1);assert.equal(data.audit.drift.modified[0].changes[0].path,'$.name');
    assert.deepEqual(versionCalls,['4','5']);
    assert.equal((await worker.fetch(req(path,{headers:{Cookie:l.cookie}}),e)).status,200);assert.deepEqual(versionCalls,['4','5']);
    assert.equal((await worker.fetch(req(path,{headers:{Cookie:other.cookie}}),e)).status,409);
    assert.equal((await worker.fetch(req(path.replace('before=4','before=999'),{headers:{Cookie:l.cookie}}),e)).status,400);
    assert.equal((await worker.fetch(req(path),e)).status,401);
  }finally{globalThis.fetch=saved;}
});


const clerkKeys=generateKeyPairSync('rsa',{modulusLength:2048});
const clerkHost='test-auth.clerk.accounts.dev';
function clerkEnv(){return {...env(),AUTH_PROVIDER:'clerk',CLERK_SECRET_KEY:'sk_test_fixture',CLERK_PUBLISHABLE_KEY:'pk_test_'+Buffer.from(clerkHost+'$').toString('base64'),CLERK_JWT_KEY:clerkKeys.publicKey.export({type:'spki',format:'pem'})};}
function clerkToken(claims={}){
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'test-key'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:'https://'+clerkHost,sub:'user_alice',sid:'sess_alice',azp:ORIGIN,iat:now,nbf:now-5,exp:now+60,v:2,sts:'active',...claims})).toString('base64url');
  const body=header+'.'+payload;
  return body+'.'+sign('RSA-SHA256',Buffer.from(body),clerkKeys.privateKey).toString('base64url');
}
test('public Clerk config exposes only the publishable key',async()=>{
  const e=clerkEnv();e.CLERK_SECRET_KEY='sk_test_DO_NOT_EXPOSE';
  const response=await worker.fetch(req('/api/auth/config'),e),body=await response.text();
  assert.equal(response.status,200);assert.equal(JSON.parse(body).provider,'clerk');
  assert.equal(JSON.parse(body).configured,true);assert.ok(!body.includes('DO_NOT_EXPOSE'));assert.ok(!body.includes('BEGIN PUBLIC KEY'));
});
test('Clerk mode fails closed with missing keys, even with a valid legacy Google session',async()=>{
  const e=env(),l=await login(e);e.AUTH_PROVIDER='clerk';
  const response=await worker.fetch(req('/api/gtm/accounts',{headers:{Cookie:l.cookie}}),e);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error.code,'app_auth_setup_required');
});
test('real signed Clerk JWT is required before Google OAuth begins',async()=>{
  const e=clerkEnv();
  assert.equal((await worker.fetch(req('/api/auth/start'),e)).status,401);
  for(const token of ['invalid.jwt.token',clerkToken({exp:1}),clerkToken({azp:'https://evil.example'})]){
    assert.equal((await worker.fetch(req('/api/auth/start',{headers:{Authorization:'Bearer '+token}}),e)).status,401);
  }
  assert.equal((await worker.fetch(req('/api/auth/start',{headers:{Authorization:'Bearer '+clerkToken()}}),e)).status,302);
});
test('Clerk user and session are both bound to the Google connection; logout invalidates it',async()=>{
  const e=clerkEnv(),token=clerkToken(),l=await login(e,token);
  const status=await worker.fetch(req('/api/auth/status',{headers:{Cookie:l.cookie,Authorization:'Bearer '+token}}),e);
  const data=await status.json();assert.equal(data.appSignedIn,true);assert.equal(data.signedIn,true);
  for(const badToken of [clerkToken({sub:'user_bob',sid:'sess_bob'}),clerkToken({sid:'sess_alice_new'}),null]){
    const headers={Cookie:l.cookie,...(badToken?{Authorization:'Bearer '+badToken}:{})};
    assert.equal((await worker.fetch(req('/api/gtm/accounts',{headers}),e)).status,401);
    assert.equal((await worker.fetch(req('/api/gtm/gallery/explorer.html',{headers}),e)).status,401);
  }
  const headers={Cookie:l.cookie,Authorization:'Bearer '+token,Origin:ORIGIN,'X-CSRF-Token':l.csrf};
  assert.equal((await worker.fetch(req('/api/auth/logout',{method:'POST',headers}),e)).status,200);
  assert.equal((await worker.fetch(req('/api/gtm/accounts',{headers}),e)).status,401);
});
test('OAuth callback rejects an account switch before exchanging the Google code',async()=>{
  const e=clerkEnv(),start=await worker.fetch(req('/api/auth/start',{headers:{Authorization:'Bearer '+clerkToken()}}),e);
  const state=new URL(start.headers.get('Location')).searchParams.get('state');
  const flowCookie=start.headers.get('Set-Cookie').split(';')[0];
  const saved=globalThis.fetch;globalThis.fetch=async()=>{assert.fail('Must not exchange a code after account switching');};
  try{
    const response=await worker.fetch(req('/api/auth/callback?state='+state+'&code=private',{headers:{Cookie:flowCookie,Authorization:'Bearer '+clerkToken({sub:'user_bob'})}}),e);
    assert.equal(response.status,401);assert.equal((await response.json()).error.code,'connection_owner_mismatch');
  }finally{globalThis.fetch=saved;}
});
test('Clerk cookie authentication works for private document requests',async()=>{
  const e=clerkEnv(),token=clerkToken(),l=await login(e,token);
  const response=await worker.fetch(req('/api/auth/status',{headers:{Cookie:l.cookie+'; __client_uat=1; __clerk_db_jwt=test-browser; __session='+token}}),e);
  assert.equal((await response.json()).signedIn,true);
});
test('enabling Clerk invalidates unbound legacy sessions without importing them',async()=>{
  const e=env(),l=await login(e);Object.assign(e,{...clerkEnv(),GTM_SESSIONS:e.GTM_SESSIONS});
  const response=await worker.fetch(req('/api/gtm/accounts',{headers:{Cookie:l.cookie,Authorization:'Bearer '+clerkToken()}}),e);
  assert.equal(response.status,401);assert.equal((await response.json()).error.code,'connection_owner_mismatch');
});

test('unknown auth provider never downgrades to Google-only access',async()=>{
  const e=env(),l=await login(e);e.AUTH_PROVIDER='clrek';
  assert.equal((await worker.fetch(req('/api/gtm/accounts',{headers:{Cookie:l.cookie}}),e)).status,503);
});
test('bundled Worker retains auth configuration and denies unauthenticated private requests',async()=>{
  const {default:built}=await import('../docs/_worker.js');
  const e=clerkEnv();
  assert.equal((await (await built.fetch(req('/api/auth/config'),e)).json()).provider,'clerk');
  assert.equal((await built.fetch(req('/api/gtm/accounts'),e)).status,401);
});
