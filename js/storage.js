/**
 * storage.js — persisted best scores and settings.
 *
 * Every access is wrapped: localStorage throws in private mode, when site data
 * is blocked, and inside some embedded webviews. The game must stay playable
 * when it is unavailable, so failures silently fall back to in-memory defaults.
 */

const KEY = 'rgbs.v1';

const DEFAULTS = {
	best: {},          // "arcade:hard" -> score. Per mode+difficulty, so HARD
	                   // ARCADE never competes with EASY ZEN.
	longestStreak: 0,
	totalMatched: 0,
	bestLevel: 1,
	muted: false,
	haptics: true,
	channelBars: true,
	onboarded: false,   // drives first-run routing to the RGB tutorial
	lastMode: 'arcade',
	lastDifficulty: 'medium',
};

let cache = null;

function load() {
	if (cache) return cache;
	cache = { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				cache = { ...DEFAULTS, ...parsed, best: { ...parsed.best } };
			}
		}
	} catch {
		/* unavailable or corrupt — defaults stand */
	}
	return cache;
}

function save() {
	try {
		localStorage.setItem(KEY, JSON.stringify(cache));
	} catch {
		/* quota or blocked — the in-memory cache still serves this session */
	}
}

export const get = (key) => load()[key];

export function set(key, value) {
	load();
	cache[key] = value;
	save();
}

export const bestKey = (mode, difficulty) => `${mode}:${difficulty}`;

export function getBest(mode, difficulty) {
	return load().best[bestKey(mode, difficulty)] || 0;
}

/** @returns {boolean} true if this beat the stored best. */
export function recordBest(mode, difficulty, score) {
	load();
	const k = bestKey(mode, difficulty);
	if (score > (cache.best[k] || 0)) {
		cache.best[k] = score;
		save();
		return true;
	}
	return false;
}

export function recordSession({ longestStreak, matched, level }) {
	load();
	let dirty = false;
	if (longestStreak > cache.longestStreak) { cache.longestStreak = longestStreak; dirty = true; }
	if (level > cache.bestLevel) { cache.bestLevel = level; dirty = true; }
	if (matched > 0) { cache.totalMatched += matched; dirty = true; }
	if (dirty) save();
}
