// Storage for the lucky draw.
//
// Production: Upstash Redis over its REST API. Every operation that changes
// state is ONE Lua script, and Redis runs scripts one at a time, so two
// people pressing "Spin" in the same millisecond are simply queued: the first
// takes a number out of the pool, the second takes a different one.
//
// Local preview (`npm run dev` without Redis credentials): an in-memory store
// with the same behaviour. It is refused on Vercel, because serverless
// instances do not share memory and uniqueness could not be guaranteed.

import { randomInt } from 'node:crypto';
import { PARTICIPANTS, SITE_MODE } from './config.js';

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '');
const REST_URL = clean(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL).replace(/\/+$/, '');
const REST_TOKEN = clean(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
const PREFIX = clean(process.env.DRAW_KEY_PREFIX) || (SITE_MODE === 'test' ? 'test:' : 'luckydraw:');

const K = {
  mode: PREFIX + 'open', //   missing = follow schedule, "1" = open now, "0" = closed
  init: PREFIX + 'init', //   set (to N) once the pool has been filled
  pool: PREFIX + 'pool', //   list of numbers not yet drawn
  byName: PREFIX + 'byName', // hash  name   -> number
  byNum: PREFIX + 'byNum', //  hash  number -> name
  at: PREFIX + 'at', //        hash  name   -> ISO time of the draw
};
const KEYS = [K.mode, K.init, K.pool, K.byName, K.byNum, K.at];

export class ConfigError extends Error {}

// ── Lua scripts ─────────────────────────────────────────────
// KEYS: 1 mode, 2 init, 3 pool, 4 byName, 5 byNum, 6 at

const STATE_LUA = `
local mode = redis.call('GET', KEYS[1])
local init = redis.call('GET', KEYS[2])
local pool = redis.call('LRANGE', KEYS[3], 0, -1)
local byName = redis.call('HGETALL', KEYS[4])
local at = redis.call('HGETALL', KEYS[6])
return { mode or '', init or '', pool, byName, at }
`;

// ARGV: 1 name, 2 N, 3 random fraction in [0,1), 4 timestamp, 5 schedule says open ("1"/"0")
// The random pick happens inside the script, at the moment of the draw, so
// no order exists in advance that anyone (the admin included) could see.
const DRAW_LUA = `
local existing = redis.call('HGET', KEYS[4], ARGV[1])
if existing then return { 'existing', existing } end
local mode = redis.call('GET', KEYS[1])
if not (mode == '1' or (mode ~= '0' and ARGV[5] == '1')) then return { 'closed', '' } end
if not redis.call('GET', KEYS[2]) then
  redis.call('DEL', KEYS[3])
  for i = 1, tonumber(ARGV[2]) do redis.call('RPUSH', KEYS[3], tostring(i)) end
  redis.call('SET', KEYS[2], ARGV[2])
end
local len = redis.call('LLEN', KEYS[3])
if len == 0 then return { 'empty', '' } end
local idx = math.floor(tonumber(ARGV[3]) * len)
if idx >= len then idx = len - 1 end
if idx < 0 then idx = 0 end
local n = redis.call('LINDEX', KEYS[3], idx)
redis.call('LREM', KEYS[3], 1, n)
redis.call('HSET', KEYS[4], ARGV[1], n)
redis.call('HSET', KEYS[5], n, ARGV[1])
redis.call('HSET', KEYS[6], ARGV[1], ARGV[4])
return { 'new', n }
`;

// ARGV: 1 name. Puts that person's number back into the pool.
const RELEASE_LUA = `
local n = redis.call('HGET', KEYS[4], ARGV[1])
if not n then return '' end
redis.call('HDEL', KEYS[4], ARGV[1])
redis.call('HDEL', KEYS[5], n)
redis.call('HDEL', KEYS[6], ARGV[1])
if redis.call('GET', KEYS[2]) then redis.call('RPUSH', KEYS[3], n) end
return n
`;

// Clears every number; the open/closed switch goes back to "follow schedule".
const RESET_LUA = `
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
return 1
`;

// ARGV: 1 "auto" | "1" | "0"
const SET_MODE_LUA = `
if ARGV[1] == 'auto' then redis.call('DEL', KEYS[1]) else redis.call('SET', KEYS[1], ARGV[1]) end
return ARGV[1]
`;

// ── Upstash REST ────────────────────────────────────────────

async function upstash(command) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  let body;
  try { body = await r.json(); } catch { body = {}; }
  if (!r.ok || body.error) throw new Error(`Redis error: ${body.error || r.status}`);
  return body.result;
}

