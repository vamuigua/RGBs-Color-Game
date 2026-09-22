/**
 * color.js — perceptual color engine for The RGBs Game.
 *
 * Difficulty comes from perceptual similarity, not tile count.
 *
 * Strategy: sample in CIELAB using dE76 (Euclidean, so "a color at exactly
 * distance d" is closed-form), but accept/reject using dE00 (accurate, but not
 * a metric — it violates the triangle inequality, so it can only be measured).
 * The whole difficulty table is expressed in dE00 because that is what the
 * player actually perceives.
 *
 * No DOM dependency: validate.mjs imports this directly under node.
 */

import { CONFIG, subscribe } from './config.js';

/* ------------------------------------------------------------------ *
 * Color space conversions (sRGB D65 <-> CIELAB)
 * ------------------------------------------------------------------ */

const EPS = 216 / 24389;   // 0.0088564516
const KAPPA = 24389 / 27;  // 903.2962963
const DX = 0.95047, DY = 1.0, DZ = 1.08883; // D65 white point

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// NOTE: this must keep its piecewise form. Out-of-gamut conversions produce
// negative linear values, and Math.pow(negative, 1/2.4) is NaN. The <= branch
// catches negatives and returns a safely negative number. Do not "simplify".
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const f = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const fi = (t) => { const t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAPPA; };

export function rgbToLab(p) {
	const r = s2l(p[0] / 255), g = s2l(p[1] / 255), b = s2l(p[2] / 255);
	const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / DX;
	const Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / DY;
	const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / DZ;
	const fx = f(X), fy = f(Y), fz = f(Z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** @returns {{rgb: number[], inGamut: boolean}} rgb is always clamped + rounded. */
export function labToRgb(L) {
	const fy = (L[0] + 16) / 116, fx = fy + L[1] / 500, fz = fy - L[2] / 200;
	const X = fi(fx) * DX;
	const Y = (L[0] > KAPPA * EPS ? fy * fy * fy : L[0] / KAPPA) * DY;
	const Z = fi(fz) * DZ;
	const lin = [
		3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
		-0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
		0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
	];
	let inGamut = true;
	const out = [0, 0, 0];
	for (let i = 0; i < 3; i++) {
		const v = l2s(lin[i]) * 255;
		if (v < -0.5 || v > 255.5) inGamut = false;
		out[i] = Math.min(255, Math.max(0, Math.round(v)));
	}
	return { rgb: out, inGamut };
}

export const deltaE76 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const POW25_7 = 6103515625; // 25^7, precomputed

export function deltaE00(L1, L2) {
	const l1 = L1[0], a1 = L1[1], b1 = L1[2];
	const l2 = L2[0], a2 = L2[1], b2 = L2[2];
	const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
	const Cb = (C1 + C2) / 2, Cb7 = Math.pow(Cb, 7);
	const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + POW25_7)));
	const A1 = (1 + G) * a1, A2 = (1 + G) * a2;
	const Cp1 = Math.hypot(A1, b1), Cp2 = Math.hypot(A2, b2);
	const h1 = (Math.atan2(b1, A1) * 180 / Math.PI + 360) % 360;
	const h2 = (Math.atan2(b2, A2) * 180 / Math.PI + 360) % 360;
	const dL = l2 - l1, dC = Cp2 - Cp1;
	let dh = 0;
	if (Cp1 * Cp2 !== 0) {
		dh = h2 - h1;
		if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
	}
	const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * Math.PI / 360);
	const Lb = (l1 + l2) / 2, Cpb = (Cp1 + Cp2) / 2;
	let hb;
	if (Cp1 * Cp2 === 0) hb = h1 + h2;
	else {
		hb = (h1 + h2) / 2;
		if (Math.abs(h1 - h2) > 180) hb += (h1 + h2 < 360) ? 180 : -180;
	}
	const T = 1
		- 0.17 * Math.cos((hb - 30) * Math.PI / 180)
		+ 0.24 * Math.cos(2 * hb * Math.PI / 180)
		+ 0.32 * Math.cos((3 * hb + 6) * Math.PI / 180)
		- 0.20 * Math.cos((4 * hb - 63) * Math.PI / 180);
	const Cpb7 = Math.pow(Cpb, 7);
	const Rc = 2 * Math.sqrt(Cpb7 / (Cpb7 + POW25_7));
	const Sl = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
	const Sc = 1 + 0.045 * Cpb;
	const Sh = 1 + 0.015 * Cpb * T;
	const Rt = -Math.sin(2 * 30 * Math.exp(-Math.pow((hb - 275) / 25, 2)) * Math.PI / 180) * Rc;
	const tL = dL / Sl, tC = dC / Sc, tH = dH / Sh;
	return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
}

