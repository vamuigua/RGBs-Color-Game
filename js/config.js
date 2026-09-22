/**
 * config.js — runtime gameplay configuration.
 *
 * Every tunable rule in the game lives here. color.js and game.js read from
 * CONFIG instead of module constants, which is what lets the Tuning Lab change
 * the rules without a rebuild.
 *
 * This module imports NOTHING — not even storage.js. It has to be a leaf,
 * because color.js depends on it and color.js must stay importable under plain
 * node for validate.mjs. Under node there is no localStorage, the read throws,
 * and the defaults stand.
 *
 * applyConfig() is the only mutation path. CONFIG is deep-frozen, so the engine
 * physically cannot be handed a config that was edited after validation.
 */

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

/**
 * NOTE ON `lives: null`
 * JSON.stringify(Infinity) is null, so persisting Infinity silently round-trips
 * to null anyway. Making null the canonical "unlimited" on disk — and mapping
 * it to Infinity at read time — removes a whole class of "ZEN lost its infinity
 * after reload" bugs. null = unlimited is a project-wide convention.
 */
export const DEFAULTS = deepFreeze({
	version: 1,

	/* --- consumed by color.js ------------------------------------- */
	tiers: {
		easy:   { tiles: 3, min0: 28, minF: 14,  max0: 48, maxF: 26, decay: 0.93, sepFrac: 0.55, sepFloor: 9, lWeight: 0.90, timer: 12, scoreMult: 1.0, lives: null },
		medium: { tiles: 6, min0: 17, minF: 8.5, max0: 30, maxF: 16, decay: 0.90, sepFrac: 0.50, sepFloor: 6, lWeight: 0.65, timer: 9,  scoreMult: 1.5, lives: null },
		hard:   { tiles: 9, min0: 10, minF: 4.5, max0: 20, maxF: 9,  decay: 0.88, sepFrac: 0.45, sepFloor: 4, lWeight: 0.45, timer: 7,  scoreMult: 2.0, lives: null },
	},

	engine: {
		sepAbs: 4.0,        // absolute pairwise floor — below this, tiles blur together
		lLo: 28, lHi: 92,   // L* window: off the near-black background, off the light border
		cLo: 12,            // no grey-on-grey washouts
		maxTry: 48,         // bounded rejection sampling
		levelCap: 60,       // the ramp saturates here
		relaxAt: 16,        // attempt index at which pairwise separation relaxes once
		relaxFactor: 0.85,
		maxOvershoot: 1.22, // how far past dMax a candidate may land
	},

	/* --- consumed by game.js -------------------------------------- */
	ramp: {
		enabled: true,
		levelMax: 99,
		levelDownOnWrong: true,
		timerFloor: 4,      // seconds — the timer never drops below this
		timerStep: 0.3,     // seconds shaved per level
	},

	modes: {
		arcade: { label: 'ARCADE', lives: 3,    timed: true,  canSkip: false },
		steady: { label: 'STEADY', lives: 3,    timed: false, canSkip: true },
		zen:    { label: 'ZEN',    lives: null, timed: false, canSkip: true },
	},

	scoring: {
		baseAward: 100,
		timeBonusMax: 50,
		minAward: 10,
		minScore: 0,
		wrongPenalty: 0,          // flat score charge per wrong guess
		cleanBonus: 0,            // flat bonus for a first-try correct answer
		peekPenalty: 0.5,         // fraction of the award lost to PEEK
		noLivesWrongPenalty: 0.5, // ZEN only: fraction lost per wrong guess
		streakTiers: [
			{ at: 15, mult: 5 }, { at: 10, mult: 4 }, { at: 6, mult: 3 }, { at: 3, mult: 2 },
		],
	},
});

/* ------------------------------------------------------------------ *
 * Schema — bounds live here so the Lab can generate its inputs from the
 * same table that enforces them. One source of truth; they cannot drift.
 * ------------------------------------------------------------------ */

