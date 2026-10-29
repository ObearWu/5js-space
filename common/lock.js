/*
 * App 上鎖：這台裝置自己的 4 碼 PIN。
 *
 * 這是擋住旁人隨手翻看的「軟鎖」，不是加密：PIN 的雜湊存在這台裝置的 localStorage，
 * 資料本身沒有加密，懂開發者工具的人可以繞過。忘記 PIN 的出路是登出再用 Google 重新登入
 * （登出會一併清掉這台的 PIN），所以偷到手機的人還是得有 Google 帳號才進得去。
 *
 * 每個頁面的 <head> 都載入這支。已經登入而且設了 PIN 的話：
 * - 打開頁面時，離上次操作超過設定的時間，就先蓋一層全螢幕輸入 PIN 的畫面，再讓人看到內容。
 * - 切回這個頁面（從背景回來）時也一樣檢查。
 * 在各頁之間切換不算「離開」，所以不會每換一頁就問一次。
 */
(function () {
  "use strict";
  const SRC = document.currentScript && document.currentScript.src;
  const KEY = "fivejsLock", ACTIVE = "fivejsLockActive";
  const IDLE_CHOICES = [[0, "每次離開都上鎖"], [60, "1 分鐘沒用"], [300, "5 分鐘沒用"], [900, "15 分鐘沒用"]];
  const enc = new TextEncoder();

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const save = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} };
  const loggedIn = () => { try { return !!localStorage.getItem("fivejsSession"); } catch (e) { return false; } };
  const supported = () => !!(window.crypto && crypto.subtle);
  const enabled = () => !!load()?.hash;

  async function hash(pin, salt) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${pin}`));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const randomSalt = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, "0")).join("");
  const touch = () => { try { sessionStorage.setItem(ACTIVE, String(Date.now())); } catch (e) {} };
  const lastActive = () => { try { return +sessionStorage.getItem(ACTIVE) || 0; } catch (e) { return 0; } };

  function shouldLock() {
    const c = load();
    if (!c?.hash || !loggedIn()) return false;
    // 「每次離開都上鎖」也留 3 秒：在各頁之間切換（整頁重新載入）不算離開
    const idle = Math.max(c.idle ?? 60, 3) * 1000, last = lastActive();
    // 同一個分頁裡切換頁面：離上次操作還沒超過設定的時間就不用再輸入
    return !last || Date.now() - last > idle;
  }

  const api = {
    supported, enabled, IDLE_CHOICES,
    idle: () => load()?.idle ?? 60,
    async set(pin, idle) {
      if (!/^\d{4}$/.test(pin)) throw new Error("PIN 要是 4 個數字");
      const salt = randomSalt();
      save({ salt, hash: await hash(pin, salt), idle: idle ?? load()?.idle ?? 60 });
      touch();
    },
    async verify(pin) { const c = load(); return !!c?.hash && (await hash(pin, c.salt)) === c.hash; },
    setIdle(s) { const c = load(); if (c) save({ ...c, idle: +s }); },
    disable() { try { localStorage.removeItem(KEY); } catch (e) {} },
    lockNow() { try { sessionStorage.removeItem(ACTIVE); } catch (e) {} show(); },
  };
  window.FiveLock = api;

  let overlay = null, fails = 0, waitUntil = 0;
  const css = `
