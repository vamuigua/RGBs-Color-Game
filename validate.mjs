/**
 * validate.mjs — invariant harness for the color engine.
 *
 *   node validate.mjs            run the full sweep
 *   node validate.mjs --anchors  regenerate the difficulty anchors in analyze.js
 *
 * This is a keeper, not a throwaway. An earlier iteration of the engine used
 * dE76 for its pairwise guard with a floor of 6.0; this harness revealed those
 * pairs measured dE00 as low as 1.1 — genuinely indistinguishable tiles, an
 * unsolvable board. That finding is why every guard in color.js is dE00.
 *
 * Measurement lives in js/analyze.js, shared with the Tuning Lab so the two can
 * never disagree. What stays here is CI POLICY: the health thresholds below.
 *
 * Re-run after any change to the tier table, the sampling strategy, or the
 * tile counts.
 */

import { resetConfig } from './js/config.js';
import { sampleSync, pressure } from './js/analyze.js';
import { TIERS } from './js/color.js';

// Make it load-bearing rather than incidental that the harness tests DEFAULTS.
// Today node has no localStorage so nothing could have been loaded, but the
// moment someone adds a config file or env override for CI experiments, this
// line is what keeps the gate honest.
resetConfig({ persist: false });

const ROUNDS = 2000;
const LEVELS = [1, 5, 10, 20, 40, 60];
const TIER_NAMES = ['easy', 'medium', 'hard'];

// --- CI policy. Deliberately NOT in analyze.js. -------------------------
const MAX_FALLBACK_PCT = 30;   // dMax is soft, so EASY at L1 legitimately runs ~29%
const MIN_TIER_RATIO = 1.5;    // each tier must stay clearly apart from the next

const f = (n, w = 6) => n.toFixed(2).padStart(w);
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

/* ------------------------------------------------------------------ */

if (process.argv.includes('--anchors')) {
	// effective = median dE / sqrt(tiles-1), measured on the default table.
	// Paste the result into ANCHORS in js/analyze.js.
	const rows = [
		['easy', 1, 'TRIVIAL', 'easier than EASY at level 1'],
		['easy', 60, 'RELAXED', 'around EASY at high levels'],
		['medium', 1, 'MODERATE', 'around MEDIUM at level 1'],
		['medium', 60, 'CHALLENGING', 'around MEDIUM late / HARD early'],
		['hard', 60, 'BRUTAL', 'around HARD at level 60'],
	];
	console.log('\nexport const ANCHORS = [');
	for (const [tier, level, label, note] of rows) {
		const s = sampleSync(tier, level, 1500, now);
		console.log(`\t{ at: ${s.effective.toFixed(1)}, label: '${label}', note: '${note}' },`);
	}
	console.log('];\n');
	process.exit(0);
}

const failures = [];
const medians = {};

console.log(`\nRGBs color engine — ${ROUNDS} rounds x ${TIER_NAMES.length} tiers x ${LEVELS.length} levels\n`);
console.log('tier    lvl  band dE00        min    med    p95   minPair  fallb%  hatch%  ms/rnd');
console.log('------  ---  --------------  -----  -----  -----  -------  ------  ------  ------');

for (const tier of TIER_NAMES) {
	for (const level of LEVELS) {
		const s = sampleSync(tier, level, ROUNDS, now);
		medians[`${tier}:${level}`] = s.medDist;

		// Engine invariants — analyze.js already decided these are violations.
		for (const v of s.violations) failures.push(`${tier} L${level}: ${v}`);

		// Health metric — policy, owned here.
		if (s.fallbackPct > MAX_FALLBACK_PCT) {
			failures.push(`${tier} L${level}: fallback rate ${s.fallbackPct.toFixed(1)}% > ${MAX_FALLBACK_PCT}%`);
		}

		console.log(
			`${tier.padEnd(6)}  ${String(level).padStart(3)}  ` +
			`[${f(s.band.dMin, 4)},${f(s.band.dMax, 5)}]  ` +
			`${f(s.minDist, 5)}  ${f(s.medDist, 5)}  ${f(s.p95, 5)}  ` +
			`${f(s.minPair, 7)}  ${f(s.fallbackPct, 6)}  ${f(s.hatchPct, 6)}  ${s.msPerRound.toFixed(3)}`
		);
	}
	console.log('');
}

console.log('Sampler pressure (sepFloor vs the spacing stratified azimuth actually gives):');
for (const tier of TIER_NAMES) {
	const p = pressure(TIERS[tier]);
	console.log(`  ${tier.padEnd(6)} P = ${p.toFixed(2)}${p > 1.2 ? '  WARN over-constrained' : ''}`);
}

console.log('\nTier separation (median dE00 ratio vs the next harder tier):');
for (const level of LEVELS) {
	const e = medians[`easy:${level}`], m = medians[`medium:${level}`], h = medians[`hard:${level}`];
	const em = e / m, mh = m / h;
	const ok = em >= MIN_TIER_RATIO && mh >= MIN_TIER_RATIO;
	console.log(`  L${String(level).padStart(2)}  easy/medium ${em.toFixed(2)}x   medium/hard ${mh.toFixed(2)}x   ${ok ? 'ok' : 'WARN < ' + MIN_TIER_RATIO + 'x'}`);
	if (!ok) failures.push(`L${level}: tier medians converge (easy/medium ${em.toFixed(2)}x, medium/hard ${mh.toFixed(2)}x)`);
}

console.log('');
if (failures.length) {
	console.log(`FAILED — ${failures.length} problem(s):`);
	for (const x of failures) console.log('  x ' + x);
	process.exit(1);
}
console.log('All hard invariants hold.');
