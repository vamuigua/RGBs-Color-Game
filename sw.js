/**
 * sw.js — offline shell for The RGBs Game.
 *
 * Replaces the hosted Progressier worker. The whole app is static and tiny, so
 * cache-first over a precached shell is both correct and the fastest option;
 * there is no dynamic content that could go stale in a way that matters.
 *
 * Bump CACHE when any shell file changes.
 */

const CACHE = 'rgbs-v2';

// js/lab.js and js/analyze.js are deliberately ABSENT. They are developer
// tooling, lazily imported on first use; a player who never opens the Tuning
// Lab never downloads them. The stale-while-revalidate handler below will cache
// them incidentally once fetched, which is the right behaviour for a dev tool.
// js/onboarding.js is likewise lazy — but it IS precached, because a first-run
// player offline still needs the tutorial.
const SHELL = [
	'./',
	'./index.html',
	'./manifest.webmanifest',
	'./css/rgbs.css',
	'./js/main.js',
	'./js/ui.js',
	'./js/game.js',
	'./js/color.js',
	'./js/config.js',
	'./js/onboarding.js',
	'./js/audio.js',
	'./js/storage.js',
	'./assets/audio/beep-good.ogg',
	'./assets/audio/negative-beeps.wav',
	'./assets/audio/positive-beeps.wav',
	'./assets/images/logo.png',
	'./assets/images/icon-192.png',
	'./assets/images/icon-512.png',
	'./assets/images/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE)
			// addAll is all-or-nothing; one missing optional asset should not
			// sink the whole install.
			.then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	// Only serve our own origin from cache; fonts and anything else fall
	// through to the network untouched.
	if (url.origin !== self.location.origin) return;

	// Stale-while-revalidate: answer instantly from cache (so the game opens
	// offline and without a network round trip), but refresh in the background
	// so the next load is current. Plain cache-first would serve a stale shell
	// forever whenever a deploy forgot to bump CACHE.
	event.respondWith(
		caches.match(request).then((hit) => {
			const fresh = fetch(request)
				.then((res) => {
					if (res.ok && res.type === 'basic') {
						const copy = res.clone();
						caches.open(CACHE).then((c) => c.put(request, copy));
					}
					return res;
				})
				// A navigation that misses both cache and network still gets the
				// app shell, so an installed app never shows a browser error page.
				.catch(() => hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));

			if (hit) event.waitUntil(fresh.catch(() => {}));
			return hit || fresh;
		})
	);
});
