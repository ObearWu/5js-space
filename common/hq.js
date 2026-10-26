/*
 * 「記憶球總部」的共用小工具，每一頁都載入：
 * - MODS：各功能的名稱、路徑與情緒色（新增功能時加在這裡，首頁和導覽列都會跟著出現）。
 * - 手機底部導覽列：依 <html data-mod> 標出目前在哪一頁，載入時自動加到頁面最下面。
 * - MOOD_COLOR：互動頁心情打卡的八種心情對應的情緒色（首頁記憶架也用）。
 */
(() => {
  const MODS = [
    { key: "hq", name: "總部", path: "", color: "var(--gold)" },
    { key: "food", name: "飲食", path: "food/", color: "var(--joy)" },
    { key: "split", name: "分帳", path: "split/", color: "var(--disgust)" },
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

  window.FiveJS = Object.assign(window.FiveJS || {}, { MODS, MOOD_COLOR });
})();
