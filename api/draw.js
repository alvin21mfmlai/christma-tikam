// POST /api/draw  { name }
// Draws one number for this person — or returns the number they already
// have. Safe to repeat: pressing Spin twice, or on two phones, never gives
// one person two numbers.
import { PARTICIPANTS, scheduledOpen } from '../lib/config.js';
import { getStore } from '../lib/store.js';
import { send, readJson, handleError } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const { name } = await readJson(req);
    const match = PARTICIPANTS.find((p) => p === String(name || '').trim());
    if (!match) return send(res, 400, { error: 'That name is not on the list.' });

    const { status, number } = await getStore().draw(match, scheduledOpen());
    if (status === 'closed') return send(res, 403, { status, name: match, error: 'The draw is not open yet.' });
    if (status === 'empty') return send(res, 409, { status, name: match, error: 'All numbers have been drawn.' });
    send(res, 200, { status, name: match, number });
  } catch (err) {
    handleError(res, err);
  }
}
