import { initializeAuth } from './auth/client.js';
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let appAuth = null;
  let csrfToken = '', generation = 0, galleryGeneration = 0, connectedTarget = null, galleryBusy = false;
  function status(message,error=false){$('google-status').textContent=message;$('google-status').dataset.error=String(error);}
  function empty(id,label){const node=$(id);node.replaceChildren(new Option(label,''));node.disabled=true;}
  function options(id,rows,key,label){const node=$(id);for(const row of rows)node.add(new Option(label(row),row[key]));node.disabled=rows.length===0;}
  function selection(value){connectedTarget=value;$('google-selection').hidden=!value;$('gallery-refresh').hidden=!value;if(value)$('google-selection').textContent=`Connected (read-only): ${value.containerName} · ${value.publicId||value.containerId} · ${value.workspaceName} — account ${value.accountId}, container ${value.containerId}, workspace ${value.workspaceId}. Your session's gallery uses this workspace.`;}
  function demoGallery(){galleryGeneration++;galleryBusy=false;$('gallery-refresh').disabled=false;$('gallery-frame').src='/style-gallery/explorer.html#district';$('gallery-frame').hidden=false;$('gallery-open').href='/style-gallery/explorer.html#flow';$('gallery-open').hidden=false;$('atlas-open').href='/style-gallery/explorer.html#district';$('atlas-open').hidden=false;$('gallery-status').textContent='Demo data · Northstar — sign in and connect a workspace to see your private GTM data.';}
  async function loadGallery(force=false){
    if(!connectedTarget){demoGallery();return;}
    const ticket=++galleryGeneration;galleryBusy=true;
    $('gallery-frame').src='about:blank';$('gallery-frame').hidden=true;$('gallery-open').hidden=true;$('atlas-open').hidden=true;$('gallery-refresh').disabled=true;
    $('gallery-status').textContent=`Loading ${connectedTarget.containerName} from GTM… Reads are paced for Google's API quota and may take about a minute.`;
    try{
      let data=force?{ready:false}:await api('/api/gtm/gallery');
      if(!data.ready)data=await api('/api/gtm/gallery/refresh',{});
      if(ticket!==galleryGeneration)return;
      const path='/api/gtm/gallery/explorer.html?snapshot='+encodeURIComponent(data.snapshotId);
      $('gallery-frame').title=`GTM Audit Pro · ${data.selection.containerName} — private workspace snapshot`;
      $('gallery-frame').src=path;$('gallery-frame').hidden=false;$('gallery-open').href=path+'#flow';$('gallery-open').hidden=false;
      $('atlas-open').href='/api/gtm/gallery/explorer.html?snapshot='+encodeURIComponent(data.snapshotId)+'#district';$('atlas-open').hidden=false;
      $('gallery-status').textContent=`Private GTM snapshot · ${data.selection.containerName} (${data.selection.publicId||data.selection.containerId}), workspace ${data.selection.workspaceId} · captured ${new Date(data.capturedAt).toLocaleString()} · ${data.counts.tag||0} tags, ${data.counts.trigger||0} triggers, ${data.counts.variable||0} variables. Scores are unassessed; click Refresh from GTM for newer data.`;
    }catch(error){if(ticket===galleryGeneration)$('gallery-status').textContent=`Live gallery unavailable: ${error.message} No demo data is being substituted. Use Refresh from GTM to retry.`;}
    finally{if(ticket===galleryGeneration){galleryBusy=false;$('gallery-refresh').disabled=false;}}
  }
  async function api(path,body){
    const token=appAuth?.clerk?.session?await appAuth.clerk.session.getToken():null;
    const headers={...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json','X-CSRF-Token':csrfToken}:{})};
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers,body:body?JSON.stringify(body):undefined});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error?.message||'The connection request failed.');error.status=response.status;throw error;}
    return data;
  }
  async function refresh(){
    const ticket=++generation;
    try {
      appAuth=await initializeAuth();
      const data=await api('/api/auth/status');
      if(ticket!==generation)return;
      $('google-signin').textContent=appAuth.clerk?.user?'Connect Google Tag Manager':'Continue to sign in';
      $('google-signin').disabled=!data.configured;$('google-setup').hidden=data.configured;
      $('google-signin').hidden=!!data.signedIn;$('google-signout').hidden=!data.signedIn;$('gtm-picker').hidden=!data.signedIn;
      if(!data.configured){selection(null);demoGallery();status('Google connection is not available right now. You can still explore the demo.');return;}
      if(!data.signedIn){csrfToken='';$('google-user').textContent='';selection(null);demoGallery();status(data.appSignedIn?'You’re signed in. Connect Google to choose a GTM workspace.':'Sign in to connect your workspace. Access is read-only.');return;}
      csrfToken=data.csrfToken;
      $('google-user').textContent=`Signed in as ${data.user.name||data.user.email} (${data.user.email})`;
      selection(data.selection);status('Loading your accessible GTM accounts…');
      if(data.selection)await loadGallery(false);else demoGallery();
      const result=await api('/api/gtm/accounts');if(ticket!==generation)return;empty('gtm-account','Choose an account');
      options('gtm-account',result.accounts,'accountId',x=>`${x.name} (${x.accountId})`);
      status(result.accounts.length?'Choose the GTM account you want to connect.':'This Google account has no accessible GTM accounts. Ask the GTM owner to grant read access, or sign in with another account.');
    } catch(error){if(ticket!==generation)return;csrfToken='';selection(null);demoGallery();$('gtm-picker').hidden=true;$('google-signin').hidden=false;$('google-signin').disabled=false;status(error.message,true);}
  }
  $('google-signin').addEventListener('click',()=>location.assign(appAuth?.clerk?.user?'/api/auth/start':'/auth/'));
  $('google-signout').addEventListener('click',async()=>{
    $('google-signout').disabled=true;
    generation++;galleryGeneration++;$('gallery-frame').src='about:blank';$('gallery-frame').hidden=true;$('gallery-open').hidden=true;$('atlas-open').hidden=true;$('gtm-picker').hidden=true;
    try{try{await api('/api/auth/logout',{});}catch(error){if(error.status!==401)throw error;}generation++;empty('gtm-account','Choose an account');empty('gtm-container','Choose a container');empty('gtm-workspace','Choose a workspace');$('gtm-connect').disabled=true;await refresh();}
    catch(error){status(error.message,true);}finally{$('google-signout').disabled=false;}
  });
  $('gtm-account').addEventListener('change',async()=>{
    const current=++generation,id=$('gtm-account').value;
    empty('gtm-container','Choose a container');empty('gtm-workspace','Choose a workspace');$('gtm-connect').disabled=true;
    if(!id)return;status('Loading containers…');
    try{const data=await api('/api/gtm/containers?accountId='+encodeURIComponent(id));if(current!==generation)return;options('gtm-container',data.containers,'containerId',x=>`${x.name} · ${x.publicId||x.containerId}`);status(data.containers.length?'Choose a container.':'No accessible containers in this account.');}catch(error){if(current===generation)status(error.message,true);}
  });
  $('gtm-container').addEventListener('change',async()=>{
    const current=++generation,account=$('gtm-account').value,container=$('gtm-container').value;
    empty('gtm-workspace','Choose a workspace');$('gtm-connect').disabled=true;if(!container)return;
    status('Loading workspaces…');
    try{const data=await api('/api/gtm/workspaces?'+new URLSearchParams({accountId:account,containerId:container}));if(current!==generation)return;options('gtm-workspace',data.workspaces,'workspaceId',x=>`${x.name} (${x.workspaceId})`);status(data.workspaces.length?'Choose a workspace, then connect.':'No accessible workspaces.');}catch(error){if(current===generation)status(error.message,true);}
  });
  $('gtm-workspace').addEventListener('change',()=>{$('gtm-connect').disabled=!$('gtm-workspace').value;});
  $('gtm-picker').addEventListener('submit',async event=>{
    event.preventDefault();$('gtm-connect').disabled=true;
    const current=generation;
    try{const data=await api('/api/gtm/selection',{accountId:$('gtm-account').value,containerId:$('gtm-container').value,workspaceId:$('gtm-workspace').value});if(current!==generation)return;selection(data.selection);status('Workspace connected. Loading its private gallery… No GTM configuration was changed.');await loadGallery(true);}
    catch(error){status(error.message,true);}finally{if(current===generation)$('gtm-connect').disabled=!$('gtm-workspace').value;}
  });
  $('gallery-refresh').addEventListener('click',()=>{if(!galleryBusy)loadGallery(true);});
  // Strip OAuth outcome parameters from the visible address; never store tokens here.
  const url=new URL(location.href);
  const cancelled=url.searchParams.get('gtm_auth')==='cancelled';
  if(url.searchParams.has('gtm_auth')){url.searchParams.delete('gtm_auth');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  refresh().then(()=>{if(cancelled)status('Google connection was cancelled. Try again whenever you’re ready.');});
})();
