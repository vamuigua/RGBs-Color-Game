/**
 * ui.js — everything that touches the DOM.
 *
 * game.js emits, this renders. Feedback is deliberately short: nothing here is
 * allowed to delay the next round by more than a few hundred milliseconds.
 */

import { rgbToCss, rgbToHex, contrastingTextOn } from './color.js';
import { MODES, DIFFICULTIES } from './game.js';
import { CONFIG, TUNED, resetConfig, subscribe } from './config.js';
import * as storage from './storage.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);

const MODE_HINTS = {
	arcade: '3 lives, and a countdown that tightens as you level up.',
	steady: '3 lives, no clock. Think as long as you like.',
	zen: 'No lives, no clock. Wrong guesses only cost points.',
};

const DIFF_HINTS = {
	easy: '3 tiles, clearly different colors.',
	medium: '6 tiles, noticeably closer colors.',
	hard: '9 tiles, separated by hue more than brightness.',
};

/** Pacing between a resolved round and the next board. */
const NEXT_ROUND_DELAY = 620;
const TIMEOUT_DELAY = 1000;
const PEEK_MS = 600;

let game = null;
let el = {};
let mode = 'arcade';
let difficulty = 'medium';
let focusIndex = 0;
let cols = 3;
let peekTimer = null;
let advanceTimer = null;
let onExit = null;
let hooks = {};
/** Set once by main.js right after the tutorial, to point out PEEK. */
let pendingPeekHint = false;
export function flagPeekHint() { pendingPeekHint = true; }

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

export function init(gameInstance, opts = {}) {
	game = gameInstance;
	hooks = opts;
	onExit = opts.onExit;

	el = {
		body: document.body,
		// start
		modeGroup: $('modeGroup'), diffGroup: $('diffGroup'),
		modeHint: $('modeHint'), diffHint: $('diffHint'),
		playBtn: $('playBtn'), startBest: $('startBest'),
		helpBtn: $('helpBtn'), helpSheet: $('helpSheet'), helpCloseBtn: $('helpCloseBtn'),
		// hud
		hudLevel: $('hudLevel'), hudLives: $('hudLives'), hudScore: $('hudScore'),
		hudBest: $('hudBest'), hudStreak: $('hudStreak'), hudMult: $('hudMult'),
		// play
		timer: $('timer'), timerBar: $('timerBar'),
		targetCard: $('targetCard'), targetRgb: $('targetRgb'), targetHex: $('targetHex'),
		targetR: $('targetR'), targetG: $('targetG'), targetB: $('targetB'),
		bars: $('targetBars'), barR: $('barR'), barG: $('barG'), barB: $('barB'),
		peekBtn: $('peekBtn'), board: $('board'), strip: $('strip'),
		pauseBtn: $('pauseBtn'), skipBtn: $('skipBtn'),
		toastSlot: $('toastSlot'), live: $('liveRegion'),
		hudTuned: $('hudTuned'), startTuned: $('startTuned'), startResetTuning: $('startResetTuning'),
		// settings
		settingsBtn: $('settingsBtn'), settingsSheet: $('settingsSheet'),
		settingsCloseBtn: $('settingsCloseBtn'),
		setSound: $('setSound'), setHaptics: $('setHaptics'), setBars: $('setBars'),
		setReplay: $('setReplay'), setLabRow: $('setLabRow'), setLab: $('setLab'),
		setTunedNote: $('setTunedNote'),
		// overlays
		pauseOverlay: $('pauseOverlay'), resumeBtn: $('resumeBtn'), quitBtn: $('quitBtn'),
		// over
		overTitle: $('overTitle'), overBadge: $('overBadge'), overScore: $('overScore'),
		overBest: $('overBest'), overStreak: $('overStreak'), overMatched: $('overMatched'),
		overLevel: $('overLevel'), againBtn: $('againBtn'), changeBtn: $('changeBtn'),
		// shared
		soundBtns: [...document.querySelectorAll('[data-sound-glyph]')].map((s) => s.closest('button')),
	};

	mode = storage.get('lastMode');
	difficulty = storage.get('lastDifficulty');
	if (!MODES[mode]) mode = 'arcade';
	if (!DIFFICULTIES.includes(difficulty)) difficulty = 'medium';

	wireStart();
	wirePlay();
	wireOverlays();
	wireKeyboard();
	wireSettings();
	wireLabAccess();
	bindGame();

	syncPills();
	syncSound();
	syncBars();
	syncTuned();
	syncHelpNumbers();
	subscribe(() => { syncTuned(); syncHelpNumbers(); });
}

