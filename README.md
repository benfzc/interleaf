# Interleaf 中英對照

Chrome / Edge extension：把網頁的每一段原文下方插入繁體中文翻譯，變成「一段原文、一段中文」交錯排列。

> **注意：網頁文字會送到 Google 翻譯。有 NDA 的內容不要使用。**

## 安裝

1. 到 [Releases](https://github.com/benfzc/interleaf/releases) 下載 `interleaf-*.zip`，解壓縮到固定的資料夾。
2. 開啟 `chrome://extensions`（Edge 是 `edge://extensions`），打開「開發人員模式」。
3. 按「載入未封裝項目」，選擇解壓縮後的資料夾。

## 使用

- 按工具列的 Interleaf 圖示：翻譯目前分頁。再按一次：還原。
- 先翻畫面上看得到的段落，再預先翻往下約兩個螢幕高的內容。捲動或之後才載入的內容（留言、無限捲動）會接著翻。
- 圖示上的標記：

  | 標記 | 意思 |
  |---|---|
  | `中` | 對照模式開啟中 |
  | `…` | 翻譯中 |
  | `30s` | 達到速率上限或被 Google 限流，等待秒數後自動重試 |
  | `!` | Google 連續拒絕，已暫停；按圖示恢復 |

不翻譯的內容：程式碼（`<code>`、`<pre>` 等）、輸入框、按鈕、導覽列、已經是中文的段落、沒有一般單字的段落（如 `GPIOA_MODER`、`400 kHz`）。

## 運作方式

```
content.js (每個網頁)                     background.js (service worker)
  找出段落、跳過程式碼                        依文字內容跳過 → cache → rate limit
  IntersectionObserver 決定先翻哪些   ──►    → Google gtx → 簡轉繁 (opencc-js)
  一批譯文一次插入                     ◄──
```

- 翻譯用 Google 翻譯的免費端點（非官方，可能隨時改變或封鎖），每分鐘最多 20 次、每小時 300 次請求。
- 多個段落用空行連接成一次請求，最多 5000 字元。
- 譯文只存在記憶體，不儲存任何東西。

## 開發

純 JavaScript，不需要 build。改完程式後到 `chrome://extensions` 按重新載入。

```sh
npm test       # unit tests (Node only)
npm run e2e    # loads the extension in Chromium via Playwright
```

E2E 測試攔截 Google 翻譯請求並回傳假譯文，不會真的連線。

發布：修改 `manifest.json` 的 `version` 並 push，CI 會在該版本還沒有 Release 時自動建立 GitHub Release 並附上 zip。

## 授權

`vendor/opencc-js/` 是 [opencc-js](https://github.com/nk2028/opencc-js) 1.4.2，授權見該目錄。