export const SCHEMA = {
	'tiers.*.tiles':     { type: 'int', min: 2, max: 9, step: 1, label: 'Choices', help: 'Tiles on the board. Capped at 9 because keys 1-9 select them.' },
	'tiers.*.min0':      { type: 'num', min: 4, max: 60, step: 0.5, label: 'ΔE min @ L1', help: 'Closest a decoy may be at level 1. ΔE 4-5 is the practical limit of discrimination.' },
	'tiers.*.minF':      { type: 'num', min: 4, max: 60, step: 0.5, label: 'ΔE min floor', help: 'The ramp never pushes decoys closer than this.' },
	'tiers.*.max0':      { type: 'num', min: 5, max: 90, step: 0.5, label: 'ΔE max @ L1', help: 'Furthest a decoy may be at level 1. ΔE 40+ reads as unrelated colors.' },
	'tiers.*.maxF':      { type: 'num', min: 5, max: 90, step: 0.5, label: 'ΔE max floor' },
	'tiers.*.decay':     { type: 'num', min: 0.70, max: 1.00, step: 0.005, label: 'Ramp rate', help: 'Per-level narrowing. 1.00 = difficulty never ramps for this tier.' },
	'tiers.*.sepFrac':   { type: 'num', min: 0.10, max: 1.00, step: 0.05, label: 'Pairwise sep ×' },
	'tiers.*.sepFloor':  { type: 'num', min: 4, max: 30, step: 0.5, label: 'Pairwise sep min', help: 'Minimum ΔE between any two tiles — stops two decoys looking identical.' },
	'tiers.*.lWeight':   { type: 'num', min: 0, max: 1, step: 0.05, label: 'Lightness bias', help: '1 = decoys may differ purely in brightness (easy). 0 = differences are pure hue (hard).' },
	'tiers.*.timer':     { type: 'num', min: 2, max: 60, step: 0.5, label: 'Timer @ L1 (s)' },
	'tiers.*.scoreMult': { type: 'num', min: 0, max: 10, step: 0.1, label: 'Score ×' },
	'tiers.*.lives':     { type: 'int?', min: 1, max: 9, step: 1, label: 'Lives override', help: 'Blank = inherit from the mode.' },

	'engine.sepAbs':      { type: 'num', min: 2, max: 15, step: 0.25, label: 'Absolute sep floor', warnBelow: 4, help: 'Hard solvability floor. Below 4 the puzzle can become a coin flip.' },
	'engine.lLo':         { type: 'num', min: 0, max: 60, step: 1, label: 'L* min' },
	'engine.lHi':         { type: 'num', min: 40, max: 100, step: 1, label: 'L* max' },
	'engine.cLo':         { type: 'num', min: 0, max: 40, step: 1, label: 'C* min', help: 'Minimum chroma — stops washed-out greys.' },
	'engine.maxTry':      { type: 'int', min: 8, max: 200, step: 1, label: 'Sampler attempts', warnAbove: 96, help: 'CPU cost per decoy. Raising this slows round generation.' },
	'engine.levelCap':    { type: 'int', min: 1, max: 999, step: 1, label: 'Ramp saturates at' },
	'engine.relaxAt':     { type: 'int', min: 1, max: 200, step: 1, label: 'Relax separation at try' },
	'engine.relaxFactor': { type: 'num', min: 0.3, max: 1, step: 0.05, label: 'Relax factor' },
	'engine.maxOvershoot':{ type: 'num', min: 1, max: 3, step: 0.01, label: 'ΔE max overshoot' },

	'ramp.enabled':          { type: 'bool', label: 'Progressive difficulty', help: 'Off = level frozen at 1: no ΔE narrowing, no timer shrink, no level up or down.' },
	'ramp.levelMax':         { type: 'int', min: 1, max: 999, step: 1, label: 'Max level' },
	'ramp.levelDownOnWrong': { type: 'bool', label: 'Level down on wrong', help: 'The rubber band. Off = difficulty only ever climbs.' },
	'ramp.timerFloor':       { type: 'num', min: 1, max: 30, step: 0.5, label: 'Timer floor (s)' },
	'ramp.timerStep':        { type: 'num', min: 0, max: 5, step: 0.05, label: 'Timer shaved / level' },

	'modes.*.lives':   { type: 'int?', min: 1, max: 9, step: 1, label: 'Lives', help: 'Blank = unlimited.' },
	'modes.*.timed':   { type: 'bool', label: 'Timed' },
	'modes.*.canSkip': { type: 'bool', label: 'Allow new colors' },

	'scoring.baseAward':          { type: 'int', min: 0, max: 10000, step: 10, label: 'Base points' },
	'scoring.timeBonusMax':       { type: 'int', min: 0, max: 10000, step: 5, label: 'Max time bonus' },
	'scoring.minAward':           { type: 'int', min: 0, max: 10000, step: 5, label: 'Minimum award' },
	'scoring.minScore':           { type: 'int', min: -1000000, max: 0, step: 100, label: 'Score can fall to' },
	'scoring.wrongPenalty':       { type: 'int', min: 0, max: 10000, step: 5, label: 'Wrong answer penalty' },
	'scoring.cleanBonus':         { type: 'int', min: 0, max: 10000, step: 5, label: 'First-try bonus', help: 'Flat, added after the streak multiplier.' },
	'scoring.peekPenalty':        { type: 'num', min: 0, max: 1, step: 0.05, label: 'PEEK penalty', help: 'Fraction of the round award lost. 0.5 = half points.' },
	'scoring.noLivesWrongPenalty':{ type: 'num', min: 0, max: 1, step: 0.05, label: 'ZEN wrong penalty', help: 'Fraction lost per wrong guess where there are no lives to take.' },
};

