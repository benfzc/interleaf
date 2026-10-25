// Decides which paragraphs are worth sending for translation.

export const Kind = Object.freeze({
  Translate: "translate",
  Skip: "skip",
});

// shortest run of letters that counts as an ordinary word ("the"; "PLL" is not)
const MIN_WORD_LEN = 3;

// punctuation stripped from both ends of a word: "shown," -> "shown"
const WORD_PUNCT = /^[.,;:()"'!?]+|[.,;:()"'!?]+$/gu;

// an ordinary word: letters only, lower case except maybe the first
// ("Reset", "the", "Größe"; not "PLL", "kHz", "GPIOA_MODER", "1.8")
const ORDINARY_WORD = /^\p{L}\p{Ll}+$/u;

// scripts without letter case, so the word rule cannot see them
const KANA_HANGUL = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const HAN = /\p{Script=Han}/gu;
const LATIN = /\p{Script=Latin}/gu;

// collapse whitespace runs into one space
export function normalize(text) {
  return text.replace(/\s+/gu, " ").trim();
}

function count(text, re) {
  return (text.match(re) || []).length;
}

function hasOrdinaryWord(text) {
  for (const raw of text.split(" ")) {
    const w = raw.replace(WORD_PUNCT, "");
    if (w.length >= MIN_WORD_LEN && ORDINARY_WORD.test(w)) {
      return true;
    }
  }
  return false;
}

// text must already be normalized
export function classify(text) {
  if (KANA_HANGUL.test(text)) {
    return Kind.Translate;
  }
  // already Chinese, maybe with a few English terms mixed in
  if (count(text, HAN) > count(text, LATIN)) {
    return Kind.Skip;
  }
  return hasOrdinaryWord(text) ? Kind.Translate : Kind.Skip;
}
