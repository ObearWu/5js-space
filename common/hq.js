/*
 * 「記憶球總部」的共用小工具，每一頁都載入：
 * - MODS：各功能的名稱、路徑與情緒色（新增功能時加在這裡，首頁和導覽列都會跟著出現）。
 * - 手機底部導覽列：依 <html data-mod> 標出目前在哪一頁，載入時自動加到頁面最下面。
 * - MOOD_COLOR：互動頁心情打卡的八種心情對應的情緒色（首頁記憶架也用）。
 * - moodFace(mood)：心情球上的表情臉（SVG），放進 <i class="orb"> 裡面。
 * - glassPop(anchor, html, color)：在記憶球上方跳出毛玻璃泡泡，點別的地方或按 Esc 收起。
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

  // 八種心情的臉：眼睛＋嘴巴，線條畫在 -10..10 的座標裡
  const EYES = {
    dot: '<circle cx="-5" cy="-3" r="1.8"/><circle cx="5" cy="-3" r="1.8"/>',
    happy: '<path d="M-8 -2 Q-5 -6 -2 -2 M2 -2 Q5 -6 8 -2" fill="none"/>',
    closed: '<path d="M-8 -3 Q-5 -1 -2 -3 M2 -3 Q5 -1 8 -3" fill="none"/>',
    tired: '<path d="M-8 -2 L-2 -2 M2 -2 L8 -2" fill="none"/>',
    sad: '<circle cx="-5" cy="-2" r="1.8"/><circle cx="5" cy="-2" r="1.8"/><path d="M-9 -7 L-3 -5 M9 -7 L3 -5" fill="none"/>',
    angry: '<path d="M-9 -7 L-2 -4 M9 -7 L2 -4" fill="none"/><circle cx="-5" cy="-1" r="1.8"/><circle cx="5" cy="-1" r="1.8"/>',
    heart: '<path d="M-5 -1 l-3 -3 a1.8 1.8 0 0 1 3 -2 a1.8 1.8 0 0 1 3 2 z M5 -1 l-3 -3 a1.8 1.8 0 0 1 3 -2 a1.8 1.8 0 0 1 3 2 z"/>',
  };
  const FACES = {
    "超開心": ["happy", "M-6 4 Q0 11 6 4 Z"], "開心": ["dot", "M-6 4 Q0 9 6 4"], "平靜": ["closed", "M-5 5 L5 5"],
    "累": ["tired", "M-4 6 Q0 4 4 6"], "有點煩": ["dot", "M-5 6 L-2 4 L1 6 L4 4"], "難過": ["sad", "M-6 7 Q0 1 6 7"],
    "生氣": ["angry", "M-5 7 Q0 3 5 7"], "想你": ["heart", "M-4 5 Q0 8 4 5"],
  };
  function moodFace(mood) {
    const f = FACES[mood]; if (!f) return "";
    const filled = f[1].endsWith("Z");
    return `<svg class="face" viewBox="-10 -10 20 20" aria-hidden="true" fill="#2A1A14" stroke="#2A1A14" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${EYES[f[0]]}<path d="${f[1]}" fill="${filled ? "#2A1A14" : "none"}"/></svg>`;
  }

  // 毛玻璃泡泡：放在 anchor 最近的定位祖先（position 不是 static）裡，預設在球的上方，
  // 上面放不下就改到下方。同時只會有一個。
  let pop = null, popAnchor = null;
  function closeGlassPop() {
    if (pop) { pop.remove(); pop = null; }
    if (popAnchor) { popAnchor.setAttribute("aria-expanded", "false"); popAnchor = null; }
  }
  function glassPop(anchor, html, color) {
    if (popAnchor === anchor) { closeGlassPop(); return null; }
    closeGlassPop();
    const host = anchor.offsetParent || document.body;
    pop = document.createElement("div");
    pop.className = "glass-pop"; pop.setAttribute("role", "dialog");
    if (color) pop.style.setProperty("--c", color);
    pop.innerHTML = html;
    host.appendChild(pop);
    popAnchor = anchor; anchor.setAttribute("aria-expanded", "true");
    const h = host.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    const ax = a.left - h.left + a.width / 2, pw = pop.offsetWidth, ph = pop.offsetHeight;
    const left = Math.max(-6, Math.min(h.width - pw + 6, ax - pw / 2));
    let top = a.top - h.top - ph - 11;
    if (a.top - ph - 11 < 8) { top = a.bottom - h.top + 11; pop.classList.add("below"); }
    pop.style.left = left + "px"; pop.style.top = top + "px";
    pop.style.setProperty("--tail", Math.max(16, Math.min(pw - 16, ax - left)) + "px");
    return pop;
  }
  document.addEventListener("click", e => {
    if (pop && !pop.contains(e.target) && !(popAnchor && popAnchor.contains(e.target))) closeGlassPop();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && pop) { const a = popAnchor; closeGlassPop(); a?.focus(); } });

  window.FiveJS = Object.assign(window.FiveJS || {}, { MODS, MOOD_COLOR, moodFace, glassPop, closeGlassPop });
})();
