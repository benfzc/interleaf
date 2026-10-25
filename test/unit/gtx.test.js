import { test } from "node:test";
import assert from "node:assert/strict";
import { GtxStatus, batchEnd, buildBody, parse } from "../../lib/gtx.js";
import { REPLY_BATCH, REPLY_ONE, SORRY_PAGE } from "../fixtures/gtx.js";

test("parse one sentence", () => {
  const res = parse(200, REPLY_ONE, 1);
  assert.equal(res.status, GtxStatus.Ok);
  assert.deepEqual(res.texts, ["設備進入睡眠模式。"]);
});

test("parse batch splits on blank lines", () => {
  const res = parse(200, REPLY_BATCH, 5);
  assert.equal(res.status, GtxStatus.Ok);
  assert.equal(res.texts.length, 5);
  assert.equal(res.texts[4], "有關完整的暫存器說明，請參閱參考手冊。");
});

test("paragraph count mismatch is a bad response", () => {
  assert.equal(parse(200, REPLY_BATCH, 4).status, GtxStatus.BadResponse);
  assert.equal(parse(200, "not json", 1).status, GtxStatus.BadResponse);
});

test("429 and captcha page mean blocked", () => {
  assert.equal(parse(429, "", 1).status, GtxStatus.Blocked);
  assert.equal(parse(200, SORRY_PAGE, 1).status, GtxStatus.Blocked);
  assert.equal(parse(500, "", 1).status, GtxStatus.Failed);
});

test("body joins paragraphs with blank lines", () => {
  const params = new URLSearchParams(buildBody(["a b", "c&d"], "auto", "zh-TW"));
  assert.equal(params.get("client"), "gtx");
  assert.equal(params.get("sl"), "auto");
  assert.equal(params.get("tl"), "zh-TW");
  assert.equal(params.get("dt"), "t");
  assert.equal(params.get("q"), "a b\n\nc&d");
});

test("batchEnd counts separators and always takes one", () => {
  assert.equal(batchEnd(["aaaa", "bbbb", "cc"], 0, 10), 2);  // 4 + 2 + 4
  assert.equal(batchEnd(["aaaa", "bbbb", "cc"], 0, 9), 1);
  assert.equal(batchEnd(["toolong"], 0, 3), 1);
  assert.equal(batchEnd(["aaaa", "bbbb", "cc"], 1, 8), 3); // 4 + 2 + 2
});
