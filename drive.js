/* ===== סנכרון Google Drive (appDataFolder) ===== */
"use strict";
(function () {
  const CLIENT_ID_KEY = "ytHub.driveClientId";
  // Client ID ציבורי מוטמע — כך אין צורך להדביק כלום בכל דפדפן
  const DEFAULT_CLIENT_ID = "543009235041-bsopvs4559cni30fkt8hqvl0dpbjl307.apps.googleusercontent.com";
  const FILE_NAME = "ythub-data.json";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";

  let tokenClient = null;
  let accessToken = null;
  let fileId = null;
  let syncTimer = null;
  let onTokenResolve = null;

  const $ = (s) => document.querySelector(s);
  function status(msg, cls) {
    const el = $("#drive-status");
    if (el) {
      el.textContent = msg;
      el.className = "drive-status" + (cls ? " " + cls : "");
    }
  }
  const getClientId = () => (localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID).trim();
  const setClientId = (v) => localStorage.setItem(CLIENT_ID_KEY, (v || "").trim());

  /* ---- טעינת Google Identity Services ---- */
  function waitGis(cb) {
    if (window.google && google.accounts && google.accounts.oauth2) return cb();
    let tries = 0;
    const iv = setInterval(() => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        clearInterval(iv);
        cb();
      } else if (++tries > 50) {
        clearInterval(iv);
        status("⚠️ טעינת גוגל נכשלה — בדוק חיבור אינטרנט/חוסם פרסומות", "err");
      }
    }, 150);
  }

  function initTokenClient() {
    const cid = getClientId();
    if (!cid) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: SCOPE,
      callback: (resp) => {
        const ok = !!(resp && resp.access_token);
        if (ok) accessToken = resp.access_token;
        if (onTokenResolve) {
          const r = onTokenResolve;
          onTokenResolve = null;
          r(ok);
        } else if (ok) {
          onConnected();
        } else {
          status("⚠️ ההתחברות בוטלה", "err");
        }
      },
    });
    return true;
  }

  /* ---- חיבור / ניתוק ---- */
  function connect() {
    if (!getClientId()) {
      status("קודם הדבק Client ID ולחץ 'שמירת מזהה'", "err");
      return;
    }
    waitGis(() => {
      if (!tokenClient && !initTokenClient()) return;
      status("מתחבר…");
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
  }
  function disconnect() {
    if (accessToken && window.google) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    fileId = null;
    updateButtons(false);
    status("מנותק");
  }

  /* ---- קריאות Drive עם רענון טוקן אוטומטי ---- */
  async function driveFetch(url, opts, retry) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + accessToken });
    const res = await fetch(url, opts);
    if (res.status === 401 && !retry) {
      const ok = await new Promise((resolve) => {
        onTokenResolve = resolve;
        tokenClient.requestAccessToken({ prompt: "" });
      });
      if (ok) return driveFetch(url, opts, true);
      throw new Error("auth");
    }
    return res;
  }

  async function findFile() {
    const q = encodeURIComponent("name='" + FILE_NAME + "'");
    const url =
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,modifiedTime)&q=" + q;
    const res = await driveFetch(url);
    const data = await res.json();
    fileId = data.files && data.files.length ? data.files[0].id : null;
    return fileId;
  }

  async function downloadFile() {
    if (!fileId) return null;
    const res = await driveFetch("https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media");
    if (!res.ok) return null;
    return res.json();
  }

  async function uploadFile() {
    const content = JSON.stringify(window.getLocalData());
    if (fileId) {
      await driveFetch(
        "https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media",
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: content }
      );
    } else {
      const boundary = "ythub" + Math.random().toString(36).slice(2);
      const metadata = { name: FILE_NAME, parents: ["appDataFolder"] };
      const body =
        "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
        JSON.stringify(metadata) +
        "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" +
        content +
        "\r\n--" + boundary + "--";
      const res = await driveFetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body }
      );
      const data = await res.json();
      fileId = data.id;
    }
  }

  /* ---- סנכרון ראשוני אחרי התחברות ---- */
  async function onConnected() {
    updateButtons(true);
    status("מסנכרן…");
    try {
      await findFile();
      const cloud = fileId ? await downloadFile() : null;
      const localMod = window.getLocalModified();
      const cloudMod = (cloud && cloud.meta && cloud.meta.updatedAt) || 0;
      if (cloud && cloudMod > localMod) {
        window.applyCloudData(cloud, cloudMod); // הענן חדש יותר → מיישם מקומית
        status("✅ סונכרן מהענן");
      } else {
        await uploadFile(); // מקומי חדש יותר או אין קובץ → מעלה
        status("✅ מסונכרן לענן");
      }
    } catch (e) {
      status("⚠️ שגיאת סנכרון: " + (e.message || ""), "err");
    }
  }

  /* ---- סנכרון אוטומטי אחרי כל שינוי (debounced) ---- */
  window.onCloudSync = function () {
    if (!accessToken) return;
    clearTimeout(syncTimer);
    status("שומר בענן…");
    syncTimer = setTimeout(async () => {
      try {
        await uploadFile();
        status("✅ נשמר בענן");
      } catch (e) {
        status("⚠️ העלאה נכשלה", "err");
      }
    }, 1500);
  };

  function manualSync() {
    if (!accessToken) return connect();
    onConnected();
  }

  function updateButtons(connected) {
    const c = $("#btn-drive-connect");
    if (c) c.textContent = connected ? "🔌 התנתק" : "🔗 התחבר עם גוגל";
    const s = $("#btn-drive-sync");
    if (s) s.classList.toggle("hidden", !connected);
  }

  /* ---- אתחול ה-UI ---- */
  function boot() {
    const cidInput = $("#drive-client-id");
    // מציגים רק override מפורש; ברירת המחדל מוטמעת בקוד
    if (cidInput) cidInput.value = localStorage.getItem(CLIENT_ID_KEY) || "";
    const save = $("#btn-drive-save");
    if (save)
      save.addEventListener("click", () => {
        setClientId($("#drive-client-id").value);
        tokenClient = null;
        status(getClientId() ? "המזהה נשמר — לחץ 'התחבר עם גוגל'" : "המזהה נמחק");
      });
    const conn = $("#btn-drive-connect");
    if (conn) conn.addEventListener("click", () => (accessToken ? disconnect() : connect()));
    const sync = $("#btn-drive-sync");
    if (sync) sync.addEventListener("click", manualSync);
    const help = $("#drive-help");
    if (help)
      help.addEventListener("click", (e) => {
        e.preventDefault();
        $("#drive-help-box").classList.toggle("hidden");
      });
    updateButtons(false);
    status("מוכן — לחץ 'התחבר עם גוגל'");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
