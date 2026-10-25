// Service worker: toolbar button, badge, and the translation pipeline.
// All tabs share one Translator, so they share one rate limit and cache.

import { Converter } from "./vendor/opencc-js/cn2t.js";
import { Outcome, Translator } from "./lib/translator.js";

const translator = new Translator({
  fetchFn: (url, init) => fetch(url, init),
  convert: Converter({ from: "cn", to: "tw" }),
});

const MS_PER_SEC = 1000;

const BADGE_ON = "中";
const BADGE_BUSY = "…";
const BADGE_PAUSED = "!";
const BADGE_COLOR = "#4a6fa5";
const BADGE_PAUSED_COLOR = "#c0392b";

const TITLE_OFF = "中英對照：按一下翻譯此頁";
const TITLE_ON = "中英對照：按一下還原";
const TITLE_BUSY = "翻譯中…";
const TITLE_PAUSED = "Google 拒絕請求，按此重試";

function setBadge(tabId, text, title, color = BADGE_COLOR) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setTitle({ tabId, title });
}

function showOutcome(tabId, res, remaining) {
  if (res.outcome === Outcome.Paused) {
    setBadge(tabId, BADGE_PAUSED, TITLE_PAUSED, BADGE_PAUSED_COLOR);
    return;
  }
  if (res.outcome === Outcome.Wait) {
    const sec = Math.ceil(res.waitMs / MS_PER_SEC);
    setBadge(tabId, `${sec}s`, `等待 ${sec} 秒後重試（剩 ${remaining} 段）`);
    return;
  }
  setBadge(tabId, BADGE_ON, TITLE_ON);
}

async function handleTranslate(tabId, msg) {
  setBadge(tabId, BADGE_BUSY, TITLE_BUSY);
  const res = await translator.translate(msg.texts);
  showOutcome(tabId, res, msg.remaining);
  return res;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return false;
  }
  switch (msg.type) {
    case "translate":
      handleTranslate(tabId, msg).then(reply);
      return true; // reply asynchronously
    case "on":
      setBadge(tabId, BADGE_ON, TITLE_ON);
      return false;
    case "off":
      setBadge(tabId, "", TITLE_OFF);
      return false;
    default:
      return false;
  }
});

// Inject content.js once per page, then let it toggle itself on or off.
async function onClick(tab) {
  if (translator.isPaused()) {
    translator.resume();
    setBadge(tab.id, BADGE_ON, TITLE_ON);
    return;
  }

  const target = { tabId: tab.id };
  try {
    const [probe] = await chrome.scripting.executeScript({
      target,
      func: () => typeof globalThis.interleaf === "function",
    });
    if (!probe.result) {
      await chrome.scripting.insertCSS({ target, files: ["content.css"] });
      await chrome.scripting.executeScript({ target, files: ["content.js"] });
    }
    await chrome.scripting.executeScript({ target, func: () => globalThis.interleaf() });
  } catch (err) {
    // e.g. chrome:// pages and the Web Store do not allow scripts
    console.warn("interleaf: cannot run on this page", err);
  }
}

chrome.action.onClicked.addListener(onClick);

// lets E2E tests press the toolbar button
globalThis.interleafClick = onClick;
