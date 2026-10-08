import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../dashboard/', import.meta.url));
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
export async function startDashboard({ getReport, port = 3210, now = Date.now, onControl } = {}) {
 const controlToken = randomBytes(32).toString('hex');
 const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  const activePort = server.address()?.port;
  if (!['127.0.0.1:' + activePort, 'localhost:' + activePort].includes(request.headers.host)) { response.writeHead(403); response.end('Acesso local necessário.'); return; }
  try {
   const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
   if (pathname === '/api/control' && request.method === 'POST' && onControl) {
    const supplied = Buffer.from(String(request.headers['x-control-token'] || ''));
    if (request.headers.origin !== 'http://' + request.headers.host || supplied.length !== controlToken.length || !timingSafeEqual(supplied, Buffer.from(controlToken))) { response.writeHead(403); response.end(); return; }
    let body = '', size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 4096) { response.writeHead(413); response.end(); return; } body += chunk.toString(); }
    let result;
    try { const patch = JSON.parse(body); if (!patch || Array.isArray(patch) || typeof patch !== 'object') throw Error(); result = await onControl(patch); }
    catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Não foi possível aplicar. Confira os valores e o arquivo de controle.' })); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
   }
   if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
   if (pathname === '/api/report') {
    const report = await getReport();
    const payload = JSON.stringify({ ...report, serverTime: now(), stale: report.heartbeatAt ? now() - report.heartbeatAt > 30000 : false, controlsEnabled: Boolean(onControl), ...(onControl ? { controlToken } : {}) });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(request.method === 'HEAD' ? undefined : payload); return;
   }
   if (!assets.has(pathname)) { response.writeHead(404); response.end(); return; }
   const [file, contentType] = assets.get(pathname); const bytes = await fs.readFile(path.join(directory, file));
   response.writeHead(200, { 'Content-Type': contentType }); response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Relatório temporariamente indisponível.' })); }
 });
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
 return { url: 'http://127.0.0.1:' + server.address().port, stop: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
