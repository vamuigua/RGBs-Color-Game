/**
 * game.js — the game state machine. Pure logic, no DOM.
 *
 * ui.js subscribes via game.on(event, fn). Keeping this DOM-free is what makes
 * the scoring and progression testable without a browser.
 */

import { generateRound, TIERS } from './color.js';
import { CONFIG, TUNED, subscribe } from './config.js';
import * as storage from './storage.js';

/**
 * Live binding — reassigned when the config changes. Do not destructure at
 * module scope.
 *
 * `lives: null` in config means unlimited; it becomes Infinity here. null is
 * the canonical on-disk form because JSON.stringify(Infinity) is null anyway.
 */
export let MODES = buildModes(CONFIG);

function buildModes(c) {
	const out = {};
	for (const [key, m] of Object.entries(c.modes)) {
		out[key] = { ...m, lives: m.lives == null ? Infinity : m.lives };
	}
	return out;
}

subscribe((c) => { MODES = buildModes(c); });

// Fixed, not configurable: these are bound to three hardcoded [data-diff]
// buttons in index.html and to DIFF_HINTS in ui.js. A fourth tier added via
// config would be a tier nothing could select.
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

/** Consecutive correct answers -> score multiplier. Tiers are sorted descending by config.js. */
export function streakMultiplier(streak) {
	for (const t of CONFIG.scoring.streakTiers) if (streak >= t.at) return t.mult;
	return 1;
}

/** Seconds allowed for one round. Shrinks with level, floored so it stays fair. */
export function timeLimitFor(difficulty, level) {
	const base = (TIERS[difficulty] || TIERS.medium).timer;
	const { enabled, timerFloor, timerStep } = CONFIG.ramp;
	if (!enabled) return base;
	return Math.max(timerFloor, base - timerStep * (level - 1));
}

export class Game {
	constructor() {
		this._listeners = new Map();
		this.status = 'idle'; // idle | playing | resolved | over
		this.mode = 'arcade';
		this.difficulty = 'medium';
		this._timerId = null;
		this._everTuned = false;
		// Sticky: a run that was tuned at any point stays quarantined even if the
		// config is reset mid-session, so a half-tuned run can never bank a score.
		subscribe(() => { if (TUNED) this._everTuned = true; });
	}

	/** True while this run must not write to the real score table. */
	get quarantined() { return this._everTuned; }

	/* -------------------------------------------------- events */

	on(event, fn) {
		if (!this._listeners.has(event)) this._listeners.set(event, new Set());
		this._listeners.get(event).add(fn);
		return () => this._listeners.get(event).delete(fn);
	}

	_emit(event, payload) {
		const set = this._listeners.get(event);
		if (set) for (const fn of set) fn(payload);
	}

	/* -------------------------------------------------- lifecycle */

	/**
	 * Lives come from the mode, optionally overridden per difficulty.
	 * Resolved once at start so the Infinity checks downstream read one value.
	 */
	_resolveLives(mode, difficulty) {
		const base = MODES[mode].lives;
		if (base === Infinity) return Infinity;   // ZEN stays ZEN unless the mode itself is changed
		const override = TIERS[difficulty]?.lives;
		return override == null ? base : override;
	}

	start(mode, difficulty) {
		this.mode = mode;
		this.difficulty = difficulty;
		this.level = 1;
		this.sessionMaxLevel = 1;
		this.score = 0;
		this.maxLives = this._resolveLives(mode, difficulty);
		this.lives = this.maxLives;
		this._everTuned = TUNED;   // a fresh run after RESET DEFAULTS counts again
		this.streak = 0;
		this.longestStreak = 0;
		this.matched = 0;
		this.newBest = false;
		this.status = 'playing';
		this._emit('start', this.snapshot());
		this.nextRound();
	}

	nextRound() {
		if (this.status === 'over') return;
		this._clearTimer();
		this.round = generateRound({ difficulty: this.difficulty, level: this.level });
		this.roundWrong = 0;
		this.peekUsed = false;
		this.eliminated = new Set();
		this.status = 'playing';

		const limit = MODES[this.mode].timed ? timeLimitFor(this.difficulty, this.level) : 0;
		this.timeLimit = limit;
		this._emit('round', { round: this.round, timeLimit: limit, hud: this.snapshot() });
		if (limit) this._startTimer(limit * 1000);
	}

	/** STEADY/ZEN only: reroll the board. Level and streak are untouched — no
	 *  rerolling for an easier board, no punishment either. ARCADE has no skip
	 *  because a free reroll would be a free timer refresh. */
	skip() {
		if (!MODES[this.mode].canSkip || this.status !== 'playing') return;
		this.nextRound();
	}

	/* -------------------------------------------------- timer */

	_startTimer(ms) {
		this._deadline = performance.now() + ms;
		this._timerId = setTimeout(() => this._onTimeout(), ms);
	}

	_clearTimer() {
		if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
		this._deadline = null;
	}

	/** Fraction of the round's time still remaining, 0..1. */
	_remainingFraction() {
		if (!this._deadline || !this.timeLimit) return 0;
		const left = this._deadline - performance.now();
		return Math.max(0, Math.min(1, left / (this.timeLimit * 1000)));
	}

	/** Works in every mode, not just timed ones — the pause overlay is also how
	 *  an untimed session is ended. */
	pause() {
		if (this.status !== 'playing') return false;
		if (this._timerId) {
			this._pausedRemaining = Math.max(0, this._deadline - performance.now());
			this._clearTimer();
		}
		this.status = 'paused';
		this._emit('pause');
		return true;
	}

