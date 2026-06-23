/* ===== מרכז הערוצים שלי — לוגיקה ===== */
"use strict";

const STORE_KEY = "ytHub.channels.v1";

/* --- State --- */
let channels = load();

/* --- DOM --- */
const $ = (s) => document.querySelector(s);
const grid = $("#grid");
const empty = $("#empty");
const search = $("#search");

/* ===================== אחסון ===================== */
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(channels));
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

    const avatar = ch.emoji
      ? ch.emoji
      : `<span>${escapeHtml(initial(ch.name))}</span>`;

    card.innerHTML = `
      <div class="card-menu">
        <button class="mini" data-edit title="עריכה">✏️</button>
        <button class="mini" data-del title="מחיקה">🗑️</button>
      </div>
      <div class="card-top">
        <div class="avatar">${avatar}</div>
        <div class="card-info">
          <div class="card-name">${escapeHtml(ch.name)}</div>
          <div class="card-email">${escapeHtml(ch.email || "")}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-studio" data-studio>🎬 פתח סטודיו</button>
        <button class="btn" data-open title="פתח ערוץ ביוטיוב">▶</button>
      </div>
    `;

    card.querySelector("[data-studio]").addEventListener("click", () =>
      window.open(studioUrl(ch), "_blank", "noopener")
    );
    card.querySelector("[data-open]").addEventListener("click", () =>
      window.open(channelUrl(ch), "_blank", "noopener")
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
  $("#help-box").classList.add("hidden");
  showModal("#modal");
  setTimeout(() => $("#f-name").focus(), 60);
}

function submitForm(e) {
  e.preventDefault();
  const id = $("#f-id").value;
  const parsed = parseChannelInput($("#f-channel").value);
  const data = {
    id: id || uid(),
    name: $("#f-name").value.trim(),
    email: $("#f-email").value.trim(),
    channelId: parsed.channelId || "",
    handle: parsed.handle || "",
    emoji: $("#f-emoji").value.trim(),
    color: $("#f-color").value,
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
  const blob = new Blob([JSON.stringify(channels, null, 2)], {
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

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error("bad");
      const valid = data
        .filter((c) => c && c.name)
        .map((c) => ({
          id: c.id || uid(),
          name: String(c.name),
          email: String(c.email || ""),
          channelId: String(c.channelId || ""),
          handle: String(c.handle || ""),
          emoji: String(c.emoji || ""),
          color: String(c.color || "#ff0033"),
        }));
      // מיזוג: מוסיף רק ערוצים שלא קיימים (לפי שם+מייל)
      const key = (c) => (c.name + "|" + c.email).toLowerCase();
      const existing = new Set(channels.map(key));
      let added = 0;
      valid.forEach((c) => {
        if (!existing.has(key(c))) {
          channels.push(c);
          added++;
        }
      });
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
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ===================== אירועים ===================== */
$("#btn-add").addEventListener("click", () => openForm(null));
$("#form").addEventListener("submit", submitForm);
search.addEventListener("input", render);

$("#btn-menu").addEventListener("click", () => {
  $("#count-line").textContent = `סה"כ ${channels.length} ערוצים שמורים`;
  showModal("#menu");
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
  }
});

/* ===================== Service Worker ===================== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js").catch(() => {})
  );
}

/* ===================== התחלה ===================== */
render();
