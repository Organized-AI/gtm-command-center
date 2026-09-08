const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture() {
  class Element extends EventTarget {
    constructor() { super(); this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.contentDocument = null; this.value = ''; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return key === 'src' ? this.src : this.attributes[key]; }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const dims = ['2d', '3d'].map(value => Object.assign(new Element(), {dataset: {researchDimension: value}}));
  const views = ['container', 'versions', 'drift'].map(value => Object.assign(new Element(), {dataset: {researchView: value}}));
  const window = new EventTarget();
  const document = {getElementById: get, querySelectorAll: selector => selector.includes(',') ? [...dims, ...views] : selector.includes('dimension') ? dims : views};
  vm.runInNewContext(fs.readFileSync('docs/autoresearch.js', 'utf8'), {window, document, URL, Date, Array, String, Number, encodeURIComponent});
  const emit = detail => { const event = new Event('gtm-workspace-snapshot'); event.detail = detail; window.dispatchEvent(event); };
  const ready = (id = 'snapshot-1', name = 'Real workspace') => emit({state: 'ready', data: {snapshotId: id, selection: {containerName: name, workspaceId: '4'}, counts: {tag: 17, trigger: 8, variable: 12}, capturedAt: '2026-09-08T12:00:00Z'}});
  return {get, dims, views, emit, ready};
}

test('no connected data is represented as a scored experiment', () => {
  const f = fixture();
  assert.ok(f.get('research-frame').hidden);
  assert.ok([...f.dims, ...f.views].every(button => button.disabled));
  assert.match(f.get('research-evidence').textContent, /Not assessed/);
});

test('real snapshot uses authenticated routes and dimensions retain snapshot identity', () => {
  const f = fixture(); f.ready('snapshot & private');
  assert.equal(f.get('research-frame').src, '/api/gtm/gallery/structured-3d.html?snapshot=snapshot%20%26%20private');
  assert.equal(f.get('research-counts').textContent, '17 tags · 8 triggers · 12 variables');
  f.dims[0].click();
  assert.equal(f.get('research-frame').src, '/api/gtm/gallery/structured-2d.html?snapshot=snapshot%20%26%20private');
  assert.match(f.get('research-evidence').textContent, /Not assessed/);
});

test('sign-out, failed refresh, and loading clear previous private content', () => {
  for (const state of ['empty', 'error', 'loading']) {
    const f = fixture(); f.ready(); f.emit({state, message: 'Unavailable'});
    assert.equal(f.get('research-frame').src, 'about:blank');
    assert.ok(f.get('research-frame').hidden);
    assert.ok(f.get('research-open').hidden);
    assert.ok([...f.dims, ...f.views].every(button => button.disabled));
    assert.equal(f.get('research-status').textContent, 'Unavailable');
  }
});

test('malformed snapshot fails closed and names are assigned as text', () => {
  const f = fixture(); f.ready('valid', '<img src=x onerror=alert(1)>');
  assert.match(f.get('research-meta').textContent, /<img/);
  assert.equal(f.get('research-meta').innerHTML, undefined);
  f.emit({state: 'ready', data: {snapshotId: 'incomplete'}});
  assert.ok(f.get('research-frame').hidden);
});

test('an expired authenticated iframe hides content and offers reconnection', () => {
  const f = fixture(); f.ready();
  f.get('research-frame').contentDocument = {querySelector: () => null};
  f.get('research-frame').dispatchEvent(new Event('load'));
  assert.ok(f.get('research-frame').hidden);
  assert.ok(f.get('research-open').hidden);
  assert.equal(f.get('research-connect').hidden, false);
  assert.match(f.get('research-status').textContent, /expired/);
});