	resume() {
		if (this.status !== 'paused') return;
		this.status = 'playing';
		if (this._pausedRemaining != null && this.timeLimit) {
			this._startTimer(this._pausedRemaining);
			this._pausedRemaining = null;
		}
		this._emit('resume');
	}

	_onTimeout() {
		if (this.status !== 'playing') return;
		this._clearTimer();
		this.streak = 0;
		this.lives -= 1;
		this.status = 'resolved';
		this._emit('timeout', { targetIndex: this.round.targetIndex, hud: this.snapshot() });
		if (this.lives <= 0) this._gameOver();
	}

	/* -------------------------------------------------- play */

	/** PEEK: flash the true color. Costs half the round's award, once per round. */
	peek() {
		if (this.status !== 'playing' || this.peekUsed) return false;
		this.peekUsed = true;
		this._emit('peek', { hud: this.snapshot() });
		return true;
	}

	guess(index) {
		if (this.status !== 'playing') return;
		if (this.eliminated.has(index)) return;

		if (index === this.round.targetIndex) this._correct(index);
		else this._wrong(index);
	}

	_correct(index) {
		const S = CONFIG.scoring;
		const remaining = this._remainingFraction();
		this._clearTimer();

		this.streak += 1;
		this.longestStreak = Math.max(this.longestStreak, this.streak);
		this.matched += 1;

		const clean = this.roundWrong === 0;
		const mult = streakMultiplier(this.streak);
		const timeBonus = MODES[this.mode].timed ? Math.round(remaining * S.timeBonusMax) : 0;

		let award = Math.floor(S.baseAward * TIERS[this.difficulty].scoreMult * mult) + timeBonus;
		// Flat, and added after the multiplier: cleanBonus rewards consistency,
		// and multiplying it by the streak would double-count consistency.
		if (clean) award += S.cleanBonus;
		// ZEN has no lives, so wrong guesses are paid for in score instead. The
		// other modes already charge a life and reset the streak — taking the
		// award too would punish one mistake three times over.
		if (this.maxLives === Infinity) {
			for (let i = 0; i < this.roundWrong; i++) award = Math.floor(award * (1 - S.noLivesWrongPenalty));
		}
		if (this.peekUsed) award = Math.floor(award * (1 - S.peekPenalty));
		award = Math.max(S.minAward, award);

		this.score += award;

		// Adaptive rubber band: only a clean win (correct on the first click)
		// raises the level, so difficulty settles at the player's real threshold.
		let leveledUp = false;
		if (clean && CONFIG.ramp.enabled && this.level < CONFIG.ramp.levelMax) {
			this.level += 1;
			leveledUp = this.level > this.sessionMaxLevel;
			this.sessionMaxLevel = Math.max(this.sessionMaxLevel, this.level);
		}

		// Tuned runs are quarantined: a config with baseAward 10000 and 2 tiles
		// would otherwise permanently poison the real best-score table.
		if (!this.quarantined && storage.recordBest(this.mode, this.difficulty, this.score) && !this.newBest) {
			this.newBest = true;
			this._emit('newbest', { score: this.score });
		}

		this.status = 'resolved';
		this._emit('correct', {
			index, award, timeBonus, multiplier: mult, clean,
			// Rationed so "LEVEL UP" stays meaningful: the HUD number always
			// updates, but the toast only fires on a new session max every 5th.
			levelToast: leveledUp && this.level % 5 === 0,
			hud: this.snapshot(),
		});
	}

	_wrong(index) {
		const S = CONFIG.scoring;
		this.roundWrong += 1;
		this.streak = 0;
		this.eliminated.add(index);

		if (S.wrongPenalty) this.score = Math.max(S.minScore, this.score - S.wrongPenalty);
		if (this.maxLives !== Infinity) this.lives -= 1;

		// Wrong answers lower the level too, so the ramp tracks the player
		// rather than running away from them.
		if (CONFIG.ramp.enabled && CONFIG.ramp.levelDownOnWrong && this.level > 1) this.level -= 1;

		const dead = this.lives <= 0;
		if (dead) {
			this._clearTimer();
			this.status = 'resolved';
		}
		this._emit('wrong', { index, hud: this.snapshot() });
		if (dead) this._gameOver();
	}

	/** ZEN has no failure state, so the player ends the session explicitly. */
	endSession() {
		if (this.status === 'over') return;
		this._gameOver();
	}

	_gameOver() {
		this._clearTimer();
		this.status = 'over';
		if (!this.quarantined) {
			storage.recordSession({
				longestStreak: this.longestStreak,
				matched: this.matched,
				level: this.sessionMaxLevel,
			});
		}
		this._emit('gameover', {
			quarantined: this.quarantined,
			score: this.score,
			best: storage.getBest(this.mode, this.difficulty),
			newBest: this.newBest,
			longestStreak: this.longestStreak,
			matched: this.matched,
			level: this.sessionMaxLevel,
			mode: this.mode,
			difficulty: this.difficulty,
		});
	}

	/* -------------------------------------------------- view model */

	snapshot() {
		return {
			mode: this.mode,
			difficulty: this.difficulty,
			level: this.level,
			score: this.score,
			best: storage.getBest(this.mode, this.difficulty),
			lives: this.lives,
			maxLives: this.maxLives,
			streak: this.streak,
			multiplier: streakMultiplier(this.streak),
			peekUsed: this.peekUsed,
			timed: MODES[this.mode].timed,
			quarantined: this.quarantined,
		};
	}
}
