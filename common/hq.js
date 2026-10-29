/*
 * 「記憶球總部」的共用小工具，每一頁都載入：
 * - MODS：各功能的名稱、路徑與情緒色（新增功能時加在這裡，首頁和導覽列都會跟著出現）。
 * - 手機底部導覽列：依 <html data-mod> 標出目前在哪一頁，載入時自動加到頁面最下面。
 * - MOOD_COLOR：互動頁心情打卡的八種心情對應的情緒色（首頁記憶架也用）。
 * - 註冊 sw.js（手機推播）。
 */
(() => {
  const MODS = [
    { key: "hq", name: "總部", path: "", color: "var(--gold)" },
    { key: "food", name: "飲食", path: "food/", color: "var(--joy)" },
    { key: "split", name: "記帳", path: "split/", color: "var(--disgust)" },
    { key: "period", name: "經期", path: "period/", color: "var(--emb)" },
    { key: "together", name: "互動", path: "together/", color: "var(--sad)" },
    { key: "fitness", name: "運動", path: "fitness/", color: "var(--anger)" },
  ];
  const MOOD_COLOR = {
    "超開心": "var(--joy)", "開心": "var(--gold)", "平靜": "var(--envy)", "累": "var(--ennui)",
    "有點煩": "var(--anx)", "難過": "var(--sad)", "生氣": "var(--anger)", "想你": "var(--emb)",
  };

  function tabbar() {
    // 經期頁有自己的底部分頁（data-no-tabbar），不再疊一條
    if (document.querySelector(".tabbar") || document.documentElement.hasAttribute("data-no-tabbar")) return;
    const cur = document.documentElement.dataset.mod || "hq";
    // 功能頁都在網站根目錄的下一層，入口頁在根目錄
    const root = cur === "hq" ? "" : "../";
    const el = document.createElement("div");
    el.className = "tabbar";
    el.innerHTML = `<nav aria-label="切換功能">${MODS.map(m =>
      `<a href="${root}${m.path || "./"}"${m.key === cur ? ' aria-current="page"' : ""}><i class="orb" style="--c:${m.color}"></i>${m.name}</a>`
    ).join("")}</nav>`;
    document.body.appendChild(el);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tabbar);
  else tabbar();

  // 離線／還沒補送的提示條：沒網路時說一聲可以照常記；有東西還沒送出時列出筆數與前幾筆。
  // 實際的暫存與補送在 auth.js（帳）和 claude-shim.js（飲食、運動、經期）。
  function pendingBar() {
    let el = null;
    const draw = () => {
      let n = 0, items = [];
      try { const p = FiveJS.pending?.(); if (p) { n = p.api.length + p.docs.length; items = p.api.map(x => x.label).filter(Boolean).slice(0, 3); } } catch (e) {}
      const off = navigator.onLine === false;
      if (!n && !off) { if (el) el.hidden = true; return; }
      if (!el) {
        el = document.createElement("div"); el.id = "fivejsPendingBar"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
        el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 6px);z-index:45;max-width:calc(100% - 24px);background:#3a3050;color:#fff;border-radius:999px;padding:6px 14px;font-size:.78rem;line-height:1.4;box-shadow:0 2px 10px rgba(0,0,0,.25);text-align:center;pointer-events:none";
        document.body.appendChild(el);
      }
      el.hidden = false;
      el.textContent = (off ? "離線中" : "") + (off && n ? "，" : "") + (n ? `${n} 筆還沒送出（已存在手機）${items.length ? "：" + items.join("、") : ""}，有網路會自動補送` : "，可以照常記，之後自動補送");
    };
    window.addEventListener("online", draw); window.addEventListener("offline", draw); window.addEventListener("fivejs:outbox", draw);
    setInterval(draw, 4000); draw();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pendingBar);
  else pendingBar();

  // 推播用的 service worker（收通知，也把頁面和程式存起來，沒網路時還打得開）。註冊在網站根目錄，整個網站都收得到。
  const ROOT = (document.documentElement.dataset.mod || "hq") === "hq" ? "" : "../";
  if ("serviceWorker" in navigator) navigator.serviceWorker.register(ROOT + "sw.js").catch(() => {});

  window.FiveJS = Object.assign(window.FiveJS || {}, { MODS, MOOD_COLOR });
})();