const evalWith = (script, keys, args = []) =>
  upstash(['EVAL', script, String(keys.length), ...keys, ...args.map(String)]);
const evalScript = (script, args) => evalWith(script, KEYS, args);

const pairs = (flat) => {
  const out = {};
  for (let i = 0; i + 1 < (flat || []).length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
};
const modeName = (raw) => (raw === '1' ? 'open' : raw === '0' ? 'closed' : 'auto');

const redisStore = {
  kind: 'redis',
  async state() {
    const [mode, init, pool, byName, at] = await evalScript(STATE_LUA);
    return { mode: modeName(mode), init: init ? Number(init) : 0, pool: pool.map(Number), byName: mapNums(pairs(byName)), at: pairs(at) };
  },
  async draw(name, schedOpen) {
    const [status, n] = await evalScript(DRAW_LUA, [name, PARTICIPANTS.length, fraction(), new Date().toISOString(), schedOpen ? '1' : '0']);
    return { status, number: n ? Number(n) : null };
  },
  async release(name) {
    const n = await evalScript(RELEASE_LUA, [name]);
    return n ? Number(n) : null;
  },
  async reset() { await evalScript(RESET_LUA); },
  async setMode(mode) { await evalScript(SET_MODE_LUA, [mode === 'open' ? '1' : mode === 'closed' ? '0' : 'auto']); },
};

// ── In-memory (local preview only) ──────────────────────────

const mem = { mode: 'auto', init: 0, pool: [], byName: {}, at: {} };
const memoryStore = {
  kind: 'memory',
  async state() {
    return { mode: mem.mode, init: mem.init, pool: [...mem.pool], byName: { ...mem.byName }, at: { ...mem.at } };
  },
  async draw(name, schedOpen) {
    if (mem.byName[name] != null) return { status: 'existing', number: mem.byName[name] };
    if (!(mem.mode === 'open' || (mem.mode !== 'closed' && schedOpen))) return { status: 'closed', number: null };
    if (!mem.init) {
      mem.pool = Array.from({ length: PARTICIPANTS.length }, (_, i) => i + 1);
      mem.init = PARTICIPANTS.length;
    }
    if (!mem.pool.length) return { status: 'empty', number: null };
    const idx = Math.min(mem.pool.length - 1, Math.floor(fraction() * mem.pool.length));
    const [n] = mem.pool.splice(idx, 1);
    mem.byName[name] = n;
    mem.at[name] = new Date().toISOString();
    return { status: 'new', number: n };
  },
  async release(name) {
    const n = mem.byName[name];
    if (n == null) return null;
    delete mem.byName[name];
    delete mem.at[name];
    if (mem.init) mem.pool.push(n);
    return n;
  },
  async reset() { Object.assign(mem, { mode: 'auto', init: 0, pool: [], byName: {}, at: {} }); },
  async setMode(mode) { mem.mode = mode; },
};

// ── helpers ─────────────────────────────────────────────────

function fraction() {
  // 48 bits of cryptographic randomness → uniform fraction in [0, 1)
  return randomInt(0, 2 ** 24) / 2 ** 24 + randomInt(0, 2 ** 24) / 2 ** 48;
}

function mapNums(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Number(v);
  return out;
}

export function getStore() {
  if (REST_URL && REST_TOKEN) return redisStore;
  if (process.env.VERCEL) {
    throw new ConfigError(
      'Storage is not connected. In Vercel, open the project → Storage → add Upstash Redis and connect it to this project, then redeploy.'
    );
  }
  return memoryStore;
}

export const keyPrefix = () => PREFIX;

// Numbers still in the pool, sorted (never in pool order).
export function remainingNumbers(s) {
  if (!s.init) {
    const taken = new Set(Object.values(s.byName));
    return Array.from({ length: PARTICIPANTS.length }, (_, i) => i + 1).filter((n) => !taken.has(n));
  }
  return [...s.pool].sort((a, b) => a - b);
}

// Is the draw open right now? Host override wins; otherwise the schedule.
export const isOpen = (mode, schedOpen) => mode === 'open' || (mode !== 'closed' && schedOpen);
