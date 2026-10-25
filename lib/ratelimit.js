// Client-side throttling for a service with undocumented quotas.
//
// Two sliding windows (per minute, per hour) cap how often we send. When the
// service pushes back (429, captcha page) we cool down with exponential
// backoff; after too many push-backs in a row we pause until the user resumes.
//
//   ready ──sent──► ready ... window full ──► wait(until oldest leaves window)
//     │
//     └─blocked──► wait(30s) ─blocked─► wait(60s) ... ─4th blocked─► paused
//                      │                                              │
//                      └──────succeeded──► ready ◄──────resume────────┘
//
// Time is passed in (ms) so tests can use a fake clock.

export const RateState = Object.freeze({
  Ready: "ready",   // a request may be sent now
  Wait: "wait",     // retry after waitMs
  Paused: "paused", // only resume() unpauses
});

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const PER_MINUTE = 20;
export const PER_HOUR = 300;

// cooldown after the first push-back; doubles on each consecutive one
const FIRST_COOLDOWN_MS = 30 * 1000;
// push-backs in a row tolerated before pausing (the 4th one pauses)
const MAX_BLOCKED_IN_ROW = 3;

function waitFor(waitMs) {
  return { state: RateState.Wait, waitMs };
}

export class RateLimiter {
  constructor(perMinute = PER_MINUTE, perHour = PER_HOUR) {
    this.perMinute = perMinute;
    this.perHour = perHour;
    this.sentMs = []; // send times within the last hour, oldest first
    this.cooldownUntilMs = 0;
    this.nBlocked = 0; // consecutive push-backs
  }

  check(nowMs) {
    if (this.nBlocked > MAX_BLOCKED_IN_ROW) {
      return { state: RateState.Paused, waitMs: 0 };
    }
    if (nowMs < this.cooldownUntilMs) {
      return waitFor(this.cooldownUntilMs - nowMs);
    }

    // forget sends that left the hour window
    while (this.sentMs.length > 0 && this.sentMs[0] <= nowMs - HOUR_MS) {
      this.sentMs.shift();
    }
    const n = this.sentMs.length;

    // hour window full: wait until its oldest send drops out
    if (n >= this.perHour) {
      return waitFor(this.sentMs[n - this.perHour] + HOUR_MS - nowMs);
    }

    // minute window full: e.g. perMinute=20 -> look at the 20th most recent send
    if (n >= this.perMinute) {
      const nth = this.sentMs[n - this.perMinute];
      if (nth > nowMs - MINUTE_MS) {
        return waitFor(nth + MINUTE_MS - nowMs);
      }
    }
    return { state: RateState.Ready, waitMs: 0 };
  }

  sent(nowMs) {
    this.sentMs.push(nowMs);
  }

  // retryAfterMs: the service's Retry-After hint, 0 if none
  blocked(nowMs, retryAfterMs = 0) {
    const steps = Math.min(this.nBlocked, MAX_BLOCKED_IN_ROW);
    const cooldown = Math.max(FIRST_COOLDOWN_MS * 2 ** steps, retryAfterMs);
    this.nBlocked++;
    this.cooldownUntilMs = nowMs + cooldown;
  }

  succeeded() {
    this.nBlocked = 0;
  }

  resume() {
    this.nBlocked = 0;
    this.cooldownUntilMs = 0;
  }

  isPaused() {
    return this.nBlocked > MAX_BLOCKED_IN_ROW;
  }
}