/* ------------------------------------------------------------------ *
 * Screens
 * ------------------------------------------------------------------ */

const SCREENS = ['start', 'play', 'over', 'learn', 'lab'];

export function showScreen(name) {
	el.body.dataset.screen = name;
	for (const id of SCREENS) {
		const node = $(`screen-${id}`);
		if (node) node.hidden = id !== name;
	}
}

/* ------------------------------------------------------------------ *
 * Start screen
 * ------------------------------------------------------------------ */

function wireStart() {
	el.modeGroup.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-mode]');
		if (!btn) return;
		mode = btn.dataset.mode;
		storage.set('lastMode', mode);
		syncPills();
	});

	el.diffGroup.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-diff]');
		if (!btn) return;
		difficulty = btn.dataset.diff;
		storage.set('lastDifficulty', difficulty);
		syncPills();
	});

	// Arrow-key support inside each radiogroup, as the ARIA pattern expects.
	for (const group of [el.modeGroup, el.diffGroup]) {
		group.addEventListener('keydown', (e) => {
			if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
			const items = [...group.querySelectorAll('.pill')];
			const i = items.indexOf(document.activeElement);
			if (i < 0) return;
			e.preventDefault();
			const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
			next.focus();
			next.click();
		});
	}

	el.playBtn.addEventListener('click', () => {
		audio.arm();
		showScreen('play');
		game.start(mode, difficulty);
	});

	el.helpBtn.addEventListener('click', () => el.helpSheet.showModal());
	el.helpCloseBtn.addEventListener('click', () => el.helpSheet.close());

	for (const btn of el.soundBtns) {
		btn.addEventListener('click', () => { audio.toggleMute(); syncSound(); });
	}
}

function syncPills() {
	for (const btn of el.modeGroup.querySelectorAll('[data-mode]')) {
		btn.setAttribute('aria-checked', String(btn.dataset.mode === mode));
	}
	for (const btn of el.diffGroup.querySelectorAll('[data-diff]')) {
		btn.setAttribute('aria-checked', String(btn.dataset.diff === difficulty));
	}
	el.modeHint.textContent = MODE_HINTS[mode];
	el.diffHint.textContent = DIFF_HINTS[difficulty];
	el.startBest.textContent = storage.getBest(mode, difficulty).toLocaleString();
}

function syncSound() {
	const on = !audio.isMuted();
	for (const btn of el.soundBtns) {
		btn.setAttribute('aria-pressed', String(on));
		btn.querySelector('[data-sound-glyph]').textContent = on ? '\u{1F50A}' : '\u{1F507}';
	}
}

/* ------------------------------------------------------------------ *
 * Play screen wiring
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function wireSettings() {
	el.settingsBtn.addEventListener('click', () => {
		el.setSound.checked = !audio.isMuted();
		el.setHaptics.checked = storage.get('haptics') !== false;
		el.setBars.checked = storage.get('channelBars') !== false;
		el.setLabRow.hidden = !labUnlocked();
		el.setTunedNote.hidden = !TUNED;
		el.settingsSheet.showModal();
	});
	el.settingsCloseBtn.addEventListener('click', () => el.settingsSheet.close());

	el.setSound.addEventListener('change', () => {
		if (audio.isMuted() === !el.setSound.checked) return;
		audio.toggleMute();
		syncSound();
	});
	el.setHaptics.addEventListener('change', () => storage.set('haptics', el.setHaptics.checked));
	el.setBars.addEventListener('change', () => {
		storage.set('channelBars', el.setBars.checked);
		syncBars();
	});

	el.setReplay.addEventListener('click', () => {
		el.settingsSheet.close();
		hooks.onReplayTutorial?.();
	});

	el.setLab.addEventListener('click', () => {
		el.settingsSheet.close();
		openLab();
	});

	el.startResetTuning.addEventListener('click', () => {
		resetConfig();
		syncTuned();
		syncPills();
	});
}

/** Re-read anything on the start screen that another module may have changed. */
export function refreshStart() {
	mode = storage.get('lastMode');
	difficulty = storage.get('lastDifficulty');
	if (!MODES[mode]) mode = 'arcade';
	if (!DIFFICULTIES.includes(difficulty)) difficulty = 'medium';
	syncPills();
	syncBars();
	syncTuned();
}

