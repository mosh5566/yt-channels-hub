/* ===== מרכז הערוצים שלי — לוגיקה ===== */
"use strict";

const STORE_KEY = "ytHub.channels.v1";
const GLOBAL_KEY = "ytHub.global.v1";
const API_KEY_STORE = "ytHub.apiKey.v1";
const STATS_TTL = 1000 * 60 * 30; // רענון אוטומטי כל 30 דקות

/* --- State --- */
let channels = load();
let globalData = loadGlobal(); // { notes, cloud, links: [{title,url}] }

/* --- DOM --- */
const $ = (s) => document.querySelector(s);
const grid = $("#grid");
const empty = $("#empty");
const search = $("#search");

/* ===================== אחסון ===================== */
// בדיקה חד-פעמית שה-localStorage באמת זמy ומתמיד
function storageAvailable() {
  try {
    const t = "__ythub_test__";
    localStorage.setItem(t, "1");
    const ok = localStorage.getItem(t) === "1";
    localStorage.removeItem(t);
    return ok;
  } catch {
    return false;
  }
}
const STORAGE_OK = storageAvailable();

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}

// שמירה חסינה: כותב, מאמת בקריאה חוזרת, ומתריע בבירור אם נכשל
function save() {
  try {
    const payload = JSON.stringify(channels);
    localStorage.setItem(STORE_KEY, payload);
    if (localStorage.getItem(STORE_KEY) !== payload) throw new Error("verify");
    onDataChanged();
    return true;
  } catch (err) {
    if (typeof toast === "function") {
      toast("⚠️ השמירה נכשלה — הדפדפן חוסם אחסון. פתח דרך הכתובת (לא קובץ מקומי) ובלי גלישה בסתר.");
    }
    return false;
  }
}

// נתונים גלובליים (מרכז מידע): הערות, מחשב ענן, קישורים
function loadGlobal() {
  try {
    const g = JSON.parse(localStorage.getItem(GLOBAL_KEY)) || {};
    return { notes: g.notes || "", cloud: g.cloud || "", links: Array.isArray(g.links) ? g.links : [] };
  } catch {
    return { notes: "", cloud: "", links: [] };
  }
}
function saveGlobal() {
  try {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(globalData));
    onDataChanged();
    return true;
  } catch {
    if (typeof toast === "function") toast("⚠️ השמירה נכשלה — הדפדפן חוסם אחסון.");
    return false;
  }
}

// מעקב חותמת זמן לסנכרון (last-write-wins בין מכשירים)
function touchModified() {
  try { localStorage.setItem("ytHub.updatedAt", String(Date.now())); } catch {}
}
function getModified() {
  return +localStorage.getItem("ytHub.updatedAt") || 0;
}

// נקודת חיבור לסנכרון ענן — נקראת אחרי כל שינוי
function onDataChanged() {
  touchModified();
  if (typeof window.onCloudSync === "function") window.onCloudSync();
}

// כל הנתונים כאובייקט אחד — לסנכרון ענן, גיבוי והורדה
function collectAll() {
  return {
    channels,
    global: globalData,
    meta: { app: "yt-channels-hub", version: 2, updatedAt: getModified() },
  };
}

// החלת נתונים שהגיעו מהענן (בלי להפעיל סנכרון חוזר)
window.applyCloudData = function (data, cloudModified) {
  if (data && Array.isArray(data.channels)) {
    channels = data.channels.filter((c) => c && c.name).map(normalizeChannel);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(channels)); } catch {}
  }
  if (data && data.global) {
    globalData = {
      notes: data.global.notes || "",
      cloud: data.global.cloud || "",
      links: Array.isArray(data.global.links) ? data.global.links : [],
    };
    try { localStorage.setItem(GLOBAL_KEY, JSON.stringify(globalData)); } catch {}
  }
  if (cloudModified) {
    try { localStorage.setItem("ytHub.updatedAt", String(cloudModified)); } catch {}
  }
  render();
};
window.getLocalData = collectAll;
window.getLocalModified = getModified;

