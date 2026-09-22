/**
 * analyze.js — measurement of generated rounds.
 *
 * Shared by validate.mjs (node, CI gate) and the Tuning Lab (browser, live
 * read-out). Extracted so the two can never disagree about what a number means.
 *
 * This module owns MEASUREMENT and the engine-level invariants (which are
 * facts: a decoy closer than dMin is unsolvable, full stop). It deliberately
 * does NOT own health thresholds like "fallback rate under 2%" — those are CI
 * policy and live in validate.mjs.
 *
 * DOM-free and node-safe, which is also what makes it worker-safe if the
 * sample size ever grows past what a main-thread slice can absorb.
 */

import {
	generateRound, bandFor, rgbToLab, deltaE00,
	SEP_ABS, L_LO, L_HI, C_LO,
} from './color.js';

/** Everything measurable about one generated round. */
export function measureRound(r) {
	const labs = r.tiles.map(rgbToLab);
	const tLab = labs[r.targetIndex];
	const targetDists = [];
	let pairMin = Infinity, lMin = Infinity, lMax = -Infinity, cMin = Infinity;

	for (let i = 0; i < labs.length; i++) {
		const C = Math.hypot(labs[i][1], labs[i][2]);
		if (labs[i][0] < lMin) lMin = labs[i][0];
		if (labs[i][0] > lMax) lMax = labs[i][0];
		if (C < cMin) cMin = C;
		if (i !== r.targetIndex) targetDists.push(deltaE00(labs[i], tLab));
		for (let j = i + 1; j < labs.length; j++) {
			const d = deltaE00(labs[i], labs[j]);
			if (d < pairMin) pairMin = d;
		}
	}

	const key = r.targetRgb.join(',');
	return {
		targetDists, pairMin, lMin, lMax, cMin,
		tiles: r.tiles.length,
		targetCount: r.tiles.filter((t) => t.join(',') === key).length,
		indexOk: r.tiles[r.targetIndex].join(',') === key,
		fallbacks: r.stats.fallbacks,
		hatches: r.stats.hatches,
	};
}

export function createAccumulator(difficulty, level) {
	return {
		difficulty, level,
		band: bandFor(difficulty, level),
		dists: [], pairMins: [],
		rounds: 0, decoys: 0, fallbacks: 0, hatches: 0,
		lMin: Infinity, lMax: -Infinity, cMin: Infinity,
		badTargetCount: 0, badIndex: 0, badTiles: 0,
		ms: 0,
	};
}

