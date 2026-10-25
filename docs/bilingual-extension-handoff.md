# 交接文件：網頁中英對照 browser extension

這份文件把 `benfzc/sumatrapdf` 的「PDF 中英對照」專案累積的知識，交給新的 project session。
新專案目標：做一個 Chrome / Edge 都能用的 extension，把非中文網頁轉成「一段原文、一段繁體中文」交錯排列的對照網頁（不是左右對照），只在瀏覽器上觀看，不需要儲存功能。

建議：新 repo 建好後，把第 1 節的規則整理進新 repo 的 `CLAUDE.md`，其他章節放在 `docs/` 當參考。

---

## 1. 使用者與工作規則（直接沿用）

- 使用者是 embedded Linux 工程師，熟 C 與 bash；JavaScript/TypeScript 與 extension 開發是新領域，解釋新概念時要附實際範例。
- 回覆用台灣繁體中文，專業術語用英文。程式碼註解一律用英文。
- **設計軟體時先討論架構，使用者明確說「提供程式」才開始寫程式。** 問指令或語法時直接給答案。
- 文件原則：由淺入深、重點在前、術語用英文、只寫目前正確內容（不寫修改歷史）、每次修改後 review 全文避免矛盾與重複。
- Commit message 七條規則：subject 與 body 空一行；subject ≤ 50 字元（上限 72）；首字大寫；結尾不加句號；祈使語氣；body 72 字元換行；body 說明 what 與 why，不寫 how。
- 寫程式的偏好：避免 magic number（抽成具名常數）；early return 減少縮排；函式名短；用 enum 取代 boolean 參數；分層，不跨層呼叫；只改與功能有關的程式碼。
- 使用者重視**閱讀舒適**，會用截圖回報問題，偏好一輪一輪小步改進。

## 2. 新專案要先和使用者討論的問題

不要自行決定，先列出選項與建議，等使用者確認：

1. 對照的呈現方式：使用者已表明要「一段原文、一段繁體中文」交錯排列，**不要左右對照**。
   「一句原文、一句中文」更好，但使用者擔心排版雜亂。要討論的是：
   - 逐段交錯的樣式（譯文字級、顏色、間距），讓原文與譯文一眼分得出來
   - 逐句交錯是否可行：句子切分（縮寫 `e.g.`、數字 `1.8 V` 裡的句點）、Google 回傳的句子能否對回原句、短句很多時是否反而難讀
   - 是否做成可切換（逐段／逐句）
2. 觸發方式：工具列按鈕、右鍵選單、快捷鍵、特定網站自動翻譯？
3. 翻譯時機：整頁一次翻完才顯示，還是看到哪翻到哪？PDF 版使用者選了「一頁全部翻完才一次換成中文」，因為逐段出現會讓版面跳動；網頁版要重新確認。
4. 動態內容：SPA、無限捲動、之後才載入的留言要不要翻？
5. 樣式：譯文的字級、顏色、是否可以關掉。
6. 發布：只給自己用（load unpacked），還是上架 Chrome Web Store / Edge Add-ons？

## 3. 可直接沿用的技術知識

### 3.1 Google 翻譯免費端點（gtx）

- URL：`https://translate.googleapis.com/translate_a/single`，不需要 API key，非官方、沒有文件，可能隨時改格式或封鎖。
- 用 POST，`Content-Type: application/x-www-form-urlencoded;charset=UTF-8`，body：
  `client=gtx&sl=en&tl=zh-TW&dt=t&q=<url-encoded text>`（`sl=auto` 可自動偵測來源語言）
- 回應是巢狀 JSON array，譯文是 `[0][i][0]` 每一個 segment 的第一個字串，依序串起來就是完整譯文。
- **批次**：多個段落用空行（`\n\n`）連接後一次送出，回傳的空行分隔會保留，可以切回各段。切回的段數不符時，改成一段一段重送。
- 實測（使用者家裡的網路）：
  - POST 40000 字元仍回 200，但沒驗證長文是否完整翻譯，所以單次上限定 5000 字元。
  - 每次延遲約 0.5～3 秒；約每 3 秒一次，連續 30 次都沒被擋。
  - 預設限速：每分鐘 20 次、每小時 300 次（每小時上限還沒實測）。
- 被限流時回 HTTP 429，或回一個 HTML「Sorry...」captcha 頁（body 以 `<` 開頭且含 `Sorry`），兩種都要當成 Blocked。
- 品質：暫存器名稱、型號、單位大多保留；但 Google 偶爾漏掉繁體轉換、回簡體字。PDF 版用 Windows `LCMapStringEx` 逐字轉繁體；瀏覽器沒有這個 API，可以考慮 `opencc-js`（只做字元轉換，不做「软件→軟體」這類用語轉換），或接受偶爾出現簡體字。
- **雲端 IP 會被 Google 直接封鎖**（CI、Claude 雲端容器都一樣）。所以自動化測試一律用存下來的真實回應當 fixture，真正連線只在使用者的網路測。

### 3.2 Rate limit 與錯誤處理

- 每分鐘、每小時兩個 sliding window。
- 遇到 Blocked 時冷卻 30s → 60s → 120s → 240s；連續第 4 次改為暫停，等使用者手動恢復。
- 成功一次就重設冷卻次數。
- 狀態要讓使用者看得到，例如「等待 30 秒後重試（剩 12 段）」或「Google 拒絕請求，按此重試」。

