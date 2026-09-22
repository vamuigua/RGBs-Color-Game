/**
 * main.js — entry point. Wires the game to the UI and owns the PWA plumbing.
 */

import { Game } from './game.js';
import * as ui from './ui.js';
import * as audio from './audio.js';
import * as storage from './storage.js';

audio.init();

const game = new Game();
ui.init(game, {
	// Leaving a session mid-round must not leave a timer armed in the background.
	onExit: () => game.endSession(),
	onReplayTutorial: () => runTutorial(),
});

/**
 * The tutorial is lazily imported too: a returning player never downloads it.
 */
async function runTutorial() {
	// Deliberately no audio.arm() here — on first load this runs without a user
	// gesture, and arming fetches 368 KB of audio. Onboarding arms on the first
	// tap instead.
	const onboarding = await import('./onboarding.js');
	ui.showScreen('learn');
	onboarding.start({
		onDone: () => {
			// Land on the start screen rather than dropping straight into a game,
			// so the player still meets the mode and difficulty choice.
			storage.set('lastDifficulty', 'easy');
			ui.flagPeekHint();
			ui.refreshStart();
			ui.showScreen('start');
		},
	});
}

if (storage.get('onboarded')) {
	ui.showScreen('start');
} else {
	// First run: teach RGB before asking anyone to read an RGB value.
	runTutorial();
}

/* ------------------------------------------------------------------ *
 * Service worker
 * ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
	window.addEventListener('load', async () => {
		try {
			// This app used to be served by Progressier's hosted service worker.
			// Returning visitors still have it registered, and it would keep
			// serving the old cached shell, so retire anything that isn't ours.
			const existing = await navigator.serviceWorker.getRegistrations();
			for (const reg of existing) {
				const url = reg.active?.scriptURL || reg.installing?.scriptURL || '';
				if (url && !url.endsWith('/sw.js')) await reg.unregister();
			}
			await navigator.serviceWorker.register('sw.js');
		} catch {
			/* offline support is a bonus, never a requirement to play */
		}
	});
}

/* ------------------------------------------------------------------ *
 * Install prompt
 *
 * The old build got its install button from Progressier's injected widget.
 * Dropping that dependency means owning the prompt ourselves.
 * ------------------------------------------------------------------ */

const installBtn = document.getElementById('installBtn');
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	deferredPrompt = e;
	installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
	if (!deferredPrompt) return;
	installBtn.hidden = true;
	deferredPrompt.prompt();
	await deferredPrompt.userChoice;
	deferredPrompt = null;
});

window.addEventListener('appinstalled', () => {
	deferredPrompt = null;
	installBtn.hidden = true;
});

/* Pausing when the tab is hidden stops the ARCADE timer running down while
   the player is in another app. */
document.addEventListener('visibilitychange', () => {
	if (document.hidden) game.pause();
});
