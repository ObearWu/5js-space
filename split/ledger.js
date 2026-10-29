/*
 * 記帳分頁（/split 的「記帳」）：只有自己看得到的個人帳本，照「財務金三角」分三個角。
 * 資料都在後端 /api/ledger（只回傳本人的資料）；分帳裡自己負擔的份由後端直接算進來。
 *
 * 畫面分成幾塊，各自一個 render 函式，資料變了就整批重畫：
 * 必要支出還能花 → 金三角與狀態卡 → 待確認（固定項目、發薪日分配）→ 記一筆
 * → 三個角的內容（必要分類、未來四個帳戶與我的目標、保障金、年度平攤）
 * → 本月明細 → 記帳打卡與這週回顧 → 近 6 個月趨勢、年底總結、匯出。
 * 表單（目標、固定項目、設定…）都開在同一個底部面板 #lgSheet。
 */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const taipeiToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
const shiftMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const dayText = s => { const [y, m, d] = s.split("-").map(Number); return `${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`; };
const pctText = v => v == null ? "—" : Math.round(v) + "%";

const FUTURE = ["reserve", "short", "mid", "long"];
const NAMES = { need: "必要支出", reserve: "預備金", short: "短期 2 年", mid: "中期 6 年", long: "長期 10 年以上", protect: "保障金" };
const NEED_CATS = ["食", "衣", "住", "行", "育", "債"];
const INCOME_CATS = ["薪水", "獎金", "其他收入"];
const KIND_TABS = [["need", "必要支出"], ["income", "收入"], ["save", "存進未來"], ["protect", "保費"], ["reserve", "從預備金花"], ["cardpay", "繳卡費"]];
const PAYS = [["cash", "現金"], ["card", "信用卡"], ["transfer", "轉帳"]];
const PAY_NAME = Object.fromEntries(PAYS);
const lastPay = () => { try { return localStorage.getItem("lg.pay") || ""; } catch (e) { return ""; } };
// 時薪：直接填的，或月薪 ÷ 每月工時。0 代表還沒設定
function wageRate() {
  const w = L.data?.settings?.wage || {};
  return w.mode === "monthly" ? (w.monthly && w.hours ? w.monthly / w.hours : 0) : +w.hourly || 0;
}
const hoursText = amount => { const r = wageRate(); if (!r || !(amount > 0)) return ""; const h = amount / r; return h < 1 ? `約 ${Math.max(1, Math.round(h * 60))} 分鐘的工作` : `約 ${Math.round(h * 10) / 10} 小時的工作`; };
const C = { need: "var(--sad)", future: "var(--envy)", protect: "var(--anx)", gold: "var(--gold)" };

const L = { data: null, month: taipeiToday().slice(0, 7), form: null, editing: null, sheet: null, busy: false, loaded: false };

// act = {label, fn}：訊息旁邊多一顆按鈕（例如刪除後的「復原」），多留幾秒讓人按得到
function toast(msg, act) {
  const t = $("toast"); t.textContent = msg;
  if (act) { const b = document.createElement("button"); b.type = "button"; b.className = "toastact"; b.textContent = act.label; b.onclick = () => { t.hidden = true; act.fn(); }; t.append(" ", b); }
  t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, act ? 7000 : 3500);
}
async function call(path, opts) {
  try { return await FiveJS.api(path, opts); }
  catch (e) { if (e instanceof FiveJS.AuthError) location.href = "../?next=split"; throw e; }
}
async function load() {
  const month = L.month;
  // 先用上次的資料畫出來（後端還在醒來也看得到），拿到最新的再重畫
  if (!L.data || L.data.month !== month) { const c = FiveJS.peek(`/api/ledger/state?month=${month}`); if (c) { L.data = c; render(); } }
  const d = await call(`/api/ledger/state?month=${month}`);
  if (month !== L.month) return;
  L.data = d; L.loaded = true;
  markGoals();
  render();
}
const reload = () => load().catch(e => toast(e.message));

// ---------- 記一筆的表單狀態 ----------
function blankForm(kind = "need") {
  return { kind, amount: "", category: kind === "income" ? "薪水" : "食", want: null, bucket: "short", goal: "", title: "",
           date: L.month === taipeiToday().slice(0, 7) ? taipeiToday() : L.month + "-01", note: "", fav: false, sinking: "", pay: lastPay() };
}
function entryToForm(e) {
  const kind = e.kind === "income" ? "income" : e.kind === "save" ? "save" : e.kind === "cardpay" ? "cardpay" : e.bucket === "need" ? "need" : e.bucket === "protect" ? "protect" : "reserve";
  const isSink = (L.data.sinking || []).some(s => s.id === e.item_id);
  return { kind, amount: String(e.amount), category: e.category || (kind === "income" ? "薪水" : "食"), want: e.want, bucket: e.bucket || "short",
           goal: e.kind === "save" && e.item_id && !isSink ? String(e.item_id) : "", title: e.title, date: e.date, note: e.note, fav: false,
           sinking: isSink ? String(e.item_id) : "", spendBucket: kind === "reserve" ? e.bucket : "reserve", pay: e.pay || "" };
}
function formToBody(f) {
  const amount = Math.round(+f.amount);
  const base = { date: f.date, amount, title: f.title.trim(), note: f.note.trim() };
  if (f.kind === "income") return { ...base, kind: "income", category: f.category };
  if (f.kind === "cardpay") return { ...base, kind: "cardpay", title: base.title || "繳信用卡費" };
  base.pay = f.pay || "";
  if (f.kind === "save") return { ...base, kind: "save", bucket: f.bucket, item_id: f.goal ? +f.goal : null };
  if (f.kind === "protect") return { ...base, kind: "expense", bucket: "protect", title: base.title || "保費" };
  if (f.kind === "reserve") return { ...base, kind: "expense", bucket: f.spendBucket || "reserve", item_id: f.goal ? +f.goal : null };
  return { ...base, kind: "expense", bucket: "need", category: f.category, want: f.want, item_id: f.sinking ? +f.sinking : null };
}

// ---------- 畫面 ----------
function render() {
  if (!L.data) return;
  const d = L.data;
  const [y, m] = L.month.split("-").map(Number);
  $("lgMonth").textContent = `${y} 年 ${m} 月`;
  if (!d.settings.setupDone && !L.sheet) { openSheet("setup"); }
  renderTop(); renderTriangle(); renderPending(); renderForm(); renderCorners(); renderList(); renderHabit(); renderTrend();
}

