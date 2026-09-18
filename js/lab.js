/**
 * lab.js — the Game Tuning Lab.
 *
 * Lazily imported and deliberately absent from the service worker precache, so
 * players never download it.
 *
 * Every control here is generated from config.js's SCHEMA and reads back into
 * the real engine. If a value has no consumer in color.js or game.js, it does
 * not get a control — a decorative knob is worse than no knob.
 *
 * Access is UI concealment, not security. Anything reachable from the client is
 * reachable by anyone who opens devtools; this only keeps it out of the way.
 */

import {
	CONFIG, DEFAULTS, SCHEMA, schemaFor,
	applyConfig, resetConfig, diffFromDefaults, getPath, setPath,
} from './config.js';
import { TIERS, rgbToCss } from './color.js';
import { generateRound } from './color.js';
import { sampleSliced, pressure, pressureLabel } from './analyze.js';
import * as storage from './storage.js';

const DIFFS = ['easy', 'medium', 'hard'];
const MODES_K = ['arcade', 'steady', 'zen'];
const SAMPLE_LEVELS = [1, 5, 10, 20, 40, 60];
const SAMPLE_PER_CELL = 50;

/** Fields shown per tier, in the order the user asked for them. */
const TIER_FIELDS = ['tiles', 'min0', 'max0', 'minF', 'maxF', 'decay', 'sepFrac', 'sepFloor', 'lWeight', 'timer', 'scoreMult', 'lives'];

let root = null;
let draft = null;      // sparse override being edited
let onClose = null;
let game = null;
let sampling = false;

export function mount(opts = {}) {
	game = opts.game;
	onClose = opts.onClose;
	game?.pause();                       // banks remaining time; resume() restores it
	draft = structuredClone(diffFromDefaults());
	root = document.getElementById('screen-lab');
	render();
}

/* ------------------------------------------------------------------ *
 * Draft helpers
 * ------------------------------------------------------------------ */

const effective = (path) => {
	const d = getPath(draft, path);
	return d === undefined ? getPath(CONFIG, path) : d;
};

const isChanged = (path) => JSON.stringify(effective(path)) !== JSON.stringify(getPath(DEFAULTS, path));

function setDraft(path, value) {
	setPath(draft, path, value);
	// Apply immediately so the sample board, pressure figures and summary always
	// describe what the engine would actually do, not what the inputs say.
	const { warnings } = applyConfig(draft, { persist: false });
	// Read the sanitized result back so a clamped value never silently differs
	// from what the field shows.
	draft = structuredClone(diffFromDefaults());
	return warnings;
}

/** Which part of the engine a path affects — decides PLAYTEST behaviour. */
const touchesGeneration = (d) => !!(d.tiers || d.engine || d.ramp);

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function render() {
	root.replaceChildren(el('div', { class: 'lab' }, [
		head(),
		section('Color generation', [grid(engineFields())]),
		section('Difficulty', DIFFS.flatMap(tierBlock)),
		section('Progression', [grid(rampFields())]),
		section('Scoring', [grid(scoringFields())]),
		section('Modes', MODES_K.flatMap(modeBlock)),
		warnBox(),
		section('Configuration summary', [summaryBox()]),
		section('Export', [exportBox()]),
		actions(),
	]));
	refreshDynamic();
}

function head() {
	return el('div', { class: 'lab__head' }, [
		el('div', {}, [
			el('h2', { class: 'lab__title' }, ['GAME TUNING LAB']),
			el('p', { class: 'lab__sub' }, [
				'Every control below is wired to the live engine. Distances are CIEDE2000 (ΔE00): ',
				'4–5 is the practical limit of discrimination on separated tiles, 10 is distinct with effort, 40+ reads as unrelated. ',
				'Scores are not recorded while any value differs from the defaults.',
			]),
		]),
		el('button', { class: 'iconbtn', onclick: () => close(false) }, ['CLOSE']),
	]);
}

function section(title, children) {
	return el('section', { class: 'lab__section' }, [el('h3', {}, [title]), ...children]);
}

const grid = (fields) => el('div', { class: 'lab__grid' }, fields);

function engineFields() {
	return ['sepAbs', 'lLo', 'lHi', 'cLo', 'maxTry', 'levelCap', 'relaxAt', 'relaxFactor', 'maxOvershoot']
		.map((k) => field(`engine.${k}`));
}

function rampFields() {
	return ['enabled', 'levelDownOnWrong', 'levelMax', 'timerFloor', 'timerStep']
		.map((k) => field(`ramp.${k}`));
}

function scoringFields() {
	return ['baseAward', 'timeBonusMax', 'minAward', 'cleanBonus', 'wrongPenalty', 'minScore', 'peekPenalty', 'noLivesWrongPenalty']
		.map((k) => field(`scoring.${k}`));
}

function tierBlock(tier) {
	return [
		el('div', { class: 'lab__tierhead' }, [
			tier.toUpperCase(),
			el('span', { class: 'lab__pressure', id: `press-${tier}` }, ['']),
		]),
		grid(TIER_FIELDS.map((k) => field(`tiers.${tier}.${k}`))),
	];
}