export function accumulate(acc, m) {
	acc.rounds++;
	acc.decoys += m.targetDists.length;
	acc.fallbacks += m.fallbacks;
	acc.hatches += m.hatches;
	for (const d of m.targetDists) acc.dists.push(d);
	acc.pairMins.push(m.pairMin);
	if (m.lMin < acc.lMin) acc.lMin = m.lMin;
	if (m.lMax > acc.lMax) acc.lMax = m.lMax;
	if (m.cMin < acc.cMin) acc.cMin = m.cMin;
	if (m.targetCount !== 1) acc.badTargetCount++;
	if (!m.indexOk) acc.badIndex++;
	if (m.tiles !== acc.band.tiles) acc.badTiles++;
	return acc;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

export function finish(acc) {
	const dists = acc.dists.slice().sort((a, b) => a - b);
	const minPair = Math.min(...acc.pairMins);
	const band = acc.band;

	// The five hard invariants. Engine facts, not policy.
	const violations = [];
	if (dists.length && dists[0] < band.dMin - 1e-9) {
		violations.push(`min ΔE to target ${dists[0].toFixed(2)} < dMin ${band.dMin.toFixed(2)} — unsolvable rounds`);
	}
	if (minPair < SEP_ABS - 1e-9) {
		violations.push(`min pairwise ΔE ${minPair.toFixed(2)} < ${SEP_ABS} — two tiles indistinguishable`);
	}
	if (acc.lMin < L_LO - 1e-9 || acc.lMax > L_HI + 1e-9 || acc.cMin < C_LO - 1e-9) {
		violations.push(`tiles outside the readable window (L* ${acc.lMin.toFixed(0)}–${acc.lMax.toFixed(0)}, C*min ${acc.cMin.toFixed(0)})`);
	}
	if (acc.badTargetCount || acc.badIndex) {
		violations.push('a round did not have exactly one correct tile');
	}
	if (acc.hatches) {
		violations.push(`escape hatch fired ${acc.hatches}× — the sampler could not satisfy the config`);
	}
	if (acc.badTiles) violations.push('tile count did not match the tier');

	const medDist = dists.length ? pct(dists, 0.5) : 0;
	// More decoys means more chances to be fooled; sqrt is the right shape for
	// "nearest of n samples". This is the scalar the difficulty label reads.
	const effective = medDist / Math.sqrt(Math.max(1, band.tiles - 1));

	return {
		difficulty: acc.difficulty, level: acc.level, band,
		rounds: acc.rounds, tiles: band.tiles,
		minDist: dists.length ? dists[0] : 0,
		p05: dists.length ? pct(dists, 0.05) : 0,
		medDist,
		p95: dists.length ? pct(dists, 0.95) : 0,
		minPair,
		fallbackPct: acc.decoys ? (acc.fallbacks / acc.decoys) * 100 : 0,
		hatchPct: acc.decoys ? (acc.hatches / acc.decoys) * 100 : 0,
		lMin: acc.lMin, lMax: acc.lMax, cMin: acc.cMin,
		msPerRound: acc.rounds ? acc.ms / acc.rounds : 0,
		violations,
		effective,
		label: labelFor(effective),
	};
}

/* ------------------------------------------------------------------ *
 * Pressure — cheap live feedback, no sampling required
 * ------------------------------------------------------------------ */

/**
 * The generator spreads n decoys by stratified azimuth on a ring of radius
 * ~dMin, so adjacent decoys sit about 2*dMin*sin(pi/n) apart. Comparing the
 * required pairwise separation against that spacing says how hard the sampler
 * will have to fight.
 *
 * Shipped defaults score easy 0.32, medium 0.60, hard 1.16 — HARD is already
 * above 1, which is exactly why it has the highest fallback rate and needs the
 * mid-loop relaxation. So this is a calibrated warning, never a reject.
 */
export function pressure(tier) {
	const n = Math.max(2, tier.tiles - 1);
	return tier.sepFloor / (2 * tier.minF * Math.sin(Math.PI / n));
}

export function pressureLabel(p) {
	if (p < 0.7) return { tone: 'ok', text: 'comfortable' };
	if (p <= 1.2) return { tone: 'warn', text: 'tight — about as tight as shipped HARD' };
	return { tone: 'bad', text: 'over-constrained — expect fallbacks' };
}

/* ------------------------------------------------------------------ *
 * Difficulty labelling
 * ------------------------------------------------------------------ */

/**
 * Calibrated against the SHIPPED default table rather than invented thresholds,
 * so a label means something concrete: "harder than shipped HARD at level 60".
 *
 * Regenerate after any change to the default tier table:
 *     node validate.mjs --anchors
 */
export const ANCHORS = [
	{ at: 33.1, label: 'TRIVIAL',     note: 'easier than EASY at level 1' },
	{ at: 16.4, label: 'RELAXED',     note: 'around EASY at high levels' },
	{ at: 12.1, label: 'MODERATE',    note: 'around MEDIUM at level 1' },
	{ at: 5.9,  label: 'CHALLENGING', note: 'around MEDIUM late / HARD early' },
	{ at: 2.4,  label: 'BRUTAL',      note: 'around HARD at level 60' },
];

export function labelFor(effective) {
	for (const a of ANCHORS) {
		if (effective >= a.at) return { label: a.label, note: a.note };
	}
	return { label: 'UNFAIR', note: 'harder than anything the shipped game asks for' };
}

/* ------------------------------------------------------------------ *
 * Sampling drivers
 * ------------------------------------------------------------------ */

/** Synchronous run. Used by validate.mjs under node. */
export function sampleSync(difficulty, level, rounds, now = () => 0) {
	const acc = createAccumulator(difficulty, level);
	const t0 = now();
	for (let i = 0; i < rounds; i++) {
		accumulate(acc, measureRound(generateRound({ difficulty, level })));
	}
	acc.ms = now() - t0;
	return finish(acc);
}

/**
 * Time-sliced run for the browser.
 *
 * 300 rounds is 30-150ms of solid compute — up to nine dropped frames in one
 * tick. rAF with an explicit budget keeps the progress bar moving and adapts
 * itself to slow phones. Not requestIdleCallback (Safari still lacks it and
 * there is no build step to add a polyfill); not a worker (module workers fail
 * silently on older WebViews, and this size does not justify it).
 *
 * If the sample size ever passes ~2000 rounds, move to a module worker —
 * analyze.js is already worker-safe for the same reason it is node-safe.
 */
export function sampleSliced({ difficulty, levels, perCell = 50, budgetMs = 6, onProgress }) {
	const cells = levels.map((level) => ({
		level, acc: createAccumulator(difficulty, level), left: perCell,
	}));
	let i = 0, done = 0;
	const total = cells.length * perCell;

	return new Promise((resolve) => {
		const step = () => {
			const t0 = performance.now();
			while (i < cells.length && performance.now() - t0 < budgetMs) {
				const c = cells[i];
				const r0 = performance.now();
				accumulate(c.acc, measureRound(generateRound({ difficulty, level: c.level })));
				c.acc.ms += performance.now() - r0;
				done++;
				if (--c.left === 0) i++;
			}
			onProgress?.(done / total);
			if (i < cells.length) requestAnimationFrame(step);
			else resolve(cells.map((c) => finish(c.acc)));
		};
		requestAnimationFrame(step);
	});
}
