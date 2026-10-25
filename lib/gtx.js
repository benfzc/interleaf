// Google Translate free endpoint (client=gtx). Undocumented; may change or
// be blocked at any time. See docs/bilingual-extension-handoff.md 3.1.

export const GTX_URL = "https://translate.googleapis.com/translate_a/single";

// longer requests return 200 but full translation was never verified
export const MAX_BATCH_CHARS = 5000;

const PARA_SEP = "\n\n";
const HTTP_OK = 200;
const HTTP_TOO_MANY_REQUESTS = 429;

export const GtxStatus = Object.freeze({
  Ok: "ok",
  Blocked: "blocked",         // 429 or captcha page: back off
  Failed: "failed",           // other HTTP error
  BadResponse: "badResponse", // unparsable, or paragraph count mismatch
});

// Index one past the last text that fits in maxChars, counting separators.
// Always takes at least one, so an oversized text goes alone.
export function batchEnd(texts, start, maxChars = MAX_BATCH_CHARS) {
  let total = 0;
  let end = start;
  while (end < texts.length) {
    const add = texts[end].length + (end > start ? PARA_SEP.length : 0);
    if (end > start && total + add > maxChars) {
      break;
    }
    total += add;
    end++;
  }
  return end;
}

export function buildBody(texts, srcLang, dstLang) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: srcLang,
    tl: dstLang,
    dt: "t",
    q: texts.join(PARA_SEP),
  });
  return params.toString();
}

function isBlockedPage(body) {
  // when throttling, Google serves an HTML "Sorry..." captcha page
  return body.startsWith("<") && body.includes("Sorry");
}

// Returns { status, texts }; texts holds nExpected translations when Ok.
export function parse(httpStatus, body, nExpected) {
  if (httpStatus === HTTP_TOO_MANY_REQUESTS || isBlockedPage(body)) {
    return { status: GtxStatus.Blocked, texts: [] };
  }
  if (httpStatus !== HTTP_OK) {
    return { status: GtxStatus.Failed, texts: [] };
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { status: GtxStatus.BadResponse, texts: [] };
  }
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    return { status: GtxStatus.BadResponse, texts: [] };
  }

  // translated text is the first string of every segment: [0][i][0]
  const joined = data[0]
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""))
    .join("");
  const texts = joined.split(PARA_SEP).map((t) => t.trim());
  if (joined.length === 0 || texts.length !== nExpected) {
    return { status: GtxStatus.BadResponse, texts: [] };
  }
  return { status: GtxStatus.Ok, texts };
}
