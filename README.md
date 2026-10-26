# 大小豬的小空間 — 前端

「大小豬的小空間」的前端網站，部署在 GitHub Pages（`https://obearwu.github.io/5js-space/`），資料來自後端 API `ObearWu/5js-space-backend`（Private repo）。這份文件分成兩個獨立的部分，請依需求閱讀：

- **[專案報告](#專案報告)**：前端怎麼組織、為什麼這樣做。
- **[架設 SOP](#架設-sop)**：本機怎麼跑起來測試、怎麼部署到 GitHub Pages。

系統整體架構、登入白名單、資料庫、API 的完整說明見 `5js-space-backend` 的 README。

---

## 專案報告

### 這是什麼

大豬和小豬兩個人的生活紀錄網站。入口頁登入後選今天要用的功能：飲食、記帳（個人記帳＋兩人分帳）、月經、互動、運動。純 vanilla JavaScript，沒有框架、沒有建置流程，直接把檔案交給 GitHub Pages 服務，跟 `ObearWu/TaiwanLARP` 一樣。

### 每個功能一個資料夾

每個功能是一個真的資料夾（`food/index.html`），所以 `/food`、`/split` 這種路徑在 GitHub Pages 上直接打得開，不需要單頁應用程式的轉址設定。功能之間共用 `common/` 底下的程式：

```
index.html            入口頁：Google 登入、五個功能卡片
common/config.js      後端網址與 Google OAuth Client ID（全站只寫在這裡）
common/auth.js        登入、session、API 呼叫、依登入者切換配色
common/mascot.js      吉祥物：藍色／粉紅色棒棒糖（沿用舊的大小豬健康食記）
common/style.css      「記憶球總部」共用樣式：夜色背景、各功能情緒色（<html data-mod>）、光帶標題、記憶球
common/hq.js          功能清單與情緒色、手機底部導覽列、心情對應的顏色（新增功能時加在這裡）
common/hq-port.css    把舊 Artifact 搬來的飲食、經期兩頁換成總部外觀
manifest.webmanifest  加到手機主畫面當 App 用
icons/                主畫面圖示
common/claude-shim.js 把舊 Artifact 用的 window.claude（資料庫、AI、下載）換成呼叫我們的後端（飲食、經期共用）
food/index.html       飲食（舊「大小豬健康食記」整個搬進來，幾乎原封不動）
split/index.html      記帳：「記帳」分頁是自己的財務金三角帳本（只有本人看得到）；「分帳」分頁記兩人的花費與還錢
split/ledger.js       記帳分頁的程式（資料在後端 /api/ledger）
period/index.html     經期（舊「小豬經期日記」整個搬進來）
together/index.html   互動：每日一問（兩人答完才揭曉）、心情打卡、照片牆、紀念日倒數
fitness/index.html    運動：運動紀錄、重訓組數、體重曲線（跟飲食頁共用同一份紀錄）
```

### 飲食：舊食記怎麼搬進來

舊的「大小豬健康食記」是 Claude Artifact，資料庫、AI、下載都透過 `window.claude.use(...)` 取得。`common/claude-shim.js` 用同樣的介面重做這幾樣，底層改成呼叫後端（細節見後端 README），所以 `food/index.html` 的畫面、計算、提示詞幾乎沒動。改過的地方只有：網站標頭與回入口頁的連結、照片小圖放大到 480px、分享對象改成「另一半」且新使用者預設分享、還原備份時可以勾選要匯入哪幾位使用者。

**搬舊資料**：在舊食記按「備份與還原 → 下載備份」，再到新網站 `/food` 按「備份與還原 → 選擇備份檔還原」。備份裡有兩個人時，各自登入後只勾自己那位，紀錄才會算在自己名下；另一半在畫面上方「另一半」那排就看得到對方。

### 經期：舊經期日記怎麼搬進來

做法跟飲食一樣：`period/index.html` 是舊「小豬經期日記」本體，載入 `common/claude-shim.js` 前先設定 `window.CLAUDE_SHIM = { module: "period", prefix: "period/" }`，資料就存在後端的 `period/...` 路徑，跟飲食分開。改過的地方：

- **飲食對照直接讀飲食頁**：以前要每晚 23:59 從食記同步一份到經期日記，現在直接讀自己在 `/food` 的紀錄（性別為女的那位使用者，沒有就用第一位），記完一餐就更新。
- **兩個人都看得到分享**：以前只有網頁擁有者看得到「她的狀態」，現在另一半打開 `/period` 就會看到。新設定預設全部項目都分享，小豬可以在「設定」隨時關掉。
- **匯入舊備份**：舊經期日記只能匯出、不能匯入，這裡加了「匯入舊網頁的備份」（第一次打開的設定畫面、以及「設定 → 資料」都有），會跟現有紀錄合併。

### 互動、運動

- **互動**（`together/index.html`）是新寫的頁面，資料存在後端自己的資料表。每日一問要兩個人都回答才會看到對方的答案（後端就不給，偷看不到）。照片上傳前先在瀏覽器壓縮成大圖約 1600px、小圖約 480px。
- **運動**（`fitness/index.html`）跟飲食頁共用同一份紀錄：運動寫進飲食的 `exercise`、體重寫進 `weights`，所以在這裡記的運動，消耗的熱量會自動加進飲食頁當天可以吃的量；飲食頁記的運動、體重也會出現在這裡。重訓多記了動作、重量、次數、組數（`sets` 欄位，飲食頁不看這個欄位，不受影響）。個人資料有分享給另一半的話，運動和體重也會一起分享，另一半在「這週」看得到你的運動量。

入口頁的功能卡片清單在 `index.html` 的 `MODULES`。還沒做好的功能 `ready: false`，卡片顯示「製作中」、不能點；做好一個就改成 `true`。

### 登入

沿用 TaiwanLARP 後台的做法：Google 登入按鈕 → 拿 Google ID Token 換後端發的 session token，存在瀏覽器的 `localStorage`，下次打開不用重新登入。Google 登入成功、但 email 不在白名單裡的人，會停在登入畫面看到「此帳號尚未獲得授權」。後端暫時連不上（例如 Render 剛好在喚醒）時不會清掉 session，重新整理就會再試一次。

各功能頁開頭呼叫 `FiveJS.requireLogin("food")`：沒登入就導回入口頁，登入後自動回到原本的功能。

頁面加了 `noindex`，不會被搜尋引擎收錄；但真正擋住其他人的是後端，每支 API 都要登入。

### 配色與角色

依登入者切換：大豬是粉藍色＋藍色棒棒糖，小豬是粉紅色＋粉紅色棒棒糖，取自兩人手作的簇絨地毯，沿用舊的大小豬健康食記。配色存在後端 `users.theme`，上次的配色記在瀏覽器裡，打開頁面時先套上，避免畫面從粉紅閃成藍色。

### 喚醒後端

入口頁一打開就先呼叫後端的 `/api/health`。平常 cron-job.org 會讓後端保持清醒；萬一剛好在休眠，這樣能提早開始喚醒，3 秒還沒回應會顯示「正在叫醒後端，第一次打開可能要等一分鐘」。

---

# 架設 SOP

## Part A. 本機測試

1. 先照 `5js-space-backend` README 的 Part A 把後端跑在 `http://127.0.0.1:5001`。
2. 在這個資料夾開一個本機伺服器：

   ```bash
   cd 5js-space
   python3 -m http.server 8000
   ```

3. 用瀏覽器打開 **`http://localhost:8000/`**（不要用 `127.0.0.1`，Google 登入不接受 IP 位址當來源）。`common/config.js` 偵測到 localhost 時會自動改連本機後端。

## Part B. 設定 Google OAuth Client ID

照 `5js-space-backend` README 的 Part C 建好 OAuth Client 之後，把用戶端 ID 填進 `common/config.js` 的 `GOOGLE_CLIENT_ID`，commit 並 push。

## Part C. 部署到 GitHub Pages

1. 到 https://github.com/ObearWu/5js-space → **Settings** → 左側 **Pages**。
2. **Source** 選 **Deploy from a branch**，**Branch** 選 `main`、資料夾選 `/ (root)` → **Save**。
3. 等 1～2 分鐘，打開 `https://obearwu.github.io/5js-space/` 確認看到登入畫面。之後每次 push 到 `main` 都會自動更新。

## Part D. 後端網址

`common/config.js` 的 `API_BASE` 是 `https://fivejs-space-backend.onrender.com`（Render 實際給的網址；服務名稱開頭是數字，Render 自動改成 fivejs）。
