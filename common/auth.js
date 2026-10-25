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

  async function api(path, { method = "GET", body } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new Error("連不上後端，可能正在喚醒中，請稍後再試一次。");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new AuthError(data.error || "登入已逾期，請重新登入。");
    if (!res.ok) throw new Error(data.error || `發生錯誤（${res.status}）`);
    return data;
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
    try { localStorage.removeItem(ME_KEY); } catch (e) {}
    if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  }

  // 各功能頁用：沒登入就回入口頁，登入後自動回來。回傳 {user, partner}。
  async function requireLogin(moduleKey) {
    const back = () => { location.href = `../?next=${encodeURIComponent(moduleKey)}`; };
    if (!getToken()) { back(); return new Promise(() => {}); }
    try { return await status(); }
    catch (e) {
      if (e instanceof AuthError) { setToken(null); back(); return new Promise(() => {}); }
      throw e;
    }
  }

  window.FiveJS = Object.assign(window.FiveJS || {}, { api, wake, status, getToken, setToken, AuthError, renderGoogleButton, logout, requireLogin, cachedMe, applyTheme });
})();
