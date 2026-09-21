import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('docs');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__responsive') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(await readFile('tests/responsive.html'));
      return;
    }
    if (url.pathname === '/api/auth/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({provider:'google',googleConfigured:false}));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(url.pathname === '/api/auth/status' ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(url.pathname === '/api/auth/status' ? { configured: false, signedIn: false } : { error: { message: 'Private GTM connections are available on the production site.' } }));
      return;
    }
    if (url.pathname.split('/').some(part=>part.startsWith('_')||part.startsWith('.'))) throw new Error('Private build file');
    let file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep) && file !== root) throw new Error('Invalid path');
    if ((await stat(file).catch(() => null))?.isDirectory()) file += '/index.html';
    if (!(await stat(file).catch(() => null))) file += '.html';
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`GTM Command Center: http://127.0.0.1:${process.env.PORT || 4173}/auth/`));
