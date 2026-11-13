import { createHash, timingSafeEqual } from 'node:crypto';
import { ConfigError } from './store.js';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  // Vercel pre-parses JSON bodies into req.body; the local dev server doesn't.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body)); } catch { return {}; }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 10_000) break;
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function handleError(res, err) {
  if (err instanceof HttpError) return send(res, err.status, { error: err.message });
  if (err instanceof ConfigError) return send(res, 503, { error: err.message });
  console.error(err);
  return send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
}

const sha = (s) => createHash('sha256').update(String(s)).digest();

export function checkAdmin(req) {
  const expected = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
  if (!expected) return { ok: false, status: 503, error: 'ADMIN_PASSWORD is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.' };
  const given = req.headers['x-admin-password'] || '';
  if (!timingSafeEqual(sha(given), sha(expected))) return { ok: false, status: 401, error: 'Wrong password.' };
  return { ok: true };
}