function syncBars() {
	const on = storage.get('channelBars') !== false;
	if (el.bars) el.bars.hidden = !on;
}

function syncTuned() {
	el.hudTuned.hidden = !TUNED;
	el.startTuned.hidden = !TUNED;
	if (el.setTunedNote) el.setTunedNote.hidden = !TUNED;
}

/** The help sheet quotes concrete numbers; under a tuned config they'd be lies. */
function syncHelpNumbers() {
	const S = CONFIG.scoring;
	const peek = Math.round(S.peekPenalty * 100);
	setText('helpPeek', `${peek}%`);
	setText('helpBase', String(S.baseAward));
	setText('helpMults', DIFFICULTIES.map((d) => '×' + CONFIG.tiers[d].scoreMult).join(' / '));
	setText('helpMaxMult', '×' + Math.max(...S.streakTiers.map((t) => t.mult)));
	setText('helpLives', String(CONFIG.modes.arcade.lives ?? '∞'));
	setText('peekNote', `show the color · −${peek}% points`);
	const tiles = DIFFICULTIES.map((d) => CONFIG.tiers[d].tiles);
	setText('helpTilesEasy', String(tiles[0]));
	setText('helpTilesMedium', String(tiles[1]));
	setText('helpTilesHard', String(tiles[2]));
}

function setText(id, text) {
	const node = $(id);
	if (node) node.textContent = text;
}

/* ------------------------------------------------------------------ *
 * Hidden lab access — concealment, not security
 * ------------------------------------------------------------------ */

const LAB_TAPS = 7;
let labTaps = 0, labTapTimer = 0, labReady = false;

function labUnlocked() {
	return labReady || new URLSearchParams(location.search).has('lab');
}

function wireLabAccess() {
	const logo = document.querySelector('.screen--start .logo');
	logo?.addEventListener('click', () => {
		clearTimeout(labTapTimer);
		labTapTimer = setTimeout(() => { labTaps = 0; }, 900);
		if (++labTaps >= LAB_TAPS) {
			labTaps = 0;
			labReady = true;
			toast('DEVELOPER MODE', 'hot');
			openLab();
		}
	});

	document.addEventListener('keydown', (e) => {
		if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
			e.preventDefault();
			labReady = true;
			openLab();
		}
	});

	if (new URLSearchParams(location.search).has('lab')) {
		labReady = true;
		queueMicrotask(openLab);
	}
}

/** Lazily imported so players never download the lab. */
async function openLab() {
	try {
		const lab = await import('./lab.js');
		lab.mount({
			game,
			onClose: (resumed) => { if (!resumed) showScreen('start'); syncTuned(); syncPills(); },
		});
		showScreen('lab');
	} catch (err) {
		toast('LAB FAILED TO LOAD', 'bad');
		console.error(err);
	}
}

function wirePlay() {
	el.board.addEventListener('click', (e) => {
		const tile = e.target.closest('.tile');
		if (tile) game.guess(Number(tile.dataset.index));
	});

	el.peekBtn.addEventListener('click', () => game.peek());
	el.skipBtn.addEventListener('click', () => game.skip());
	el.pauseBtn.addEventListener('click', () => game.pause());
}