/* ===================== נתונים חיים (YouTube Data API) ===================== */
function getApiKey() {
  return localStorage.getItem(API_KEY_STORE) || "";
}
function setApiKey(k) {
  localStorage.setItem(API_KEY_STORE, (k || "").trim());
}

// המרת מספר לתצוגה קצרה: 1234 -> 1.2K, 1500000 -> 1.5M
function formatNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function applyStats(ch, item) {
  const s = item.statistics || {};
  const sn = item.snippet || {};
  ch.stats = {
    subs: s.subscriberCount,
    hidden: !!s.hiddenSubscriberCount,
    views: s.viewCount,
    videos: s.videoCount,
    thumb: (sn.thumbnails && (sn.thumbnails.default || {}).url) || "",
    title: sn.title || "",
    fetchedAt: Date.now(),
  };
}

let refreshing = false;
async function refreshStats(force) {
  const key = getApiKey();
  if (!key) return;
  if (refreshing) return;

  // דלג אם כל הנתונים טריים (אלא אם רענון יזום)
  if (!force) {
    const stale = channels.some(
      (c) => (c.channelId || c.handle) && (!c.stats || Date.now() - c.stats.fetchedAt > STATS_TTL)
    );
    if (!stale) return;
  }

  refreshing = true;
  const refreshBtn = $("#btn-refresh");
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const base = "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics";

    // ערוצים עם channelId — אפשר לקבץ עד 50 בקריאה אחת
    const withId = channels.filter((c) => c.channelId);
    for (let i = 0; i < withId.length; i += 50) {
      const batch = withId.slice(i, i + 50);
      const ids = batch.map((c) => c.channelId).join(",");
      const res = await fetch(`${base}&id=${ids}&key=${key}`);
      const data = await res.json();
      if (data.error) throw data.error;
      (data.items || []).forEach((item) => {
        const ch = channels.find((c) => c.channelId === item.id);
        if (ch) applyStats(ch, item);
      });
    }

    // ערוצים עם handle בלבד — קריאה לכל אחד (forHandle), ושומרים את ה-channelId שחוזר
    const withHandle = channels.filter((c) => !c.channelId && c.handle);
    for (const ch of withHandle) {
      const res = await fetch(`${base}&forHandle=${encodeURIComponent(ch.handle)}&key=${key}`);
      const data = await res.json();
      if (data.error) throw data.error;
      const item = (data.items || [])[0];
      if (item) {
        applyStats(ch, item);
        ch.channelId = item.id; // העשרה: עכשיו יש לנו מזהה אמיתי
      }
    }

    save();
    render();
  } catch (err) {
    const reason = (err && err.message) || "שגיאה";
    toast("⚠️ API: " + reason);
  } finally {
    refreshing = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

/* ===================== בניית קישורים ===================== */
// הקסם: פתיחת הסטודיו של הערוץ הנכון + החשבון הנכון בלחיצה אחת
function studioUrl(ch) {
  const target = ch.channelId
    ? `https://studio.youtube.com/channel/${ch.channelId}`
    : "https://studio.youtube.com";
  if (ch.email) {
    return (
      "https://accounts.google.com/AccountChooser?Email=" +
      encodeURIComponent(ch.email) +
      "&continue=" +
      encodeURIComponent(target)
    );
  }
  return target;
}

function channelUrl(ch) {
  const target = ch.channelId
    ? `https://www.youtube.com/channel/${ch.channelId}`
    : ch.handle
    ? `https://www.youtube.com/${ch.handle}`
    : "https://www.youtube.com";
  if (ch.email) {
    return (
      "https://accounts.google.com/AccountChooser?Email=" +
      encodeURIComponent(ch.email) +
      "&continue=" +
      encodeURIComponent(target)
    );
  }
  return target;
}

// עמוד הסרטונים הציבורי — לראות את כל הסרטונים והצפיות "מבחוץ" (כמו צופה רגיל)
function videosUrl(ch) {
  if (ch.channelId) return `https://www.youtube.com/channel/${ch.channelId}/videos`;
  if (ch.handle) return `https://www.youtube.com/${ch.handle}/videos`;
  return "https://www.youtube.com";
}

// חילוץ מזהה/handle מקלט חופשי (URL, UC…, @שם)
function parseChannelInput(input) {
  const v = (input || "").trim();
  if (!v) return {};
  const idMatch = v.match(/(UC[0-9A-Za-z_-]{22})/);
  if (idMatch) return { channelId: idMatch[1] };
  const handleMatch = v.match(/@([A-Za-z0-9._֐-׿-]+)/);
  if (handleMatch) return { handle: "@" + handleMatch[1] };
  return {};
}

/* ===================== עזרי תצוגה ===================== */
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function uid() {
  if (window.crypto && crypto.randomUUID) return "c_" + crypto.randomUUID();
  return "c_" + Math.random().toString(36).slice(2) + (performance.now() | 0).toString(36);
}
function initial(name) {
  const t = (name || "?").trim();
  return t ? t[0].toUpperCase() : "?";
}

/* ===================== רינדור ===================== */
function render() {
  const q = (search.value || "").trim().toLowerCase();
  const list = channels.filter(
    (c) =>
      !q ||
      (c.name || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q)
  );

  grid.innerHTML = "";
  empty.classList.toggle("hidden", channels.length > 0);

  list.forEach((ch) => {
    const card = document.createElement("article");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = ch.id;
    card.style.setProperty("--card-accent", ch.color || "#ff0033");
    const num = channels.indexOf(ch) + 1;

    const img = ch.photo || (ch.stats && ch.stats.thumb);
    const avatar = img
      ? `<div class="avatar" style="background-image:url('${escapeHtml(img)}')"></div>`
      : `<div class="avatar">${ch.emoji ? ch.emoji : `<span>${escapeHtml(initial(ch.name))}</span>`}</div>`;

    const badges = [
      ch.password ? "🔑" : "",
      ch.phone ? "📱" : "",
      ch.skill ? "🧬" : "",
    ].filter(Boolean).join(" ");
    const badgesHtml = badges ? `<div class="card-badges" title="מידע שמור">${badges}</div>` : "";

    const stats = ch.stats
      ? `
      <div class="card-stats">
        <div class="stat"><div class="stat-num">${ch.stats.hidden ? "—" : formatNum(ch.stats.subs)}</div><div class="stat-lbl">מנויים</div></div>
        <div class="stat"><div class="stat-num">${formatNum(ch.stats.views)}</div><div class="stat-lbl">צפיות</div></div>
        <div class="stat"><div class="stat-num">${formatNum(ch.stats.videos)}</div><div class="stat-lbl">סרטונים</div></div>
      </div>`
      : "";

    card.innerHTML = `
      <div class="card-num">#${num}</div>
      <div class="card-menu">
        <button class="mini" data-del title="מחיקה">🗑️</button>
      </div>
      <div class="card-top">
        ${avatar}
        <div class="card-info">
          <div class="card-name">${escapeHtml(ch.name)}</div>
          <div class="card-email" title="${escapeHtml(ch.email || "")}">${escapeHtml(ch.email || "")}</div>
          ${badgesHtml}
        </div>
      </div>
      ${stats}
      <div class="card-btns">
        <button class="btn btn-studio btn-full" data-studio>🎬 פתח סטודיו</button>
        <button class="btn btn-view btn-full" data-view>👁️ צפה בערוץ מבחוץ</button>
        <button class="btn btn-edit btn-full" data-edit>✏️ עריכת פרופיל</button>
      </div>
    `;

    card.querySelector("[data-studio]").addEventListener("click", () =>
      window.open(studioUrl(ch), "_blank", "noopener")
    );
    card.querySelector("[data-view]").addEventListener("click", () =>
      window.open(videosUrl(ch), "_blank", "noopener")
    );
    card.querySelector("[data-edit]").addEventListener("click", () => openForm(ch));
    card.querySelector("[data-del]").addEventListener("click", () => removeChannel(ch));

    addDragHandlers(card);
    grid.appendChild(card);
  });
}

/* ===================== גרירה לסידור מחדש ===================== */
let dragId = null;
function addDragHandlers(card) {
  card.addEventListener("dragstart", () => {
    dragId = card.dataset.id;
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    dragId = null;
  });
  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!dragId || dragId === card.dataset.id) return;
    const from = channels.findIndex((c) => c.id === dragId);
    const to = channels.findIndex((c) => c.id === card.dataset.id);
    if (from < 0 || to < 0) return;
    const [moved] = channels.splice(from, 1);
    channels.splice(to, 0, moved);
    save();
    render();
  });
}