### 3.3 哪些文字不翻

- 不含任何「一般單字」的段落直接跳過。一般單字的定義：至少 3 個字母、全是字母、除了第一個字母外都是小寫。例如 `GPIOA_MODER`、`STM32F407VG`、`1.8 V`、`400 kHz`、`0x4002 0000` 都會跳過。
- 程式碼、指令不翻：PDF 版用等寬字型判斷；網頁上對應 `<code>`、`<pre>`、`<kbd>`、`<samp>`、`<script>`、`<style>`、`<textarea>`、`contenteditable` 等。
- 已經是中文的段落不送。

### 3.4 排程

- 畫面上看得到的段落優先翻，其次預先翻後面一點（PDF 版預先翻 2 頁）。網頁可以用 `IntersectionObserver`。
- 使用者捲走後，還沒送出的預取請求就作廢（PDF 版用 generation 計數器）。
- 同一段文字只翻一次：key = provider + 目標語言 + 原文。新專案不需要儲存，用記憶體 `Map` 即可（關閉分頁就清掉）。

### 3.5 Provider 抽象

先只做 gtx，但介面要能換成其他 provider。已評估的候選是 Google AI Studio 免費 API key（Gemini API）：

| | gtx 端點 | Gemini API（免費 key） |
|---|---|---|
| 性質 | 非公開，可能隨時改或封鎖 | 官方 API，有文件 |
| 註冊 | 不需要 | Google 帳號 + API key |
| 額度 | 未公開，超過回 429 + 封鎖頁 | 公開的每分鐘、每日上限 |
| 品質 | 一般機器翻譯 | LLM，可帶術語表與不翻清單 |
| 速度 | 快 | 較慢 |
| 資料 | 無條款可依循 | 免費方案的輸入可能被用來改進 Google 產品 |

不論哪種 provider，網頁文字都會送到 Google。說明文件要提醒：**有 NDA 的內容不要用。**

## 4. 版面與閱讀舒適度的經驗（PDF 版使用者實測回饋）

- 簡體字混進來 → 顯示前轉繁體。
- 中文字太小 → 最小字級要可讀；PDF 版最後定為從 13px 起，可縮到 10px。
- 標題翻譯後要保留粗體與較大字級。
- 表格要逐格翻，不能把整列合成一段。
- 每段各自調整位置與字級，會讓版面「忽左忽右、忽大忽小」，使用者很不喜歡。改成整頁一致：同類文字同一字級，位置固定在原文左緣。
- 放不下時寧可截斷加「…」，再用 hover tooltip 顯示完整中文（只顯示中文，不顯示英文）。
- 指令與程式碼被翻譯會很困擾，一定要跳過。

逐段交錯插入譯文、讓網頁自然 reflow，可以避開 PDF 版大部分的空間問題，但「一致性」與「不要讓版面跳動」這兩個原則仍然適用。

## 5. 開發環境與流程經驗

- 使用者電腦沒有完整開發環境，主要在 Claude 雲端 session 開發；編譯、測試、發布交給 GitHub Actions。
- 雲端容器有 Chromium 和 Playwright（`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`，不要執行 `playwright install`），可以載入 unpacked extension 做 E2E 測試；用 `page.route()` 攔截 gtx 請求，回傳 fixture。
- 先做 spike：寫一支 bash + curl + jq 的小程式，讓使用者在自己的網路執行，確認端點行為，並把原始回應存成 fixture。PDF 版的 spike 見下方參考檔案。
- Claude 雲端環境**不能 push git tag**（只能 push 指定分支）。所以發布用「版本檔觸發」：分支上的 `.github/release-version` 改成新版號，CI build 完檢查該版號還沒有 Release，就用 `gh release create --target <sha>` 建立 tag 與 Release。
- GitHub Actions 的 artifact 要登入才能下載；要給別人用就發 GitHub Release（public repo 不用登入）。
- Extension 不需要編譯 native code，CI 可以全用 `ubuntu-latest`：lint、unit test、Playwright E2E、把 extension 打包成 zip 附在 Release。

## 6. 參考檔案（public repo，可以直接讀取）

Repo：`https://github.com/benfzc/sumatrapdf`，分支 `claude/admiring-lovelace-g5cd8t`。raw 檔案前綴：
`https://raw.githubusercontent.com/benfzc/sumatrapdf/claude/admiring-lovelace-g5cd8t/`

| 檔案 | 內容 |
|---|---|
| `spike/google-translate-spike.sh` | gtx 端點 spike（基本請求、術語保留、批次、POST 大小、限流測試） |
| `src/shared/GoogleFreeTranslate.cpp` | 請求組裝、回應解析、Blocked 判斷 |
| `src/shared/tests/GoogleFreeTranslate_ut.cpp` | 使用者網路實際拿到的 gtx 回應（可改成 JS fixture） |
| `src/shared/RateLimiter.cpp` | sliding window 與冷卻／暫停邏輯 |
| `src/shared/TranslationService.cpp` | 背景排程、Visible/Prefetch 優先序、批次失敗改逐段 |
| `src/shared/ParagraphText.cpp` | 跳過規則（`ClassifyParagraph`）與段落合併 |
| `.github/workflows/fork-build.yml` | 版本檔觸發的 Release 流程 |
| `CLAUDE.md` | PDF 版的規則與已定案設計 |
