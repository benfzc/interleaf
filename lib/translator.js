// Turns a list of paragraphs into translations: skip rules, cache, rate
// limit, gtx batching, then Simplified -> Traditional character fix-up.
// No DOM and no chrome.* here, so it runs under Node for unit tests.

import { Kind, classify } from "./text.js";
import { GTX_URL, GtxStatus, batchEnd, buildBody, parse } from "./gtx.js";
import { RateLimiter, RateState } from "./ratelimit.js";

const PROVIDER = "gtx";
const SRC_LANG = "auto";
const DST_LANG = "zh-TW";

// network error or unexpected HTTP status: try again later, not a push-back
export const NETWORK_RETRY_MS = 10 * 1000;

// Overall outcome of translate(). Results that are null still need work.
export const Outcome = Object.freeze({
  Done: "done",
  Wait: "wait",     // retry after waitMs
  Paused: "paused", // user must resume
});

function cacheKey(text) {
  return `${PROVIDER}|${DST_LANG}|${text}`;
}

function retryAfterMs(headers) {
  const sec = Number(headers.get("Retry-After"));
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
}

export class Translator {
  // fetchFn: like fetch(); convert: Simplified -> Traditional; now: ms clock
  constructor({ fetchFn, convert, now = Date.now, limiter = new RateLimiter() }) {
    this.fetchFn = fetchFn;
    this.convert = convert;
    this.now = now;
    this.limiter = limiter;
    this.cache = new Map();
  }

  // Returns { outcome, waitMs, results }. results[i] is the translation,
  // "" when texts[i] is not translated, or null when not done yet.
  async translate(texts) {
    const results = texts.map((t) => this.lookup(t));
    const todo = [];
    results.forEach((r, i) => r === null && todo.push(i));

    const pending = todo.map((k) => texts[k]);
    let i = 0;
    let solo = 0; // upcoming items that must go one per request
    while (i < todo.length) {
      const end = solo > 0 ? i + 1 : batchEnd(pending, i);
      const res = await this.request(pending.slice(i, end));
      if (res.outcome !== Outcome.Done) {
        return { outcome: res.outcome, waitMs: res.waitMs, results };
      }

      // batch split came back wrong: resend its paragraphs one by one
      if (res.status === GtxStatus.BadResponse && end - i > 1) {
        solo = end - i;
        continue;
      }
      for (let k = i; k < end; k++) {
        const tr = res.status === GtxStatus.Ok ? this.convert(res.texts[k - i]) : "";
        this.cache.set(cacheKey(texts[todo[k]]), tr);
        results[todo[k]] = tr;
      }
      solo = Math.max(0, solo - (end - i));
      i = end;
    }
    return { outcome: Outcome.Done, waitMs: 0, results };
  }

  lookup(text) {
    if (classify(text) === Kind.Skip) {
      return "";
    }
    return this.cache.get(cacheKey(text)) ?? null;
  }

  // One gtx request through the rate limiter. Returns { outcome, waitMs,
  // status, texts }; status and texts are meaningful only when Done.
  async request(texts) {
    const check = this.limiter.check(this.now());
    if (check.state === RateState.Wait) {
      return { outcome: Outcome.Wait, waitMs: check.waitMs };
    }
    if (check.state === RateState.Paused) {
      return { outcome: Outcome.Paused, waitMs: 0 };
    }

    this.limiter.sent(this.now());
    let resp;
    let body;
    try {
      resp = await this.fetchFn(GTX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: buildBody(texts, SRC_LANG, DST_LANG),
      });
      body = await resp.text();
    } catch {
      return { outcome: Outcome.Wait, waitMs: NETWORK_RETRY_MS };
    }

    const res = parse(resp.status, body, texts.length);
    if (res.status === GtxStatus.Blocked) {
      this.limiter.blocked(this.now(), retryAfterMs(resp.headers));
      const next = this.limiter.check(this.now());
      const outcome = next.state === RateState.Paused ? Outcome.Paused : Outcome.Wait;
      return { outcome, waitMs: next.waitMs };
    }
    if (res.status === GtxStatus.Failed) {
      return { outcome: Outcome.Wait, waitMs: NETWORK_RETRY_MS };
    }

    this.limiter.succeeded();
    return { outcome: Outcome.Done, waitMs: 0, status: res.status, texts: res.texts };
  }

  isPaused() {
    return this.limiter.isPaused();
  }

  resume() {
    this.limiter.resume();
  }
}