function modeBlock(mode) {
	return [
		el('div', { class: 'lab__tierhead' }, [mode.toUpperCase()]),
		grid(['lives', 'timed', 'canSkip'].map((k) => field(`modes.${mode}.${k}`))),
	];
}

/** One control, generated from SCHEMA so bounds and UI cannot drift. */
function field(path) {
	const spec = schemaFor(path);
	if (!spec) return el('div', {});
	const value = effective(path);

	let input;
	if (spec.type === 'bool') {
		input = el('input', { type: 'checkbox', class: 'switch', checked: !!value });
		input.addEventListener('change', () => commit(path, input.checked));
	} else {
		input = el('input', {
			type: 'number',
			min: spec.min, max: spec.max, step: spec.step,
			value: value == null ? '' : value,
			placeholder: spec.type === 'int?' ? 'inherit' : '',
		});
		input.addEventListener('change', () => {
			const raw = input.value.trim();
			commit(path, raw === '' && spec.type === 'int?' ? null : Number(raw));
		});
	}
	input.dataset.path = path;

	const label = el('span', { class: 'field__label' }, [spec.label || path.split('.').pop()]);
	label.dataset.changed = String(isChanged(path));

	const node = el('label', { class: 'field' }, [
		label,
		el('span', { class: 'field__row' }, [input]),
	]);
	if (spec.help) node.appendChild(el('span', { class: 'field__help' }, [spec.help]));
	return node;
}

function commit(path, value) {
	const warnings = setDraft(path, value);
	// Write the sanitized value back into every input. A field that keeps
	// showing a rejected number reads as a knob that does nothing.
	for (const input of root.querySelectorAll('[data-path]')) {
		const p = input.dataset.path;
		const v = effective(p);
		if (input.type === 'checkbox') input.checked = !!v;
		else input.value = v == null ? '' : v;
		const lbl = input.closest('.field')?.querySelector('.field__label');
		if (lbl) lbl.dataset.changed = String(isChanged(p));
	}
	showWarnings(warnings);
	refreshDynamic();
}

/* ------------------------------------------------------------------ *
 * Warnings
 * ------------------------------------------------------------------ */

function warnBox() {
	return el('div', { class: 'lab__warn', id: 'labWarn', hidden: true });
}

function showWarnings(list) {
	const box = document.getElementById('labWarn');
	if (!box) return;
	if (!list || !list.length) { box.hidden = true; return; }
	box.hidden = false;
	box.className = 'lab__warn';
	box.replaceChildren(
		el('strong', {}, ['Adjusted to stay solvable:']),
		el('ul', {}, list.map((w) => el('li', {}, [w]))),
	);
}

/* ------------------------------------------------------------------ *
 * Live figures — pressure and a sample board, no sampling required
 * ------------------------------------------------------------------ */

function refreshDynamic() {
	for (const tier of DIFFS) {
		const node = document.getElementById(`press-${tier}`);
		if (!node) continue;
		const p = pressure(TIERS[tier]);
		const lab = pressureLabel(p);
		node.textContent = `  sampler pressure ${p.toFixed(2)} — ${lab.text}`;
		node.dataset.tone = lab.tone;
	}
	drawSample();
}

function drawSample() {
	const host = document.getElementById('labSample');
	if (!host) return;
	const diff = document.getElementById('labTier')?.value || 'hard';
	const level = Number(document.getElementById('labLevel')?.value || 1);
	const round = generateRound({ difficulty: diff, level });
	host.style.setProperty('--cols', 3);
	host.replaceChildren(...round.tiles.map((rgb, i) => {
		const t = el('i', {});
		t.style.setProperty('--tile', rgbToCss(rgb));
		if (i === round.targetIndex) t.dataset.target = 'true';
		return t;
	}));
}

/* ------------------------------------------------------------------ *
 * Configuration summary — measured with the real generator
 * ------------------------------------------------------------------ */

function summaryBox() {
	const tier = el('select', { id: 'labTier', class: 'iconbtn' },
		DIFFS.map((d) => el('option', { value: d, selected: d === 'hard' }, [d.toUpperCase()])));
	const level = el('input', { type: 'number', id: 'labLevel', min: 1, max: 99, step: 1, value: 1 });
	tier.addEventListener('change', drawSample);
	level.addEventListener('change', drawSample);

	const runBtn = el('button', { class: 'iconbtn iconbtn--wide', onclick: runSample }, ['MEASURE']);

	return el('div', {}, [
		el('p', { class: 'lab__sub' }, [
			'Runs the real generator and reports what it actually produces. ',
			`${SAMPLE_PER_CELL} rounds per level, sliced across frames.`,
		]),
		el('div', { class: 'field__row', style: 'margin:.6rem 0; flex-wrap:wrap' }, [tier, level, runBtn]),
		el('div', { class: 'lab__sample', id: 'labSample' }),
		el('div', { id: 'labResult' }),
	]);
}