/* ===================== CRUD ===================== */
function openForm(ch) {
  $("#modal-title").textContent = ch ? "עריכת ערוץ" : "ערוץ חדש";
  $("#f-id").value = ch ? ch.id : "";
  $("#f-name").value = ch ? ch.name : "";
  $("#f-email").value = ch ? ch.email || "" : "";
  $("#f-channel").value = ch ? ch.channelId || ch.handle || "" : "";
  $("#f-emoji").value = ch ? ch.emoji || "" : "";
  $("#f-color").value = ch ? ch.color || "#ff0033" : "#ff0033";
  $("#f-password").value = ch ? ch.password || "" : "";
  $("#f-phone").value = ch ? ch.phone || "" : "";
  $("#f-skill").value = ch ? ch.skill || "" : "";
  setPhotoPreview(ch ? ch.photo || "" : "");
  $("#f-password").type = "password";
  $("#help-box").classList.add("hidden");
  showModal("#modal");
  setTimeout(() => $("#f-name").focus(), 60);
}

// תצוגת התמונה בטופס + שמירתה בשדה הנסתר
function setPhotoPreview(dataUrl) {
  $("#f-photo").value = dataUrl || "";
  const prev = $("#photo-preview");
  if (dataUrl) {
    prev.style.backgroundImage = `url('${dataUrl}')`;
    prev.textContent = "";
    prev.classList.add("has-img");
    $("#btn-photo-clear").classList.remove("hidden");
  } else {
    prev.style.backgroundImage = "";
    prev.textContent = "🖼️";
    prev.classList.remove("has-img");
    $("#btn-photo-clear").classList.add("hidden");
  }
}

