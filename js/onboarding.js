/**
 * onboarding.js — teach RGB through the game, not beside it.
 *
 * Six stages on a screen that reuses the real HUD, tiles, animations and type.
 * Stages 1-3 and 6 use the actual board; 4 and 5 add the only two widgets that
 * a board cannot express — additive mixing, and the 0-255 scale.
 *
 * Nothing here writes to the score table. The tutorial is for understanding,
 * and a scripted board is not an achievement.
 */

import { generateRound, rgbToCss, rgbToHex, contrastingTextOn } from './color.js';
import * as storage from './storage.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);

const PURE = {
	red:   [255, 0, 0],
	green: [0, 255, 0],
	blue:  [0, 0, 255],
};

const STAGE_COUNT = 6;

/** Stage 4's four micro-tasks: which channels must be on, and what that makes. */
const MIXES = [
	{ want: [1, 1, 0], name: 'YELLOW',  line: 'Red + Green makes <b>yellow</b>.' },
	{ want: [1, 0, 1], name: 'MAGENTA', line: 'Red + Blue makes <b>magenta</b>.' },
	{ want: [0, 1, 1], name: 'CYAN',    line: 'Green + Blue makes <b>cyan</b>.' },
	{ want: [1, 1, 1], name: 'WHITE',   line: 'All three at full makes <b>white</b>.' },
];

/** Stage 5's slider tasks. Tolerance is generous: this is a lesson, not a test. */
const SLIDER_TASKS = [
	{ want: [255, 0, 0], tol: 12, ask: 'Drag <b>R</b> all the way up.', done: 'rgb(255, 0, 0) is pure red.' },
	{ want: [255, 100, 0], tol: 25, ask: 'Now bring <b>G</b> to about 100.', done: 'A little green turns red into orange.' },
];

let el = {};
let onDone = null;
let stage = 0;
let mixStep = 0;
let sliderStep = 0;
let realRound = null;
let wired = false;

export function start(hooks = {}) {
	onDone = hooks.onDone;
	cache();
	if (!wired) { wire(); wired = true; }
	stage = 0;
	enterStage();
}

function cache() {
	el = {
		label: $('learnLabel'), card: $('learnCard'),
		rgb: $('learnRgb'), hex: $('learnHex'),
		bars: $('learnBars'), barR: $('learnBarR'), barG: $('learnBarG'), barB: $('learnBarB'),
		strip: $('learnStrip'), board: $('learnBoard'),
		mixer: $('learnMixer'), mixResult: $('mixerResult'), mixName: $('mixerName'),
		sliders: $('learnSliders'), swatch: $('sliderSwatch'),
		sl: [$('slR'), $('slG'), $('slB')],
		slOut: [$('slROut'), $('slGOut'), $('slBOut')],
		next: $('learnNext'), skip: $('learnSkip'), stepper: $('learnStepper'),
	};
}

function wire() {
	el.board.addEventListener('click', (e) => {
		const tile = e.target.closest('.tile');
		if (!tile || el.board.dataset.locked === 'true') return;
		audio.arm();   // first real gesture of the session
		onTilePick(Number(tile.dataset.index));
	});

	el.mixer.addEventListener('click', (e) => {
		const chip = e.target.closest('.chip');
		if (!chip) return;
		audio.arm();
		chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
		onMixChange();
	});

	// Wrapped, not passed directly: the listener would hand onSliderChange the
	// Event as its first argument, which the `silent` flag would read as true
	// and skip the completion check entirely.
	for (const input of el.sl) input.addEventListener('input', () => onSliderChange());

	el.next.addEventListener('click', advance);
	el.skip.addEventListener('click', finish);
}

/* ------------------------------------------------------------------ *
 * Stage routing
 * ------------------------------------------------------------------ */

function enterStage() {
	renderStepper();
	el.next.hidden = true;
	el.board.hidden = true;
	el.mixer.hidden = true;
	el.sliders.hidden = true;
	el.board.dataset.locked = 'false';
	el.card.dataset.revealed = 'false';
	el.hex.textContent = '';

	if (stage <= 2) return stageIdentify(['red', 'green', 'blue'][stage]);
	if (stage === 3) return stageMix();
	if (stage === 4) return stageSliders();
	return stageReal();
}

function advance() {
	stage += 1;
	if (stage >= STAGE_COUNT) return finish();
	enterStage();
}

function finish() {
	storage.set('onboarded', true);
	onDone?.();
}

