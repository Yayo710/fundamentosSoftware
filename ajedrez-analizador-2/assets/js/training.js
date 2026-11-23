/* training.js — entrenador: ejercicios generados de tus propios errores, evaluación contra Stockfish,
 * repetición espaciada (cajas de Leitner) y medición del progreso. */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});

  const DAY = 86400000;
  const INTERVALS = [0, 1, 3, 7, 21];            // días hasta repetir, según la caja (0–4)
  const MAX_BOX = INTERVALS.length - 1;

  const emptyState = () => ({ v: 1, items: {}, log: [] });

  /** Añade al estado los ejercicios nuevos de las partidas analizadas (no pisa el progreso existente). */
  function sync(state, games, profile) {
    state = state && state.items ? state : emptyState();
    let added = 0;
    for (const g of games || []) {
      const side = C.coach.sideOf(g, profile);
      if (!side || !g.derived || !g.derived.exercises) continue;
      for (const e of g.derived.exercises) {
        if (e.c !== side) continue;
        const key = e.key;
        if (state.items[key]) { state.items[key].gids = Array.from(new Set((state.items[key].gids || []).concat(g.id))); continue; }
        state.items[key] = {
          key, fen: e.fen, c: e.c, played: e.played, playedSan: e.playedSan, best: e.best, bestSan: e.bestSan, pv: e.pv || [],
          evBest: e.evBest, lines: e.lines || [], loss: e.loss, themes: e.themes || [], allowed: e.allowed || [], ph: e.ph, nat: e.nat || null,
          gid: g.id, gids: [g.id], gply: e.ply + 1, opp: (e.c === 'w' ? g.headers.Black : g.headers.White) || '?', date: g.headers.Date || '',
          box: 0, due: 0, attempts: 0, correct: 0, last: null, firstTry: null,
        };
        added++;
      }
    }
    return { state, added };
  }

  /** Selección: primero las vencidas (más atrasadas antes), luego nuevas por mayor pérdida; filtro opcional. */
  function queue(state, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    let list = Object.values(state.items || {});
    if (opts.theme) list = list.filter(x => x.themes.includes(opts.theme) || x.nat === opts.theme);
    if (opts.phase) list = list.filter(x => x.ph === opts.phase);
    const due = list.filter(x => x.due <= now);
    due.sort((a, b) => (a.attempts === 0) - (b.attempts === 0) || a.due - b.due || b.loss - a.loss);
    // los nuevos (sin intentos) por pérdida desc; los repasos vencidos primero
    const reviews = due.filter(x => x.attempts > 0), fresh = due.filter(x => x.attempts === 0).sort((a, b) => b.loss - a.loss);
    return { due: reviews.concat(fresh), total: list.length, reviews: reviews.length, fresh: fresh.length };
  }

  /**
   * Evalúa la respuesta del usuario con Stockfish.
   * Usa las líneas guardadas del análisis; si la jugada no estaba entre ellas, consulta al motor.
   * Devuelve {kind:'best'|'good'|'bad', ok, uci, san, ev, evBest, lossPct, bestSan, line}
   */
  async function evaluate(ex, uci, engine, depth) {
    const U = C.util, ch = new Chess(ex.fen);
    const mv = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!mv) throw new Error('Jugada ilegal');
    const sgn = 1; // todas las evaluaciones del ejercicio están en el punto de vista de quien mueve
    let ev, from = 'guardado';
    const known = (ex.lines || []).find(l => l.u === uci);
    if (uci === ex.best) ev = ex.evBest;
    else if (known) ev = known.cp;
    else if (ch.in_checkmate()) { ev = 10000; from = 'mate'; }
    else if (ch.in_draw() || ch.in_stalemate()) { ev = 0; from = 'tablas'; }
    else {
      if (!engine) throw new Error('Se necesita el motor para evaluar esta jugada');
      const r = await engine.analyze(ch.fen(), depth || 12, 1);
      ev = r.lines && r.lines[0] ? -r.lines[0].cp : 0; from = 'motor';
    }
    const lossPct = Math.max(0, U.winPct(sgn * ex.evBest) - U.winPct(sgn * ev));
    const kind = uci === ex.best || lossPct <= 2 ? 'best' : lossPct <= 5 ? 'good' : 'bad';
    return { kind, ok: kind !== 'bad', uci, san: mv.san, ev, evBest: ex.evBest, lossPct: +lossPct.toFixed(1), bestSan: ex.bestSan, line: ex.pv, from, wasMistake: uci === ex.played };
  }

  /** Registra un intento: actualiza caja, fecha de repaso e historial. */
  function record(state, key, result, now) {
    now = now || Date.now();
    const it = state.items[key]; if (!it) return state;
    it.attempts++;
    if (it.firstTry == null) it.firstTry = result.ok ? 1 : 0;
    if (result.ok) { it.correct++; it.box = Math.min(MAX_BOX, it.box + 1); } else it.box = 0;
    it.due = now + INTERVALS[it.box] * DAY - (INTERVALS[it.box] === 0 ? 0 : 0);
    if (it.box === 0) it.due = now;          // si falla, vuelve a salir en esta sesión
    it.last = now;
    state.log.push({ t: now, key, ok: result.ok ? 1 : 0, kind: result.kind, themes: it.themes, ph: it.ph, nat: it.nat, box: it.box });
    if (state.log.length > 5000) state.log = state.log.slice(-5000);
    return state;
  }

  /** Progreso: precisión, rachas, dominio por tema/fase y evolución por día. */
  function progress(state, now) {
    now = now || Date.now();
    const items = Object.values(state.items || {}), log = state.log || [];
    const att = log.length, ok = log.filter(l => l.ok).length;
    const dayKey = t => new Date(t).toISOString().slice(0, 10);
    const byDay = {};
    log.forEach(l => { const k = dayKey(l.t); const e = byDay[k] = byDay[k] || { day: k, n: 0, ok: 0 }; e.n++; e.ok += l.ok; });
    const days = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
    const by = (fn) => {
      const m = {};
      log.forEach(l => (fn(l) || []).forEach(k => { const e = m[k] = m[k] || { id: k, n: 0, ok: 0 }; e.n++; e.ok += l.ok; }));
      return Object.values(m).map(e => Object.assign(e, { rate: e.n ? e.ok / e.n : null })).sort((a, b) => b.n - a.n);
    };
    // racha de aciertos consecutivos (al final del historial)
    let streak = 0; for (let i = log.length - 1; i >= 0 && log[i].ok; i--) streak++;
    const half = Math.floor(log.length / 2);
    const rate = a => (a.length ? a.filter(l => l.ok).length / a.length : null);
    return {
      total: items.length, attempts: att, correct: ok, rate: att ? ok / att : null, streak,
      mastered: items.filter(x => x.box >= 3).length,
      learning: items.filter(x => x.attempts > 0 && x.box < 3).length,
      untouched: items.filter(x => x.attempts === 0).length,
      dueNow: items.filter(x => x.due <= now).length,
      firstTryRate: (() => { const t = items.filter(x => x.firstTry != null); return t.length ? t.filter(x => x.firstTry === 1).length / t.length : null; })(),
      days, byTheme: by(l => (l.themes && l.themes.length ? l.themes : (l.nat ? [l.nat] : ['otros']))), byPhase: by(l => [l.ph || '?']),
      trend: log.length >= 10 ? { before: rate(log.slice(0, half)), after: rate(log.slice(half)) } : null,
    };
  }

  C.training = { emptyState, sync, queue, evaluate, record, progress, INTERVALS };
})();
