// ==UserScript==
// @name         SIM Guardian giovcris
// @namespace    roc-mx
// @version      1.6.0
// @description  SIM SLA guard: Etiquetas bajo Short ID solo con contorno y emojis al final.
// @match        https://*.corp.amazon.com/*
// @match        https://t.corp.amazon.com/*
// @updateURL    https://raw.githubusercontent.com/giovcris411/roc-userscripts/main/sim-assignment-guardian.user.js
// @downloadURL  https://raw.githubusercontent.com/giovcris411/roc-userscripts/main/sim-assignment-guardian.user.js
// @grant        GM_addStyle
// @supportURL   https://github.com/giovcris411/roc-userscripts
// @author       Giovcris ROC
// ==/UserScript==

(() => {
  "use strict";

  const CFG = {
    SLA_MINUTES: 15,
    WARN_MIN: 10,
    CRIT_MIN: 13,
    REFRESH_MS: 6000,

    HEADERS: {
      SHORT_ID: ["Short ID", "Short Id", "ShortID", "Ticket", "TT"],
      TITLE: ["Title", "Subject"],
      STATUS: ["Status"],
      ASSIGNEE: ["Assignee", "Owner", "Assigned to"],
      CREATED: ["Created", "Create Date", "Created Date"],
      TYPE: ["Type", "Tipo"]
    },

    TYPE_CLASSIFICATION: {
      "Cancelación de VRID": { name: "ADHOC", css: "adhoc", emoji: "➕🚛" },
      "Caps": { name: "CASES", css: "cases", emoji: "🛠️🏢" },
      "Disrupcion en Ruta": { name: "TRACKEO", css: "trackeo", emoji: "📡📍" },
      "Edicion de VRID": { name: "CASES", css: "cases", emoji: "🛠️🏢" },
      "Metrics": { name: "SCHEDULING", css: "scheduling", emoji: "📅📊" },
      "MM Planning": { name: "SCHEDULING", css: "scheduling", emoji: "📅📊" },
      "Problema en la Carga": { name: "CASES", css: "cases", emoji: "🛠️🏢" },
      "Reactive Scheduling": { name: "ADHOC", css: "adhoc", emoji: "➕🚛" },
      "Solicitud de ETA": { name: "TRACKEO", css: "trackeo", emoji: "📡📍" },
      "Soporte en Yard": { name: "CASES", css: "cases", emoji: "🛠️🏢" },
      "Totes MX": { name: "SCHEDULING", css: "scheduling", emoji: "📅📊" },
      "VRID Adicional": { name: "ADHOC", css: "adhoc", emoji: "➕🚛" }
    },

    STATUS_WIP: "Work In Progress",
    ASSIGNEE_TEAM: "roc-team",

    REQUIRE_TABLE_HINT: false,
    TABLE_HINT_TEXT: "Search results",

    NEW_TT_NOTIFY: { ENABLED: true },

    STORAGE_PREFIX: "sim_assignment_guardian_v1_6",
  };

  GM_addStyle(`
    .slaRadarBox{
      position: sticky; top: 0; z-index: 9999;
      background:#fff; border:1px solid #ddd; border-radius:8px;
      padding:10px 12px; margin:10px 0;
      font-family: Arial, sans-serif; font-size:12px;
      box-shadow:0 2px 12px rgba(0,0,0,.08);
      display:flex; gap:12px; align-items:center; flex-wrap:wrap;
    }
    .slaPill{
      border:1px solid #ddd; border-radius:999px;
      padding:4px 10px; display:inline-flex; gap:6px; align-items:center;
      background:#fafafa;
    }
    .slaPill b{font-size:12px;}
    .slaSmall{opacity:.75}

    tr.sla-ok{ background: rgba(46, 204, 113, .12) !important; }
    tr.sla-warn{ background: rgba(241, 196, 15, .18) !important; }
    tr.sla-crit{ background: rgba(230, 126, 34, .22) !important; }
    tr.sla-dead{ background: rgba(231, 76, 60, .20) !important; }

    .slaBadge{
      display:inline-block; padding:2px 8px; border-radius:999px;
      border:1px solid #ddd; font-size:11px; margin-left:8px;
      background:#fff; white-space:nowrap;
    }
    .slaBadge.dead{ border-color:#e74c3c; }
    .slaBadge.crit{ border-color:#e67e22; }
    .slaBadge.warn{ border-color:#f1c40f; }
    .slaBadge.ok{ border-color:#2ecc71; }

    /* Estilos actualizados: Solo contorno (borde) y texto de color, sin fondo */
    .typeBadge {
      display: block;
      width: max-content;
      margin-top: 6px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      background-color: #ffffff; /* Fondo blanco para que no se mezcle con la fila */
      border: 1.5px solid; /* Grosor del contorno */
    }

    /* Colores aplicados al borde y al texto */
    .typeBadge.adhoc { color: #8e44ad; border-color: #8e44ad; }
    .typeBadge.trackeo { color: #2980b9; border-color: #2980b9; }
    .typeBadge.cases { color: #d35400; border-color: #d35400; }
    .typeBadge.scheduling { color: #2c3e50; border-color: #2c3e50; }
  `);

  const now = () => new Date();
  const norm = s => String(s || "").trim().toLowerCase();

  function findHeaderIndex(ths, variants) {
    const v = variants.map(x => norm(x));
    for (let i = 0; i < ths.length; i++) {
      const t = norm(ths[i].innerText);
      if (v.includes(t)) return i;
    }
    for (let i = 0; i < ths.length; i++) {
      const t = norm(ths[i].innerText);
      if (v.some(x => t.includes(x))) return i;
    }
    return -1;
  }

  function parseSimCreatedDate(s) {
    const t = String(s || "").trim();
    if (!t) return null;

    const cleaned = t.replace(/\(UTC[^\)]*\)/ig, "").trim();

    const m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      const yyyy = Number(m[1]);
      const mm = Number(m[2]);
      const dd = Number(m[3]);
      let hh = Number(m[4]);
      const mi = Number(m[5]);
      const ss = Number(m[6]);
      const ap = m[7].toLowerCase();
      if (ap === "pm" && hh !== 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
      return new Date(yyyy, mm - 1, dd, hh, mi, ss, 0);
    }

    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d;
    return null;
  }

  function minutesBetween(a, b) {
    if (!a || !b) return null;
    return Math.floor((b.getTime() - a.getTime()) / 60000);
  }

  function lsKey(suffix) { return `${CFG.STORAGE_PREFIX}:${suffix}`; }

  function notifyNewTT(title, body) {
    if (!CFG.NEW_TT_NOTIFY.ENABLED) return;
    try {
      if (Notification && Notification.permission === "granted") {
        new Notification(title, { body }); return;
      }
      if (Notification && Notification.permission !== "denied") {
        Notification.requestPermission().then(p => {
          if (p === "granted") new Notification(title, { body });
        });
        return;
      }
    } catch {}
  }

  function isProbablySimPage() {
    if (!CFG.REQUIRE_TABLE_HINT) return true;
    return document.body && document.body.innerText.includes(CFG.TABLE_HINT_TEXT);
  }

  function findTicketsTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    for (const t of tables) {
      const ths = t.querySelectorAll("thead th");
      if (!ths.length) continue;
      const txt = Array.from(ths).map(x => norm(x.innerText)).join(" | ");
      if (txt.includes("short id") && txt.includes("created") && txt.includes("status")) return t;
    }
    return null;
  }

  function ensureRadarBox(anchorEl) {
    let box = document.querySelector(".slaRadarBox");
    if (box) return box;

    box = document.createElement("div");
    box.className = "slaRadarBox";
    box.innerHTML = `
      <span class="slaPill"><b>SIM Assignment Guardian</b></span>
      <span class="slaPill">Pendientes: <b id="simPend">0</b></span>
      <span class="slaPill">⚠ 10+ min: <b id="simWarn">0</b></span>
      <span class="slaPill">🔥 13+ min: <b id="simCrit">0</b></span>
      <span class="slaPill">💀 15+ min: <b id="simDead">0</b></span>
      <span class="slaPill">Target: <b>${CFG.SLA_MINUTES} min</b></span>
    `;
    anchorEl.parentElement?.insertBefore(box, anchorEl);
    return box;
  }

  function upsertBadge(cell, cls, text) {
    if (!cell) return;
    let b = cell.querySelector(".slaBadge");
    if (!b) {
      b = document.createElement("span");
      b.className = "slaBadge";
      cell.appendChild(b);
    }
    b.classList.remove("ok", "warn", "crit", "dead");
    b.classList.add(cls);
    b.textContent = text;
  }

  function upsertClassBadge(cell, classData) {
    if (!cell) return;
    let b = cell.querySelector(".typeBadge");

    if (!classData) {
      if (b) b.remove();
      return;
    }

    if (!b) {
      b = document.createElement("div");
      cell.appendChild(b);
    }
    b.className = `typeBadge ${classData.css}`;
    // Cambiado: Primero el nombre, luego el emoji
    b.textContent = `${classData.name} ${classData.emoji}`;
  }

  function process() {
    if (!isProbablySimPage()) return;

    const table = findTicketsTable();
    if (!table) return;

    const ths = Array.from(table.querySelectorAll("thead th"));
    if (!ths.length) return;

    const idx = {
      shortId: findHeaderIndex(ths, CFG.HEADERS.SHORT_ID),
      title: findHeaderIndex(ths, CFG.HEADERS.TITLE),
      status: findHeaderIndex(ths, CFG.HEADERS.STATUS),
      assignee: findHeaderIndex(ths, CFG.HEADERS.ASSIGNEE),
      created: findHeaderIndex(ths, CFG.HEADERS.CREATED),
      type: findHeaderIndex(ths, CFG.HEADERS.TYPE),
    };

    if (idx.shortId < 0 || idx.created < 0 || idx.status < 0 || idx.assignee < 0) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    ensureRadarBox(table);

    const rows = Array.from(tbody.querySelectorAll("tr"));

    if (CFG.NEW_TT_NOTIFY.ENABLED && rows.length > 0) {
      const firstRow = rows[0];
      const tds = Array.from(firstRow.querySelectorAll("td"));
      if (tds.length) {
        const shortId = (tds[idx.shortId]?.innerText || "").trim().split('\n')[0];
        const title = idx.title >= 0 ? (tds[idx.title]?.innerText || "").trim() : "";
        const lastNotifiedId = localStorage.getItem(lsKey("lastNotifiedTop"));

        if (shortId && shortId !== lastNotifiedId) {
          localStorage.setItem(lsKey("lastNotifiedTop"), shortId);
          notifyNewTT("SIM TT", `${shortId} | ${title}`.slice(0, 180));
        }
      }
    }

    let pend = 0, warn = 0, crit = 0, dead = 0;

    for (const r of rows) {
      const tds = Array.from(r.querySelectorAll("td"));
      if (!tds.length) continue;

      const shortIdRaw = (tds[idx.shortId]?.innerText || "").trim();
      const shortId = shortIdRaw.split('\n')[0];
      if (!shortId) continue;

      const status = (tds[idx.status]?.innerText || "").trim();
      const assignee = (tds[idx.assignee]?.innerText || "").trim();
      const createdText = (tds[idx.created]?.innerText || "").trim();
      const createdDt = parseSimCreatedDate(createdText);

      const typeText = idx.type >= 0 ? (tds[idx.type]?.innerText || "").trim() : "";
      let matchedClass = null;

      if (typeText) {
        const typeLower = typeText.toLowerCase();
        for (const [key, value] of Object.entries(CFG.TYPE_CLASSIFICATION)) {
          if (typeLower.includes(key.toLowerCase())) {
            matchedClass = value;
            break;
          }
        }
      }

      upsertClassBadge(tds[idx.shortId], matchedClass);

      r.classList.remove("sla-ok", "sla-warn", "sla-crit", "sla-dead");

      const isWip = status === CFG.STATUS_WIP;
      const isTeam = norm(assignee) === norm(CFG.ASSIGNEE_TEAM);

      const needsStatus = !isWip;
      const needsLogin = isTeam;
      const pending = needsStatus || needsLogin;

      let needLabel = "";
      if (needsStatus && needsLogin) needLabel = "Need Action";
      else if (needsStatus) needLabel = "Need Status";
      else if (needsLogin) needLabel = "Need Login";

      if (!pending) {
        r.classList.add("sla-ok");
        if (idx.title >= 0) upsertBadge(tds[idx.title], "ok", "✅");
        continue;
      }

      pend++;

      const elapsed = createdDt ? minutesBetween(createdDt, now()) : null;
      if (elapsed === null) {
        r.classList.add("sla-warn");
        if (idx.title >= 0) upsertBadge(tds[idx.title], "warn", `⏱️ ${needLabel} (date parse issue)`);
        continue;
      }

      let level = "ok";
      if (elapsed >= CFG.SLA_MINUTES) level = "dead";
      else if (elapsed >= CFG.CRIT_MIN) level = "crit";
      else if (elapsed >= CFG.WARN_MIN) level = "warn";

      if (level === "warn") { r.classList.add("sla-warn"); warn++; }
      else if (level === "crit") { r.classList.add("sla-crit"); crit++; }
      else if (level === "dead") { r.classList.add("sla-dead"); dead++; }
      else { r.classList.add("sla-ok"); }

      const remaining = CFG.SLA_MINUTES - elapsed;

      const badgeText =
        level === "dead" ? `💀 ${elapsed}m (BREACH) | ${needLabel}` :
        level === "crit" ? `🔥 ${elapsed}m (${remaining}m left) | ${needLabel}` :
        level === "warn" ? `⚠ ${elapsed}m (${remaining}m left) | ${needLabel}` :
        `⏱ ${elapsed}m (${remaining}m left) | ${needLabel}`;

      if (idx.title >= 0) upsertBadge(tds[idx.title], level === "ok" ? "ok" : level, badgeText);
    }

    const pendEl = document.getElementById("simPend");
    const warnEl = document.getElementById("simWarn");
    const critEl = document.getElementById("simCrit");
    const deadEl = document.getElementById("simDead");
    if (pendEl) pendEl.textContent = String(pend);
    if (warnEl) warnEl.textContent = String(warn);
    if (critEl) critEl.textContent = String(crit);
    if (deadEl) deadEl.textContent = String(dead);
  }

  let lastRun = 0;
  function safeRun() {
    const t = Date.now();
    if (t - lastRun < 1500) return;
    lastRun = t;
    try { process(); } catch (e) { console.error("SIM Guardian error:", e); }
  }

  setInterval(safeRun, CFG.REFRESH_MS);

  const obs = new MutationObserver(() => safeRun());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  safeRun();
})();