function renderStepper() {
	el.stepper.replaceChildren(...Array.from({ length: STAGE_COUNT }, (_, i) => {
		const dot = document.createElement('i');
		dot.className = 'stepper__dot';
		dot.dataset.state = i < stage ? 'done' : i === stage ? 'now' : 'todo';
		return dot;
	}));
	el.stepper.setAttribute('aria-label', `Step ${stage + 1} of ${STAGE_COUNT}`);
}

function say(html, tone) {
	el.strip.innerHTML = html;
	el.strip.dataset.tone = tone || '';
	el.strip.removeAttribute('data-anim');
	void el.strip.offsetWidth;
	el.strip.dataset.anim = 'in';
}

function setBars(rgb) {
	el.barR.style.width = `${(rgb[0] / 255) * 100}%`;
	el.barG.style.width = `${(rgb[1] / 255) * 100}%`;
	el.barB.style.width = `${(rgb[2] / 255) * 100}%`;
}

/* ------------------------------------------------------------------ *
 * Stages 1-3 — meet each channel
 * ------------------------------------------------------------------ */

const WORDS = { red: 'RED', green: 'GREEN', blue: 'BLUE' };
const LINES = {
	red: 'Meet <b>Red</b>. The <b>R</b> in RGB. Tap it.',
	green: 'Now find <b>Green</b> — the <b>G</b>.',
	blue: 'And <b>Blue</b>, the <b>B</b>. Last one.',
};

let wantChannel = null;

function stageIdentify(channel) {
	wantChannel = channel;
	el.label.textContent = 'FIND THIS COLOR';
	el.rgb.textContent = WORDS[channel];
	el.rgb.style.color = rgbToCss(PURE[channel]);
	setBars(PURE[channel]);
	el.bars.hidden = false;
	say(LINES[channel]);

	// Shuffled each time so stage 2 and 3 are not muscle memory.
	const order = shuffle(['red', 'green', 'blue']);
	renderTiles(order.map((k) => PURE[k]), order.indexOf(channel));
	el.board.hidden = false;
}

function onTilePick(index) {
	if (stage <= 2) {
		const correct = index === el.board.dataset.answer * 1;
		if (!correct) {
			markTile(index, 'miss');
			audio.wrong();
			say('Not quite — that one is a different channel.', 'bad');
			return;
		}
		markTile(index, 'win');
		audio.correct();
		el.card.dataset.revealed = 'true';
		el.card.style.setProperty('--reveal', rgbToCss(PURE[wantChannel]));
		el.card.style.setProperty('--readout', contrastingTextOn(PURE[wantChannel]));
		el.rgb.style.color = '';
		el.hex.textContent = rgbToCss(PURE[wantChannel]);
		lockBoard();
		say(`That&rsquo;s <b>${WORDS[wantChannel]}</b> — ${rgbToCss(PURE[wantChannel])}.`, 'good');
		showNext(stage === 2 ? 'NEXT: MIXING' : 'CONTINUE');
		return;
	}

	// Stage 6 — a real generated round.
	if (index !== realRound.targetIndex) {
		markTile(index, 'miss');
		audio.wrong();
		say('Not that one. Read the numbers again.', 'bad');
		return;
	}
	markTile(index, 'win');
	audio.correct();
	el.card.dataset.revealed = 'true';
	lockBoard();
	say('<b>You&rsquo;re ready.</b> That was a real round.', 'good');
	showNext('PLAY THE GAME');
}

function showNext(text) {
	el.next.textContent = text;
	el.next.hidden = false;
	el.next.focus();
}

function lockBoard() { el.board.dataset.locked = 'true'; }

function markTile(index, state) {
	const tile = el.board.children[index];
	if (!tile) return;
	tile.dataset.state = state;
	if (state === 'miss') setTimeout(() => { if (tile.isConnected) tile.dataset.state = 'dead'; }, 320);
}

function renderTiles(colors, answerIndex) {
	el.board.style.setProperty('--cols', 3);
	el.board.style.setProperty('--rows', Math.ceil(colors.length / 3));
	el.board.dataset.answer = answerIndex;
	const frag = document.createDocumentFragment();
	colors.forEach((rgb, i) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'tile';
		btn.dataset.index = i;
		btn.style.setProperty('--tile', rgbToCss(rgb));
		btn.style.setProperty('--delay', `${i * 30}ms`);
		btn.setAttribute('aria-label', `Option ${i + 1}, ${rgbToCss(rgb)}`);
		frag.appendChild(btn);
	});
	el.board.replaceChildren(frag);
}