function renderTop() {
  const d = L.data, n = d.need;
  const left = n.left, budget = n.budget + n.cover - n.sinkingMonthly;
  const ratio = budget > 0 ? Math.max(0, Math.min(1, (budget - left) / budget)) : 0;
  let html = `<div class="lg-left"><span class="small muted">必要支出還能花${d.baseCarried ? "（這個月還沒記收入，用上個月收入估）" : ""}</span>
    <b class="num ${left < 0 ? "neg" : ""}">${d.base ? money(left) : "—"}</b>
    <span class="small muted">${d.base ? `預算 ${money(n.budget)}${n.cover ? `＋挪用 ${money(n.cover)}` : ""}${n.sinkingMonthly ? `−年度預留 ${money(n.sinkingMonthly)}` : ""}，已花 ${money(n.spent)}` : "先記一筆這個月的收入，就能算出三個角的目標。"}</span>
    <div class="bar"><i style="width:${Math.round(ratio * 100)}%;--c:${n.warn ? "var(--anger)" : C.need}"></i></div></div>`;
  if (n.warn) {
    const over = n.spent - n.warnAt;
    html += `<div class="lg-warn"><b>必要支出已經超過收入的 ${d.settings.needWarn}%</b><span>超出 ${money(over)}。可以從預備金（目前 ${money(d.balances.reserve)}）挪一筆補上，這個月的帳會記下挪了多少。</span>
      <button class="btn sm" type="button" data-act="cover" data-v="${Math.max(over, 0)}">從預備金挪 ${money(Math.max(over, 0))}</button></div>`;
  }
  $("lgTop").innerHTML = html;
}

function renderTriangle() {
  const d = L.data, r = d.settings.ratios;
  const futT = FUTURE.reduce((a, b) => a + r[b], 0);
  const pill = (x, y, w, fill, ink, text) => `<rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="${fill}"/><text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" fill="${ink}" font-size="11">${text}</text>`;
  const svg = `<svg class="tri" viewBox="0 0 300 220" role="img" aria-label="財務金三角：必要支出 ${pctText(d.need.pct)}、未來規劃 ${pctText(d.future.pct)}、風險保障 ${pctText(d.protect.pct)}">
    <polygon points="150,30 270,190 30,190" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
    <text x="150" y="128" text-anchor="middle" fill="#B9AEDA" font-size="11">${d.baseCarried ? "上個月收入" : "本月收入"}</text>
    <text x="150" y="154" text-anchor="middle" fill="#F3EEFF" font-size="26" font-family="Fredoka">${d.base ? d.base.toLocaleString("en-US") : "—"}</text>
    ${pill(85, 4, 130, "#4E7FE0", "#fff", `必要 ${pctText(d.need.pct)} · 目標 ${r.need}–${d.settings.needWarn}%`)}
    ${pill(0, 196, 132, "#2BB7B0", "#0B2321", `未來 ${pctText(d.future.pct)} · 目標 ${futT}%`)}
    ${pill(168, 196, 132, "#F28B2F", "#2A1503", `保障 ${pctText(d.protect.pct)} · 目標 ${r.protect}%`)}
  </svg>`;
  // 目前三角的狀態：三個角各一句
  const lines = [];
  const np = d.need.pct;
  if (np == null) lines.push(["生活", "還沒有收入可以比較。", "#9CC3E8"]);
  else if (np < r.need) lines.push(["生活：控制得好", `必要支出 ${money(d.need.spent)}，低於 ${r.need}%。`, "#9CC3E8"]);
  else if (np <= d.settings.needWarn) lines.push(["生活：在範圍內", `必要支出 ${money(d.need.spent)}，落在 ${r.need}–${d.settings.needWarn}%。`, "#9CC3E8"]);
  else lines.push(["生活：超出了", `必要支出 ${money(d.need.spent)}，超過 ${d.settings.needWarn}%。`, "#FF9E8A"]);
  const fp = d.future.pct, rm = d.reserveMonths;
  const reserveTxt = rm == null ? `預備金 ${money(d.balances.reserve)}。` : rm < 3 ? `預備金 ${money(d.balances.reserve)} 約撐 ${rm} 個月，建議 3–6 個月（約 ${money(d.avgNeed * 3)}–${money(d.avgNeed * 6)}）。` : `預備金約撐 ${rm} 個月，夠用。`;
  lines.push([fp == null ? "未來" : fp >= futT ? (rm != null && rm < 3 ? "未來：存得夠、預備金偏薄" : "未來：達標") : `未來：還差 ${money(d.future.target.reserve * 4 - d.future.total)}`, reserveTxt, "#8FD3C1"]);
  lines.push([`保障：今年已繳 ${money(d.protect.paidYear)} / ${money(d.protect.yearBudget)}`, `保障金累積 ${money(d.balances.protect)}，這個月存了 ${money(d.protect.saved)}。`, "#F2B27A"]);
  $("lgTri").innerHTML = `<div class="head"><h2>財務金三角</h2><button class="link" type="button" data-act="settings">比例與設定</button></div>${svg}
    <div class="lg-status">${lines.map(([t, s, c]) => `<div><b style="color:${c}">${esc(t)}</b><span>${esc(s)}</span></div>`).join("")}</div>`;
}

function renderPending() {
  const d = L.data, out = [];
  // 發薪日分配：這個月有收入，而且未來＋保障還沒存到目標
  const futTarget = FUTURE.reduce((a, b) => a + d.future.target[b], 0) + d.protect.target;
  const futSaved = d.future.total + d.protect.saved;
  if (d.income && !d.baseCarried && futSaved < futTarget) {
    out.push(`<div class="lg-pay"><div><b>發薪日先分配</b><span>先付錢給自己：把未來 ${money(futTarget - futSaved)} 和保障存起來，剩下的才是這個月能花的。</span></div>
      <button class="btn primary sm" type="button" data-act="allocate">分配</button></div>`);
  }
  for (const r of d.pending) {
    const where = r.kind === "income" ? "收入" : r.kind === "save" ? `存進${NAMES[r.bucket]}` : r.bucket === "need" ? `必要・${r.category}` : NAMES[r.bucket];
    out.push(`<div class="lg-rec"><div><b>${esc(r.name)}</b><span>${esc(where)}・每月 ${r.day} 號</span></div><b class="num">${money(r.amount)}</b>
      <button class="btn sm primary" type="button" data-act="recOk" data-v="${r.id}">確認</button><button class="btn sm ghost" type="button" data-act="recSkip" data-v="${r.id}">這個月略過</button></div>`);
  }
  $("lgPending").hidden = !out.length;
  $("lgPending").innerHTML = out.length ? `<h2>待處理</h2>${out.join("")}` : "";
}

