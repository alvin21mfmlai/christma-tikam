// ─────────────────────────────────────────────────────────────
//  Edit this file to change the event or the participant list.
//  Lucky draw numbers run from 1 to the number of participants.
//  If you change the list after people have started drawing,
//  use "Reset everything" on the admin page afterwards.
// ─────────────────────────────────────────────────────────────

export const EVENT = {
  title: 'Christmas Party Lucky Draw',
  subtitle: 'Find your name, spin the wheel, get your lucky number.',
  // The official draw opens by itself at this moment (Singapore time).
  // Override per deployment with the DRAW_OPENS_AT environment variable.
  opensAt: '2026-11-28T19:00:00+08:00',
  timeZone: 'Asia/Singapore',
};

export const PARTICIPANTS = [
  'Brenda',
  'Ah Beng',
  'Evan',
  'YJ',
  'Avril',
  'Celest',
  'Johnny',
  'Harris',
  'Joe',
  'Vincent',
  'Terence',
  'Tien Fun',
  'Jayvin',
  'Jayer',
  'Gladys',
  'Sherman',
  'Aly',
  'Aldan',
  'Alvin',
  'Gwen',
  'Alisa',
  'Theresa',
  'Bin Hao',
  'Charles',
  'Ros',
];

// Fail loudly on an accidental duplicate (ignoring case and spaces): two
// people with the same name would share one button. Add an initial ("Joe T").
export const normalize = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
{
  const seen = new Set();
  for (const n of PARTICIPANTS) {
    const k = normalize(n);
    if (seen.has(k || n)) throw new Error(`Duplicate participant name in lib/config.js: "${n}"`);
    seen.add(k || n);
  }
}

const env = (k) => (process.env[k] || '').trim().replace(/^["']|["']$/g, '');

// SITE_MODE=test → a practice copy: banner on every page, opens immediately
// unless DRAW_OPENS_AT is set, and an admin button that stress-tests the draw.
export const SITE_MODE = env('SITE_MODE').toLowerCase() === 'test' ? 'test' : 'live';

// When the draw opens by schedule: epoch ms, or null for "already open".
export function opensAtMs() {
  const v = env('DRAW_OPENS_AT');
  if (v.toLowerCase() === 'now') return null;
  if (v) {
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw new Error(`DRAW_OPENS_AT is not a valid date: "${v}" (use e.g. 2026-11-28T19:00:00+08:00)`);
    return t;
  }
  return SITE_MODE === 'test' ? null : Date.parse(EVENT.opensAt);
}

export const scheduledOpen = (now = Date.now()) => {
  const t = opensAtMs();
  return t === null || now >= t;
};