function submitForm(e) {
  e.preventDefault();
  const id = $("#f-id").value;
  const parsed = parseChannelInput($("#f-channel").value);
  const existing = id ? channels.find((c) => c.id === id) : null;
  const data = {
    id: id || uid(),
    name: $("#f-name").value.trim(),
    email: $("#f-email").value.trim(),
    channelId: parsed.channelId || "",
    handle: parsed.handle || "",
    emoji: $("#f-emoji").value.trim(),
    color: $("#f-color").value,
    password: $("#f-password").value,
    phone: $("#f-phone").value.trim(),
    skill: $("#f-skill").value,
    photo: $("#f-photo").value || "",
    stats: existing ? existing.stats : undefined, // שימור נתונים חיים בעריכה
  };
  if (!data.name || !data.email) return;

  if (id) {
    const i = channels.findIndex((c) => c.id === id);
    if (i >= 0) channels[i] = data;
  } else {
    channels.push(data);
  }
  save();
  render();
  hideModal("#modal");
  toast(id ? "✅ הערוץ עודכן" : "✅ הערוץ נוסף");
  refreshStats(true);
}

function removeChannel(ch) {
  if (!confirm(`למחוק את "${ch.name}"?`)) return;
  channels = channels.filter((c) => c.id !== ch.id);
  save();
  render();
  toast("🗑️ הערוץ נמחק");
}