/* ------------------------------------------------------------------ *
 * Difficulty tiers
 * ------------------------------------------------------------------ */

/**
 * All distances are dE00. The values themselves live in config.js so the
 * Tuning Lab can change them; the reasoning behind them lives here.
 *
 * Textbook dE anchors assume large ADJACENT patches. These are separated tiles
 * with a border and a near-black background between them, which raises the
 * practical threshold ~2-3x. A floor at the textbook JND of 1-2 would make the
 * game a coin flip. Hence SEP_ABS = 4.0.
 *
 *   min0/max0        band at level 1
 *   minF/maxF        asymptotic floor the ramp decays toward
 *   decay            geometric ramp rate
 *   sepFrac/sepFloor minimum separation between every PAIR of tiles
 *   lWeight          cap on the L* component of the perturbation direction.
 *                    Lightness is our sharpest channel and pops hardest against
 *                    a dark background, so EASY allows lightness cues freely
 *                    (0.90) while HARD forces >=89% of the shift to be
 *                    chromatic (0.45). This makes the tiers differ
 *                    qualitatively, not just numerically.
 *
 * THESE ARE LIVE BINDINGS, reassigned when the config changes. Never
 * destructure them at module scope — `const { hard } = TIERS` pins a stale
 * table and the failure is silent.
 */
export let TIERS = CONFIG.tiers;
export let SEP_ABS = CONFIG.engine.sepAbs;
export let L_LO = CONFIG.engine.lLo;
export let L_HI = CONFIG.engine.lHi;
export let C_LO = CONFIG.engine.cLo;

subscribe((c) => {
	TIERS = c.tiers;
	SEP_ABS = c.engine.sepAbs;
	L_LO = c.engine.lLo;
	L_HI = c.engine.lHi;
	C_LO = c.engine.cLo;
});