function wireOverlays() {
	el.resumeBtn.addEventListener('click', () => game.resume());
	el.quitBtn.addEventListener('click', () => { el.pauseOverlay.hidden = true; game.endSession(); });
	el.againBtn.addEventListener('click', () => { showScreen('play'); game.start(mode, difficulty); });
	el.changeBtn.addEventListener('click', () => { showScreen('start'); syncPills(); onExit?.(); });
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

function wireKeyboard() {
	document.addEventListener('keydown', (e) => {
		if (el.body.dataset.screen !== 'play') return;
		if (el.helpSheet.open) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;

		const key = e.key.toLowerCase();

		if (key === 'escape') {
			e.preventDefault();
			game.status === 'paused' ? game.resume() : game.pause();
			return;
		}
		if (key === 'm') { e.preventDefault(); audio.toggleMute(); syncSound(); return; }
		if (game.status !== 'playing') return;

		if (key === 'p') { e.preventDefault(); game.peek(); return; }
		if (key === 'n') { e.preventDefault(); game.skip(); return; }

		if (/^[1-9]$/.test(key)) {
			const i = Number(key) - 1;
			if (i < el.board.children.length) { e.preventDefault(); game.guess(i); }
			return;
		}

		const delta = { arrowleft: -1, arrowright: 1, arrowup: -cols, arrowdown: cols }[key];
		if (delta !== undefined && el.board.contains(document.activeElement)) {
			e.preventDefault();
			moveFocus(delta);
		}
	});
}

function moveFocus(delta) {
	const tiles = [...el.board.children];
	const next = focusIndex + delta;
	if (next < 0 || next >= tiles.length) return;
	focusIndex = next;
	for (const t of tiles) t.tabIndex = -1;
	tiles[focusIndex].tabIndex = 0;
	tiles[focusIndex].focus();
}

/* ------------------------------------------------------------------ *
 * Game event bindings
 * ------------------------------------------------------------------ */

function bindGame() {
	game.on('round', ({ round, timeLimit, hud }) => {
		clearTimeout(advanceTimer);
		renderBoard(round);
		resetTarget(round);
		updateHud(hud);
		clearStrip();
		el.peekBtn.disabled = false;
		el.peekBtn.querySelector('.btn__peekLabel').textContent = 'PEEK';
		el.peekBtn.dataset.hint = String(!!pendingPeekHint);
		pendingPeekHint = false;
		el.skipBtn.hidden = !MODES[hud.mode].canSkip;
		setTimer(timeLimit);
		audio.round();
	});

	game.on('peek', () => {
		clearTimeout(peekTimer);
		revealTarget(true);
		el.peekBtn.disabled = true;
		el.peekBtn.dataset.hint = 'false';
		el.peekBtn.querySelector('.btn__peekLabel').textContent = 'PEEKED';
		peekTimer = setTimeout(() => {
			if (game.status === 'playing') revealTarget(false);
		}, PEEK_MS);
	});

	game.on('correct', (p) => {
		stopTimer();
		revealTarget(true);
		lockBoard(true);

		const tile = el.board.children[p.index];
		if (tile) {
			tile.dataset.state = 'win';
			spawnPop(tile, '+' + p.award);
			spawnConfetti(tile);
		}
		audio.correct();
		announce(`Correct. Plus ${p.award} points.`);

		// Per-round feedback goes in the strip; toasts are reserved for the
		// rarer session events so they keep their weight.
		if (p.hud.streak >= 3) strip(`✓ CORRECT · \u{1F525} ${p.hud.streak} · ×${p.multiplier}`, 'hot');
		else strip('✓ CORRECT', 'good');

		if (p.levelToast) { toast(`LEVEL ${p.hud.level}`, 'hot'); audio.levelUp(); }

		updateHud(p.hud);
		advanceTimer = setTimeout(() => game.nextRound(), NEXT_ROUND_DELAY);
	});

	game.on('wrong', (p) => {
		const tile = el.board.children[p.index];
		if (tile) {
			tile.dataset.state = 'miss';
			// Let the shake finish before the tile fades out of play.
			setTimeout(() => { if (tile.isConnected) tile.dataset.state = 'dead'; }, 320);
			tile.disabled = true;
		}
		audio.wrong();
		strip('✕ NOT THAT ONE', 'bad');
		announce('Wrong color.');
		updateHud(p.hud);
	});

	game.on('timeout', (p) => {
		stopTimer();
		lockBoard(true);
		revealTarget(true);
		const tile = el.board.children[p.targetIndex];
		if (tile) tile.dataset.state = 'show';
		audio.wrong();
		strip('⏱ TIME UP', 'bad');
		announce('Out of time.');
		updateHud(p.hud);
		if (p.hud.lives > 0) advanceTimer = setTimeout(() => game.nextRound(), TIMEOUT_DELAY);
	});

	game.on('newbest', () => toast('⭐ NEW BEST', 'hot'));

	game.on('pause', () => { el.pauseOverlay.hidden = false; el.timer.classList.add('timer--paused'); el.resumeBtn.focus(); });
	game.on('resume', () => { el.pauseOverlay.hidden = true; el.timer.classList.remove('timer--paused'); });

	game.on('gameover', (p) => {
		clearTimeout(advanceTimer);
		clearTimeout(peekTimer);
		stopTimer();
		lockBoard(true);
		setTimeout(() => renderOver(p), p.matched === 0 ? 300 : 700);
	});
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderBoard(round) {
	// 3 / 6 / 9 tiles all read best as 3 columns: 1, 2 or 3 rows.
	cols = 3;
	el.board.style.setProperty('--cols', cols);
	el.board.style.setProperty('--rows', Math.ceil(round.tiles.length / cols));

	const frag = document.createDocumentFragment();
	round.tiles.forEach((rgb, i) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'tile';
		btn.dataset.index = i;
		btn.style.setProperty('--tile', rgbToCss(rgb));
		btn.style.setProperty('--delay', `${i * 30}ms`);
		btn.tabIndex = i === 0 ? 0 : -1;
		// Exposing each tile's value is deliberate: the target is text too, so a
		// screen-reader user can play the game numerically rather than merely
		// navigate past it.
		btn.setAttribute('aria-label', `Option ${i + 1}, ${rgbToCss(rgb)}, ${rgbToHex(rgb)}`);
		frag.appendChild(btn);
	});

	el.board.replaceChildren(frag);   // one layout pass
	el.board.dataset.locked = 'false';
	focusIndex = 0;
	fitBoard();
}

/**
 * Cap the board by the vertical space actually left over, so a 3-row HARD
 * board never pushes the play screen into a scroll. Measuring beats guessing a
 * vh fraction, which breaks as soon as the HUD or target card changes height.
 */
function fitBoard() {
	const screen = document.getElementById('screen-play');
	if (screen.hidden) return;
	const cs = getComputedStyle(screen);
	// The landscape layout swaps to grid and sets its own cap; leave it alone.
	if (cs.display !== 'flex') return;

	const gap = parseFloat(cs.rowGap) || 0;
	const siblings = [...screen.children].filter(
		(k) => k !== el.board && !k.hidden && getComputedStyle(k).position === 'static'
	);
	let used = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + gap * siblings.length;
	for (const k of siblings) used += k.getBoundingClientRect().height;

	// Measure against the viewport, not the screen element: once the board has
	// overflowed, the element's own height already includes that overflow and
	// the calculation would never converge.
	// 4px of slack absorbs sub-pixel rounding in the row gaps; without it the
	// board can land a hair over and trip a scrollbar.
	el.board.style.setProperty('--board-max-h', `${Math.max(150, window.innerHeight - used - 4)}px`);
}

let resizeRaf = 0;
window.addEventListener('resize', () => {
	cancelAnimationFrame(resizeRaf);
	resizeRaf = requestAnimationFrame(fitBoard);
});

function resetTarget(round) {
	clearTimeout(peekTimer);
	const [r, g, b] = round.targetRgb;
	el.targetR.textContent = r;
	el.targetG.textContent = g;
	el.targetB.textContent = b;
	el.targetHex.textContent = round.targetHex;
	el.barR.style.width = `${(r / 255) * 100}%`;
	el.barG.style.width = `${(g / 255) * 100}%`;
	el.barB.style.width = `${(b / 255) * 100}%`;
	el.targetCard.style.setProperty('--reveal', round.targetCss);
	el.targetCard.style.setProperty('--readout', contrastingTextOn(round.targetRgb));
	revealTarget(false);
}

// The readout flips to a contrasting ink once the card floods with the color;
// the swap itself lives in CSS, keyed off this attribute.
function revealTarget(on) { el.targetCard.dataset.revealed = String(on); }

function lockBoard(on) { el.board.dataset.locked = String(on); }

function updateHud(hud) {
	el.hudLevel.textContent = hud.level;
	el.hudScore.textContent = hud.score.toLocaleString();
	el.hudBest.textContent = Math.max(hud.best, hud.score).toLocaleString();
	el.hudStreak.querySelector('strong').textContent = hud.streak;
	el.hudStreak.dataset.hot = String(hud.streak >= 3);
	el.hudMult.textContent = '×' + hud.multiplier;
	el.hudMult.dataset.hot = String(hud.multiplier > 1);
	el.hudTuned.hidden = !hud.quarantined;

	if (hud.maxLives === Infinity) {
		el.hudLives.textContent = '∞';
		el.hudLives.setAttribute('aria-label', 'Unlimited lives');
	} else {
		el.hudLives.replaceChildren(...Array.from({ length: hud.maxLives }, (_, i) => {
			const s = document.createElement('span');
			s.className = 'hud__life' + (i < hud.lives ? '' : ' hud__life--spent');
			s.textContent = '♥';
			return s;
		}));
		el.hudLives.setAttribute('aria-label', `${hud.lives} of ${hud.maxLives} lives`);
	}
}

function renderOver(p) {
	el.overTitle.textContent = p.mode === 'zen' ? 'SESSION COMPLETE' : 'GAME OVER';
	el.overBadge.hidden = !p.newBest;
	el.overScore.textContent = p.score.toLocaleString();
	el.overBest.textContent = p.best.toLocaleString();
	el.overStreak.textContent = p.longestStreak;
	el.overMatched.textContent = p.matched;
	el.overLevel.textContent = p.level;
	showScreen('over');
	el.againBtn.focus();
}

/* ------------------------------------------------------------------ *
 * Timer bar
 * ------------------------------------------------------------------ */

function setTimer(seconds) {
	if (!seconds) { el.timer.hidden = true; return; }
	el.timer.hidden = false;
	el.timer.classList.remove('timer--paused');
	const bar = el.timerBar;
	bar.classList.remove('timer__bar--running');
	void bar.offsetWidth;                                 // force a restart
	bar.style.animationDuration = `${seconds}s`;
	bar.style.setProperty('--timer-duration', `${seconds}s`);
	bar.classList.add('timer__bar--running');
}

function stopTimer() {
	el.timerBar.classList.remove('timer__bar--running');
	el.timer.classList.remove('timer--paused');
}

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

function announce(text) { el.live.textContent = text; }

/** The band between target and board. Replaced, never queued. */
function strip(text, tone) {
	if (!el.strip) return;
	el.strip.textContent = text;
	el.strip.dataset.tone = tone || '';
	el.strip.removeAttribute('data-anim');
	void el.strip.offsetWidth;        // restart the entry animation
	el.strip.dataset.anim = 'in';
}

function clearStrip() {
	if (!el.strip) return;
	el.strip.textContent = '';
	el.strip.dataset.tone = '';
}

/** Single-slot queue: a new toast replaces the old one rather than stacking. */
function toast(text, tone) {
	const node = document.createElement('div');
	node.className = 'toast';
	node.dataset.tone = tone;
	node.textContent = text;
	el.toastSlot.replaceChildren(node);
	// Timeout rather than animationend: under prefers-reduced-motion the
	// animation is suppressed and animationend would never fire.
	setTimeout(() => { if (node.isConnected) node.remove(); }, 950);
}

function spawnPop(tile, text) {
	const node = document.createElement('span');
	node.className = 'pop';
	node.textContent = text;
	tile.appendChild(node);
	setTimeout(() => node.remove(), 750);
}

function spawnConfetti(tile) {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const styles = getComputedStyle(document.documentElement);
	const palette = [
		tile.style.getPropertyValue('--tile'),
		styles.getPropertyValue('--r'),
		styles.getPropertyValue('--g'),
		styles.getPropertyValue('--b'),
		'#FFFFFF',
	];
	const frag = document.createDocumentFragment();
	const nodes = [];
	for (let i = 0; i < 12; i++) {
		const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
		const dist = 46 + Math.random() * 46;
		const p = document.createElement('i');
		p.className = 'confetti';
		p.style.background = palette[i % palette.length];
		p.style.setProperty('--dx', `${Math.cos(angle) * dist - 50}%`);
		p.style.setProperty('--dy', `${Math.sin(angle) * dist - 50}%`);
		p.style.setProperty('--rot', `${Math.random() * 540 - 270}deg`);
		frag.appendChild(p);
		nodes.push(p);
	}
	tile.appendChild(frag);
	setTimeout(() => nodes.forEach((n) => n.remove()), 480);
}