/* ===================== גיבוי ===================== */
function exportData() {
  const blob = new Blob([JSON.stringify(collectAll(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "youtube-channels-backup.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("⬇️ הגיבוי נשמר");
}

function normalizeChannel(c) {
  return {
    id: c.id || uid(),
    name: String(c.name),
    email: String(c.email || ""),
    channelId: String(c.channelId || ""),
    handle: String(c.handle || ""),
    emoji: String(c.emoji || ""),
    color: String(c.color || "#ff0033"),
    password: String(c.password || ""),
    phone: String(c.phone || ""),
    skill: String(c.skill || ""),
    photo: String(c.photo || ""),
    stats: c.stats || undefined,
  };
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      // תמיכה בפורמט ישן (מערך) ובחדש ({channels, global})
      const arr = Array.isArray(data) ? data : data.channels;
      if (!Array.isArray(arr)) throw new Error("bad");
      const valid = arr.filter((c) => c && c.name).map(normalizeChannel);

      const key = (c) => (c.name + "|" + c.email).toLowerCase();
      const existing = new Set(channels.map(key));
      let added = 0;
      valid.forEach((c) => {
        if (!existing.has(key(c))) {
          channels.push(c);
          added++;
        }
      });

      // ייבוא נתונים גלובליים (אם קיימים ואין עדיין)
      if (data.global) {
        if (data.global.notes && !globalData.notes) globalData.notes = String(data.global.notes);
        if (data.global.cloud && !globalData.cloud) globalData.cloud = String(data.global.cloud);
        if (Array.isArray(data.global.links) && !globalData.links.length) {
          globalData.links = data.global.links.filter((l) => l && l.url);
        }
        saveGlobal();
      }

      save();
      render();
      hideModal("#menu");
      toast(`⬆️ יובאו ${added} ערוצים`);
    } catch {
      toast("⚠️ קובץ לא תקין");
    }
  };
  reader.readAsText(file);
}

/* ===================== מודאלים ===================== */
function showModal(sel) {
  $(sel).classList.remove("hidden");
}
function hideModal(sel) {
  $(sel).classList.add("hidden");
}

/* ===================== טוסט ===================== */
let toastTimer;
function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms || 2200);
}

