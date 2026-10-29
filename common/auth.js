/*
 * 登入與 API 呼叫，每一頁共用。
 *
 * 流程沿用 TaiwanLARP 後台：Google 登入按鈕 → 拿 Google ID Token 換後端發的
 * session token，存在這台瀏覽器的 localStorage，下次打開不用重新登入。
 * 後端連不上（例如 Render 剛好在喚醒）不代表登入失效，所以不會清掉 token。
 *
 * 入口頁（/）負責登入；各功能頁呼叫 FiveJS.requireLogin()，沒登入就導回入口頁，
 * 登入後再回到原本的功能。
 */
(() => {
  const { API_BASE, GOOGLE_CLIENT_ID } = window.FIVEJS_CONFIG;
  const TOKEN_KEY = "fivejsSession";
  const ME_KEY = "fivejsMe";

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
  const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} };

  class AuthError extends Error {}

  // ---------- 離線補送（新增一筆帳／分帳） ----------
  // api(path, {method:"POST", body, queue:true}) 沒送到（沒網路、後端還在醒來）時，
  // 不報錯：存在這台瀏覽器，回傳 {queued:true}，之後自動補送。每筆帶一個 client_id，
  // 後端看到同一個 client_id 只記一次，所以「其實送到了但回應掉了」重送也不會記兩筆。
  const OUT_PREFIX = "fivejsApiOutbox:";
  const outKey = () => `${OUT_PREFIX}${cachedMe()?.user?.id || 0}`;
  const readOut = () => { try { return JSON.parse(localStorage.getItem(outKey()) || "[]"); } catch (e) { return []; } };
  const writeOut = list => {
    try { list.length ? localStorage.setItem(outKey(), JSON.stringify(list)) : localStorage.removeItem(outKey()); } catch (e) {}
    window.dispatchEvent(new Event("fivejs:outbox"));
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const retryable = status => status === 502 || status === 503 || status === 504;
  function stashApi(path, method, body) {
    const label = [body.title || body.kind, body.amount != null ? `$${body.amount}` : ""].filter(Boolean).join(" ");
    const list = readOut().concat({ path, method, body, label, at: Date.now() }).slice(-200);
    try { localStorage.setItem(outKey(), JSON.stringify(list)); }
    catch (e) { throw new Error("離線中，而且手機的儲存空間不夠，先存不下這筆。"); }  // 例如帶了大張收據照片
    window.dispatchEvent(new Event("fivejs:outbox"));
    armOut();
    return { queued: true };
  }
  let outTimer = null, outBusy = false;
  function armOut() { if (!outTimer) outTimer = setInterval(flushOut, 15000); }
  async function flushOut() {
    if (outBusy || navigator.onLine === false) return;
    let list = readOut();
    if (!list.length) { clearInterval(outTimer); outTimer = null; return; }
    outBusy = true; let sent = 0, dropped = 0;
    try {
      for (const it of list) {
        let res;
        try {
          res = await fetch(API_BASE + it.path, { method: it.method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(it.body) });
        } catch (e) { break; }
        if (res.status === 401 || retryable(res.status)) break;
        if (res.ok) sent++; else dropped++;  // 後端明確拒絕（資料不合法）：補送也不會成功，丟掉
        writeOut(readOut().filter(x => !(x.at === it.at && x.body.client_id === it.body.client_id)));
      }
    } finally { outBusy = false; }
    if (sent || dropped) window.dispatchEvent(new CustomEvent("fivejs:synced", { detail: { sent, dropped } }));
  }
  window.addEventListener("online", () => setTimeout(flushOut, 300));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) flushOut(); });
  if (readOut().length) { armOut(); setTimeout(flushOut, 1500); }

  async function api(path, { method = "GET", body, queue } = {}) {
    if (queue && method === "POST" && body && !Array.isArray(body.entries)) body = { ...body, client_id: body.client_id || newId() };
    else queue = false;
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      if (queue) return stashApi(path, method, body);
      throw new Error("連不上後端，可能正在喚醒中，請稍後再試一次。");
    }
    if (queue && retryable(res.status)) return stashApi(path, method, body);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new AuthError(data.error || "登入已逾期，請重新登入。");
    if (!res.ok) throw new Error(data.error || `發生錯誤（${res.status}）`);
    if (method === "GET" && CACHE_PATHS.test(path)) keep(path, data);
    return data;
  }

  // ---------- 先顯示上次的資料 ----------
  // 常用的讀取結果存在這台瀏覽器（依登入的人分開）。頁面打開先用 peek() 拿上次的畫出來，
  // 後端醒來、拿到最新的再重畫，不用一直看「正在叫醒後端」。登出時全部清掉。
  const CACHE_PATHS = /^\/api\/(hq\/|together\/|ledger\/state|split\/)/;
  const CACHE_PREFIX = "fivejsCache:";
  const cacheKey = path => `${CACHE_PREFIX}${cachedMe()?.user?.id || 0}:${path}`;
  function keep(path, data) {
    try {
      const v = JSON.stringify({ at: Date.now(), data });
      if (v.length < 600000) localStorage.setItem(cacheKey(path), v);
    } catch (e) { clearCache(); }
  }
  function peek(path) {
    try { const v = JSON.parse(localStorage.getItem(cacheKey(path)) || "null"); return v ? v.data : null; } catch (e) { return null; }
  }
  // all=true（登出）連還沒補送的也清掉；快取空間不夠時只清快取，不動還沒補送的
  function clearCache(all) {
    try { Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX) || k.startsWith("fivejsDocs:") || (all && (k.startsWith("fivejsOutbox:") || k.startsWith(OUT_PREFIX)))).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  }

  // 後端休眠時，第一個請求要等它醒來。頁面一打開就先叫醒它，不碰資料庫。
  function wake() {
    return fetch(API_BASE + "/api/health").then(r => r.ok).catch(() => false);
  }

  // 依登入者切換配色：blue（粉藍＋藍色棒棒糖）、pink（粉紅＋粉紅色棒棒糖）。
  // 先套上次的配色，避免畫面從粉紅閃成藍色。
  function applyTheme(theme) {
    document.documentElement.dataset.palette = theme === "blue" ? "blue" : "pink";
  }
  function rememberMe(me) { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch (e) {} }
  function cachedMe() { try { return JSON.parse(localStorage.getItem(ME_KEY) || "null"); } catch (e) { return null; } }
  const cached = cachedMe();
  if (cached?.user) applyTheme(cached.user.theme);

  // 回傳 {user, partner}；token 無效時丟 AuthError。
  async function status() {
    const me = await api("/auth/status");
    rememberMe(me);
    applyTheme(me.user.theme);
    return me;
  }

  function renderGoogleButton(el, onDone, onError) {
    if (!GOOGLE_CLIENT_ID) { onError(new Error("網站還沒設定 Google 登入（GOOGLE_CLIENT_ID）。")); return; }
    // Google 的 script 是非同步載入，還沒好就稍後再試
    if (!window.google || !google.accounts) { setTimeout(() => renderGoogleButton(el, onDone, onError), 200); return; }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async resp => {
        try {
          const r = await api("/auth/login", { method: "POST", body: { id_token: resp.credential } });
          setToken(r.session_token);
          onDone(await status());
        } catch (e) { onError(e); }
      },
    });
    google.accounts.id.renderButton(el, { theme: "outline", size: "large", shape: "pill", text: "signin_with", locale: "zh-TW" });
  }

  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); } catch (e) {}
    setToken(null);
    clearCache(true);
    try { localStorage.removeItem(ME_KEY); } catch (e) {}
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  }

  // 各功能頁用：沒登入就回入口頁，登入後自動回來。回傳 {user, partner}。
  async function requireLogin(moduleKey) {
    const back = () => { location.href = `../?next=${encodeURIComponent(moduleKey)}`; };
    if (!getToken()) { back(); return new Promise(() => {}); }
    // 這台瀏覽器登入過：先用上次的身分讓頁面畫出來，背景再跟後端確認；登入失效才導回入口頁
    const prev = cachedMe();
    if (prev?.user) {
      status().catch(e => { if (e instanceof AuthError) { setToken(null); back(); } });
      return prev;
    }
    try { return await status(); }
    catch (e) {
      if (e instanceof AuthError) { setToken(null); back(); return new Promise(() => {}); }
      throw e;
    }
  }

  // 還沒補送的筆數與簡短說明（頁面上方的提示條用）
  const pending = () => ({ api: readOut(), docs: (() => { try { return JSON.parse(localStorage.getItem(`fivejsOutbox:${cachedMe()?.user?.id || 0}`) || "[]"); } catch (e) { return []; } })() });

  window.FiveJS = Object.assign(window.FiveJS || {}, { pending, api, wake, status, getToken, setToken, AuthError, renderGoogleButton, logout, requireLogin, cachedMe, applyTheme, peek, clearCache });
})();
