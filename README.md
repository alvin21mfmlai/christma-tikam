# Christmas Party Lucky Draw

Each participant opens the site on their phone, taps **their own name**, spins the wheel and
gets **one unique lucky draw number** (1–25) from the numbers still left. The official draw
opens by itself on **Sat 28 Nov 2026, 7:00 pm (Singapore time)**. A host page lets you watch
results, show a big-screen board and fix mistakes. A separate **test site** lets you rehearse.

```
index.html          participant page (tap name → spin → number, countdown before opening)
admin.html          host page (/admin)
api/state.js        public state: open?, opening time, numbers left, who has drawn
api/draw.js         draw a number (or return the one you already have)
api/admin.js        host actions: follow schedule / open now / closed, release, reset
lib/config.js       ← EDIT THIS: title, opening time, participant list
lib/store.js        Upstash Redis storage (atomic Lua scripts) + local in-memory fallback
lib/http.js         small helpers
scripts/dev-server.mjs  local preview (not deployed)
vercel.json         clean URLs, Singapore region, headers
```

No npm dependencies and no build step.

## How uniqueness is guaranteed (the concurrency question)

The phone never picks the number — the server does. Each draw is **one Lua script inside
Redis**, and Redis runs scripts strictly one at a time. The script:

1. If this person already has a number → returns that same number (double taps, two phones or a
   retry after a network blip can never give one person two numbers).
2. If the draw isn't open → refuses.
3. Picks a random number from the pool of numbers still left, removes it, and records
   name ↔ number — all in the same atomic step.

If all 25 people press Spin in the same second, Redis queues the 25 scripts and each one takes
a different number. The wheel only spins after the server has answered, then lands on that
number. The random pick happens at the moment of the draw, so no pre-shuffled order exists for
anyone (the host included) to peek at.

Tested against real Redis with three separate server processes: 30 rounds × 77 simultaneous
requests (every person tapping Spin three times at once, plus unknown names) — unique every
round. The test site has a button that runs the same kind of test on
the real Vercel + Upstash setup (see below).

## Opening time

- Set in `lib/config.js` (`opensAt: '2026-11-28T19:00:00+08:00'`). Phones show a countdown
  in Singapore time, whatever time zone the phone is in, and unlock by themselves at 7 pm.
- The server decides using its own clock, so changing the phone's clock does nothing.
- Host switch on `/admin`:
  - **Follow schedule** (default) — opens at the set time.
  - **Open now** — opens immediately (e.g. if you want to start early).
  - **Closed** — keeps it closed even after the start time, until you switch back.
- `DRAW_OPENS_AT` (environment variable) overrides the time for one deployment, e.g.
  `2026-11-28T18:30:00+08:00`, or `now`.

## Two sites from one repo: test and official

Both are Vercel projects built from the **same GitHub repo**, so they always run the same
code. They can share one Upstash database but keep separate data.

| | Official site | Test site |
|---|---|---|
| `SITE_MODE` | *(not set)* | `test` |
| Opens | Sat 28 Nov, 7 pm | immediately |
| Banner | — | "TEST SITE · numbers drawn here don't count" |
| Data | keys `luckydraw:…` | keys `test:…` |
| Extra | — | **Live concurrency test** button on `/admin` |

### Set up the official site

1. **Push to GitHub.** New repo (e.g. `christmas-lucky-draw`), unzip this folder into it,
   commit, push.
2. **Import into Vercel.** Add New → Project → the repo. Framework preset **Other**; leave
   build settings empty. Deploy.
3. **Add storage.** Project → **Storage** → **Upstash for Redis** (free plan; region
   **Singapore**, `ap-southeast-1`) → connect it to this project. This adds `KV_REST_API_URL`
   and `KV_REST_API_TOKEN`.
4. **Environment variables** (Settings → Environment Variables):
   - `ADMIN_PASSWORD` — your host password
5. **Redeploy** (Deployments → ⋯ → Redeploy).

### Set up the test site

1. Vercel → Add New → Project → **the same repo** again; name it e.g. `lucky-draw-test`.
2. Storage → connect the **same** Upstash database to this project too.
3. Environment variables:
   - `SITE_MODE` = `test`
   - `ADMIN_PASSWORD` = any password
4. Redeploy.

Optional: on the test site, set `DRAW_OPENS_AT` to a time a few minutes ahead to rehearse the
countdown and automatic opening.

## Rehearsal checklist (test site)

1. `/admin` → **Run the test**: all 25 participants spin at the same instant, twice each,
   against the real servers; it reports pass/fail. Then **Reset everything**.
2. Send a few friends the test link (**Copy invite message**) and try it together.
3. Try tapping a name that already has a number, and the Board in full screen.
4. Reset everything when done.

## Before 28 Nov (official site)

1. `/admin` → switch shows **Follow schedule** and "Opens Sat, 28 Nov, 7:00 pm".
2. If you tried anything on the official site, **Reset everything** (it also goes back to
   Follow schedule).
3. **Copy invite message** → paste it into the party group chat (link + start time).

## On the night

- At 7 pm the wheel unlocks on everyone's phone by itself.
- The **Board** tab shows numbers 1–25 filling in with names — **Full screen** on a TV.
- Someone drew by mistake? Table tab → **Release** (tap twice): their number goes back on the
  wheel and they can spin again.
- **Closed** stops new draws.
- **Download CSV** gives the final list (number, name, time).

## Good to know

- People can tap their name before 7 pm; they'll see the wheel with a locked button and the
  countdown, and it unlocks by itself.
- One phone can draw for several people (e.g. a parent for a child); the page remembers the
  draws made on that phone.
- **Once a name has spun, its button is greyed out ("✓ already spun") and can't be picked
  again** — on every phone, within a few seconds. The phone that did the spin keeps the number
  on screen (and under "Drawn on this phone"). If two phones open the same name, the first to
  spin wins; the other is sent back to the list with a message. The server never gives one
  name a second number either way. Anyone who needs their number again (e.g. new phone) can ask
  the host — it's on the admin page.
- Names aren't protected: anyone could tap someone else's name. Because numbers are random this
  doesn't change anyone's odds; if it happens, **Release** that name — the button unlocks again
  so its owner can spin.
- Changing the participant list: edit `lib/config.js`, push, then **Reset everything**.
- Only outside request: Google Fonts (with system-font fallback).
- 25 phones checking every 4 s for an evening is well inside Upstash's free tier.

## Run locally

```bash
npm run dev            # http://localhost:3000, admin password "admin"
```

Uses an in-memory store (refused on Vercel). To preview test
mode: `SITE_MODE=test npm run dev`. PowerShell:

```powershell
$env:SITE_MODE="test"; npm run dev
```
