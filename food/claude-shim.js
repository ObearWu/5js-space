/*
 * 讓舊的「大小豬健康食記」不用重寫就能跑在正式網站上。
 *
 * 舊食記是 Claude Artifact，透過 window.claude.use(...) 取得四種能力：
 *   db（共享資料庫）、user（目前是誰）、sample（呼叫 Claude）、downloads（下載檔案）。
 * 這支檔案用同樣的介面重做這四樣，底層改成呼叫我們自己的後端：
 *   db        → /api/docs/sync、/api/docs/write（後端 modules/docs.py）
 *   user      → /auth/status（登入的是大豬還是小豬，另一半是誰）
 *   sample    → /api/ai/json（後端拿 ANTHROPIC_API_KEY 呼叫 Claude）
 *   downloads → 瀏覽器一般的下載
 * 舊程式的其他部分（畫面、計算、提示詞）原封不動。
 *
 * 即時同步：舊資料庫會主動推送變化；這裡改成每隔幾秒向後端要「上次之後
 * 有變動的文件」。自己寫入的資料會先直接反映到畫面上，不用等下一輪。
 */
(() => {
  const { API_BASE } = window.FIVEJS_CONFIG;
  const PHOTO_PREFIX = `${API_BASE}/api/photos/`;
  const POLL_MS = 12000;

  // ---------- 登入 ----------
  // 後端剛好在休眠時要等它醒來（Render 免費方案最久約一分鐘），先不要放棄。
  let mePromise = null;
  function me() {
    if (!mePromise) mePromise = (async () => {
      for (let i = 0; ; i++) {
        try { return await FiveJS.requireLogin("food"); }
        catch (e) {
          if (i >= 12) throw e;
          const el = document.getElementById("storeStatus");
          if (el) el.textContent = "正在喚醒後端，第一次打開可能要等半分鐘…";
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    })();
    return mePromise;
  }

  const netErr = msg => ({ code: "unavailable", message: msg || "連不上後端，請稍後再試。" });

  async function post(path, body, { signal } = {}) {
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${FiveJS.getToken()}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e?.name === "AbortError") throw { code: "cancelled", message: "已停止" };
      throw netErr();
    }
    if (res.status === 401) { FiveJS.setToken(null); location.href = "../?next=food"; throw netErr("登入已逾期"); }
    return res;
  }
  async function postJSON(path, body) {
    const res = await post(path, body);
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) throw { code: "permission_denied", message: data.error || "沒有權限" };
    if (!res.ok) throw netErr(data.error);
    return data;
  }

  // ---------- 照片網址轉換 ----------
  // 後端把餐點小圖存成 "photo:<id>"；畫面上要換成真正的網址，寫回去時再換回來。
  const fromServer = data => {
    if (data && typeof data.thumb === "string" && data.thumb.startsWith("photo:"))
      return { ...data, thumb: PHOTO_PREFIX + data.thumb.slice(6) };
    return data;
  };
  const toServer = data => {
    if (data && typeof data.thumb === "string" && data.thumb.startsWith(PHOTO_PREFIX))
      return { ...data, thumb: "photo:" + data.thumb.slice(PHOTO_PREFIX.length) };
    return data;
  };

  // ---------- 查詢條件（跟後端同樣的規則：值一律當字串比較） ----------
  const OPS = { "==": (a, b) => a === b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b };
  const matches = (data, where) => where.every(([f, op, v]) => data[f] !== undefined && data[f] !== null && OPS[op](String(data[f]), String(v)));

  // ---------- 同步 ----------
  let seq = 0;
  const listeners = new Map();     // key → {c, where, map, since, cb, err, ready}
  const oneShots = [];             // get() 的一次性查詢
  let timer = null, inflight = null;

  function snapshotOf(map) {
    const docs = [...map.entries()].map(([id, data]) => ({ id, data: () => data }));
    return { docs, empty: !docs.length, size: docs.length };
  }
  function emit(l) {
    if (l.emitTimer) return;
    l.emitTimer = setTimeout(() => { l.emitTimer = null; try { l.cb(snapshotOf(l.map)); } catch (e) { console.error(e); } }, 0);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms);
  }
  async function syncNow() {
    clearTimeout(timer);
    if (inflight) { await inflight; return syncNow(); }
    const shots = oneShots.splice(0);
    if (!listeners.size && !shots.length) return;
    const queries = [...listeners.entries()].map(([key, l]) => ({ key, c: l.c, where: l.where, since: l.since }))
      .concat(shots.map(s => ({ key: s.key, c: s.c, where: s.where })));
    inflight = (async () => {
      try {
        const { now, results } = await postJSON("/api/docs/sync", { queries });
        for (const [key, l] of listeners) {
          const r = results[key]; if (!r) continue;
          if (r.full) l.map = new Map(r.docs.map(d => [d.id, fromServer(d.data)]));
          else {
            r.removed.forEach(id => l.map.delete(id));
            r.docs.forEach(d => { const data = fromServer(d.data); if (matches(data, l.where)) l.map.set(d.id, data); else l.map.delete(d.id); });
          }
          l.since = now;
          if (r.full || r.docs.length || r.removed.length || !l.ready) { l.ready = true; emit(l); }
        }
        shots.forEach(s => s.resolve(snapshotOf(new Map((results[s.key]?.docs || []).map(d => [d.id, fromServer(d.data)])))));
      } catch (e) {
        shots.forEach(s => s.reject(e));
        for (const l of listeners.values()) if (!l.ready && l.err) { try { l.err(e); } catch {} }
      } finally {
        inflight = null;
        if (listeners.size) schedule(document.hidden ? POLL_MS * 5 : POLL_MS);
      }
    })();
    return inflight;
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(50); });
  window.addEventListener("online", () => schedule(50));

  // 自己寫入的資料先反映到畫面上
  function applyLocal(c, id, data) {
    for (const l of listeners.values()) {
      if (l.c !== c) continue;
      if (data && matches(data, l.where)) l.map.set(id, data); else l.map.delete(id);
      if (l.ready) emit(l);
    }
  }
  function resyncCollection(c) {
    for (const l of listeners.values()) if (l.c === c) l.since = null;
    schedule(100);
  }

  // ---------- 寫入：同一瞬間的多筆寫入合併成一個請求 ----------
  let queue = [], flushTimer = null;
  function enqueue(op) {
    return new Promise((resolve, reject) => {
      queue.push({ op, resolve, reject });
      if (!flushTimer) flushTimer = setTimeout(flush, 20);
    });
  }
  async function flush() {
    flushTimer = null;
    while (queue.length) {
      const batch = queue.splice(0, 200);
      try {
        await postJSON("/api/docs/write", { ops: batch.map(b => b.op), import: !!window.__fivejsImporting });
        batch.forEach(b => b.resolve());
      } catch (e) {
        batch.forEach(b => { b.reject(e); resyncCollection(b.op.c); });
      }
    }
    schedule(800);
  }

  function docRef(c, id) {
    return {
      id,
      set(body) {
        const data = { ...body }; delete data.id;
        applyLocal(c, id, data);
        return enqueue({ op: "set", c, id, data: toServer(data) });
      },
      delete() {
        applyLocal(c, id, null);
        return enqueue({ op: "delete", c, id });
      },
    };
  }
  function query(c, where) {
    return {
      where(f, op, v) { return query(c, where.concat([[f, op, v]])); },
      doc(id) { return docRef(c, id); },
      get() {
        return new Promise((resolve, reject) => { oneShots.push({ key: `g${++seq}`, c, where, resolve, reject }); schedule(0); });
      },
      onSnapshot(cb, err) {
        const key = `l${++seq}`;
        listeners.set(key, { c, where, map: new Map(), since: null, cb, err, ready: false });
        schedule(0);
        return () => listeners.delete(key);
      },
    };
  }
  const db = {
    collection: path => query(path, []),
    doc(path) { const i = path.lastIndexOf("/"); return docRef(path.slice(0, i), path.slice(i + 1)); },
  };

  // ---------- user ----------
  function userApi(info) {
    const names = { [info.user.id]: info.user.name };
    if (info.partner) names[info.partner.id] = info.partner.name;
    return {
      id: async () => String(info.user.id),
      can: async () => true,
      profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: names[i] || "另一半" }])),
    };
  }

  // ---------- sample（AI） ----------
  const blobToB64 = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject; r.readAsDataURL(blob);
  });
  const sample = {
    limits: async () => ({ images: 4 }),
    async json(prompt, { images, signal, onText, modelTier } = {}) {
      const list = images ? (Array.isArray(images) ? images : [images]) : [];
      const imgs = await Promise.all(list.map(async b => ({ media_type: b.type || "image/jpeg", data: await blobToB64(b) })));
      const res = await post("/api/ai/json", { prompt, images: imgs, quick: modelTier === "quick" }, { signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw { code: res.status === 429 ? "rate_limited" : "error", message: data.error || `AI 發生錯誤（${res.status}）` };
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "", text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line) continue;
            const msg = JSON.parse(line);
            if (msg.t) { text += msg.t; onText?.({ text }); }
            else if (msg.done) return msg.json;
            else if (msg.error) throw { code: /格式/.test(msg.error) ? "invalid_json" : "error", message: msg.error };
          }
        }
      } catch (e) {
        if (e?.name === "AbortError") throw { code: "cancelled", message: "已停止" };
        throw e;
      }
      throw { code: "error", message: "AI 回覆中斷，請再試一次。" };
    },
  };

  // ---------- downloads ----------
  const downloads = {
    async save({ filename, data }) {
      const u = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = document.createElement("a"); a.href = u; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    },
  };

  window.claude = {
    async use(name) {
      const info = await me();
      if (name === "db") return db;
      if (name === "user") return userApi(info);
      if (name === "sample") return sample;
      if (name === "downloads") return downloads;
      return null;
    },
  };
})();
