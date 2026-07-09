// ==UserScript==
// @name         SIM Guardian giovcris (V8.4.1 Link Fix)
// @namespace    roc-mx
// @version      8.6.0
// @description  SIM SLA guard. Reparación de enlaces azules (Short ID/Title), omisión de bots y candado anti-trabado.
// @match        https://*.corp.amazon.com/*
// @match        https://t.corp.amazon.com/*
// @updateURL    https://raw.githubusercontent.com/giovcris411/roc-userscripts/main/sim-assignment-guardian.user.js
// @downloadURL  https://raw.githubusercontent.com/giovcris411/roc-userscripts/main/sim-assignment-guardian.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      sim-ticketing-graphql-fleet.corp.amazon.com
// @supportURL   https://github.com/giovcris411/roc-userscripts
// @author       Giovcris ROC
// ==/UserScript==

(() => {
  "use strict";

  const LBL = {
    ADHOC: { name: "ADHOC", css: "adhoc", emoji: "➕🚛" },
    CASES: { name: "CASES", css: "cases", emoji: "🛠️🏢" },
    TRACKEO: { name: "TRACKEO", css: "trackeo", emoji: "📡📍" },
    SCHEDULING: { name: "SCHEDULING", css: "scheduling", emoji: "📅📊" }
  };

  const CFG = {
    SLA_MINUTES: 15,
    WARN_MIN: 10,
    CRIT_MIN: 13,
    REFRESH_MS: 6000,
    RELIEF_THRESHOLD: 1000,
    AUTO_REPLY_TEXT: "Buen dia team!!\n\nEnseguida se trabaja su solicitud",

    // 🔴 Aquí ignoramos a tu usuario para que no te genere alerta a ti mismo.
    IGNORE_AUTHORS: ["giovcris", "system", "arn:aws", "SnowEngine", "apex_pddr", "AutomationRules", "antohfr", "ajorgena", "pimentdp", "eemanuep", "andretoz", "albehug", "jazmirai", "huemitzi", "flobofer", "alandeg", "jumendoj", "radaigon", "rosaareg", "tanvmi", "angelch", "aripm", "camoch", "dakruizg", "diadoran", "carbauti", "julioczj", "rosamueh", "zargilbe", "breavile", "jakeven", "alducin", "lopenaye", "jojega", "israsty", "gonbrenz", "lgarcleo", "meraalma"],

    HEADERS: {
      SHORT_ID: ["Short ID", "Short Id", "ShortID", "Ticket", "TT"],
      TITLE: ["Title", "Subject"],
      STATUS: ["Status"],
      ASSIGNEE: ["Assignee", "Owner", "Assigned to"],
      CREATED: ["Created", "Create Date", "Created Date"],
      TYPE: ["Type", "Tipo"],
      ITEM: ["Item", "Articulo", "Ítem"],
      LAST_UPDATED: ["Last Updated", "Last Comment Date", "Last Modified"]
    },

    TYPE_CLASSIFICATION: {
      "Cancelación de VRID": { "All": LBL.ADHOC, "Error en configuraciones": LBL.ADHOC, "Volumen insuficiente": LBL.ADHOC },
      "Caps": { "All": LBL.CASES, "Tactical Cap Adjustment": LBL.CASES },
      "Disrupcion en Ruta": { "All": LBL.TRACKEO, "Accidente en Ruta": LBL.TRACKEO, "Evento de Fuerza Mayor": LBL.TRACKEO, "Manifestantes": LBL.TRACKEO, "Trafico": LBL.TRACKEO },
      "Edicion de VRID": { "All": LBL.CASES, "Cambio de capacidad": LBL.ADHOC, "Corrección de ruta": LBL.CASES, "CPT Incorrecto": LBL.CASES, "Registro en Dock Master": LBL.CASES, "Transit Time Incorrecto": LBL.CASES },
      "Metrics": { "All": LBL.SCHEDULING, "Modificacion de LTR": LBL.CASES },
      "MM Planning": { "All": LBL.SCHEDULING, "CRets": LBL.SCHEDULING, "EF/ES Plan": LBL.SCHEDULING, "MM First Leg Plan": LBL.SCHEDULING, "MM Second Leg Plan": LBL.SCHEDULING, "WHT Planning": LBL.SCHEDULING },
      "Problema en la Carga": { "All": LBL.CASES, "MNR/RNM": LBL.CASES, "No es Posible Descargar la mercancia": LBL.CASES, "Paquetes Missorts": LBL.CASES },
      "Reactive Scheduling": { "All": LBL.ADHOC, "Ad Hoc": LBL.ADHOC, "Hard Cancellations": LBL.ADHOC, "Soft Cancellations": LBL.CASES },
      "Solicitud de ETA": { "All": LBL.TRACKEO, "ETA para Arrival": LBL.TRACKEO, "ETA para Departure": LBL.CASES, "ETA para Pick-Up": LBL.TRACKEO },
      "Soporte en Yard": { "All": LBL.CASES, "Call Out para el Carrier": LBL.CASES, "Colisión en el Yard": LBL.CASES, "Daño al Site": LBL.CASES, "Problema con CCP": LBL.CASES, "Truck Rechazado": LBL.CASES, "WePay": LBL.CASES },
      "Totes MX": { "All": LBL.CASES, "Ad Hoc": LBL.ADHOC, "Cancelacion de VRID": LBL.ADHOC, "Programacion de Viaje Nacional": LBL.SCHEDULING },
      "VRID Adicional": { "All": LBL.ADHOC, "Ad hoc": LBL.ADHOC, "Direct Imports": LBL.CASES, "Easy Ship": LBL.CASES, "VRID Dummy": LBL.CASES, "WePay": LBL.CASES }
    },

    STATUS_WIP: "Work In Progress",
    ASSIGNEE_TEAM: "roc-team",
    REQUIRE_TABLE_HINT: false,
    TABLE_HINT_TEXT: "Search results",
    STORAGE_PREFIX: "sim_guardian_v84",
  };

  const UPDATES_STORAGE_KEY = `${CFG.STORAGE_PREFIX}_author_memory`;
  const activeRequests = new Set();

  GM_addStyle(`
    .slaRadarBox{ background:#fff; border:1px solid #ddd; border-radius:8px; padding:10px 12px; margin-bottom:15px; font-family: Arial, sans-serif; font-size:12px; box-shadow:0 2px 12px rgba(0,0,0,.08); display:flex; gap:12px; align-items:center; flex-wrap:wrap; position: relative; }
    .slaPill{ border:1px solid #ddd; border-radius:999px; padding:4px 10px; display:inline-flex; gap:6px; align-items:center; background:#fafafa; }
    .slaPill b{font-size:12px;}
    .slaSmall{opacity:.75}

    tr.sla-ok{ background: rgba(46, 204, 113, .12) !important; }
    tr.sla-warn{ background: rgba(241, 196, 15, .18) !important; }
    tr.sla-crit{ background: rgba(230, 126, 34, .22) !important; }
    tr.sla-dead{ background: rgba(231, 76, 60, .20) !important; }
    tr.row-updated{ background: rgba(142, 68, 173, 0.15) !important; }

    .slaBadge{ display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid #ddd; font-size:11px; margin-left:8px; background:#fff; white-space:nowrap; }
    .slaBadge.dead{ border-color:#e74c3c; }
    .slaBadge.crit{ border-color:#e67e22; }
    .slaBadge.warn{ border-color:#f1c40f; }
    .slaBadge.ok{ border-color:#2ecc71; }

    .slaBadge.update-alert { background-color: #8e44ad; color: white; border-color: #732d91; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(142, 68, 173, 0.4); transition: all 0.2s ease; animation: bounceUpdate 2s infinite; }
    .slaBadge.update-alert:hover { background-color: #732d91; transform: scale(1.05); }
    @keyframes bounceUpdate { 0%, 20%, 50%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-3px); } 60% { transform: translateY(-1px); } }

    .typeBadge { display: block; width: max-content; margin-top: 6px; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; text-transform: uppercase; background-color: #ffffff; border: 1.5px solid; }
    .typeBadge.adhoc { color: #8e44ad; border-color: #8e44ad; }
    .typeBadge.trackeo { color: #2980b9; border-color: #2980b9; }
    .typeBadge.cases { color: #d35400; border-color: #d35400; }
    .typeBadge.scheduling { color: #2c3e50; border-color: #2c3e50; }

    table.sim-guardian-table { border-collapse: separate !important; border-spacing: 0 5px !important; }
    tr[class*="row-"] td:first-child { border-top-left-radius: 10px !important; border-bottom-left-radius: 10px !important; }
    tr[class*="row-"] td:last-child { border-top-right-radius: 10px !important; border-bottom-right-radius: 10px !important; }

    tr.row-adhoc td { border-top: 1.5px solid #8e44ad !important; border-bottom: 1.5px solid #8e44ad !important; }
    tr.row-adhoc td:first-child { border-left: 5px solid #8e44ad !important; }
    tr.row-adhoc td:last-child { border-right: 1.5px solid #8e44ad !important; }

    tr.row-trackeo td { border-top: 1.5px solid #2980b9 !important; border-bottom: 1.5px solid #2980b9 !important; }
    tr.row-trackeo td:first-child { border-left: 5px solid #2980b9 !important; }
    tr.row-trackeo td:last-child { border-right: 1.5px solid #2980b9 !important; }

    tr.row-cases td { border-top: 1.5px solid #d35400 !important; border-bottom: 1.5px solid #d35400 !important; }
    tr.row-cases td:first-child { border-left: 5px solid #d35400 !important; }
    tr.row-cases td:last-child { border-right: 1.5px solid #d35400 !important; }

    tr.row-scheduling td { border-top: 1.5px solid #2c3e50 !important; border-bottom: 1.5px solid #2c3e50 !important; }
    tr.row-scheduling td:first-child { border-left: 5px solid #2c3e50 !important; }
    tr.row-scheduling td:last-child { border-right: 1.5px solid #2c3e50 !important; }

    tr[class*="row-"]:hover td { background-color: rgba(0, 0, 0, 0.04) !important; }

    .btn-auto-triage { position: absolute; right: 15px; top: 50%; transform: translateY(-50%); padding: 6px 12px; background-color: #2980b9; color: white !important; font-weight: bold; border: none; border-radius: 6px; font-size: 11px; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: all 0.2s; z-index: 10; }
    .btn-auto-triage:hover { background-color: #1abc9c; transform: translateY(-50%) scale(1.05); }
    .btn-auto-triage.disabled { background-color: #bdc3c7 !important; color: #7f8c8d !important; cursor: not-allowed !important; box-shadow: none !important; transform: translateY(-50%) !important; }
  `);

  const now = () => new Date();
  const norm = s => String(s || "").trim().toLowerCase();

  function graphqlFetch(operationName, query, variables, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const csrfToken = document.cookie.match(/anti-csrftoken-a2z=([^;]+)/)?.[1] || "";
      const endpoint = "https://sim-ticketing-graphql-fleet.corp.amazon.com/graphql";
      const timer = setTimeout(() => reject(new Error("Timeout")), timeout);

      GM_xmlhttpRequest({
        method: "POST", url: endpoint, withCredentials: true,
        headers: { "Content-Type": "application/json", "Accept": "application/json", "anti-csrftoken-a2z": csrfToken, "Origin": window.location.origin, "Referer": window.location.href },
        data: JSON.stringify({ operationName, query, variables }),
        onload: (response) => {
          clearTimeout(timer);
          if (response.status >= 200 && response.status < 300) {
            try { const json = JSON.parse(response.responseText); if (json.errors) reject(new Error(json.errors[0].message)); else resolve(json.data); } catch (e) { reject(new Error("Error parse JSON")); }
          } else { reject(new Error(`HTTP Error: ${response.status}`)); }
        },
        onerror: (err) => { clearTimeout(timer); reject(err); }
      });
    });
  }

  async function fetchLatestAuthor(shortId) {
      if (activeRequests.has(shortId)) return;
      activeRequests.add(shortId);

      let mem = JSON.parse(localStorage.getItem(UPDATES_STORAGE_KEY) || "{}");

      if (mem[shortId] && !mem[shortId].alertText) {
          mem[shortId].alertText = "⏳ Revisando...";
          localStorage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(mem));
      }

      try {
          const issueData = await graphqlFetch("IssueOverview", "query IssueOverview($issueId: String!) { issue(id: $issueId) { id } }", { issueId: shortId });
          const uuid = issueData?.issue?.id;

          if (uuid) {
              const threadData = await graphqlFetch("ThreadComments", "query ThreadComments($threadId: String!, $start: Int, $rows: Int, $sort: CommentSortOrder) { thread(id: $threadId) { conversation(start: $start, rows: $rows, sort: $sort) { ... on Comment { id author { name } } } } }", { threadId: `updates:${uuid}`, start: 0, rows: 5, sort: "newest_first" });
              const conversation = threadData?.thread?.conversation || [];

              let realAuthor = null;
              const BOTS = ["system", "arn:aws", "snowengine", "apex_pddr", "automationrules", "awseb-e-session"];

              for (const c of conversation) {
                  const rawName = c.author?.name || "";
                  const isBot = BOTS.some(bot => norm(rawName).includes(bot));
                  if (!isBot) {
                      realAuthor = rawName;
                      break;
                  }
              }

              if (realAuthor) {
                  mem = JSON.parse(localStorage.getItem(UPDATES_STORAGE_KEY) || "{}");
                  const isIgnored = CFG.IGNORE_AUTHORS.some(alias => norm(realAuthor).includes(norm(alias)));

                  if (!isIgnored) {
                      let displayAuthor = realAuthor;
                      if (displayAuthor.includes("/")) displayAuthor = displayAuthor.split("/").pop();
                      if (displayAuthor.includes("@")) displayAuthor = displayAuthor.split("@")[0];
                      if (displayAuthor.length > 15) displayAuthor = displayAuthor.substring(0, 15) + "..";

                      if (mem[shortId]) mem[shortId].alertText = `💬 ${displayAuthor} contestó`;
                  } else {
                      if (mem[shortId]) mem[shortId].alertText = "";
                  }
                  localStorage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(mem));
              } else {
                  mem = JSON.parse(localStorage.getItem(UPDATES_STORAGE_KEY) || "{}");
                  if (mem[shortId]) mem[shortId].alertText = "";
                  localStorage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(mem));
              }
          }
      } catch (e) {
          mem = JSON.parse(localStorage.getItem(UPDATES_STORAGE_KEY) || "{}");
          if (mem[shortId] && mem[shortId].alertText === "⏳ Revisando...") {
              mem[shortId].alertText = "";
              localStorage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(mem));
          }
      } finally {
          activeRequests.delete(shortId);
          safeRun();
      }
  }

  async function performAutoTriage(btn, shortId) {
    btn.textContent = "⏳ Conectando..."; btn.style.backgroundColor = "#f39c12"; btn.style.pointerEvents = "none";
    try {
      const assignData = await graphqlFetch("assignIssue", "mutation assignIssue($issueId: String!, $assignee: String!) { assignIssue(issueId: $issueId, assignee: $assignee) { id } }", { issueId: shortId, assignee: "me" });
      const uuid = assignData.assignIssue.id;
      if (!uuid) throw new Error("No UUID");
      btn.textContent = "⏳ Estatus...";
      await graphqlFetch("changeIssueStatus", "mutation changeIssueStatus($args: EditIssueInput!) { editIssue(args: $args) { id } }", { args: { issueId: uuid, status: "Work In Progress" } });
      btn.textContent = "⏳ Comentando...";
      await graphqlFetch("createCommentOnThread", "mutation createCommentOnThread($args: CommentInput!) { createCommentGetComment(args: $args) { id } }", { args: { contentType: "text/plain", mentions: [], message: CFG.AUTO_REPLY_TEXT, threadId: `updates:${uuid}` } });

      btn.textContent = "✅ Realizado!"; btn.style.backgroundColor = "#2ecc71";
    } catch (error) {
      console.error("Error Auto-Triage:", error); btn.textContent = "❌ Error API"; btn.style.backgroundColor = "#e74c3c"; btn.style.pointerEvents = "auto";
    }
  }

  function findHeaderIndex(ths, variants) {
    const v = variants.map(x => norm(x));
    for (let i = 0; i < ths.length; i++) { const t = norm(ths[i].innerText); if (v.includes(t)) return i; }
    for (let i = 0; i < ths.length; i++) { const t = norm(ths[i].innerText); if (v.some(x => t.includes(x))) return i; }
    return -1;
  }

  function parseSimCreatedDate(s) {
    const t = String(s || "").trim();
    if (!t) return null;
    const cleaned = t.replace(/\(UTC[^\)]*\)/ig, "").trim();
    const m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      const yyyy = Number(m[1]), mm = Number(m[2]), dd = Number(m[3]);
      let hh = Number(m[4]);
      const mi = Number(m[5]), ss = Number(m[6]), ap = m[7].toLowerCase();
      if (ap === "pm" && hh !== 12) hh += 12;
      if (ap === "am" && hh === 12) hh = 0;
      return new Date(yyyy, mm - 1, dd, hh, mi, ss, 0);
    }
    const d = new Date(cleaned); if (!isNaN(d.getTime())) return d; return null;
  }

  function minutesBetween(a, b) { if (!a || !b) return null; return Math.floor((b.getTime() - a.getTime()) / 60000); }
  function isProbablySimPage() { if (!CFG.REQUIRE_TABLE_HINT) return true; return document.body && document.body.innerText.includes(CFG.TABLE_HINT_TEXT); }

  function findTicketsTable() {
    const tables = Array.from(document.querySelectorAll("table"));
    for (const t of tables) {
      const ths = t.querySelectorAll("thead th"); if (!ths.length) continue;
      const txt = Array.from(ths).map(x => norm(x.innerText)).join(" | ");
      if (txt.includes("short id") && txt.includes("created") && txt.includes("status")) return t;
    } return null;
  }

  function ensureRadarBox(anchorEl) {
    let box = document.querySelector(".slaRadarBox");
    if (box) return box;
    box = document.createElement("div"); box.className = "slaRadarBox";
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
    let b = cell.querySelector(".slaBadge:not(.update-alert)");
    if (!b) { b = document.createElement("span"); b.className = "slaBadge"; cell.appendChild(b); }
    b.classList.remove("ok", "warn", "crit", "dead"); b.classList.add(cls); b.textContent = text;
  }

  function upsertClassBadge(cell, classData) {
    if (!cell) return; let b = cell.querySelector(".typeBadge");
    if (!classData) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); cell.appendChild(b); }
    b.className = `typeBadge ${classData.css}`; b.textContent = `${classData.name} ${classData.emoji}`;
  }

  function injectTriageButton(cell, shortId, isDisabled) {
    if (!cell) return; let btn = cell.querySelector(".btn-auto-triage");
    if (!btn) { btn = document.createElement("button"); btn.className = "btn-auto-triage"; cell.appendChild(btn); }
    if (isDisabled) {
      btn.classList.add("disabled"); btn.innerHTML = "🔒 Bloqueado"; btn.title = "Válvula cerrada.";
      btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); };
    } else {
      btn.classList.remove("disabled"); btn.innerHTML = "⚡ Tomar TT"; btn.title = "¡Válvula operativa!";
      btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); performAutoTriage(btn, shortId); };
    }
  }

  function removeTriageButton(cell) { if (!cell) return; let btn = cell.querySelector(".btn-auto-triage"); if (btn) btn.remove(); }

  function getOfficialSimTicketCount() {
    const elements = Array.from(document.querySelectorAll('h2, span, div, b, th, td'));
    for (const el of elements) {
      if (el.children.length === 0 && el.innerText && el.innerText.includes("Tickets (")) {
        const match = el.innerText.match(/Tickets\s*\((\d+)\)/i); if (match) return parseInt(match[1], 10);
      }
    } return null;
  }

  function process() {
    if (!isProbablySimPage()) return;
    const table = findTicketsTable(); if (!table) return;
    table.classList.add("sim-guardian-table");
    const ths = Array.from(table.querySelectorAll("thead th")); if (!ths.length) return;

    const idx = {
      shortId: findHeaderIndex(ths, CFG.HEADERS.SHORT_ID), title: findHeaderIndex(ths, CFG.HEADERS.TITLE),
      status: findHeaderIndex(ths, CFG.HEADERS.STATUS), assignee: findHeaderIndex(ths, CFG.HEADERS.ASSIGNEE),
      created: findHeaderIndex(ths, CFG.HEADERS.CREATED), type: findHeaderIndex(ths, CFG.HEADERS.TYPE),
      item: findHeaderIndex(ths, CFG.HEADERS.ITEM),
      lastUpdated: findHeaderIndex(ths, CFG.HEADERS.LAST_UPDATED)
    };

    if (idx.shortId < 0 || idx.created < 0 || idx.status < 0 || idx.assignee < 0) return;
    const tbody = table.querySelector("tbody"); if (!tbody) return;

    ensureRadarBox(table);
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const totalOficialSIM = getOfficialSimTicketCount();
    const conteoFinalParaValvula = totalOficialSIM !== null ? totalOficialSIM : rows.length;
    const esValvulaAbierta = conteoFinalParaValvula >= CFG.RELIEF_THRESHOLD;

    let ticketsMemory = JSON.parse(localStorage.getItem(UPDATES_STORAGE_KEY) || "{}");
    let pend = 0, warn = 0, crit = 0, dead = 0;

    // 🔥 LÓGICA DE BORRADO SEGURA (Anti-Ghost Click con Link Fix) 🔥
    const resetAlert = (e) => {
        if (e && e.target.tagName === 'BUTTON') return;

        // ¡LA MAGIA REPARADA!
        // Solo bloqueamos si le diste clic DIRECTAMENTE a la etiqueta morada.
        // Si tocaste el enlace azul, el navegador lo abrirá sin problemas.
        if (e && e.target.classList.contains("update-alert")) {
            e.preventDefault();
            e.stopPropagation();
        }

        const clickedRow = e.target.closest("tr");
        if (!clickedRow) return;

        const tds = clickedRow.querySelectorAll("td");
        const currentShortId = tds[idx.shortId]?.innerText.split('\n')[0].trim();
        const currentLastUpdated = tds[idx.lastUpdated]?.innerText.trim();

        if (currentShortId && currentLastUpdated) {
            let freshMem = JSON.parse(localStorage.getItem(UPDATES_STORAGE_KEY) || "{}");
            if (freshMem[currentShortId]) {
                freshMem[currentShortId].knownDate = currentLastUpdated;
                freshMem[currentShortId].alertText = "";
                localStorage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(freshMem));
            }
            clickedRow.classList.remove("row-updated");
            let badge = clickedRow.querySelector(".update-alert");
            if (badge) badge.remove();
        }
    };

    for (const r of rows) {
      const tds = Array.from(r.querySelectorAll("td")); if (!tds.length) continue;
      const shortIdRaw = (tds[idx.shortId]?.innerText || "").trim();
      const shortId = shortIdRaw.split('\n')[0]; if (!shortId) continue;
      removeTriageButton(tds[idx.shortId]);

      const status = (tds[idx.status]?.innerText || "").trim();
      const assignee = (tds[idx.assignee]?.innerText || "").trim();
      const createdText = (tds[idx.created]?.innerText || "").trim();
      const createdDt = parseSimCreatedDate(createdText);
      const typeText = idx.type >= 0 ? (tds[idx.type]?.innerText || "").trim() : "";
      const itemText = idx.item >= 0 ? (tds[idx.item]?.innerText || "").trim() : "";
      const lastUpdatedText = idx.lastUpdated >= 0 ? (tds[idx.lastUpdated]?.innerText || "").trim() : "";

      if (lastUpdatedText && shortId) {
          if (!ticketsMemory[shortId]) {
              ticketsMemory[shortId] = { knownDate: lastUpdatedText, alertText: "" };
          }
          else if (ticketsMemory[shortId].knownDate !== lastUpdatedText) {
              ticketsMemory[shortId].knownDate = lastUpdatedText;
              localStorage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(ticketsMemory));
              fetchLatestAuthor(shortId);
          }
      }

      if (idx.shortId >= 0 && !tds[idx.shortId].dataset.guardianBound) {
          tds[idx.shortId].dataset.guardianBound = "true";
          tds[idx.shortId].addEventListener("click", resetAlert);
      }

      if (idx.title >= 0 && !tds[idx.title].dataset.guardianBound) {
          tds[idx.title].dataset.guardianBound = "true";
          tds[idx.title].addEventListener("click", resetAlert);
      }

      let matchedClass = null;
      if (typeText) {
        const typeLower = typeText.toLowerCase(); const itemLower = itemText.toLowerCase();
        for (const [typeKey, itemMap] of Object.entries(CFG.TYPE_CLASSIFICATION)) {
          if (typeLower.includes(typeKey.toLowerCase())) {
            for (const [itemKey, classData] of Object.entries(itemMap)) {
              if (itemKey.toLowerCase() !== "all" && itemText && itemLower.includes(itemKey.toLowerCase())) { matchedClass = classData; break; }
            }
            if (!matchedClass && itemMap.All) matchedClass = itemMap.All; break;
          }
        }
      }

      upsertClassBadge(tds[idx.shortId], matchedClass);

      const alertText = ticketsMemory[shortId]?.alertText || "";

      r.classList.remove("sla-ok", "sla-warn", "sla-crit", "sla-dead", "row-updated");
      r.classList.remove("row-adhoc", "row-cases", "row-trackeo", "row-scheduling");

      if (matchedClass) r.classList.add(`row-${matchedClass.css}`);

      const isWip = status === CFG.STATUS_WIP;
      const isTeam = norm(assignee) === norm(CFG.ASSIGNEE_TEAM);
      const needsStatus = !isWip; const needsLogin = isTeam;
      const pending = needsStatus || needsLogin;
      let needLabel = "";
      if (needsStatus && needsLogin) needLabel = "Need Action"; else if (needsStatus) needLabel = "Need Status"; else if (needsLogin) needLabel = "Need Login";

      if (alertText) {
          r.classList.add("row-updated");
          if (idx.title >= 0) {
              let badge = tds[idx.title].querySelector(".update-alert");
              if (!badge) {
                  badge = document.createElement("span");
                  badge.className = "slaBadge update-alert";
                  badge.addEventListener("click", resetAlert);
                  tds[idx.title].appendChild(badge);
              }
              badge.textContent = alertText;

              if (pending) {
                  const elapsed = createdDt ? minutesBetween(createdDt, now()) : 0;
                  upsertBadge(tds[idx.title], "warn", `⏱️ ${elapsed}m | ${needLabel}`);
                  pend++;
              }
          }
          continue;
      } else {
          let badge = idx.title >= 0 ? tds[idx.title].querySelector(".update-alert") : null;
          if (badge) badge.remove();
      }

      if (!pending) {
        r.classList.add("sla-ok");
        if (idx.title >= 0) {
            upsertBadge(tds[idx.title], "ok", "✅");
            removeTriageButton(tds[idx.title]);
        }
        continue;
      }

      if (idx.title >= 0) { tds[idx.title].style.position = "relative"; tds[idx.title].style.paddingRight = "100px"; injectTriageButton(tds[idx.title], shortId, !esValvulaAbierta); }
      pend++;

      const elapsed = createdDt ? minutesBetween(createdDt, now()) : null;
      if (elapsed === null) {
        r.classList.add("sla-warn"); if (idx.title >= 0) upsertBadge(tds[idx.title], "warn", `⏱️ ${needLabel}`); continue;
      }

      let level = "ok";
      if (elapsed >= CFG.SLA_MINUTES) level = "dead"; else if (elapsed >= CFG.CRIT_MIN) level = "crit"; else if (elapsed >= CFG.WARN_MIN) level = "warn";

      if (level === "warn") { r.classList.add("sla-warn"); warn++; }
      else if (level === "crit") { r.classList.add("sla-crit"); crit++; }
      else if (level === "dead") { r.classList.add("sla-dead"); dead++; }
      else { r.classList.add("sla-ok"); }

      const remaining = CFG.SLA_MINUTES - elapsed;
      const badgeText = level === "dead" ? `💀 ${elapsed}m (BREACH) | ${needLabel}` : level === "crit" ? `🔥 ${elapsed}m (${remaining}m left) | ${needLabel}` : level === "warn" ? `⚠ ${elapsed}m (${remaining}m left) | ${needLabel}` : `⏱ ${elapsed}m (${remaining}m left) | ${needLabel}`;
      if (idx.title >= 0) {
          upsertBadge(tds[idx.title], level === "ok" ? "ok" : level, badgeText);
      }
    }

    localStorage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(ticketsMemory));

    const pendEl = document.getElementById("simPend"); const warnEl = document.getElementById("simWarn"); const critEl = document.getElementById("simCrit"); const deadEl = document.getElementById("simDead");
    if (pendEl) pendEl.textContent = String(pend); if (warnEl) warnEl.textContent = String(warn); if (critEl) critEl.textContent = String(crit); if (deadEl) deadEl.textContent = String(dead);
  }

  let lastRun = 0;
  function safeRun() {
    const t = Date.now(); if (t - lastRun < 1500) return; lastRun = t;
    try { process(); } catch (e) { console.error("SIM Guardian error:", e); }
  }

  setInterval(safeRun, CFG.REFRESH_MS);
  const obs = new MutationObserver(() => safeRun()); obs.observe(document.documentElement, { childList: true, subtree: true }); safeRun();
})();
