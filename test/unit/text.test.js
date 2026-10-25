import { test } from "node:test";
import assert from "node:assert/strict";
import { Kind, classify, normalize } from "../../lib/text.js";

test("prose is translated", () => {
  for (const t of ["The device enters sleep mode.", "Reset", "Größe der Datei", "(shown, below)"]) {
    assert.equal(classify(t), Kind.Translate, t);
  }
});

test("register names, part numbers and units are skipped", () => {
  for (const t of ["GPIOA_MODER", "STM32F407VG", "1.8 V", "400 kHz", "0x4002 0000", "PLL", "", "e.g. 42"]) {
    assert.equal(classify(t), Kind.Skip, t);
  }
});

test("Chinese is skipped, Japanese and Korean are translated", () => {
  assert.equal(classify("看門狗計時器將重置系統。"), Kind.Skip);
  assert.equal(classify("使用 the API 讀取暫存器的值"), Kind.Skip);
  assert.equal(classify("ウォッチドッグタイマー"), Kind.Translate);
  assert.equal(classify("감시 타이머"), Kind.Translate);
});

test("normalize collapses whitespace", () => {
  assert.equal(normalize("  a\n\n b\tc  "), "a b c");
});