export function bandFor(difficulty, level) {
	const t = TIERS[difficulty] || TIERS.medium;
	// Ramp off means a permanent level-1 band. This gate has to be consistent
	// with the timer and the level counter (see game.js) or the level climbs
	// while the difficulty does not, which reads as a bug.
	const k = CONFIG.ramp.enabled
		? Math.pow(t.decay, Math.min(level, CONFIG.engine.levelCap) - 1)
		: 1;
	const dMin = t.minF + (t.min0 - t.minF) * k;
	const dMax = t.maxF + (t.max0 - t.maxF) * k;
	return {
		dMin, dMax,
		dSep: Math.max(t.sepFloor, t.sepFrac * dMin),
		tiles: t.tiles,
		lWeight: t.lWeight,
	};
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * Target sampled in LCh, not RGB — uniform RGB oversamples dark high-chroma
 * corners and rejects constantly.
 *
 * Gamut handling is a bounded chroma walk-in rather than blind retry:
 * guaranteed to terminate (<=10 steps), and guaranteed to succeed because
 * C* = 15.6 is in gamut at every hue for L* in [42, 84].
 */
function pickTarget(rand, lLo, lHi) {
	// Deliberately inset from the [L_LO, L_HI] tile window so lRoom is never
	// zero. Derived rather than hardcoded: if the window is narrowed in the
	// Tuning Lab, a fixed [42, 84] would generate targets outside the operator's
	// own constraint and drive lRoom negative, which breaks the direction guard.
	// With the defaults (28, 92) this reproduces exactly [42, 84].
	const tLo = lLo + 14, tHi = lHi - 8;
	const L = tLo + rand() * Math.max(1, tHi - tLo);
	const h = rand() * 2 * Math.PI;
	let C = 26 + rand() * 52;        // [26, 78]
	for (let t = 0; t < 10; t++) {   // 0.85^10 -> C >= 15.6
		const c = labToRgb([L, C * Math.cos(h), C * Math.sin(h)]);
		// Re-measure Lab from the ROUNDED 8-bit rgb: that is what the player
		// sees. Using the ideal Lab overstates precision by up to ~0.5 dE,
		// which matters when HARD's floor is 4.5.
		if (c.inGamut) return { rgb: c.rgb, lab: rgbToLab(c.rgb) };
		C *= 0.85;
	}
	const c = labToRgb([L, C * Math.cos(h), C * Math.sin(h)]);
	return { rgb: c.rgb, lab: rgbToLab(c.rgb) };
}

/**
 * Deterministic last resort: 12 fixed well-spread directions at 1.5x dMax.
 * A larger radius means an easier tile, which is the safe failure direction.
 */
function escapeHatch(target, labs, band, scale, lRoom) {
	const dd = band.dMax * 1.5 * scale;
	const czCap = Math.min(0.3, lRoom / dd);
	let best = null, bestScore = -1;
	for (let k = 0; k < 12; k++) {
		const az = k * Math.PI / 6;
		const cz = czCap * ((k % 2) ? 1 : -1);
		const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
		const conv = labToRgb([
			target.lab[0] + dd * cz,
			target.lab[1] + dd * sz * Math.cos(az),
			target.lab[2] + dd * sz * Math.sin(az),
		]);
		const lb = rgbToLab(conv.rgb);
		let sc = Infinity;
		for (const o of labs) sc = Math.min(sc, deltaE00(lb, o));
		if (sc > bestScore) { bestScore = sc; best = { rgb: conv.rgb, lab: lb }; }
	}
	return best;
}

function shuffle(n, rand) {
	const a = Array.from({ length: n }, (_, i) => i);
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const t = a[i]; a[i] = a[j]; a[j] = t;
	}
	return a;
}

/**
 * Generate one round.
 *
 * Governing invariant:
 *   dMin is a HARD floor — it protects solvability, never relaxed below SEP_ABS.
 *   dMax is a SOFT preference — it only controls difficulty.
 * Every fallback path therefore fails in the EASY direction. A round may come
 * out easier than the tier wants; it can never come out unsolvable.
 *
 * @returns {{tiles: number[][], targetIndex: number, targetCss: string,
 *            targetHex: string, targetRgb: number[], band: object,
 *            stats: {fallbacks: number, hatches: number}}}
 */