#fiveLock{position:fixed;inset:0;z-index:2147483000;background:#15102A;color:#F3EEFF;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;font-family:"Noto Sans TC",system-ui,sans-serif;touch-action:manipulation}
#fiveLock h1{margin:0;font-size:1.15rem;font-weight:700}
#fiveLock .dots{display:flex;gap:14px;height:18px}
#fiveLock .dots i{width:14px;height:14px;border-radius:50%;border:2px solid #FFD36B;display:block}
#fiveLock .dots i.on{background:#FFD36B}
#fiveLock .pad{display:grid;grid-template-columns:repeat(3,72px);gap:12px}
#fiveLock .pad button{height:72px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:inherit;font-size:1.5rem;font-family:inherit;cursor:pointer}
#fiveLock .pad button:active{background:rgba(255,211,107,.3)}
#fiveLock .pad .ghost{border:0;background:none;font-size:.9rem}
#fiveLock p{margin:0;min-height:1.3em;font-size:.88rem;color:#FFB3C7;text-align:center}
#fiveLock .forgot{border:0;background:none;color:#B9AEDA;font:inherit;font-size:.85rem;text-decoration:underline;cursor:pointer;padding:6px}
#fiveLock.shake .dots{animation:fiveShake .35s}
@keyframes fiveShake{20%{transform:translateX(-8px)}60%{transform:translateX(8px)}}`;

  function show() {
    if (overlay || !enabled() || !loggedIn()) return;
    let pin = "";
    overlay = document.createElement("div");
    overlay.id = "fiveLock"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-label", "輸入 PIN 解鎖");
    overlay.innerHTML = `<style>${css}</style><h1>大小豬的小空間</h1><div class="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p id="flMsg" role="status">輸入 4 碼 PIN</p>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-n="${n}">${n}</button>`).join("")}<button type="button" class="ghost" data-act="clear" aria-label="清除">清除</button><button type="button" data-n="0">0</button><button type="button" class="ghost" data-act="back" aria-label="刪除一碼">⌫</button></div>
      <button type="button" class="forgot" data-act="forgot">忘記 PIN？登出後用 Google 重新登入</button>`;
    document.documentElement.appendChild(overlay);
    const dots = overlay.querySelectorAll(".dots i"), msg = overlay.querySelector("#flMsg");
    const draw = () => dots.forEach((d, i) => d.classList.toggle("on", i < pin.length));
    async function submit() {
      if (Date.now() < waitUntil) { msg.textContent = `錯太多次了，請等 ${Math.ceil((waitUntil - Date.now()) / 1000)} 秒`; pin = ""; draw(); return; }
      if (await api.verify(pin)) { fails = 0; touch(); overlay.remove(); overlay = null; return; }
      fails++; pin = ""; draw();
      overlay.classList.remove("shake"); void overlay.offsetWidth; overlay.classList.add("shake");
      if (navigator.vibrate) navigator.vibrate(80);
      if (fails >= 5) { waitUntil = Date.now() + Math.min(300, 15 * 2 ** (fails - 5)) * 1000; msg.textContent = `錯太多次了，請等 ${Math.ceil((waitUntil - Date.now()) / 1000)} 秒`; }
      else msg.textContent = `PIN 不對（${fails}/5）`;
    }
    overlay.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.n != null) { if (pin.length < 4) { pin += b.dataset.n; draw(); msg.textContent = ""; if (pin.length === 4) await submit(); } }
      else if (b.dataset.act === "back") { pin = pin.slice(0, -1); draw(); }
      else if (b.dataset.act === "clear") { pin = ""; draw(); }
      else if (b.dataset.act === "forgot") {
        if (!confirm("登出這台裝置，並清掉這台的 PIN？之後要用 Google 重新登入。")) return;
        try { if (window.FiveJS?.logout) await FiveJS.logout(); } catch (err) {}
        api.disable();
        try { localStorage.removeItem("fivejsSession"); } catch (err) {}
        location.href = SRC ? new URL("../", SRC).href : "./";
      }
    });
    overlay.addEventListener("keydown", e => { if (/^\d$/.test(e.key)) overlay.querySelector(`[data-n="${e.key}"]`)?.click(); else if (e.key === "Backspace") overlay.querySelector('[data-act="back"]').click(); });
    overlay.tabIndex = -1; overlay.focus();
  }

  // ---- 啟動：先檢查要不要鎖，再開始記錄「最後一次操作」----
  if (shouldLock()) show(); else if (enabled() && loggedIn()) touch();
  let lastTouch = 0;
  const bump = () => { const n = Date.now(); if (!overlay && n - lastTouch > 5000) { lastTouch = n; touch(); } };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach(ev => addEventListener(ev, bump, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (enabled() && !overlay) touch(); return; }
    if (shouldLock()) show();
  });
  addEventListener("pagehide", () => { if (enabled() && !overlay) touch(); });
  addEventListener("pageshow", e => { if (e.persisted && shouldLock()) show(); });
})();
