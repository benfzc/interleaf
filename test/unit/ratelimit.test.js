import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, RateState } from "../../lib/ratelimit.js";

const SEC = 1000;
const MIN = 60 * SEC;

test("minute window waits for the oldest send to leave", () => {
  const rl = new RateLimiter(2, 100);
  rl.sent(0);
  rl.sent(10 * SEC);
  assert.deepEqual(rl.check(20 * SEC), { state: RateState.Wait, waitMs: 40 * SEC });
  assert.equal(rl.check(MIN + 1).state, RateState.Ready);
});

test("hour window", () => {
  const rl = new RateLimiter(100, 2);
  rl.sent(0);
  rl.sent(2 * MIN);
  assert.deepEqual(rl.check(10 * MIN), { state: RateState.Wait, waitMs: 50 * MIN });
});

test("cooldown doubles, 4th push-back pauses, resume clears", () => {
  const rl = new RateLimiter();
  for (const expect of [30, 60, 120]) {
    rl.blocked(0);
    assert.deepEqual(rl.check(0), { state: RateState.Wait, waitMs: expect * SEC });
  }
  rl.blocked(0);
  assert.equal(rl.check(0).state, RateState.Paused);
  rl.resume();
  assert.equal(rl.check(0).state, RateState.Ready);
});

test("success resets the cooldown count", () => {
  const rl = new RateLimiter();
  rl.blocked(0);
  rl.blocked(0);
  rl.succeeded();
  rl.blocked(0);
  assert.equal(rl.check(0).waitMs, 30 * SEC);
});

test("Retry-After longer than the cooldown wins", () => {
  const rl = new RateLimiter();
  rl.blocked(0, 90 * SEC);
  assert.equal(rl.check(0).waitMs, 90 * SEC);
});