function goalsFor(bucket) { return L.data.goals.filter(g => !bucket || g.bucket === bucket); }
function renderForm() {
  const f = L.form || (L.form = blankForm());
  const d = L.data;
  const seg = (items, cur, act) => items.map(([v, t]) => `<button type="button" data-act="${act}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(t)}</button>`).join("");
  let fields = "";
  if (f.kind === "need") {
    fields += `<div class="field"><span>分類</span><div class="seg">${seg(NEED_CATS.map(c => [c, c]), f.category, "fCat")}</div></div>
      <div class="field"><span>需要還是想要</span><div class="seg">${seg([["need", "需要"], ["want", "想要"], ["", "不分"]], f.want === true ? "want" : f.want === false ? "need" : "", "fWant")}</div></div>`;
    if (f.want === true && hoursText(+f.amount)) fields += `<p class="lg-hours">這筆等於 <b>${hoursText(+f.amount)}</b>，值得嗎？</p>`;
    else if (f.want === true && !wageRate()) fields += `<p class="small muted">在「比例與設定」填時薪，想要的花費會換算成工作幾小時。</p>`;
    if (d.sinking.length) fields += `<div class="field"><span>從年度平攤付（選填）</span><select data-f="sinking"><option value="">不是，算這個月的預算</option>${d.sinking.map(s => `<option value="${s.id}"${String(s.id) === f.sinking ? " selected" : ""}>${esc(s.name)}（預留 ${money(s.pool)}）</option>`).join("")}</select></div>`;
  } else if (f.kind === "income") {
    fields += `<div class="field"><span>分類</span><div class="seg">${seg(INCOME_CATS.map(c => [c, c]), f.category, "fCat")}</div></div>`;
  } else if (f.kind === "save") {
    fields += `<div class="field"><span>存進哪個帳戶</span><div class="seg">${seg([...FUTURE, "protect"].map(b => [b, NAMES[b]]), f.bucket, "fBucket")}</div></div>`;
    const gs = goalsFor(f.bucket).filter(g => !g.done);
    if (gs.length) fields += `<div class="field"><span>存給哪個目標（選填）</span><select data-f="goal"><option value="">不指定</option>${gs.map(g => `<option value="${g.id}"${String(g.id) === f.goal ? " selected" : ""}>${esc(g.name)}（${money(g.saved)} / ${money(g.target)}）</option>`).join("")}</select></div>`;
  } else if (f.kind === "reserve") {
    fields += `<div class="field"><span>從哪個帳戶花</span><div class="seg">${seg(FUTURE.map(b => [b, NAMES[b]]), f.spendBucket || "reserve", "fSpend")}</div><small class="muted">紅白帖、大餐這類臨時支出從預備金花；買房頭期、旅費從存好的帳戶花。不吃必要支出的預算。</small></div>`;
    const gs = goalsFor(f.spendBucket || "reserve");
    if (gs.length) fields += `<div class="field"><span>用在哪個目標（選填）</span><select data-f="goal"><option value="">不指定</option>${gs.map(g => `<option value="${g.id}"${String(g.id) === f.goal ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>`;
  }
  if (f.kind === "cardpay") {
    const c = d.card || {};
    fields += `<p class="small muted">刷卡那天已經算進花費了，繳卡費只是把錢付給銀行，不會再算一次。${c.used ? `目前信用卡還沒繳 <b>${money(c.unpaid)}</b>。` : ""}</p>`;
  }
  if (["need", "protect", "reserve"].includes(f.kind)) fields += `<div class="field"><span>付款方式</span><div class="seg">${seg([...PAYS, ["", "不記"]], f.pay || "", "fPay")}</div></div>`;
  const favs = d.settings.favorites || [];
  $("lgForm").innerHTML = `<div class="head"><h2>${L.editing ? "修改這筆" : "記一筆"}</h2>${L.editing ? "" : `<label class="btn sm ghost lg-snap">拍收據<input type="file" accept="image/*" id="lgSnap" hidden></label>`}</div>
    ${!L.editing && favs.length ? `<div class="lg-favs"><span class="small muted">常用</span>${favs.map((x, i) => `<button type="button" data-act="fav" data-v="${i}">${esc(x.title)} ${money(x.amount)}</button>`).join("")}</div>` : ""}
    <div class="seg kinds">${seg(KIND_TABS, f.kind, "fKind")}</div>
    <div class="field money"><input data-f="amount" type="number" inputmode="numeric" min="1" step="1" placeholder="0" aria-label="金額（元）" value="${esc(f.amount)}"></div>
    ${fields}
    <div class="row2"><div class="field"><span>${f.kind === "income" || f.kind === "cardpay" ? "說明（選填）" : "品項"}</span><input data-f="title" maxlength="60" value="${esc(f.title)}" placeholder="${f.kind === "need" ? "例如：午餐便當" : f.kind === "protect" ? "例如：醫療險" : f.kind === "reserve" ? "例如：喜宴紅包" : f.kind === "cardpay" ? "例如：國泰卡 10 月帳單" : ""}"></div>
      <div class="field"><span>日期</span><input data-f="date" type="date" value="${esc(f.date)}"></div></div>
    <div class="field"><span>備註（選填）</span><input data-f="note" maxlength="300" value="${esc(f.note)}"></div>
    ${f.kind === "need" && !L.editing ? `<label class="chk"><input type="checkbox" data-f="fav"${f.fav ? " checked" : ""}> 存成常用項目（下次一鍵記）</label>` : ""}
    <div class="actions"><div>${L.editing ? `<button class="btn danger" type="button" data-act="del">刪除</button>` : `<button class="btn ghost sm" type="button" data-act="nospend">今天沒花錢</button>`}</div>
      <div>${L.editing ? `<button class="btn ghost" type="button" data-act="cancel">取消</button> ` : ""}<button class="btn primary" type="button" data-act="save"${L.busy ? " disabled" : ""}>${L.editing ? "儲存" : "記下來"}</button></div></div>`;
}

function renderCorners() {
  const d = L.data, n = d.need;
  const max = Math.max(1, ...NEED_CATS.map(c => n.cats[c] || 0));
  const need = `<div class="lg-corner" style="--c:${C.need}"><div class="ch"><h3><i class="orb"></i>必要支出</h3><span class="num">${money(n.spent)} · ${pctText(n.pct)}</span></div>
    ${NEED_CATS.map(c => `<div class="cat"><span>${c}</span><span class="bar"><i style="width:${Math.round((n.cats[c] || 0) * 100 / max)}%;background:${C.need}"></i></span><span class="num">${money(n.cats[c] || 0)}</span></div>`).join("")}
    ${n.want ? `<p class="small muted">其中「想要」${money(n.want)}</p>` : ""}</div>`;
  const acct = b => {
    const saved = d.future.saved[b], target = d.future.target[b];
    return `<div class="acct"><div class="ah"><b>${NAMES[b]}</b><span class="num">${money(saved)} / ${money(target)}</span></div>
      <div class="bar"><i style="width:${target ? Math.min(100, Math.round(saved * 100 / target)) : 0}%;background:${C.future}"></i></div>
      <div class="ah small muted"><span>目前累積 ${money(d.balances[b])}${d.future.spent[b] ? `・這個月花 ${money(d.future.spent[b])}` : ""}</span><button class="link" type="button" data-act="adjust" data-v="${b}">更新累積</button></div></div>`;
  };
  const goals = d.goals.filter(g => !g.done);
  const done = d.goals.filter(g => g.done);
  const goalHtml = `<div class="goals"><div class="ah"><b>我的目標</b><button class="link" type="button" data-act="goal">＋ 新增目標</button></div>
    ${goals.length ? goals.map(g => `<button class="goal" type="button" data-act="goal" data-v="${g.id}"><span class="gh"><b>${esc(g.name)}</b><span class="small muted">${NAMES[g.bucket]}${g.deadline ? `・${g.deadline.replaceAll("-", "/")} 前` : ""}</span></span>
      <span class="num">${money(g.saved)} / ${money(g.target)}</span><span class="bar"><i style="width:${Math.min(100, Math.round(g.saved * 100 / g.target))}%;background:${C.gold}"></i></span></button>`).join("")
      : `<p class="small muted">例如中國旅費、結婚基金、房子頭期款。每個目標選它屬於哪個帳戶，存錢時指定存給它。</p>`}
    ${done.length ? `<div class="done"><span class="small muted">已達成</span>${done.map(g => `<button type="button" class="dg" data-act="goal" data-v="${g.id}" title="${esc(g.name)}"><i class="orb gold"></i>${esc(g.name)}</button>`).join("")}</div>` : ""}</div>`;
  const future = `<div class="lg-corner" style="--c:${C.future}"><div class="ch"><h3><i class="orb"></i>未來規劃</h3><span class="num">${money(d.future.total)} · ${pctText(d.future.pct)}</span></div>${FUTURE.map(acct).join("")}${goalHtml}</div>`;
  const p = d.protect;
  const protect = `<div class="lg-corner" style="--c:${C.protect}"><div class="ch"><h3><i class="orb"></i>風險保障</h3><span class="num">${money(p.saved)} · ${pctText(p.pct)}</span></div>
    <div class="acct"><div class="ah"><b>保障金</b><span class="num">${money(p.saved)} / ${money(p.target)}</span></div><div class="bar"><i style="width:${p.target ? Math.min(100, Math.round(p.saved * 100 / p.target)) : 0}%;background:${C.protect}"></i></div>
    <div class="ah small muted"><span>目前累積 ${money(d.balances.protect)}・今年已繳保費 ${money(p.paidYear)} / ${money(p.yearBudget)}</span><button class="link" type="button" data-act="adjust" data-v="protect">更新累積</button></div></div></div>`;
  const sink = `<div class="lg-corner" style="--c:${C.gold}"><div class="ch"><h3><i class="orb"></i>年度大額支出平攤</h3><button class="link" type="button" data-act="sinking">＋ 新增</button></div>
    ${d.sinking.length ? d.sinking.map(s => `<button class="goal" type="button" data-act="sinking" data-v="${s.id}"><span class="gh"><b>${esc(s.name)}</b><span class="small muted">全年 ${money(s.yearly)}・每月預留 ${money(s.monthly)}${s.dueMonth ? `・${s.dueMonth} 月要付` : ""}</span></span><span class="num">預留 ${money(s.pool)}</span></button>`).join("")
      : `<p class="small muted">過年紅包、牌照稅、年費這類一年一次的錢，設好全年金額，每月先預留 1/12。付的時候選「從年度平攤付」，不會吃掉那個月的預算。</p>`}</div>`;
  const c = d.card || {};
  const card = c.used ? `<div class="lg-corner" style="--c:var(--fear)"><div class="ch"><h3><i class="orb"></i>信用卡對帳</h3><button class="link" type="button" data-act="payCard">繳卡費</button></div>
    <div class="acct"><div class="ah"><b>還沒繳</b><span class="num">${money(c.unpaid)}</span></div>
    <div class="ah small muted"><span>這個月刷了 ${money(c.monthCharged)}・繳了 ${money(c.monthPaid)}</span></div></div>
    <p class="small muted">刷卡那天就算花費；繳卡費不會再算一次。月底跟銀行帳單對一下「還沒繳」的金額。</p></div>` : "";
  $("lgCorners").innerHTML = need + future + protect + sink + card;
}

function entryLine(e) {
  const tag = e.kind === "income" ? ["收入", "var(--disgust)"] : e.kind === "save" ? [NAMES[e.bucket], e.bucket === "protect" ? C.protect : C.future]
    : e.kind === "cover" ? ["挪用", C.future] : e.kind === "adjust" ? ["校正", "var(--muted)"] : e.kind === "nospend" ? ["沒花錢", C.gold] : e.kind === "cardpay" ? ["卡費", "var(--fear)"]
    : e.bucket === "need" ? [e.category, C.need] : [NAMES[e.bucket], e.bucket === "protect" ? C.protect : C.future];
  const sign = e.kind === "income" ? "+" : e.kind === "expense" ? "-" : "";
  const sub = [e.split ? e.note : "", e.want === true ? "想要" + (hoursText(e.amount) ? `（${hoursText(e.amount)}）` : "") : "", e.sinking ? "年度平攤" : "",
    PAY_NAME[e.pay] || "", !e.split && e.note ? e.note : ""].filter(Boolean).join("・");
  return `<button class="item${e.split ? " split" : ""}" type="button" data-act="${e.split ? "openSplit" : "edit"}" data-v="${e.id}">
    <span class="tag" style="--t:${tag[1]}">${esc(tag[0])}</span><span class="main"><b>${esc(e.kind === "nospend" ? "今天沒花錢" : e.title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span>
    <span class="amt">${e.kind === "nospend" ? "" : sign + money(e.amount).replace("-", "")}</span></button>`;
}
function renderList() {
  const es = L.data.entries;
  if (!es.length) { $("lgList").innerHTML = `<p class="empty">這個月還沒有紀錄。</p>`; return; }
  let html = "", day = "";
  for (const e of es) {
    if (e.date !== day) { day = e.date; html += `<p class="day">${dayText(day)}</p>`; }
    html += entryLine(e);
  }
  $("lgList").innerHTML = html + `<p class="small muted" style="margin-top:10px">標「分帳」的是你在分帳裡負擔的那份，自動帶進來；要改請到分帳分頁。</p>`;
}

function renderHabit() {
  const d = L.data, [y, m] = L.month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate(), today = taipeiToday(), set = new Set(d.days);
  let orbs = "";
  for (let i = 1; i <= days; i++) {
    const ds = `${L.month}-${String(i).padStart(2, "0")}`;
    const cls = set.has(ds) ? "" : ds > today ? " future" : " empty";
    orbs += `<span class="dorb${ds === today ? " today" : ""}"><i class="orb${cls}" style="--c:var(--disgust)"></i><small>${i}</small></span>`;
  }
  const streak = (() => { let n = 0, t = new Date(today + "T00:00:00"); const all = new Set(d.days); if (!all.has(today)) t.setDate(t.getDate() - 1);
    for (;;) { const s = new Intl.DateTimeFormat("sv-SE").format(t); if (!all.has(s)) break; n++; t.setDate(t.getDate() - 1); } return n; })();
  const w = d.week, sunday = new Date(today + "T00:00:00").getDay() === 0;
  const week = `<div class="lg-week${sunday ? " hot" : ""}"><h3>這週 5 分鐘回顧 <span class="small muted">${w.from.slice(5).replace("-", "/")} 起 7 天</span></h3>
    <div class="stats"><div class="stat"><b>${money(w.need)}</b><span>必要支出</span></div><div class="stat"><b>${money(w.want)}</b><span>其中想要</span></div><div class="stat"><b>${money(w.saved)}</b><span>存進未來</span></div></div>
    <p class="small">${w.topCat ? `花最多的是「${esc(w.topCat)}」。` : ""}${w.repeat.length ? `常出現的小花費：${w.repeat.map(r => `${esc(r[0])} ${r[1]} 次 ${money(r[2])}`).join("、")}。` : ""}這週有 ${w.days} 天有紀錄。</p></div>`;
  $("lgHabit").innerHTML = `<div class="head"><h2>記帳打卡</h2><span class="small muted">${streak ? `連續 ${streak} 天` : "今天開始累積"}</span></div><div class="dorbs">${orbs}</div>${week}`;
}

function renderTrend() {
  const t = L.data.trend;
  const W = 300, H = 120, P = 18, xs = i => P + i * (W - 2 * P) / Math.max(1, t.length - 1);
  const maxPct = Math.max(70, ...t.flatMap(x => [x.needPct || 0, x.futurePct || 0, x.protectPct || 0]));
  const ys = v => H - P - (v / maxPct) * (H - 2 * P);
  const line = (k, c) => { const pts = t.map((x, i) => x[k] == null ? null : `${xs(i).toFixed(1)},${ys(x[k]).toFixed(1)}`).filter(Boolean);
    return pts.length ? `<polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>` + pts.map(p => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="2.6" fill="${c}"/>`).join("") : ""; };
  const labels = t.map((x, i) => `<text x="${xs(i)}" y="${H - 2}" text-anchor="middle" fill="#B9AEDA" font-size="9">${+x.month.slice(5)}月</text>`).join("");
  const svg = `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 6 個月三個角佔收入的比例">
    <line x1="${P}" x2="${W - P}" y1="${ys(50)}" y2="${ys(50)}" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 4"/><text x="${W - P}" y="${ys(50) - 3}" text-anchor="end" fill="#B9AEDA" font-size="8">50%</text>
    ${line("needPct", "#4E7FE0")}${line("futurePct", "#2BB7B0")}${line("protectPct", "#F28B2F")}${labels}</svg>`;
  const yr = L.month.slice(0, 4), dec = L.month.slice(5) === "12" || L.month.slice(5) === "01";
  $("lgTrend").innerHTML = `<div class="head"><h2>近 6 個月</h2></div>${svg}
    <div class="legend"><span style="--c:#4E7FE0">必要</span><span style="--c:#2BB7B0">未來</span><span style="--c:#F28B2F">保障</span></div>
    <div class="actions" style="margin-top:12px"><button class="btn${dec ? " primary" : ""} sm" type="button" data-act="year" data-v="${L.month.slice(5) === "01" ? +yr - 1 : yr}">${L.month.slice(5) === "01" ? +yr - 1 : yr} 年底總結</button>
      <button class="btn ghost sm" type="button" data-act="export" data-v="${yr}">匯出 ${yr} 年 CSV</button></div>`;
}

// ---------- 底部面板 ----------
function openSheet(type, arg) { L.sheet = { type, arg }; renderSheet(); }
function closeSheet() { L.sheet = null; $("lgSheet").hidden = true; $("lgSheet").innerHTML = ""; }
const bucketOpts = (cur, list = [...FUTURE, "protect"]) => list.map(b => `<option value="${b}"${b === cur ? " selected" : ""}>${NAMES[b]}</option>`).join("");
function renderSheet() {
  const s = L.sheet, d = L.data; if (!s) return;
  let inner = "";
  if (s.type === "goal") {
    const g = d.goals.find(x => x.id === +s.arg) || { name: "", bucket: "long", target: "", startAmount: 0, deadline: "" };
    inner = `<h2>${g.id ? "編輯目標" : "新增目標"}</h2>
      <label>目標名稱<input id="sgName" maxlength="40" value="${esc(g.name)}" placeholder="例如：中國旅費、結婚基金、房子頭期款"></label>
      <label>屬於哪個帳戶<select id="sgBucket">${bucketOpts(g.bucket, FUTURE)}</select></label>
      <div class="row2"><label>目標金額<input id="sgTarget" type="number" inputmode="numeric" min="1" value="${esc(g.target)}"></label>
      <label>已經存了多少<input id="sgStart" type="number" inputmode="numeric" min="0" value="${esc(g.startAmount || 0)}"></label></div>
      <label>想在哪天前達成（選填）<input id="sgDeadline" type="date" value="${esc(g.deadline || "")}"></label>
      ${g.id ? `<p class="small muted">目前 ${money(g.saved)} / ${money(g.target)}${g.done ? "，已達成！" : ""}</p>` : ""}
      <div class="actions"><div>${g.id ? `<button class="btn danger sm" type="button" data-sh="delItem" data-v="${g.id}">刪除</button>` : ""}</div><div><button class="btn ghost" type="button" data-sh="close">取消</button> <button class="btn primary" type="button" data-sh="saveGoal" data-v="${g.id || ""}">儲存</button></div></div>`;
  } else if (s.type === "sinking") {
    const it = d.sinking.find(x => x.id === +s.arg) || { name: "", yearly: "", dueMonth: "" };
    inner = `<h2>${it.id ? "編輯年度平攤" : "新增年度大額支出"}</h2>
      <label>名稱<input id="ssName" maxlength="40" value="${esc(it.name)}" placeholder="例如：過年紅包、牌照稅、年費"></label>
      <div class="row2"><label>全年金額<input id="ssYearly" type="number" inputmode="numeric" min="1" value="${esc(it.yearly)}"></label>
      <label>幾月要付（選填）<select id="ssDue"><option value="">不固定</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${it.dueMonth === i + 1 ? " selected" : ""}>${i + 1} 月</option>`).join("")}</select></label></div>
      <p class="small muted">每月會從必要支出的預算先預留全年的 1/12。保費不用設在這裡：保障 10% 本來就是每月存進保障金。</p>
      <div class="actions"><div>${it.id ? `<button class="btn danger sm" type="button" data-sh="delItem" data-v="${it.id}">刪除</button>` : ""}</div><div><button class="btn ghost" type="button" data-sh="close">取消</button> <button class="btn primary" type="button" data-sh="saveSinking" data-v="${it.id || ""}">儲存</button></div></div>`;
  } else if (s.type === "recurring") {
    const r = d.recurring.find(x => x.id === +s.arg) || { name: "", kind: "expense", bucket: "need", category: "住", amount: "", day: 1, active: true };
    const where = r.kind === "income" ? "income" : r.kind === "save" ? "save:" + r.bucket : r.bucket === "need" ? "need:" + r.category : "spend:" + r.bucket;
    const opts = [["need:" + "食", "必要・食"], ...NEED_CATS.slice(1).map(c => ["need:" + c, "必要・" + c]), ...[...FUTURE, "protect"].map(b => ["save:" + b, "存進" + NAMES[b]]), ["spend:protect", "保費（從保障金扣）"], ["income", "收入"]];
    inner = `<h2>${r.id ? "編輯固定項目" : "新增固定項目"}</h2>
      <label>名稱<input id="srName" maxlength="40" value="${esc(r.name)}" placeholder="例如：房租、電話費、ETF 定期定額、醫療險"></label>
      <label>算在哪裡<select id="srWhere">${opts.map(([v, t]) => `<option value="${v}"${v === where ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="row2"><label>金額<input id="srAmount" type="number" inputmode="numeric" min="1" value="${esc(r.amount)}"></label>
      <label>每月幾號<input id="srDay" type="number" inputmode="numeric" min="1" max="31" value="${esc(r.day)}"></label></div>
      <label class="chk"><input type="checkbox" id="srActive"${r.active !== false ? " checked" : ""}> 啟用</label>
      <p class="small muted">每月到了那天，會出現在「待處理」，按確認才記進帳。</p>
      <div class="actions"><div>${r.id ? `<button class="btn danger sm" type="button" data-sh="delItem" data-v="${r.id}">刪除</button>` : ""}</div><div><button class="btn ghost" type="button" data-sh="close">取消</button> <button class="btn primary" type="button" data-sh="saveRec" data-v="${r.id || ""}">儲存</button></div></div>`;
  } else if (s.type === "allocate") {
    const parts = [...FUTURE, "protect"].map(b => [b, Math.max(0, (b === "protect" ? d.protect.target - d.protect.saved : d.future.target[b] - d.future.saved[b]))]);
    inner = `<h2>發薪日先分配</h2><p class="small muted">這個月收入 ${money(d.income)}。照你設的比例，先把下面這些存起來（可以改金額，填 0 就是這個月不存）。</p>
      ${parts.map(([b, v]) => `<label class="alloc">${NAMES[b]}<input type="number" inputmode="numeric" min="0" data-alloc="${b}" value="${v}"></label>`).join("")}
      <label>日期<input id="saDate" type="date" value="${taipeiToday().slice(0, 7) === L.month ? taipeiToday() : L.month + "-01"}"></label>
      <div class="actions"><div></div><div><button class="btn ghost" type="button" data-sh="close">取消</button> <button class="btn primary" type="button" data-sh="saveAlloc">存起來</button></div></div>`;
  } else if (s.type === "adjust") {
    const b = s.arg;
    inner = `<h2>更新${NAMES[b]}目前的累積</h2><p class="small muted">例如 ETF 漲跌、銀行利息。填現在實際有多少，差額會記成一筆「校正」。</p>
      <label>現在有多少<input id="sjValue" type="number" inputmode="numeric" value="${d.balances[b]}"></label>
      <div class="actions"><div></div><div><button class="btn ghost" type="button" data-sh="close">取消</button> <button class="btn primary" type="button" data-sh="saveAdjust" data-v="${b}">更新</button></div></div>`;
  } else if (s.type === "setup" || s.type === "settings") {
    const st = d.settings, r = st.ratios;
    const splitCats = Object.keys(st.splitCat);
    const target = v => [...NEED_CATS.map(c => [c, "必要・" + c]), ...FUTURE.map(b => [b, NAMES[b]])].map(([k, t]) => `<option value="${k}"${k === v ? " selected" : ""}>${t}</option>`).join("");
    const trips = (window.FiveJSSplit?.islands() || []).filter(i => i.id);
    inner = `<h2>${s.type === "setup" ? "開始記帳" : "比例與設定"}</h2>
      ${s.type === "setup" ? `<p class="small muted">這個帳本只有你看得到。先填未來規劃各帳戶<b>現在已經有多少</b>，之後照存入和花費自動加減。</p>` : ""}
      <h3>各帳戶現在的累積</h3>
      <div class="row2">${[...FUTURE, "protect"].map(b => `<label>${NAMES[b]}<input type="number" inputmode="numeric" min="0" data-start="${b}" value="${st.start[b] || 0}"></label>`).join("")}</div>
      <h3>財務金三角的比例（加起來 100%）</h3>
      <div class="row2"><label>必要支出 %<input type="number" min="0" max="100" data-ratio="need" value="${r.need}"></label><label>必要支出警示 %<input type="number" min="1" max="100" id="stWarn" value="${st.needWarn}"></label>
      ${FUTURE.map(b => `<label>${NAMES[b]} %<input type="number" min="0" max="100" data-ratio="${b}" value="${r[b]}"></label>`).join("")}<label>風險保障 %<input type="number" min="0" max="100" data-ratio="protect" value="${r.protect}"></label></div>
      <h3>時薪（換算「這筆等於工作幾小時」）</h3>
      <div class="row2"><label>怎麼算<select id="stWageMode"><option value="hourly"${st.wage?.mode !== "monthly" ? " selected" : ""}>直接填時薪</option><option value="monthly"${st.wage?.mode === "monthly" ? " selected" : ""}>月薪 ÷ 每月工時</option></select></label>
      <label>時薪<input type="number" inputmode="numeric" min="0" id="stHourly" value="${st.wage?.hourly || ""}" placeholder="例如 250"></label>
      <label>月薪（實拿）<input type="number" inputmode="numeric" min="0" id="stMonthly" value="${st.wage?.monthly || ""}"></label>
      <label>每月工時<input type="number" inputmode="numeric" min="1" id="stHours" value="${st.wage?.hours || 176}"></label></div>
      <p class="small muted">只有你看得到。標成「想要」的花費會顯示等於工作幾小時，下手前多想一秒。</p>
      <h3>分帳帶進來時算在哪</h3><p class="small muted">日常島依分類；旅程島每座自己選（預設預備金）。</p>
      <div class="row2">${splitCats.map(k => `<label>日常・${esc(k)}<select data-scat="${esc(k)}">${target(st.splitCat[k])}</select></label>`).join("")}
      ${trips.map(t => `<label>島・${esc(t.name)}<select data-trip="${t.id}">${target(st.tripMap[t.id] || "reserve")}</select></label>`).join("")}</div>
      <h3>固定項目</h3>${d.recurring.length ? d.recurring.map(x => `<button class="goal" type="button" data-sh="rec" data-v="${x.id}"><span class="gh"><b>${esc(x.name)}</b><span class="small muted">每月 ${x.day} 號${x.active === false ? "・停用" : ""}</span></span><span class="num">${money(x.amount)}</span></button>`).join("") : `<p class="small muted">房租、電話費、ETF 定期定額、保費…</p>`}
      <button class="link" type="button" data-sh="rec">＋ 新增固定項目</button>
      ${(st.favorites || []).length ? `<h3>常用項目</h3>${st.favorites.map((x, i) => `<div class="favrow"><span>${esc(x.title)} ${money(x.amount)}・${x.category}</span><button class="link" type="button" data-sh="delFav" data-v="${i}">移除</button></div>`).join("")}` : ""}
      <div class="actions"><div></div><div>${s.type === "settings" ? `<button class="btn ghost" type="button" data-sh="close">取消</button> ` : ""}<button class="btn primary" type="button" data-sh="saveSettings">${s.type === "setup" ? "開始" : "儲存"}</button></div></div>`;
  } else if (s.type === "year") {
    const y = s.arg;
    if (!y.year) inner = `<p class="loading"><span class="spinner"></span>整理中…</p>`;
    else inner = `<div class="yr"><i class="orb gold" style="--s:46px"></i><h2>${y.year} 年總結</h2></div>
      <div class="stats"><div class="stat"><b>${pctText(y.needPct)}</b><span>必要支出</span></div><div class="stat"><b>${pctText(y.futurePct)}</b><span>未來規劃</span></div><div class="stat"><b>${pctText(y.protectPct)}</b><span>風險保障</span></div></div>
      <ul class="yl"><li>全年收入 <b>${money(y.income)}</b>，必要支出 ${money(y.need)}（其中想要 ${money(y.want)}）。</li>
      <li>未來規劃淨增加 <b>${money(y.futureGrowth)}</b>：${FUTURE.map(b => `${NAMES[b]} ${money(y.saved[b])}`).join("、")}。</li>
      <li>存進保障金 ${money(y.protect)}。</li>
      <li>達成 <b>${y.goalsDone.length}</b> 個目標${y.goalsDone.length ? "：" + y.goalsDone.map(g => esc(g.name)).join("、") : ""}。</li>
      <li>${y.topMonths.length ? `最花錢的月份：${y.topMonths.map(([m, v]) => `${+m.slice(5)} 月 ${money(v)}`).join("、")}。` : "還沒有花費紀錄。"}</li>
      <li>這一年有 ${y.days} 天有記帳。</li></ul>
      <div class="actions"><div></div><button class="btn primary" type="button" data-sh="close">收進記憶</button></div>`;
  } else if (s.type === "snap") {
    inner = `<p class="loading"><span class="spinner"></span>AI 正在讀收據…</p>`;
  }
  $("lgSheet").innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${inner}</div>`;
  $("lgSheet").hidden = false;
}

// ---------- 動作 ----------
async function saveEntry() {
  const f = L.form;
  const amount = Math.round(+f.amount);
  if (!(amount > 0)) return toast("請填金額");
  if (["need", "reserve"].includes(f.kind) && !f.title.trim()) return toast("請填品項");
  L.busy = true; renderForm();
  try {
    const body = formToBody(f);
    if (L.editing) await call(`/api/ledger/entries/${L.editing}`, { method: "PUT", body });
    else await call("/api/ledger/entries", { method: "POST", body });
    if (f.fav && f.kind === "need") {
      const favs = [...(L.data.settings.favorites || []).filter(x => x.title !== body.title), { title: body.title, amount, category: f.category }].slice(-12);
      await call("/api/ledger/settings", { method: "PUT", body: { favorites: favs } });
    }
    toast(L.editing ? "已儲存" : "記好了");
    L.editing = null; L.form = blankForm(f.kind === "income" ? "need" : f.kind);
    await load();
    if (f.kind === "income" && !L.editing) toast("收入記好了，可以按「分配」先存起來");
  } catch (e) { toast(e.message); }
  L.busy = false; renderForm();
}
async function post(body, msg) { try { await call("/api/ledger/entries", { method: "POST", body }); if (msg) toast(msg); await load(); } catch (e) { toast(e.message); } }
function markGoals() {
  // 第一次看到目標達成時記下日期（年底總結用），並恭喜一下
  for (const g of L.data.goals) if (g.done && !g.doneAt) {
    const { id, saved, done, created, ...rest } = g;
    call(`/api/ledger/items/${id}`, { method: "PUT", body: { ...rest, doneAt: taipeiToday() } }).catch(() => {});
    g.doneAt = taipeiToday();
    toast(`「${g.name}」達成了！收進金色記憶球`);
  }
}

document.addEventListener("click", async ev => {
  const pane = $("ledger"); if (!pane || pane.hidden) return;
  const b = ev.target.closest("[data-act],[data-sh]"); if (!b || !pane.contains(b) && !$("lgSheet").contains(b)) return;
  const a = b.dataset.act, sh = b.dataset.sh, v = b.dataset.v, f = L.form, d = L.data;
  if (a === "fKind") { L.form = { ...blankForm(v), amount: f.amount, date: f.date, title: f.title, note: f.note }; renderForm(); }
  else if (a === "fCat") { f.category = v; renderForm(); }
  else if (a === "fWant") { f.want = v === "want" ? true : v === "need" ? false : null; renderForm(); }
  else if (a === "fBucket") { f.bucket = v; f.goal = ""; renderForm(); }
  else if (a === "fSpend") { f.spendBucket = v; f.goal = ""; renderForm(); }
  else if (a === "fPay") { f.pay = v; try { localStorage.setItem("lg.pay", v); } catch (e) {} renderForm(); }
  else if (a === "payCard") { L.editing = null; L.form = { ...blankForm("cardpay"), amount: String(Math.max(0, d.card?.unpaid || 0) || "") }; renderForm(); $("lgForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (a === "save") saveEntry();
  else if (a === "cancel") { L.editing = null; L.form = blankForm(); renderForm(); }
  else if (a === "edit") { const e = d.entries.find(x => String(x.id) === v); if (!e) return;
    if (e.kind === "cover" || e.kind === "adjust" || e.kind === "nospend") { if (confirm(`刪除這筆「${e.title || "沒花錢"}」？`)) { const ok = await call(`/api/ledger/entries/${e.id}`, { method: "DELETE" }).then(() => true, x => { toast(x.message); return false; }); await reload(); if (ok) toast("已刪除", { label: "復原", fn: () => call(`/api/ledger/entries/${e.id}/restore`, { method: "POST" }).then(() => { toast("已復原"); return load(); }).catch(x => toast(x.message)) }); } return; }
    L.editing = e.id; L.form = entryToForm(e); renderForm(); $("lgForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (a === "del") { if (!confirm("刪除這筆？")) return; try { const id = L.editing; await call(`/api/ledger/entries/${id}`, { method: "DELETE" }); L.editing = null; L.form = blankForm(); await load(); toast("已刪除", { label: "復原", fn: () => call(`/api/ledger/entries/${id}/restore`, { method: "POST" }).then(() => { toast("已復原"); return load(); }).catch(x => toast(x.message)) }); } catch (e) { toast(e.message); } }
  else if (a === "nospend") { if (d.entries.some(e => e.date === taipeiToday())) return toast("今天已經有紀錄了"); post({ kind: "nospend", date: taipeiToday() }, "今天沒花錢，點亮一顆記憶球"); }
  else if (a === "fav") { const x = d.settings.favorites[+v]; post({ kind: "expense", bucket: "need", category: x.category, amount: x.amount, title: x.title, date: taipeiToday() }, `記好了：${x.title} ${money(x.amount)}`); }
  else if (a === "cover") { const amt = +v; if (amt > 0 && confirm(`從預備金挪 ${money(amt)} 補這個月的必要支出？`)) post({ kind: "cover", amount: amt, date: L.month === taipeiToday().slice(0, 7) ? taipeiToday() : L.month + "-28" }, "已從預備金挪過來"); }
  else if (a === "recOk") { const r = d.recurring.find(x => x.id === +v); if (!r) return;
    const date = `${L.month}-${String(Math.min(r.day, new Date(+L.month.slice(0, 4), +L.month.slice(5), 0).getDate())).padStart(2, "0")}`;
    const body = r.kind === "income" ? { kind: "income", category: "薪水", title: r.name } : r.kind === "save" ? { kind: "save", bucket: r.bucket, title: r.name } : r.bucket === "need" ? { kind: "expense", bucket: "need", category: r.category, title: r.name } : { kind: "expense", bucket: r.bucket, title: r.name };
    post({ ...body, amount: r.amount, date, item_id: r.id }, `已記：${r.name}`); }
  else if (a === "recSkip") { const r = d.recurring.find(x => x.id === +v); if (!r) return; const { id, created, ...rest } = r;
    try { await call(`/api/ledger/items/${id}`, { method: "PUT", body: { ...rest, skipped: [...(r.skipped || []), L.month] } }); await load(); } catch (e) { toast(e.message); } }
  else if (a === "openSplit") { window.FiveJSSplit?.show(); }
  else if (["goal", "sinking", "allocate", "settings", "adjust"].includes(a)) openSheet(a, v);
  else if (a === "year") { openSheet("year", {}); try { const y = await call(`/api/ledger/year?year=${v}`); if (L.sheet?.type === "year") { L.sheet.arg = y; renderSheet(); } } catch (e) { toast(e.message); closeSheet(); } }
  else if (a === "export") {
    try { const res = await fetch(`${window.FIVEJS_CONFIG.API_BASE}/api/ledger/export?year=${v}`, { headers: { Authorization: `Bearer ${FiveJS.getToken()}` } });
      if (!res.ok) throw new Error("匯出失敗");
      const url = URL.createObjectURL(await res.blob()); const link = document.createElement("a"); link.href = url; link.download = `記帳-${v}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast(e.message); } }
  // 面板裡的按鈕
  else if (sh === "close") closeSheet();
  else if (sh === "rec") openSheet("recurring", v);
  else if (sh) sheetAction(sh, v);
});

