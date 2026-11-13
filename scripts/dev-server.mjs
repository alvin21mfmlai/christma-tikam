// Local preview: `npm run dev` → http://localhost:3000
// Serves the pages and runs the /api functions the way Vercel does.
// Without Redis credentials it uses an in-memory store (reset on restart).
// ADMIN_PASSWORD defaults to "admin" here only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.ADMIN_PASSWORD ||= 'admin';
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const api = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
    if (api) {
      const mod = await import(pathToFileURL(join(root, 'api', api[1] + '.js')).href);
      return await mod.default(req, res);
    }
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!extname(p)) p += '.html'; // cleanUrls, like vercel.json
    const file = normalize(join(root, p));
    if (!file.startsWith(root) || /\/(lib|api|scripts)\//.test(file)) throw Object.assign(new Error(), { code: 'ENOENT' });
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' || e.code === 'ERR_MODULE_NOT_FOUND' ? 'Not found' : String(e));
  }
}).listen(PORT, () => {
  const redis = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  console.log(`Lucky draw running at http://localhost:${PORT}  (admin: /admin, storage: ${redis ? 'Upstash Redis' : 'in-memory'})`);
});
