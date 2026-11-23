/* ui-lib.js — utilidades de interfaz compartidas */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  C.views = C.views || {};

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const pct = (x, d) => (x == null || isNaN(x) ? '–' : (x * 100).toFixed(d || 0) + '%');
  const num = (x, d) => (x == null || isNaN(x) ? '–' : Number(x).toFixed(d == null ? 0 : d));
  const fmtSec = s => (s == null ? '–' : s >= 60 ? Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's' : s.toFixed(1) + 's');
  const LEVEL = { low: 'Bajo', mid: 'Medio', high: 'Alto', na: 'Sin datos' };
  const SIDE = { w: 'Blancas', b: 'Negras' };
  const PHASE = { opening: 'Apertura', middlegame: 'Medio juego', endgame: 'Final' };

  let toastTimer = null;
  function toast(msg, kind) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show ' + (kind || '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, kind === 'err' ? 7000 : 3500);
  }

  const scoreBar = (score, level) => `<div class="sbar ${level}" title="${score == null ? 'Sin datos suficientes' : 'Puntuación de gravedad 0–100 (más alto = peor)'}"><i style="width:${score == null ? 0 : score}%"></i><b>${score == null ? '—' : score}</b></div>`;
  const wdl = (w, d, l) => { const t = w + d + l; return t ? `<div class="wdl" title="${w} victorias · ${d} tablas · ${l} derrotas"><i class="w" style="flex:${w}"></i><i class="d" style="flex:${d}"></i><i class="l" style="flex:${l}"></i></div>` : '<div class="wdl empty"></div>'; };
  const exLink = (e, text) => `<a href="#" class="exl" data-open="${esc(e.gid)}" data-ply="${e.ply}" title="Abrir la partida en esta jugada">${esc(text || e.san)}</a>`;
  const exList = (arr, withLoss) => (arr || []).map(e => exLink(e) + (withLoss && e.loss != null ? ` <small>−${e.loss}%</small>` : '')).join(' · ');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const empty = (title, text) => `<div class="empty-state"><h3>${esc(title)}</h3><p>${text}</p></div>`;
  const clsDot = c => (c && C.util.CLASS_INFO[c] ? `<i class="dot" style="background:${C.util.CLASS_INFO[c].color}"></i>` : '');

  C.ui = { esc, $, $$, pct, num, fmtSec, LEVEL, SIDE, PHASE, toast, scoreBar, wdl, exLink, exList, debounce, empty, clsDot };
})();
