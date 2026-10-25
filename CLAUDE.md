# interleaf

Chrome / Edge browser extension：把非中文網頁轉成「一段原文、一段繁體中文」交錯排列的對照網頁（不是左右對照），只在瀏覽器上觀看，不需要儲存功能。

背景知識（Google gtx 端點實測、rate limit、不翻譯規則、閱讀舒適度經驗）見 `docs/bilingual-extension-handoff.md`。

## 溝通

- 使用者是 embedded Linux 工程師，熟 C 與 bash；JavaScript/TypeScript 與 extension 開發是新領域，解釋新概念時要附實際範例。
- 回覆用台灣繁體中文，專業術語用英文。
- 問指令或語法時直接給答案。
- 使用者重視閱讀舒適，會用截圖回報問題，偏好一輪一輪小步改進。

## 設計流程

- 設計軟體時先討論架構，列出選項與建議，等使用者確認。
- 使用者明確說「提供程式」才開始寫程式。

## 程式碼

- 程式碼註解一律用英文。
- 避免 magic number，抽成具名常數。
- 用 early return 減少縮排。
- 函式名短。
- 用 enum 取代 boolean 參數。
- 分層，不跨層呼叫。
- 只改與功能有關的程式碼。

## 文件

- 由淺入深，重點在前。
- 術語用英文。
- 只寫目前正確的內容，不寫修改歷史。
- 每次修改後 review 全文，避免矛盾與重複。

## Commit message

1. Subject 與 body 之間空一行。
2. Subject ≤ 50 字元（上限 72）。
3. Subject 首字大寫。
4. Subject 結尾不加句號。
5. Subject 用祈使語氣。
6. Body 72 字元換行。
7. Body 說明 what 與 why，不寫 how。

## 已定案設計

原則：避免 over design，先求有再求好。

- 呈現：只做逐段交錯（Paragraph）。譯文插在原文元素內的最後，不做逐句。
- 觸發：只用工具列按鈕。按一下翻譯，再按一下還原。
- 簡體字：顯示前用 `opencc-js` 做字元轉換（cn → tw）。
- 語言與建置：純 JavaScript（ES modules），不用 TypeScript，不需要 build 步驟。第三方程式庫放 `vendor/`。
- 分層：
  - Content script 只處理 DOM：擷取段落、依元素跳過程式碼（`<code>`、`<pre>` 等）、插入譯文。
  - Service worker 處理文字與網路：依文字內容跳過、cache、rate limit、呼叫 gtx、轉繁體。
  - Service worker 的邏輯不碰 DOM，可以直接用 Node 跑 unit test。

## 開發與測試

- `npm test`：unit test，只需要 Node。`npm run e2e`：用 Playwright 載入 unpacked extension。
- 雲端容器已經有 Chromium 與 Playwright，不要執行 `playwright install` 或 `npm install`。
- 雲端 IP 會被 Google 封鎖，測試一律用 `test/fixtures/` 的真實回應或攔截請求，真正連線只在使用者的網路測。
- 發布：改 `manifest.json` 的 `version`，CI 在該版本沒有 Release 時建立 Release（雲端 session 不能 push tag）。