async function sheetAction(sh, v) {
  const num = id => Math.round(+$(id).value || 0);
  try {
    if (sh === "saveGoal") {
      const body = { name: $("sgName").value, bucket: $("sgBucket").value, target: num("sgTarget"), startAmount: num("sgStart"), deadline: $("sgDeadline").value || null };
      await call(v ? `/api/ledger/items/${v}` : "/api/ledger/items/goal", { method: v ? "PUT" : "POST", body });
    } else if (sh === "saveSinking") {
      const body = { name: $("ssName").value, yearly: num("ssYearly"), dueMonth: $("ssDue").value ? +$("ssDue").value : null };
      await call(v ? `/api/ledger/items/${v}` : "/api/ledger/items/sinking", { method: v ? "PUT" : "POST", body });
    } else if (sh === "saveRec") {
      const [k, x] = $("srWhere").value.split(":");
      const body = { name: $("srName").value, amount: num("srAmount"), day: num("srDay") || 1, active: $("srActive").checked,
        kind: k === "income" ? "income" : k === "save" ? "save" : "expense", bucket: k === "need" ? "need" : x || "", category: k === "need" ? x : "",
        skipped: L.data.recurring.find(r => r.id === +v)?.skipped || [] };
      await call(v ? `/api/ledger/items/${v}` : "/api/ledger/items/recurring", { method: v ? "PUT" : "POST", body });
      await load(); openSheet("settings"); return;
    } else if (sh === "delItem") {
      if (!confirm("確定刪除？")) return;
      await call(`/api/ledger/items/${v}`, { method: "DELETE" });
      closeSheet(); await load();
      return toast("已刪除", { label: "復原", fn: () => call(`/api/ledger/items/${v}/restore`, { method: "POST" }).then(() => { toast("已復原"); return load(); }).catch(x => toast(x.message)) });
    } else if (sh === "saveAlloc") {
      const date = $("saDate").value;
      const entries = [...document.querySelectorAll("[data-alloc]")].map(i => ({ kind: "save", bucket: i.dataset.alloc, amount: Math.round(+i.value || 0), date, title: "發薪日分配" })).filter(e => e.amount > 0);
      if (!entries.length) return closeSheet();
      await call("/api/ledger/entries", { method: "POST", body: { entries } });
      toast("先存好了，剩下的才是這個月能花的");
    } else if (sh === "saveAdjust") {
      const delta = num("sjValue") - L.data.balances[v];
      if (delta) await call("/api/ledger/entries", { method: "POST", body: { kind: "adjust", bucket: v, amount: delta, date: taipeiToday(), title: `校正${NAMES[v]}` } });
    } else if (sh === "saveSettings") {
      const ratios = {}; document.querySelectorAll("[data-ratio]").forEach(i => ratios[i.dataset.ratio] = Math.round(+i.value || 0));
      const start = {}; document.querySelectorAll("[data-start]").forEach(i => start[i.dataset.start] = Math.max(0, Math.round(+i.value || 0)));
      const splitCat = {}; document.querySelectorAll("[data-scat]").forEach(i => splitCat[i.dataset.scat] = i.value);
      const tripMap = { ...L.data.settings.tripMap }; document.querySelectorAll("[data-trip]").forEach(i => tripMap[i.dataset.trip] = i.value);
      const sum = Object.values(ratios).reduce((a, b) => a + b, 0);
      if (sum !== 100) return toast(`比例加起來是 ${sum}%，要剛好 100%`);
      const wage = { mode: $("stWageMode").value, hourly: Math.max(0, Math.round(+$("stHourly").value || 0)), monthly: Math.max(0, Math.round(+$("stMonthly").value || 0)), hours: Math.max(1, Math.round(+$("stHours").value || 176)) };
      await call("/api/ledger/settings", { method: "PUT", body: { ratios, needWarn: Math.round(+$("stWarn").value || 60), start, splitCat, tripMap, wage, setupDone: true } });
    } else if (sh === "delFav") {
      const favs = L.data.settings.favorites.filter((_, i) => i !== +v);
      await call("/api/ledger/settings", { method: "PUT", body: { favorites: favs } });
      await load(); openSheet("settings"); return;
    }
    closeSheet(); await load();
  } catch (e) { toast(e.message); }
}

