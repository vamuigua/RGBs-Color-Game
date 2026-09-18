/**
 * audio.js — sound effects and haptics.
 *
 * Reuses the three original clips. The old code called play() during init(),
 * before any user gesture, which browsers reject with an unhandled
 * NotAllowedError on every single page load. Everything here is gated behind
 * the first real gesture instead, and the clips are only fetched at that point
 * so 368 KB of WAV stays off the critical path.
 */

import * as storage from './storage.js';

const els = {};
let armed = false;
let muted = false;
let hapticsOn = true;

export function init() {
	els.correct = document.getElementById('audioCorrect');
	els.wrong = document.getElementById('audioWrong');
	els.round = document.getElementById('audioRound');
	muted = !!storage.get('muted');
	hapticsOn = storage.get('haptics') !== false;
}

/** Call from the first user gesture (the PLAY button). */
export function arm() {
	if (armed) return;
	armed = true;
	for (const el of Object.values(els)) {
		if (el) { el.preload = 'auto'; el.load(); }
	}
}

export function isMuted() { return muted; }

export function toggleMute() {
	muted = !muted;
	storage.set('muted', muted);
	return muted;
}

function play(name, volume = 1) {
	if (muted || !armed) return;
	const el = els[name];
	if (!el) return;
	try {
		el.volume = volume;
		el.currentTime = 0;          // rapid repeats must restart, not no-op
		el.play().catch(() => {});   // autoplay policy, missing codec, etc.
	} catch {
		/* never let audio break gameplay */
	}
}

function buzz(pattern) {
	if (muted || !hapticsOn) return;
	try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

export const correct = () => { play('correct', 1); buzz(10); };
export const wrong = () => { play('wrong', .55); buzz(40); };
export const round = () => { play('round', .35); };
export const levelUp = () => { play('correct', .8); buzz([30, 20, 30]); };
