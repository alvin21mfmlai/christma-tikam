// GET /api/state — public view: is the draw open (or when it opens), which
// numbers are left, and which names have drawn (not who holds which number).
import { EVENT, PARTICIPANTS, SITE_MODE, opensAtMs, scheduledOpen } from '../lib/config.js';
import { getStore, remainingNumbers, isOpen } from '../lib/store.js';
import { send, handleError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  try {
    const s = await getStore().state();
    const opensAt = opensAtMs();
    send(res, 200, {
      event: { title: EVENT.title, subtitle: EVENT.subtitle, timeZone: EVENT.timeZone },
      siteMode: SITE_MODE,
      open: isOpen(s.mode, scheduledOpen()),
      hostMode: s.mode, // auto | open | closed
      opensAt: opensAt === null ? null : new Date(opensAt).toISOString(),
      serverNow: new Date().toISOString(),
      total: PARTICIPANTS.length,
      drawn: PARTICIPANTS.filter((n) => s.byName[n] != null).length,
      remaining: remainingNumbers(s),
      people: PARTICIPANTS.map((name) => ({ name, drawn: s.byName[name] != null })),
    });
  } catch (err) {
    handleError(res, err);
  }
}