// 表單輸入：直接寫回 L.form（不重畫，免得游標跳掉）
document.addEventListener("input", ev => {
  const k = ev.target.dataset?.f; if (!k || !$("lgForm").contains(ev.target)) return;
  L.form[k] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
});
document.addEventListener("change", ev => {
  const k = ev.target.dataset?.f; if (k && $("lgForm").contains(ev.target)) { L.form[k] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value; if (k === "amount" && L.form.want === true) renderForm(); }
  if (ev.target.id === "lgSnap") { const file = ev.target.files[0]; ev.target.value = ""; if (file) snap(file); }
});

// ---------- 拍收據 ----------
async function shrink(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.86));
}
async function snap(file) {
  openSheet("snap");
  try {
    const sample = await window.claude.use("sample");
    const r = await sample.json(`這張照片是一張台灣的發票或收據。請讀出來，只回傳 JSON：{"date":"YYYY-MM-DD（民國年要換成西元）","amount":總金額整數,"store":"店家名稱","title":"簡短品項，例如「午餐便當」「全聯日用品」","category":"食|衣|住|行|育|債 選一個"}。看不清楚的欄位填 null，不要猜。分類：食＝吃喝、衣＝衣服鞋包、住＝房租水電日用品、行＝交通油錢停車、育＝學習書籍娛樂、債＝還款。`, { images: await shrink(file), modelTier: "quick" });
    const f = blankForm("need");
    if (r?.amount > 0) f.amount = String(Math.round(r.amount));
    if (/^\d{4}-\d{2}-\d{2}$/.test(r?.date || "")) f.date = r.date;
    if (NEED_CATS.includes(r?.category)) f.category = r.category;
    f.title = String(r?.title || r?.store || "").slice(0, 60);
    f.note = r?.store && r.store !== f.title ? String(r.store).slice(0, 100) : "";
    L.editing = null; L.form = f; closeSheet(); renderForm();
    toast("AI 讀好了，確認一下再按「記下來」（照片已經丟掉）");
    $("lgForm").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { closeSheet(); toast(e?.message || "讀不出來，請手動記"); }
}

$("lgPrev").onclick = () => { L.month = shiftMonth(L.month, -1); L.form = null; L.editing = null; reload(); };
$("lgNext").onclick = () => { L.month = shiftMonth(L.month, 1); L.form = null; L.editing = null; reload(); };
$("lgSheet").addEventListener("click", ev => { if (ev.target === $("lgSheet") && L.sheet?.type !== "setup" && L.sheet?.type !== "snap") closeSheet(); });

window.FiveJSLedger = { load: reload, loaded: () => L.loaded };
})();
