(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let snapshot = null, dimension = '3d', view = 'container';
  let savedPair = null;
  const frame = $('research-frame');

  function blank(message) {
    snapshot = null; savedPair = null;
    frame.src = 'about:blank'; frame.hidden = true;
    $('research-status').textContent = message;
    $('research-meta').textContent = 'No workspace snapshot loaded';
    $('research-open').hidden = true;
    $('research-connect').hidden = false;
    $('research-counts').textContent = 'Connect a workspace to inspect its actual configuration.';
    $('research-evidence').textContent = 'Not assessed — no experiment test results are attached.';
    document.querySelectorAll('[data-research-view],[data-research-dimension]').forEach(button => {button.disabled = true;});
  }

  function capturePair() {
    try {
      const doc = frame.contentDocument;
      const before = doc?.getElementById('version-before');
      const after = doc?.getElementById('version-after');
      if (before && after) savedPair = {before: before.value, after: after.value};
    } catch { /* A navigating iframe has no readable document yet. */ }
  }

  function setView() {
    document.querySelectorAll('[data-research-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.researchView === view));
    });
    const doc = frame.contentDocument;
    if (!doc || !snapshot) return;
    if (view === 'versions') {
      const button = doc.querySelector('.versions-tab');
      if (button && button.getAttribute('aria-pressed') !== 'true') button.click();
    } else {
      const mode = view === 'drift' ? 'drift' : 'architecture';
      doc.querySelector(`[data-mode="${mode}"]`)?.click();
      // The two-dimensional renderer calls its main mode "container".
      if (!doc.querySelector(`[data-mode="${mode}"]`) && view === 'container') {
        doc.querySelector('[data-mode="current"],[data-mode="container"],[data-view="container"],[data-view="architecture"]')?.click();
      }
    }
  }

  function loadView(rememberPair = true) {
    if (!snapshot) return;
    if (rememberPair) capturePair();
    const path = `/api/gtm/gallery/structured-${dimension}.html?snapshot=${encodeURIComponent(snapshot.snapshotId)}`;
    frame.hidden = false;
    frame.title = `${snapshot.selection.containerName} · Autoresearch · ${dimension.toUpperCase()}`;
    frame.src = path;
    $('research-open').href = path;
    $('research-open').hidden = false;
    document.querySelectorAll('[data-research-dimension]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.researchDimension === dimension));
    });
  }

  frame.addEventListener('load', () => {
    if (!snapshot || frame.getAttribute('src') === 'about:blank') return;
    const doc = frame.contentDocument;
    if (!doc || doc.URL === 'about:blank') return;
    if (!doc?.querySelector('#app')) {
      frame.hidden = true;
      $('research-status').textContent = 'Workspace view unavailable. Your session may have expired; reconnect or refresh from GTM.';
      $('research-open').hidden = true;
      $('research-connect').hidden = false;
      return;
    }
    frame.hidden = false;
    $('research-status').textContent = 'Real GTM data · private workspace snapshot';
    $('research-open').hidden = false;
    $('research-connect').hidden = true;
    if (savedPair) {
      for (const key of ['before', 'after']) {
        const select = doc.getElementById(`version-${key}`);
        if (select && Array.from(select.options).some(option => option.value === savedPair[key])) select.value = savedPair[key];
      }
    }
    setView();
  });

  document.querySelectorAll('[data-research-dimension]').forEach(button => {
    button.addEventListener('click', () => {
      dimension = button.dataset.researchDimension;
      loadView();
    });
  });
  document.querySelectorAll('[data-research-view]').forEach(button => {
    button.addEventListener('click', () => {
      view = button.dataset.researchView;
      capturePair(); setView();
    });
  });

  window.addEventListener('gtm-workspace-snapshot', event => {
    const {state, data, message} = event.detail;
    if (state !== 'ready') {
      blank(message || 'Connect a GTM workspace to begin.');
      if (state === 'loading') $('research-connect').hidden = true;
      return;
    }
    if (!data?.snapshotId || !data.selection) {blank('The workspace snapshot is incomplete. Refresh from GTM to retry.');return;}
    if (snapshot?.snapshotId !== data.snapshotId) savedPair = null;
    // Clear the previous document before assigning the new workspace, so an old
    // version pair cannot be carried into a different container.
    frame.src = 'about:blank';
    snapshot = data;
    document.querySelectorAll('[data-research-view],[data-research-dimension]').forEach(button => {button.disabled = false;});
    $('research-status').textContent = 'Real GTM data · private workspace snapshot';
    const captured = new Date(data.capturedAt);
    $('research-meta').textContent = `${data.selection.containerName} · ${data.selection.workspaceName || 'Workspace ' + data.selection.workspaceId} · ${Number.isNaN(captured.getTime()) ? 'Capture time unavailable' : captured.toLocaleString()}`;
    $('research-counts').textContent = `${data.counts?.tag || 0} tags · ${data.counts?.trigger || 0} triggers · ${data.counts?.variable || 0} variables`;
    $('research-connect').hidden = true;
    loadView(false);
  });
  blank('Sign in and connect a workspace below. Your container will appear here automatically.');
})();