function shuffle(arr) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/* ------------------------------------------------------------------ *
 * Stage 4 — additive mixing
 * ------------------------------------------------------------------ */

function stageMix() {
	mixStep = 0;
	el.label.textContent = 'MIX THE LIGHTS';
	el.rgb.textContent = 'R + G + B';
	el.rgb.style.color = '';
	el.bars.hidden = true;
	el.hex.textContent = '';
	for (const chip of el.mixer.querySelectorAll('.chip')) chip.setAttribute('aria-pressed', 'false');
	el.mixer.hidden = false;
	onMixChange(true);
	say(`Colors are <b>light being added together</b>. ${askMix()}`);
}

const askMix = () => `Turn on the ones that make <b>${MIXES[mixStep].name}</b>.`;

function onMixChange(silent) {
	const on = [...el.mixer.querySelectorAll('.chip')].map((c) => (c.getAttribute('aria-pressed') === 'true' ? 1 : 0));
	const rgb = [on[0] * 255, on[1] * 255, on[2] * 255];
	el.mixResult.style.setProperty('--mix', rgbToCss(rgb));
	el.mixResult.style.setProperty('--mixInk', contrastingTextOn(rgb));
	el.mixName.textContent = nameFor(on);

	if (silent) return;

	const want = MIXES[mixStep].want;
	if (on.every((v, i) => v === want[i])) {
		audio.correct();
		say(MIXES[mixStep].line, 'good');
		mixStep += 1;
		if (mixStep >= MIXES.length) {
			say('That is every combination. <b>Nice.</b>', 'good');
			showNext('NEXT: THE NUMBERS');
		} else {
			setTimeout(() => { if (stage === 3) say(askMix()); }, 1100);
		}
	}
}

function nameFor(on) {
	const key = on.join('');
	return {
		'000': 'OFF', '100': 'RED', '010': 'GREEN', '001': 'BLUE',
		'110': 'YELLOW', '101': 'MAGENTA', '011': 'CYAN', '111': 'WHITE',
	}[key] || '';
}

/* ------------------------------------------------------------------ *
 * Stage 5 — the 0-255 scale
 * ------------------------------------------------------------------ */

function stageSliders() {
	sliderStep = 0;
	el.label.textContent = 'HOW MUCH OF EACH';
	el.bars.hidden = true;
	el.hex.textContent = '';
	el.rgb.style.color = '';
	for (const s of el.sl) s.value = 0;
	el.sliders.hidden = false;
	onSliderChange(true);
	say(`Each channel runs <b>0 to 255</b>. ${SLIDER_TASKS[0].ask}`);
}

function onSliderChange(silent) {
	const rgb = el.sl.map((s) => Number(s.value));
	rgb.forEach((v, i) => { el.slOut[i].textContent = v; });
	const css = rgbToCss(rgb);
	el.swatch.style.setProperty('--mix', css);
	el.rgb.textContent = css;
	el.hex.textContent = rgbToHex(rgb);

	if (silent || sliderStep >= SLIDER_TASKS.length) return;

	const task = SLIDER_TASKS[sliderStep];
	if (rgb.every((v, i) => Math.abs(v - task.want[i]) <= task.tol)) {
		audio.correct();
		say(task.done, 'good');
		sliderStep += 1;
		if (sliderStep >= SLIDER_TASKS.length) {
			setTimeout(() => {
				if (stage === 4) say('That is the whole game: <b>read the numbers, find the color.</b>', 'good');
			}, 1100);
			showNext('I’M READY');
		} else {
			setTimeout(() => { if (stage === 4) say(SLIDER_TASKS[sliderStep].ask); }, 1100);
		}
	}
}

/* ------------------------------------------------------------------ *
 * Stage 6 — a real round
 * ------------------------------------------------------------------ */

function stageReal() {
	realRound = generateRound({ difficulty: 'easy', level: 1 });
	el.label.textContent = 'MATCH THIS COLOR';
	el.rgb.textContent = realRound.targetCss;
	el.rgb.style.color = '';
	el.hex.textContent = realRound.targetHex;
	setBars(realRound.targetRgb);
	el.bars.hidden = storage.get('channelBars') === false;
	el.card.style.setProperty('--reveal', realRound.targetCss);
	el.card.style.setProperty('--readout', contrastingTextOn(realRound.targetRgb));
	say('Your turn — no hints this time.');
	renderTiles(realRound.tiles, realRound.targetIndex);
	el.board.dataset.answer = realRound.targetIndex;
	el.board.hidden = false;
}
