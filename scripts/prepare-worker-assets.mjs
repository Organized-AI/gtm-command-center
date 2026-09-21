import { cp, mkdir, readdir, rm } from 'node:fs/promises';

// Bundle server code separately; never publish it as a static asset.
await rm('worker-assets', { recursive: true, force: true });
await mkdir('worker-assets', { recursive: true });
for (const entry of await readdir('docs', { withFileTypes: true })) {
  if (['_worker.js', '_routes.json'].includes(entry.name)) continue;
  await cp(`docs/${entry.name}`, `worker-assets/${entry.name}`, { recursive: true });
}
console.log('Prepared gtmcc Worker assets; server bundle stays separate.');
