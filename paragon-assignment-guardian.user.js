// ==UserScript==
// @name         PARAGON Guardian giovcris
// @namespace    roc-mx
// @version      1.1.3
// @description  Paragon SLA guard: Created → Last outbound + visual radar.
// @match        https://paragon-na.amazon.com/*
// @match        https://paragon-rta.amazon.com/*
// @updateURL    https://raw.githubusercontent.com/giovcris411/roc-userscripts/main/paragon-assignment-guardian.user.js
// @downloadURL  https://raw.githubusercontent.com/giovcris411/roc-userscripts/main/paragon-assignment-guardian.user.js
// @grant        GM_addStyle
// @supportURL https://github.com/giovcris411/roc-userscripts
// @author Giovcris ROC
// ==/UserScript==

(() => {
  "use strict";

  /***********************
   * CONFIG
   ***********************/
  const CFG = {
    SLA_MINUTES: 30,
    WARN_MIN: 20,
    CRIT_MIN: 25,

    REFRESH_MS: 7000,

    HEADERS: {
      CASE_ID: ["Case ID", "CaseID", "Case Id"],
      SUBJECT: ["Subject", "Title"],
      CREATED: ["Created", "Create", "Created Date"],
      LAST_OUTBOUND: ["Last outbound", "Last Outbound", "Outbound", "Last response", "Last Response"],
    },

    REQUIRE_TABLE_HINT: true,
    TABLE_HINT_TEXT: "Export Results to CSV",

    // Only new-case notification
    NEW_CASE_NOTIFY: {
      ENABLED: true,
      MAX_PER_RUN: 3, // por si llegan muchos de golpe, evita que te aviente 20 notis
    },

    STORAGE_PREFIX: "paragon_sla_radar_v1_1",
  };

  /***********************
   * CSS
   ***********************/
  GM_addStyle(`
    .slaRadarBox{
      position: sticky;
      top: 0;
      z-index: 9999;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 10px 12px;
      margin: 10px 0;
      font-family: Arial, sans-serif;
      font-size: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,.08);
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    .slaPill{
      border: 1px solid #ddd;
      border-radius: 999px;
      padding: 4px 10px;
      display: inline-flex;
      gap: 6px;
      align-items: center;
      background: #fafafa;
    }
    .slaPill b{font-size: 12px;}
    .slaSmall{opacity:.75}

    tr.sla-ok{ background: rgba(46, 204, 113, .12) !important; }
    tr.sla-warn{ background: rgba(241, 196, 15, .18) !important; }
    tr.sla-crit{ background: rgba(230, 126, 34, .22) !important; }
    tr.sla-dead{ background: rgba(231, 76, 60, .20) !important; }
    .slaBadge{
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #ddd;
      font-size: 11px;
      margin-left: 8px;
      background: #fff;
      white-space: nowrap;
    }
    .slaBadge.dead{ border-color: #e74c3c; }
    .slaBadge.crit{ border-color: #e67e22; }
    .slaBadge.warn{ border-color: #f1c40f; }
    .slaBadge.ok{ border-color: #2ecc71; }
  `);

  /***********************
   * Helpers
   ***********************/
  const now = () => new Date();
  const norm = s => String(s || "").trim().toLowerCase();

  function findHeaderIndex(ths, headerVariants) {
    const variants = headerVariants.map(v => norm(v));
    for (let i = 0; i < ths.length; i++) {
      const text = norm(ths[i].innerText);
      if (variants.includes(text)) return i;
    }
    for (let i = 0; i < ths.length; i++) {
      const text = norm(ths[i].innerText);
      if (variants.some(v => text.includes(v))) return i;
    }
    return -1;
  }

  // "02/23/2026 10:04 am"
  function parseParagonDate(s) {
    const t = String(s || "").trim();
    if (!t) return null;

    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (m) {
      let mm = Number(m[1]);
      let dd = Number(m[2]);
      let yyyy = Number(m[3]);
      let hh = Number(m[4]);
      let mi = Number(m[5]);
      const ap = m[6].toLowerCase();
      if (ap === "pm" && hh !== 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
      return new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
    }

    const d = new Date(t);
    if (!isNaN(d.getTime())) return d;
    return null;
  }

  function minutesBetween(a, b) {
    if (!a || !b) return null;
    return Math.floor((b.getTime() - a.getTime()) / 60000);
  }

  function lsKey(suffix) {
    return `${CFG.STORAGE_PREFIX}:${suffix}`;
  }

  function getState() {
    try { return JSON.parse(localStorage.getItem(lsKey("state")) || "{}"); }
    catch { return {}; }
  }

  function setState(state) {
    localStorage.setItem(lsKey("state"), JSON.stringify(state));
  }

  function notifyNewCase(title, body) {
    if (!CFG.NEW_CASE_NOTIFY.ENABLED) return;
    try {
      if (Notification && Notification.permission === "granted") {
        new Notification(title, { body });
        return;
      }
      if (Notification && Notification.permission !== "denied") {
        Notification.requestPermission().then(p => {
          if (p === "granted") new Notification(title, { body });
        });
        return;
      }
    } catch {}
    console.log("[NEW CASE]", title, body);
  }

  function isProbablyParagonPage() {
    if (!CFG.REQUIRE_TABLE_HINT) return true;
    return document.body && document.body.innerText.includes(CFG.TABLE_HINT_TEXT);
  }

  function findResultsTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    for (const t of tables) {
      const ths = t.querySelectorAll("thead th, th");
      if (!ths.length) continue;
      const texts = Array.from(ths).map(x => norm(x.innerText)).join(" | ");
      if (texts.includes("case id") && texts.includes("created")) return t;
    }
    return null;
  }

  function ensureRadarBox(anchorEl) {
    let box = document.querySelector(".slaRadarBox");
    if (box) return box;

    box = document.createElement("div");
    box.className = "slaRadarBox";
    box.innerHTML = `
      <span class="slaPill"><b>Paragon Assignment Guardian</b></span>
      <span class="slaPill">Pendientes: <b id="slaPend">0</b></span>
      <span class="slaPill">⚠ 20+ min: <b id="slaWarn">0</b></span>
      <span class="slaPill">🔥 25+ min: <b id="slaCrit">0</b></span>
      <span class="slaPill">💀 30+ min: <b id="slaDead">0</b></span>
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

  function process() {
    if (!isProbablyParagonPage()) return;

    const table = findResultsTable();
    if (!table) return;

    const theadThs = Array.from(table.querySelectorAll("thead th"));
    if (!theadThs.length) return;

    const idx = {
      caseId: findHeaderIndex(theadThs, CFG.HEADERS.CASE_ID),
      subject: findHeaderIndex(theadThs, CFG.HEADERS.SUBJECT),
      created: findHeaderIndex(theadThs, CFG.HEADERS.CREATED),
      lastOutbound: findHeaderIndex(theadThs, CFG.HEADERS.LAST_OUTBOUND),
    };
    if (idx.caseId < 0 || idx.created < 0) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    ensureRadarBox(table);

    const state = getState();
    const rows = Array.from(tbody.querySelectorAll("tr"));

    // ---- NEW CASE DETECTION ----
    // guardamos "seen" por caseId
    let newNotified = 0;

    for (const r of rows) {
      const tds = Array.from(r.querySelectorAll("td"));
      if (!tds.length) continue;

      const caseId = (tds[idx.caseId]?.innerText || "").trim();
      if (!caseId) continue;

      if (!state.seen) state.seen = {};
      if (!state.seen[caseId]) {
        state.seen[caseId] = Date.now();

        if (CFG.NEW_CASE_NOTIFY.ENABLED && newNotified < CFG.NEW_CASE_NOTIFY.MAX_PER_RUN) {
          const subj = idx.subject >= 0 ? (tds[idx.subject]?.innerText || "").trim() : "";
          notifyNewCase("Paragon", `${caseId} | ${subj}`.slice(0, 180));
          newNotified++;
        }
      }
    }

    // ---- SLA VISUALS ----
    let pend = 0, warn = 0, crit = 0, dead = 0;

    for (const r of rows) {
      const tds = Array.from(r.querySelectorAll("td"));
      if (!tds.length) continue;

      const caseId = (tds[idx.caseId]?.innerText || "").trim();
      if (!caseId) continue;

      const createdText = (tds[idx.created]?.innerText || "").trim();
      const createdDt = parseParagonDate(createdText);

      const lastOutboundText = idx.lastOutbound >= 0 ? (tds[idx.lastOutbound]?.innerText || "").trim() : "";
      const hasOutbound = !!lastOutboundText;

      r.classList.remove("sla-ok", "sla-warn", "sla-crit", "sla-dead");

      if (hasOutbound) {
        r.classList.add("sla-ok");
        if (idx.subject >= 0) upsertBadge(tds[idx.subject], "ok", "✅");
        continue;
      }

      pend++;

      const elapsed = createdDt ? minutesBetween(createdDt, now()) : null;
      if (elapsed === null) {
        r.classList.add("sla-warn");
        if (idx.subject >= 0) upsertBadge(tds[idx.subject], "warn", "⏱️ Pending (no date parse)");
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
        level === "dead" ? `💀 ${elapsed}m (SLA breached)` :
        level === "crit" ? `🔥 ${elapsed}m (${remaining}m left)` :
        level === "warn" ? `⚠ ${elapsed}m (${remaining}m left)` :
        `⏱ ${elapsed}m (${remaining}m left)`;

      if (idx.subject >= 0) upsertBadge(tds[idx.subject], level === "ok" ? "ok" : level, badgeText);
    }

    // Radar UI update
    const pendEl = document.getElementById("slaPend");
    const warnEl = document.getElementById("slaWarn");
    const critEl = document.getElementById("slaCrit");
    const deadEl = document.getElementById("slaDead");
    if (pendEl) pendEl.textContent = String(pend);
    if (warnEl) warnEl.textContent = String(warn);
    if (critEl) critEl.textContent = String(crit);
    if (deadEl) deadEl.textContent = String(dead);

    setState(state);
  }

  let lastRun = 0;
  function safeRun() {
    const t = Date.now();
    if (t - lastRun < 1500) return;
    lastRun = t;
    try { process(); } catch (e) { console.error("SLA Radar error:", e); }
  }

  setInterval(safeRun, CFG.REFRESH_MS);

  const obs = new MutationObserver(() => safeRun());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  safeRun();
})();