/** Normalise a concrete path (tiers.hard.min0) to its schema key (tiers.*.min0). */
export function schemaFor(path) {
	if (SCHEMA[path]) return SCHEMA[path];
	const parts = path.split('.');
	if (parts.length === 3) return SCHEMA[`${parts[0]}.*.${parts[2]}`];
	return undefined;
}

/* ------------------------------------------------------------------ *
 * Live state
 * ------------------------------------------------------------------ */

/**
 * Live bindings. Importers see reassignment, which is what lets color.js keep
 * exporting `TIERS` as a plain indexable object with no call-site churn.
 *
 * THE RULE THIS IMPOSES: never destructure these at module scope.
 * `const { hard } = CONFIG.tiers` pins a stale table and the failure is silent.
 */
export let CONFIG = DEFAULTS;
export let TUNED = false;

const subscribers = new Set();

export function subscribe(fn) {
	subscribers.add(fn);
	return () => subscribers.delete(fn);
}

/**
 * The only mutation path.
 * @param {object} partial sparse override, merged onto DEFAULTS
 * @returns {{config: object, warnings: string[]}}
 */
export function applyConfig(partial, { persist = true } = {}) {
	const merged = deepMerge(DEFAULTS, partial || {});
	const warnings = sanitize(merged);
	CONFIG = deepFreeze(merged);
	const diff = diffFromDefaults(CONFIG);
	TUNED = Object.keys(diff).length > 0;
	// Persist the sparse override, not the merged tree: storing the merged
	// result would pin every untouched field to today's defaults forever, so a
	// future retune would be invisible to anyone who had ever opened the lab.
	if (persist) writeStore(diff);
	for (const fn of subscribers) fn(CONFIG);
	return { config: CONFIG, warnings };
}

export function resetConfig({ persist = true } = {}) {
	CONFIG = DEFAULTS;
	TUNED = false;
	if (persist) clearStore();
	for (const fn of subscribers) fn(CONFIG);
}

/* ------------------------------------------------------------------ *
 * Merge / diff
 * ------------------------------------------------------------------ */

/**
 * Schema-bounded deep merge: walks DEFAULTS, never the incoming object, so
 * unknown keys and `__proto__` are simply never copied. Prototype-pollution
 * proof by construction rather than by special-casing.
 */