/* ===================== תמונת פרופיל ===================== */
function handlePhotoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const im = new Image();
    im.onload = () => {
      const max = 256; // כיווץ לחיסכון באחסון וברוחב פס
      let w = im.width, h = im.height;
      if (w > h && w > max) { h = Math.round((h * max) / w); w = max; }
      else if (h > max) { w = Math.round((w * max) / h); h = max; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(im, 0, 0, w, h);
      setPhotoPreview(c.toDataURL("image/jpeg", 0.85));
    };
    im.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ===================== מרכז מידע גלובלי ===================== */
function openHub() {
  $("#g-notes").value = globalData.notes || "";
  $("#g-cloud").value = globalData.cloud || "";
  renderLinks();
  showModal("#hub");
}
function saveHub() {
  globalData.notes = $("#g-notes").value;
  globalData.cloud = $("#g-cloud").value;
  saveGlobal();
  hideModal("#hub");
  toast("✅ המידע נשמר");
}
function renderLinks() {
  const box = $("#links-list");
  box.innerHTML = "";
  const links = globalData.links || [];
  if (!links.length) {
    box.innerHTML = `<p class="muted small center">אין קישורים עדיין.</p>`;
    return;
  }
  links.forEach((lk, i) => {
    const row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML = `
      <a href="${escapeHtml(lk.url)}" target="_blank" rel="noopener" class="link-open">🔗 ${escapeHtml(lk.title || lk.url)}</a>
      <button type="button" class="mini" title="מחיקה">🗑️</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      globalData.links.splice(i, 1);
      saveGlobal();
      renderLinks();
    });
    box.appendChild(row);
  });
}
function addLink() {
  const title = $("#link-title").value.trim();
  let url = $("#link-url").value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  globalData.links = globalData.links || [];
  globalData.links.push({ title: title || url, url });
  saveGlobal();
  $("#link-title").value = "";
  $("#link-url").value = "";
  renderLinks();
}

/* ===================== הורדת כל המידע ל-HTML/PDF ===================== */
function downloadHtml() {
  const esc = (s) => escapeHtml(String(s == null ? "" : s));
  const br = (s) => esc(s).replace(/\n/g, "<br>");
  const date = new Date().toISOString().slice(0, 10);

  const cards = channels.map((ch, i) => {
    const img = ch.photo || (ch.stats && ch.stats.thumb) || "";
    const avatar = img
      ? `<img class="av" src="${esc(img)}" alt="">`
      : `<div class="av ph" style="background:${esc(ch.color || "#ff0033")}">${esc(ch.emoji || initial(ch.name))}</div>`;
    const row = (label, val) => (val ? `<tr><th>${label}</th><td dir="auto">${br(val)}</td></tr>` : "");
    const st = ch.stats
      ? `<tr><th>נתונים חיים</th><td>👥 ${formatNum(ch.stats.subs)} מנויים · ▶ ${formatNum(ch.stats.views)} צפיות · 🎬 ${formatNum(ch.stats.videos)} סרטונים</td></tr>`
      : "";
    const studioLink = ch.channelId
      ? `<tr><th>🎬 סטודיו</th><td><a href="https://studio.youtube.com/channel/${esc(ch.channelId)}">פתיחת הסטודיו</a></td></tr>`
      : "";
    const viewLink = ch.channelId
      ? `<tr><th>👁️ צפייה בערוץ</th><td><a href="https://www.youtube.com/channel/${esc(ch.channelId)}/videos">כל הסרטונים והצפיות</a></td></tr>`
      : "";
    return `
      <div class="ch" style="border-color:${esc(ch.color || "#ff0033")}">
        <div class="ch-h">${avatar}<h3>#${i + 1} · ${esc(ch.name)}</h3></div>
        <table>
          ${row("מייל", ch.email)}
          ${row("🔑 סיסמה", ch.password)}
          ${row("📱 טלפון אימות", ch.phone)}
          ${row("מזהה ערוץ", ch.channelId)}
          ${row("Handle", ch.handle)}
          ${st}
          ${studioLink}
          ${viewLink}
          ${row("🧬 סקיל לשכפול", ch.skill)}
        </table>
      </div>`;
  }).join("");

  const links = (globalData.links || [])
    .map((l) => `<li><a href="${esc(l.url)}">${esc(l.title || l.url)}</a></li>`)
    .join("");

  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>הערוצים שלי — גיבוי ${date}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI","Noto Sans Hebrew",Arial,sans-serif;background:#f4f4f6;color:#18181b;margin:0;padding:24px;line-height:1.6}
  h1{margin:0 0 4px}.sub{color:#777;margin-bottom:20px}
  .toolbar{margin-bottom:20px}
  .toolbar button{font:inherit;font-weight:700;background:#ff0033;color:#fff;border:0;border-radius:10px;padding:10px 18px;cursor:pointer}
  .ch{background:#fff;border-right:6px solid #ff0033;border-radius:12px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.08);break-inside:avoid}
  .ch-h{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .av{width:46px;height:46px;border-radius:12px;object-fit:cover}
  .av.ph{display:grid;place-items:center;background:#ff0033;color:#fff;font-size:22px;font-weight:700}
  .ch h3{margin:0;font-size:18px}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:right;padding:6px 8px;vertical-align:top;font-size:14px;border-bottom:1px solid #eee}
  th{width:130px;color:#555;font-weight:600;white-space:nowrap}
  td{word-break:break-word}
  .box{background:#fff;border-radius:12px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  .box h2{margin:0 0 8px;font-size:16px}
  .box pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}
  ul{margin:0;padding-inline-start:20px}
  @media print{.toolbar{display:none}body{background:#fff;padding:0}}
</style></head><body>
  <h1>📺 הערוצים שלי</h1>
  <div class="sub">גיבוי מלא · ${date} · ${channels.length} ערוצים</div>
  <div class="toolbar"><button onclick="window.print()">🖨️ הדפסה / שמירה כ-PDF</button></div>
  ${cards || "<p>אין ערוצים.</p>"}
  ${globalData.notes ? `<div class="box"><h2>🗒️ מידע כללי</h2><pre>${br(globalData.notes)}</pre></div>` : ""}
  ${globalData.cloud ? `<div class="box"><h2>☁️ מחשב ענן</h2><pre dir="ltr">${br(globalData.cloud)}</pre></div>` : ""}
  ${links ? `<div class="box"><h2>🔗 קישורים חשובים</h2><ul>${links}</ul></div>` : ""}
</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `youtube-channels-${date}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("📥 הקובץ הורד — פתח אותו ולחץ 'הדפסה/PDF'");
}

/* ===================== אירועים ===================== */
$("#btn-add").addEventListener("click", () => openForm(null));
$("#form").addEventListener("submit", submitForm);
search.addEventListener("input", render);

// תמונת פרופיל
$("#btn-photo").addEventListener("click", () => $("#file-photo").click());
$("#file-photo").addEventListener("change", (e) => {
  if (e.target.files[0]) handlePhotoFile(e.target.files[0]);
  e.target.value = "";
});
$("#btn-photo-clear").addEventListener("click", () => setPhotoPreview(""));
$("#pw-toggle").addEventListener("click", () => {
  const inp = $("#f-password");
  inp.type = inp.type === "password" ? "text" : "password";
});

// מרכז מידע
$("#btn-hub").addEventListener("click", openHub);
$("#btn-save-hub").addEventListener("click", saveHub);
$("#btn-add-link").addEventListener("click", addLink);
$("#link-url").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } });

// הורדת HTML
$("#btn-download-html").addEventListener("click", downloadHtml);

$("#btn-menu").addEventListener("click", () => {
  $("#count-line").textContent = `סה"כ ${channels.length} ערוצים שמורים`;
  $("#api-key").value = getApiKey();
  showModal("#menu");
});

$("#btn-save-key").addEventListener("click", () => {
  setApiKey($("#api-key").value);
  toast(getApiKey() ? "🔑 המפתח נשמר" : "המפתח נמחק");
  if (getApiKey()) refreshStats(true);
});
$("#btn-refresh").addEventListener("click", () => {
  if (!getApiKey()) {
    toast("צריך קודם להזין API Key");
    return;
  }
  toast("🔄 מרענן נתונים…");
  refreshStats(true);
});
$("#api-help").addEventListener("click", (e) => {
  e.preventDefault();
  $("#api-help-box").classList.toggle("hidden");
});

$("#btn-export").addEventListener("click", exportData);
$("#btn-import").addEventListener("click", () => $("#file-import").click());
$("#file-import").addEventListener("change", (e) => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = "";
});
$("#btn-clear").addEventListener("click", () => {
  if (!confirm("למחוק את כל הערוצים? פעולה זו אינה הפיכה.")) return;
  channels = [];
  save();
  render();
  hideModal("#menu");
  toast("הכל נמחק");
});

$("#help-id").addEventListener("click", (e) => {
  e.preventDefault();
  $("#help-box").classList.toggle("hidden");
});

// סגירת מודאלים: כפתורי close + לחיצה על הרקע + Esc
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => {
    hideModal("#modal");
    hideModal("#menu");
    hideModal("#hub");
  })
);
document.querySelectorAll(".modal").forEach((m) =>
  m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.add("hidden");
  })
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideModal("#modal");
    hideModal("#menu");
    hideModal("#hub");
  }
});

/* ===================== Service Worker ===================== */
if ("serviceWorker" in navigator) {
  // כשקוד חדש משתלט — מרעננים פעם אחת אוטומטית כדי שלא יישאר קוד ישן במטמון
  let swRefreshed = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swRefreshed) return;
    swRefreshed = true;
    location.reload();
  });
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {})
  );
}

/* ===================== התחלה ===================== */
render();
if (!STORAGE_OK) {
  toast(
    "⚠️ הדפדפן חוסם שמירה! ערוצים לא יישמרו. פתח דרך הכתובת https://mosh5566.github.io/yt-channels-hub/ (לא כקובץ מקומי) ובלי גלישה בסתר.",
    9000
  );
}
refreshStats(false);
