# Technical notes

Everything behind [the README](../README.md): how colors are generated, how the
game is tuned and tested, and what to know before changing code.

- [Architecture](#architecture) · [The color engine](#the-color-engine) · [Scoring](#scoring)
- [Game Tuning Lab](#game-tuning-lab) · [Development](#development) · [Testing](#testing)
- [Build](#build) · [Configuration](#configuration) · [Deployment](#deployment-netlify)

---

## Architecture

```
index.html              screens: start, play, summary, tutorial, lab
css/rgbs.css            design tokens, layout, keyframes
js/config.js            every tunable rule + schema, bounds and clamping
js/color.js             CIELAB math, ΔE00, difficulty-aware color generation
js/game.js              state machine: score, lives, streak, level, timer
js/ui.js                rendering, screens, feedback
js/onboarding.js        the RGB tutorial (lazy-loaded)
js/lab.js               Game Tuning Lab (lazy-loaded, not precached)
js/analyze.js           round measurement, shared by the lab and validate.mjs
js/audio.js             sound + haptics
js/storage.js           localStorage best scores and settings
sw.js                   offline shell (stale-while-revalidate)
validate.mjs            color engine invariant harness
dev-server.mjs          zero-dependency static server for local dev
```

A few constraints worth knowing before changing things:

- **`js/config.js` imports nothing.** It has to stay a leaf so `js/color.js` can
  depend on it and still be importable under plain Node for `validate.mjs`.
- **`js/analyze.js` is DOM-free** for the same reason — that is what lets the
  in-browser Lab and the CI harness share one definition of every measurement,
  so they cannot drift apart.
- **`TIERS`, `SEP_ABS`, `MODES` and friends are ES live bindings** (`export let`,
  reassigned on config change). Never destructure them at module scope —
  `const { hard } = TIERS` pins a stale table and fails silently.
- **`js/lab.js` and `js/analyze.js` are deliberately absent from `SHELL`** in
  `sw.js`. They are lazily imported, so a player who never opens the Lab never
  downloads them.
- **The `l2s()` helper in `color.js` must keep its piecewise form.**
  Out-of-gamut conversions produce negative linear values and
  `Math.pow(negative, 1/2.4)` is `NaN`.

## The color engine

Difficulty is **perceptual**, not just "more tiles". Colors are generated in
CIELAB and every candidate is accepted or rejected on its ΔE00 distance — the
CIE's model of how different two colors actually *look*.

| | Tiles | ΔE00 gap at level 1 | Floor | Character |
| --- | --- | --- | --- | --- |
| **EASY** | 3 | 28 – 48 | 14 | Clearly different colors; brightness cues allowed |
| **MEDIUM** | 6 | 17 – 30 | 8.5 | Noticeably closer |
| **HARD** | 9 | 10 – 20 | 4.5 | Separated mostly by hue, not brightness |

For scale: ΔE00 ≈ 1 is invisible on separated tiles, ≈ 4–5 is the practical
limit of discrimination, ≈ 40+ reads as "unrelated colors".

Decoys are placed by stratified azimuth and stratified magnitude around the
target, with bounded rejection sampling. Two rules govern the whole generator:

- **`dMin` is a hard floor** — solvability. No two tiles are ever closer than
  ΔE00 4.0, at any level, under any config.
- **`dMax` is soft.** Every fallback path fails in the *easier* direction, so a
  round can end up simpler than intended but never impossible.

Sampling uses ΔE76 (Euclidean, invertible, so a wanted distance can be turned
into a radius) and then *guards* with ΔE00, which is accurate but not a metric.
The bridge between them is a chroma-based fit:
`radius76 = wantedΔE00 × (1 + 0.0184 × C_target)`.

One hazard to remember when touching this: after clamping into gamut, Lab must
be **re-measured from the rounded 8-bit RGB**, never read back from the ideal
Lab — otherwise the guard validates a color that was never displayed.

**Progression is an adaptive rubber band**, not XP: every clean win raises your
level and narrows the gap, every wrong guess lowers it.

## Scoring

```
100 base  ×  difficulty (×1 / ×1.5 / ×2)  ×  streak (up to ×5)  +  time bonus (ARCADE)
```

Streak multiplier steps up at 3, 6, 10 and 15 consecutive correct answers. PEEK
halves the round's points. In ZEN — the only mode with no lives to lose — each
wrong guess in a round also decays that round's award, since nothing else charges
for a mistake.

Best scores are kept per mode *and* difficulty.

## Game Tuning Lab

A hidden developer screen for balancing the game without editing source. Open it
with **seven taps on the logo**, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>,
or `?lab=1`. That is UI concealment, **not security** — anything reachable from
the client is reachable from devtools.

Every control is generated from the schema in `js/config.js` and read by the
live engine. If a value has no consumer in `color.js` or `game.js`, it has no
control.

- **Values are clamped, then written back into the field**, with the reason
  shown. Conflicts resolve toward the *easier* option, matching the generator's
  rule that every fallback fails toward solvable — a config can be silly, but
  never unsolvable.
- **MEASURE** runs the real generator across six levels and reports what it
  actually produces — median/p95 ΔE00, minimum pairwise separation, fallback
  rate, ms per round — plus a difficulty rating calibrated against the shipped
  table, so it says "around HARD at level 60" rather than an invented score.
- **Sampler pressure** is shown live per tier without sampling:
  `sepFloor / (2·minF·sin(π/n))`. The defaults score 0.32 / 0.60 / 1.16 — HARD
  sits above 1, which is why it has the highest fallback rate.
- **PLAYTEST** applies the draft without saving. A generation change regenerates
  the board; a scoring-only change keeps it, so you can A/B the same round.
- **EXPORT** emits the sparse override to paste into `DEFAULTS`.

**While any value differs from the defaults, scores are not recorded** and the
HUD shows a TUNED badge, so experiments can never poison a real best score.

## Development

`dev-server.mjs` is a ~50-line zero-dependency static file server. It sends
`Cache-Control: no-store` so edits always show up on reload.

```bash
node dev-server.mjs
```

```bash
node dev-server.mjs 3000
```

### The service worker will serve you stale files

This is the single biggest gotcha when working on the app. `sw.js` precaches the
shell, so **your edits may not appear on reload**. While developing, either tick
*Application → Service Workers → Update on reload* in devtools, or clear it from
the console:

```js
(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  location.reload();
})();
```

**After changing any file listed in `SHELL` in `sw.js`, bump `CACHE`**
(`rgbs-v2` → `rgbs-v3`). The fetch handler is stale-while-revalidate, so users
self-heal on the next load, but bumping makes the update immediate.

## Testing

The color engine is the part with real invariants, and it has a harness:

```bash
node validate.mjs
```

It generates **2000 rounds per difficulty across six levels** (36,000 rounds) and
asserts the hard invariants:

1. every decoy is at least `dMin` from the target — solvability
2. no two tiles are closer than ΔE00 4.0 — nothing indistinguishable
3. every tile sits inside the readable `L*`/`C*` window — no washouts
4. exactly one correct answer per round
5. the deterministic escape hatch never fires

It also enforces CI policy: fallback rate and tier separation. Exit code is
non-zero on failure, so it works as a CI gate.

```bash
node validate.mjs --anchors
```

That regenerates the difficulty labels after a retune.

Run the harness after **any** change to the tier table, the sampling strategy or
the tile counts. It has already caught one real bug: an early engine used ΔE76
for its pairwise guard, and those "safe" pairs measured ΔE00 as low as 1.1 —
genuinely indistinguishable tiles.

There is no linter, formatter or type checker configured; the project uses no
tooling by design. `node --check <file>` syntax-checks a module.

## Build

**There is no build step.** The repository root *is* the deployable artifact —
what you serve locally is byte-for-byte what ships. Nothing is compiled,
bundled, transpiled or minified.

## Configuration

**The application requires no environment variables.** There is no backend, no
API, no analytics and no third-party service. Everything runs client-side and
all state lives in the visitor's browser.

If you fork this and add something that needs a key, note that **a static site
has no way to keep a secret** — anything referenced by client-side JS is public.
Put such calls behind a Netlify Function and keep the key in the Netlify
dashboard, never in the repository.

### Browser storage

| Key | Contents | Written by |
| --- | --- | --- |
| `rgbs.v1` | Best scores per mode+difficulty, longest streak, totals, sound/haptics/channel-bar settings, tutorial-completed flag | `js/storage.js` |
| `rgbs.cfg.v1` | Tuning Lab overrides — **only the values that differ from defaults** | `js/config.js` |

Kept in separate keys deliberately: clearing tuning experiments can never take
your scores with it. Every access is wrapped in `try/catch`, so the game still
runs where storage is blocked (private mode, embedded webviews).

## Deployment (Netlify)

The site is a plain static deploy and **needs no build configuration**:

| Setting | Value |
| --- | --- |
| Build command | *(none)* |
| Publish directory | `.` (repository root) |
| Node version | not used — nothing runs at build time |
| Dependency install | none — there is no `package.json` |
| Redirects / SPA rules | **not needed** — single entry point, no client-side router |
| Functions | none |
| Environment variables | none |

`index.html`, `manifest.webmanifest` and `sw.js` all sit at the repository root,
so the service worker gets the `/` scope it needs.

### Optional hardening

Not required — Netlify's defaults already serve this correctly — but if you want
the caching and content types pinned explicitly, add a `netlify.toml` at the
root:

```toml
[build]
  publish = "."
  command = ""

# The service worker must never be cached, or updates stall behind a stale copy.
[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/manifest.webmanifest"
  [headers.values]
    Content-Type = "application/manifest+json"
```

> ⚠️ A `netlify.toml` **overrides** the build settings configured in the Netlify
> dashboard. Only add it if the values above match your site's current settings.

### Verifying a deploy

After deploying, check in devtools that `manifest.webmanifest` is served as
`application/manifest+json`, that `sw.js` registers at scope `/`, and that the
app still loads with the network throttled to Offline.