function deepMerge(base, over) {
	if (Array.isArray(base)) {
		return Array.isArray(over) ? over.map((v) => (isPlain(v) ? { ...v } : v)) : base.map((v) => (isPlain(v) ? { ...v } : v));
	}
	if (!isPlain(base)) return over === undefined ? base : over;

	const out = {};
	for (const key of Object.keys(base)) {
		const b = base[key];
		const o = over && Object.prototype.hasOwnProperty.call(over, key) ? over[key] : undefined;
		out[key] = isPlain(b) || Array.isArray(b) ? deepMerge(b, o) : (o === undefined ? b : o);
	}
	return out;
}

/** Sparse object of everything that differs from DEFAULTS. Drives TUNED + EXPORT. */
export function diffFromDefaults(config = CONFIG) {
	return diff(DEFAULTS, config) || {};
}

function diff(base, cur) {
	if (Array.isArray(base)) return JSON.stringify(base) === JSON.stringify(cur) ? undefined : cur;
	if (!isPlain(base)) return base === cur ? undefined : cur;
	const out = {};
	for (const key of Object.keys(base)) {
		if (key === 'version') continue;
		const d = diff(base[key], cur[key]);
		if (d !== undefined) out[key] = d;
	}
	return Object.keys(out).length ? out : undefined;
}

/* ------------------------------------------------------------------ *
 * Sanitize — clamping lives here and ONLY here.
 * ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Mutates `cfg` in place. Returns the list of human-readable adjustments. */
function sanitize(cfg) {
	const warnings = [];
	const warn = (m) => warnings.push(m);

	clampGroup(cfg.engine, 'engine', warn);
	clampGroup(cfg.ramp, 'ramp', warn);
	clampGroup(cfg.scoring, 'scoring', warn);
	for (const k of Object.keys(cfg.tiers)) clampGroup(cfg.tiers[k], `tiers.${k}`, warn);
	for (const k of Object.keys(cfg.modes)) clampGroup(cfg.modes[k], `modes.${k}`, warn);

	// --- streak tiers: must be sorted descending for the linear scan to work.
	const st = cfg.scoring.streakTiers;
	if (!Array.isArray(st) || !st.length) {
		cfg.scoring.streakTiers = DEFAULTS.scoring.streakTiers.map((t) => ({ ...t }));
		warn('Streak tiers were empty — restored to defaults.');
	} else {
		cfg.scoring.streakTiers = st
			.filter((t) => t && Number.isFinite(+t.at) && Number.isFinite(+t.mult))
			.map((t) => ({ at: clamp(Math.round(+t.at), 1, 999), mult: clamp(+t.mult, 1, 100) }))
			.sort((a, b) => b.at - a.at);
	}

	// --- engine cross-field
	if (cfg.engine.lHi - cfg.engine.lLo < 20) {
		cfg.engine.lHi = cfg.engine.lLo + 20;
		warn('L* window widened to 20 — a narrower band leaves the sampler no room.');
	}
	if (cfg.engine.sepAbs < 4) {
		warn('Absolute separation floor is below ΔE 4.0 — tiles may be genuinely indistinguishable.');
	}

	// --- per-tier cross-field repair.
	// Conflicts resolve in the direction that makes rounds EASIER, matching the
	// generator's own rule that every fallback fails toward solvable.
	for (const name of Object.keys(cfg.tiers)) {
		const t = cfg.tiers[name];
		const floor = Math.max(4, cfg.engine.sepAbs);

		if (t.min0 < floor) { t.min0 = floor; warn(`${name}: ΔE min @ L1 raised to ${floor} (solvability floor).`); }
		if (t.minF < floor) { t.minF = floor; warn(`${name}: ΔE min floor raised to ${floor} (solvability floor).`); }
		if (t.minF > t.min0) { t.minF = t.min0; warn(`${name}: ΔE min floor cannot exceed the level-1 value.`); }

		if (t.max0 < t.min0 * 1.1) { t.max0 = round2(t.min0 * 1.1); warn(`${name}: ΔE max @ L1 widened above ΔE min.`); }
		if (t.maxF < t.minF * 1.1) { t.maxF = round2(t.minF * 1.1); warn(`${name}: ΔE max floor widened above ΔE min floor.`); }
		if (t.maxF > t.max0) t.maxF = t.max0;

		if (t.sepFloor > t.minF) { t.sepFloor = t.minF; warn(`${name}: pairwise separation cannot exceed the target ΔE floor.`); }
		if (t.sepFloor < cfg.engine.sepAbs) t.sepFloor = cfg.engine.sepAbs;
	}

	// --- a timer "floor" above the tier timer would not be a floor
	const minTimer = Math.min(...Object.values(cfg.tiers).map((t) => t.timer));
	if (cfg.ramp.timerFloor > minTimer) {
		cfg.ramp.timerFloor = minTimer;
		warn('Timer floor lowered to the shortest tier timer.');
	}

	if (cfg.engine.relaxAt >= cfg.engine.maxTry) {
		cfg.engine.relaxAt = Math.max(1, Math.floor(cfg.engine.maxTry / 3));
		warn('Separation relax point moved inside the attempt budget.');
	}

	return warnings;
}