export function generateRound({ difficulty = 'medium', level = 1, rand = Math.random } = {}) {
	const band = bandFor(difficulty, level);
	// Hoisted once per round. Leaving these as CONFIG.engine.x lookups would put
	// two property hops inside the innermost loop condition; here it costs eight
	// reads per round and zero per iteration.
	const { sepAbs, lLo, lHi, cLo, maxTry, relaxAt, relaxFactor, maxOvershoot } = CONFIG.engine;
	const target = pickTarget(rand, lLo, lHi);
	const n = band.tiles - 1;

	// dE00 -> dE76 sampling radius. The ratio is almost entirely predictable
	// from the target's chroma; this fit lands within ~7% across the range,
	// so the sampler's first guess is almost always accepted.
	const Ct = Math.hypot(target.lab[1], target.lab[2]);
	const scale = 1 + 0.0184 * Ct;
	const lRoom = Math.min(target.lab[0] - lLo, lHi - target.lab[0]);

	const labs = [target.lab];
	const rgbs = [target.rgb];
	let fallbacks = 0, hatches = 0;

	for (let i = 0; i < n; i++) {
		// Stratified magnitude: guarantees one decoy sits near dMin every round,
		// so HARD is reliably hard rather than occasionally-lucky. This is also
		// why the final order MUST be shuffled (decoy 0 is always the closest).
		const want = band.dMin + (band.dMax - band.dMin) * ((i + rand()) / n);
		let r = want * scale;
		let best = null, bestScore = -1, sep = band.dSep;
		let satisfied = false;

		for (let t = 0; t < maxTry; t++) {
			if (t === relaxAt) sep = Math.max(sepAbs, band.dSep * relaxFactor); // one relaxation

			// Analytic L* guard: cap the L component so the result provably
			// lands inside [L_LO, L_HI] instead of generating and rejecting.
			const czCap = Math.min(band.lWeight, lRoom / Math.min(r, 90));
			// Stratified azimuth: decoy i takes hue sector i of n, jittered.
			// Spreads decoys around a ring instead of clustering them.
			const az = ((i + rand()) / n) * 2 * Math.PI + (t >= relaxAt ? rand() * 2 * Math.PI : 0);
			const cz = (rand() * 2 - 1) * czCap;
			const sz = Math.sqrt(Math.max(0, 1 - cz * cz));

			const conv = labToRgb([
				target.lab[0] + r * cz,
				target.lab[1] + r * sz * Math.cos(az),
				target.lab[2] + r * sz * Math.sin(az),
			]);
			// Re-measure after clamp + round. Naive clamping silently shortens
			// the real distance and can collapse two decoys onto each other, so
			// the constraint must apply to what is displayed, not what was intended.
			const lb = rgbToLab(conv.rgb);

			const dT = deltaE00(lb, target.lab);
			let score = Infinity;
			for (let j = 0; j < labs.length; j++) score = Math.min(score, deltaE00(lb, labs[j]));

			const C = Math.hypot(lb[1], lb[2]);
			const geomOk = lb[0] >= lLo && lb[0] <= lHi && C >= cLo;

			if (conv.inGamut && geomOk && dT >= band.dMin && dT <= band.dMax * maxOvershoot && score >= sep) {
				best = { rgb: conv.rgb, lab: lb };
				satisfied = true;
				break;
			}
			// Keep the least-bad candidate that still clears BOTH hard floors.
			if (geomOk && dT >= band.dMin && score >= sepAbs && score > bestScore) {
				bestScore = score;
				best = { rgb: conv.rgb, lab: lb };
			}
			// A failed attempt carries information: damped secant step on the radius.
			if (dT > 0.5) r = Math.max(2, Math.min(150, r * (0.5 + 0.5 * want / dT)));
		}

		if (!satisfied) fallbacks++;
		if (!best) { best = escapeHatch(target, labs, band, scale, lRoom); hatches++; }
		labs.push(best.lab);
		rgbs.push(best.rgb);
	}

	const order = shuffle(rgbs.length, rand);
	return {
		tiles: order.map((k) => rgbs[k]),
		targetIndex: order.indexOf(0),
		targetRgb: target.rgb,
		targetCss: rgbToCss(target.rgb),
		targetHex: rgbToHex(target.rgb),
		band,
		stats: { fallbacks, hatches },
	};
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

export const rgbToCss = (p) => 'rgb(' + p[0] + ', ' + p[1] + ', ' + p[2] + ')';

export const rgbToHex = (p) =>
	'#' + p.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();

/** WCAG relative luminance -> pick black or white label text over an arbitrary color. */
export function contrastingTextOn(p) {
	const lum = 0.2126 * s2l(p[0] / 255) + 0.7152 * s2l(p[1] / 255) + 0.0722 * s2l(p[2] / 255);
	return lum > 0.18 ? '#0B0D12' : '#F2F4F8';
}