async function runSample() {
	if (sampling) return;
	sampling = true;
	const out = document.getElementById('labResult');
	const diff = document.getElementById('labTier').value;
	out.replaceChildren(el('p', { class: 'lab__sub' }, ['Measuring… 0%']));

	const rows = await sampleSliced({
		difficulty: diff,
		levels: SAMPLE_LEVELS,
		perCell: SAMPLE_PER_CELL,
		onProgress: (p) => {
			const n = out.querySelector('p');
			if (n) n.textContent = `Measuring… ${Math.round(p * 100)}%`;
		},
	});
	sampling = false;

	const problems = rows.flatMap((r) => r.violations.map((v) => `L${r.level}: ${v}`));
	const worst = rows[0];

	out.replaceChildren(
		el('div', { class: 'lab__verdict' }, [
			el('strong', {}, [worst.label.label]),
			el('span', {}, [`${diff.toUpperCase()} at level 1 — ${worst.label.note}`]),
		]),
		problems.length
			? el('div', { class: 'lab__warn lab__warn--bad' }, [
				el('strong', {}, ['This configuration is broken:']),
				el('ul', {}, problems.map((p) => el('li', {}, [p]))),
			])
			: el('p', { class: 'lab__sub lab__ok' }, ['All engine invariants hold across every sampled level.']),
		el('div', { class: 'lab__summary' }, [table(rows)]),
	);
}

function table(rows) {
	const head = ['lvl', 'band ΔE', 'min', 'med', 'p95', 'minPair', 'fallb%', 'hatch%', 'ms', 'rating'];
	return el('table', {}, [
		el('thead', {}, [el('tr', {}, head.map((h) => el('th', {}, [h])))]),
		el('tbody', {}, rows.map((r) => el('tr', {}, [
			el('td', {}, [String(r.level)]),
			el('td', {}, [`${r.band.dMin.toFixed(1)}–${r.band.dMax.toFixed(1)}`]),
			el('td', {}, [r.minDist.toFixed(1)]),
			el('td', {}, [r.medDist.toFixed(1)]),
			el('td', {}, [r.p95.toFixed(1)]),
			el('td', {}, [r.minPair.toFixed(1)]),
			el('td', {}, [r.fallbackPct.toFixed(1)]),
			el('td', {}, [r.hatchPct.toFixed(1)]),
			el('td', {}, [r.msPerRound.toFixed(2)]),
			el('td', {}, [r.label.label]),
		]))),
	]);
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function exportBox() {
	const area = el('textarea', { class: 'lab__export', id: 'labExport', readonly: true, spellcheck: 'false' });
	const btn = el('button', { class: 'iconbtn iconbtn--wide', onclick: () => fillExport(area) }, ['GENERATE']);
	return el('div', {}, [
		el('p', { class: 'lab__sub' }, ['Paste the override into js/config.js DEFAULTS to ship these values.']),
		el('div', { class: 'field__row', style: 'margin:.5rem 0' }, [btn]),
		area,
	]);
}

function fillExport(area) {
	const d = diffFromDefaults();
	area.value = Object.keys(d).length
		? `// Changed from defaults:\n${JSON.stringify(d, null, 2)}`
		: '// Configuration matches the shipped defaults.';
	area.select();
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function actions() {
	return el('div', { class: 'lab__actions' }, [
		el('button', { class: 'btn btn--primary', onclick: playtest }, ['PLAYTEST']),
		el('button', { class: 'btn btn--ghost', onclick: save }, ['SAVE']),
		el('button', { class: 'btn btn--ghost', onclick: reset }, ['RESET TO DEFAULTS']),
	]);
}

function save() {
	applyConfig(draft, { persist: true });
	showWarnings(['Saved. These rules persist across reloads.']);
}

function reset() {
	resetConfig();
	draft = {};
	render();
	showWarnings(['Restored the shipped defaults.']);
}

function playtest() {
	const regenerate = touchesGeneration(draft);
	applyConfig(draft, { persist: false });
	close(true, regenerate);
}

function close(resume, regenerate) {
	root.replaceChildren();
	if (resume && game) {
		if (game.status === 'paused' || game.status === 'playing') {
			// A generation change needs a fresh board; a scoring-only change keeps
			// the current one so the same round can be compared before and after.
			if (regenerate) game.nextRound();
			else game.resume();
		} else {
			// The lab was opened from the start or summary screen, so there is no
			// run to resume — PLAYTEST starts one rather than showing an empty board.
			game.start(storage.get('lastMode'), storage.get('lastDifficulty'));
		}
		document.body.dataset.screen = 'play';
		for (const id of ['start', 'play', 'over', 'learn', 'lab']) {
			const n = document.getElementById(`screen-${id}`);
			if (n) n.hidden = id !== 'play';
		}
	}
	onClose?.(!!resume);
}

/* ------------------------------------------------------------------ *
 * Tiny DOM helper
 * ------------------------------------------------------------------ */

function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === false || v === undefined || v === null) continue;
		if (k === 'onclick') node.addEventListener('click', v);
		else if (k === 'checked') node.checked = !!v;
		else if (k === 'selected') node.selected = !!v;
		else if (k === 'value') node.value = v;
		else if (k === 'hidden') node.hidden = !!v;
		else node.setAttribute(k, v);
	}
	for (const c of children) node.append(c?.nodeType ? c : String(c));
	return node;
}
