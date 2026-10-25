// Loads the unpacked extension in Chromium and checks the page it produces.
// gtx is never contacted: cloud IPs are blocked, so requests are answered
// with fake translations.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// NODE_PATH lookup, so the pre-installed global Playwright works too
const { chromium } = createRequire(import.meta.url)("playwright");

const ROOT = new URL("../../", import.meta.url).pathname;
const PAGE_URL = "https://interleaf.test/";
const GTX = "https://translate.googleapis.com/**";
const FILES = ["manifest.json", "background.js", "content.js", "content.css", "lib", "vendor"];

const PAGE = `<!doctype html><meta charset="utf-8">
<h1>Getting started</h1>
<p id="prose">The watchdog timer resets the system.</p>
<p id="reg">GPIOA_MODER</p>
<pre id="code">make install</pre>
<ul><li id="item">Connect the debug probe.</li></ul>
<table><tr><td id="cell">Serial engine peripheral</td><td id="num">0x40</td></tr></table>
<p id="zh">這段已經是中文。</p>`;

// "原文" -> "譯：原文", one reply segment per paragraph like the real thing
function fakeGtx(route) {
  const q = new URLSearchParams(route.request().postData()).get("q");
  const segs = q.split("\n\n").map((t, i, all) => [`譯：${t}${i < all.length - 1 ? "\n\n" : ""}`, t]);
  route.fulfill({ contentType: "application/json", body: JSON.stringify([segs, null, "en"]) });
}

let dir;
let context;
let worker;
const gtxQueries = [];

before(async () => {
  // test copy: <all_urls> stands in for the activeTab grant a real click gives
  dir = mkdtempSync(join(tmpdir(), "interleaf-"));
  for (const f of FILES) {
    cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  }
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  manifest.host_permissions.push("<all_urls>");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));

  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await context.route(PAGE_URL, (route) => route.fulfill({ contentType: "text/html", body: PAGE }));
  await context.route(GTX, (route) => {
    gtxQueries.push(new URLSearchParams(route.request().postData()).get("q"));
    fakeGtx(route);
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
});

after(async () => {
  await context?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function click() {
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await globalThis.interleafClick(tab);
  });
}

const trOf = (page, id) => page.locator(`#${id} > .il-tr`);

test("toggle translates paragraphs and restores the page", async () => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await click();

  await assert.doesNotReject(trOf(page, "prose").waitFor());
  assert.equal(await trOf(page, "prose").textContent(), "譯：The watchdog timer resets the system.");
  assert.equal(await trOf(page, "item").textContent(), "譯：Connect the debug probe.");
  assert.equal(await trOf(page, "cell").textContent(), "譯：Serial engine peripheral");
  assert.equal(await page.locator("h1 > .il-tr").count(), 1);

  // skipped: register name, code, numbers, Chinese
  for (const id of ["reg", "code", "num", "zh"]) {
    assert.equal(await trOf(page, id).count(), 0, id);
  }
  // all visible paragraphs went out in one request
  assert.equal(gtxQueries.length, 1);

  await click();
  assert.equal(await page.locator(".il-tr").count(), 0);
  await page.close();
});

test("paragraphs added later are translated", async () => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await click();
  await trOf(page, "prose").waitFor();

  await page.evaluate(() => {
    const p = document.createElement("p");
    p.id = "late";
    p.textContent = "A comment loaded after the page.";
    document.body.append(p);
  });
  await trOf(page, "late").waitFor();
  assert.equal(await trOf(page, "late").textContent(), "譯：A comment loaded after the page.");
  await page.close();
});