function clampGroup(obj, prefix, warn) {
	for (const key of Object.keys(obj)) {
		const spec = schemaFor(`${prefix}.${key}`);
		if (!spec) continue;
		const raw = obj[key];

		if (spec.type === 'bool') { obj[key] = !!raw; continue; }
		if (spec.type === 'int?') {
			if (raw === null || raw === undefined || raw === '') { obj[key] = null; continue; }
			const n = Math.round(Number(raw));
			obj[key] = Number.isFinite(n) ? clamp(n, spec.min, spec.max) : null;
			continue;
		}

		let n = Number(raw);
		if (!Number.isFinite(n)) {
			warn(`${prefix}.${key} was not a number — reset to default.`);
			n = getPath(DEFAULTS, `${prefix}.${key}`);
		}
		if (spec.type === 'int') n = Math.round(n);
		const c = clamp(n, spec.min, spec.max);
		if (c !== n) warn(`${prefix}.${key} clamped to ${c} (allowed ${spec.min}–${spec.max}).`);
		obj[key] = spec.type === 'int' ? c : round2(c);
	}
}

const round2 = (n) => Math.round(n * 1000) / 1000;

export function getPath(obj, path) {
	return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
	const parts = path.split('.');
	const last = parts.pop();
	let cur = obj;
	for (const p of parts) {
		if (!isPlain(cur[p])) cur[p] = {};
		cur = cur[p];
	}
	cur[last] = value;
	return obj;
}

/* ------------------------------------------------------------------ *
 * Persistence — its own key, deliberately not shared with rgbs.v1
 * ------------------------------------------------------------------ */

const KEY = 'rgbs.cfg.v1';

// The bare localStorage reference inside try/catch is intentional: under node
// it throws ReferenceError, in private mode SecurityError, and corrupt JSON
// throws SyntaxError. One catch covers all three.
function readStore() {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? JSON.parse(raw) : null;
	} catch { return null; }
}
function writeStore(o) {
	try {
		if (o && Object.keys(o).length) localStorage.setItem(KEY, JSON.stringify(o));
		else localStorage.removeItem(KEY);
	} catch { /* quota or blocked — the in-memory config still serves this session */ }
}
function clearStore() {
	try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function isPlain(v) {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepFreeze(o) {
	if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
		Object.freeze(o);
		for (const v of Object.values(o)) deepFreeze(v);
	}
	return o;
}

/* ------------------------------------------------------------------ *
 * Boot — silent no-op under node, so validate.mjs always sees DEFAULTS
 * ------------------------------------------------------------------ */

const stored = readStore();
if (stored) {
	try { applyConfig(stored, { persist: false }); }
	catch { resetConfig({ persist: false }); }
}
