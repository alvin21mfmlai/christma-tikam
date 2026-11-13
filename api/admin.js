// GET  /api/admin                       — full results (password required)
// POST /api/admin { action, name? }     — open | close | schedule | release | reset
// The password travels in the X-Admin-Password header.
import { EVENT, PARTICIPANTS, SITE_MODE, opensAtMs, scheduledOpen } from '../lib/config.js';
import { getStore, remainingNumbers, isOpen, keyPrefix } from '../lib/store.js';
import { send, readJson, handleError, checkAdmin } from '../lib/http.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapshot(store) {
  const s = await store.state();
  const known = new Set(PARTICIPANTS);
  const opensAt = opensAtMs();
  return {
    event: EVENT,
    siteMode: SITE_MODE,
    storage: store.kind,
    keyPrefix: keyPrefix(),
    hostMode: s.mode, // auto = follow schedule | open | closed
    open: isOpen(s.mode, scheduledOpen()),
    opensAt: opensAt === null ? null : new Date(opensAt).toISOString(),
    serverNow: new Date().toISOString(),
    total: PARTICIPANTS.length,
    remaining: remainingNumbers(s),
    people: PARTICIPANTS.map((name) => ({ name, number: s.byName[name] ?? null, at: s.at[name] || null })),
    // Names that hold a number but are no longer in lib/config.js
    orphans: Object.keys(s.byName).filter((n) => !known.has(n)).map((name) => ({ name, number: s.byName[name] })),
    // The pool was filled for a different list size → a reset is needed
    sizeMismatch: s.init > 0 && s.init !== PARTICIPANTS.length,
  };
}

export default async function handler(req, res) {
  const auth = checkAdmin(req);
  if (!auth.ok) {
    if (auth.status === 401) await sleep(600); // slow down guessing
    return send(res, auth.status, { error: auth.error });
  }
  try {
    const store = getStore();
    if (req.method === 'GET') return send(res, 200, await snapshot(store));
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

    const { action, name } = await readJson(req);
    if (action === 'open') await store.setMode('open');
    else if (action === 'close') await store.setMode('closed');
    else if (action === 'schedule') await store.setMode('auto');
    else if (action === 'reset') await store.reset();
    else if (action === 'release') {
      if (!name) return send(res, 400, { error: 'Missing name.' });
      await store.release(String(name));
    } else return send(res, 400, { error: 'Unknown action.' });

    send(res, 200, await snapshot(store));
  } catch (err) {
    handleError(res, err);
  }
}
