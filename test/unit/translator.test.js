import { test } from "node:test";
import assert from "node:assert/strict";
import { Converter } from "../../vendor/opencc-js/cn2t.js";
import { NETWORK_RETRY_MS, Outcome, Translator } from "../../lib/translator.js";
import { REPLY_BATCH, REPLY_ONE, SORRY_PAGE } from "../fixtures/gtx.js";

const BATCH_SRC = [
  "The watchdog timer resets the system if software stops responding.",
  "Each DMA stream can be configured for memory-to-peripheral transfers.",
  "Power consumption depends on the clock frequency and the enabled peripherals.",
  "The bootloader is stored in system memory and is activated through the BOOT0 pin.",
  "Refer to the reference manual for the full register description.",
];

function gtxReply(...segments) {
  return JSON.stringify([segments.map((s) => [s, "", null, null, 3])]);
}

// fake fetch: replies are taken in order; records each request's q
function fakeFetch(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(new URLSearchParams(init.body).get("q"));
    const r = replies.shift();
    if (r instanceof Error) {
      throw r;
    }
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers });
  };
  return { fn, calls };
}

function make(replies) {
  const f = fakeFetch(replies);
  const tr = new Translator({ fetchFn: f.fn, convert: Converter({ from: "cn", to: "tw" }), now: () => 0 });
  return { tr, calls: f.calls };
}

test("batch is one request, skipped text is not sent", async () => {
  const { tr, calls } = make([{ body: REPLY_BATCH }]);
  const res = await tr.translate(["GPIOA_MODER", ...BATCH_SRC]);
  assert.equal(res.outcome, Outcome.Done);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], BATCH_SRC.join("\n\n"));
  assert.equal(res.results[0], "");
  assert.equal(res.results[5], "有關完整的暫存器說明，請參閱參考手冊。");
});

test("cache: same text is translated once", async () => {
  const { tr, calls } = make([{ body: REPLY_ONE }]);
  await tr.translate(["The device enters sleep mode."]);
  const res = await tr.translate(["The device enters sleep mode."]);
  assert.equal(calls.length, 1);
  assert.deepEqual(res.results, ["設備進入睡眠模式。"]);
});

test("Simplified characters are converted to Traditional", async () => {
  const { tr } = make([{ body: gtxReply("只有一个软件") }]);
  const res = await tr.translate(["There is only one program."]);
  assert.deepEqual(res.results, ["只有一個軟件"]);
});

test("batch count mismatch falls back to one paragraph per request", async () => {
  const { tr, calls } = make([
    { body: gtxReply("合併在一起的譯文") },
    { body: gtxReply("第一段") },
    { body: gtxReply("第二段") },
  ]);
  const res = await tr.translate(["First paragraph here.", "Second paragraph here."]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(1), ["First paragraph here.", "Second paragraph here."]);
  assert.deepEqual(res.results, ["第一段", "第二段"]);
});

test("blocked: wait, keep unfinished results null, then pause", async () => {
  let now = 0;
  const f = fakeFetch([{ body: SORRY_PAGE }, { status: 429, body: "" }, { status: 429, body: "" }, { status: 429, body: "" }]);
  const tr = new Translator({ fetchFn: f.fn, convert: (s) => s, now: () => now });
  const texts = ["The device enters sleep mode."];

  let res = await tr.translate(texts);
  assert.equal(res.outcome, Outcome.Wait);
  assert.equal(res.waitMs, 30 * 1000);
  assert.deepEqual(res.results, [null]);

  for (const wait of [60, 120]) {
    now += 10 * 60 * 1000;
    res = await tr.translate(texts);
    assert.equal(res.waitMs, wait * 1000);
  }
  now += 10 * 60 * 1000;
  res = await tr.translate(texts);
  assert.equal(res.outcome, Outcome.Paused);
  assert.equal(tr.isPaused(), true);
});

test("network error retries later without counting as blocked", async () => {
  const { tr } = make([new TypeError("offline")]);
  const res = await tr.translate(["The device enters sleep mode."]);
  assert.equal(res.outcome, Outcome.Wait);
  assert.equal(res.waitMs, NETWORK_RETRY_MS);
  assert.equal(tr.limiter.nBlocked, 0);
});
