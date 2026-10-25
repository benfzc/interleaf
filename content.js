// Content script: finds paragraphs, asks the service worker for their
// translations, and appends each translation inside its paragraph.
// Injected by background.js; globalThis.interleaf() toggles it on and off.

(() => {
  // elements that hold one paragraph of text
  const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote, figcaption, caption, summary, div";

  // never translate inside these: code, form controls, navigation, or ours
  const SKIP = [
    "code", "pre", "kbd", "samp", "var", "script", "style", "noscript",
    "textarea", "input", "select", "button", "svg", "math", "nav",
    "[contenteditable='']", "[contenteditable='true']",
    "[translate='no']", ".notranslate", ".il-tr",
  ].join(", ");

  // text inside these is code even within a paragraph
  const CODE = "code, kbd, samp, var";

  const TR_CLASS = "il-tr";

  // translate what is visible plus two screens below it ahead of time
  const PREFETCH_MARGIN = "0px 0px 200% 0px";
  // wait for the page to settle before sending a batch
  const DEBOUNCE_MS = 100;
  // how often to check whether the user resumed after Google refused
  const PAUSED_POLL_MS = 5 * 1000;
  // keep in sync with MAX_BATCH_CHARS in lib/gtx.js
  const MAX_BATCH_CHARS = 5000;

  let active = false;
  let generation = 0; // bumped on each toggle so a stale pump stops
  let seen = new WeakSet();
  const pending = new Set(); // in the prefetch zone, not translated yet
  let io = null;
  let mo = null;
  let timer = 0;
  let pumping = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normalize = (text) => text.replace(/\s+/gu, " ").trim();

  // true if every non-blank text node sits inside code
  function onlyCode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.data.trim() !== "" && !n.parentElement.closest(CODE)) {
        return false;
      }
    }
    return true;
  }

  // a leaf block: no nested block, so its text is one paragraph
  function isCandidate(el) {
    if (seen.has(el) || el.closest(SKIP) || el.querySelector(BLOCK)) {
      return false;
    }
    return normalize(el.textContent) !== "" && !onlyCode(el);
  }

  function scan(root) {
    const list = [...root.querySelectorAll(BLOCK)];
    if (root.matches?.(BLOCK)) {
      list.push(root);
    }
    for (const el of list) {
      if (isCandidate(el)) {
        seen.add(el);
        io.observe(el);
      }
    }
  }

  function onIntersect(entries) {
    for (const e of entries) {
      if (e.isIntersecting) {
        pending.add(e.target);
      } else {
        // scrolled away before being sent: drop it, it comes back on return
        pending.delete(e.target);
      }
    }
    schedule();
  }

  function onMutate(records) {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || node.closest(`.${TR_CLASS}`)) {
          continue;
        }
        scan(node);
      }
    }
  }

  function schedule() {
    if (pumping || timer || pending.size === 0) {
      return;
    }
    timer = setTimeout(() => {
      timer = 0;
      pump(generation);
    }, DEBOUNCE_MS);
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  // visible paragraphs first, then the rest in reading order
  function takeBatch() {
    const els = [...pending].sort((a, b) => {
      const va = inViewport(a);
      if (va !== inViewport(b)) {
        return va ? -1 : 1;
      }
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    const batch = [];
    let total = 0;
    for (const el of els) {
      const text = normalize(el.innerText);
      if (batch.length > 0 && total + text.length > MAX_BATCH_CHARS) {
        break;
      }
      batch.push({ el, text });
      total += text.length;
    }
    return batch;
  }

  function insert(el, translation) {
    const span = document.createElement("span");
    span.className = TR_CLASS;
    span.lang = "zh-TW";
    span.textContent = translation;
    el.append(span);
  }

  async function pump(gen) {
    pumping = true;
    while (active && gen === generation && pending.size > 0) {
      const batch = takeBatch();
      let res;
      try {
        res = await chrome.runtime.sendMessage({
          type: "translate",
          texts: batch.map((b) => b.text),
          remaining: pending.size,
        });
      } catch {
        break; // extension reloaded or service worker gone
      }
      if (!res || !active || gen !== generation) {
        break;
      }

      // fill the whole batch at once so the page changes in one step
      batch.forEach((b, i) => {
        const tr = res.results[i];
        if (tr === null) {
          return;
        }
        pending.delete(b.el);
        io.unobserve(b.el);
        if (tr !== "") {
          insert(b.el, tr);
        }
      });

      if (res.outcome === "wait") {
        await sleep(res.waitMs);
      } else if (res.outcome === "paused") {
        await sleep(PAUSED_POLL_MS);
      }
    }
    pumping = false;
    // a toggle during the last await may have queued work for a new pump
    if (active) {
      schedule();
    }
  }

  function start() {
    active = true;
    generation++;
    seen = new WeakSet();
    io = new IntersectionObserver(onIntersect, { rootMargin: PREFETCH_MARGIN });
    mo = new MutationObserver(onMutate);
    scan(document.body);
    mo.observe(document.body, { childList: true, subtree: true });
    chrome.runtime.sendMessage({ type: "on" }).catch(() => {});
  }

  function stop() {
    active = false;
    generation++;
    clearTimeout(timer);
    timer = 0;
    pending.clear();
    io.disconnect();
    mo.disconnect();
    for (const el of document.querySelectorAll(`.${TR_CLASS}`)) {
      el.remove();
    }
    chrome.runtime.sendMessage({ type: "off" }).catch(() => {});
  }

  globalThis.interleaf = () => (active ? stop() : start());
})();
