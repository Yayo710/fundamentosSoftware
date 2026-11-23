/* analysis.js — canalización de análisis: motor → evaluaciones → rasgos por jugada ("derived") */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const T = C.tactics;

  const clampCp = cp => Math.max(-1000, Math.min(1000, cp));
  const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clampCp(cp))) - 1);
  const CLASS_ORDER = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
  const CLASS_INFO = {
    best:       { label: 'Mejor jugada', sym: '★',  color: '#5fa83a' },
    excellent:  { label: 'Excelente',    sym: '',   color: '#7fb83f' },
    good:       { label: 'Buena',        sym: '',   color: '#9aa56a' },
    inaccuracy: { label: 'Imprecisión',  sym: '?!', color: '#e6b422' },
    mistake:    { label: 'Error',        sym: '?',  color: '#e58a1f' },
    blunder:    { label: 'Error grave',  sym: '??', color: '#d33f3a' },
  };
  const classOf = loss => (loss <= 2 ? 'excellent' : loss <= 5 ? 'good' : loss <= 10 ? 'inaccuracy' : loss <= 20 ? 'mistake' : 'blunder');
  const accOfLoss = loss => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

  function fmtEval(cp) {
    if (cp == null) return '…';
    if (Math.abs(cp) >= 9000) {
      const n = 10000 - Math.abs(cp);
      return n === 0 ? '#' : (cp > 0 ? '+' : '-') + '#' + n;
    }
    const v = cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  }

  function terminal(fen) {
    const g = new Chess(fen);
    if (!g.game_over()) return null;
    if (g.in_checkmate()) return { cp: g.turn() === 'w' ? -10000 : 10000 };
    return { cp: 0 };
  }

  function pvToSan(fen, pv, max) {
    const ch = new Chess(fen), out = [];
    for (const u of (pv || []).slice(0, max || 6)) {
      const mv = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!mv) break;
      out.push(mv.san);
    }
    return out;
  }

  function nullFen(fen) {
    const p = fen.split(' ');
    p[1] = p[1] === 'w' ? 'b' : 'w'; p[3] = '-';
    return p.join(' ');
  }

  /**
   * Analiza una partida completa.
   * engine.analyze(fen, depth, multipv) → Promise<{lines:[{cp (desde el bando que mueve), pv:[uci…]}]}>
   * opts: { depth, multipv, mySide, both, zugzwang }
   */
  async function analyzeGame(game, opts, engine, hooks) {
    opts = opts || {}; hooks = hooks || {};
    const n = game.fens.length;
    const depth = opts.depth || 10, mpvOpt = opts.multipv || 2;
    const mySide = opts.mySide || null, both = opts.both !== false;
    const evals = new Array(n).fill(null), lines = new Array(n).fill(null), bests = new Array(n).fill(null);
    const cancelled = () => hooks.cancelled && hooks.cancelled();

    for (let i = 0; i < n; i++) {
      if (cancelled()) return null;
      const fen = game.fens[i], turn = fen.split(' ')[1];
      const term = terminal(fen);
      if (term) { evals[i] = term.cp; lines[i] = []; }
      else {
        const mpv = (mySide && !both && turn !== mySide) ? 1 : mpvOpt;
        const r = await engine.analyze(fen, depth, mpv);
        if (cancelled()) return null;
        const ls = (r.lines || []).map(l => ({ cp: turn === 'w' ? l.cp : -l.cp, pv: (l.pv || []).slice(0, 8) }));
        lines[i] = ls; evals[i] = ls[0] ? ls[0].cp : 0; bests[i] = ls[0] && ls[0].pv[0] || null;
      }
      if (hooks.progress) hooks.progress(i + 1, n);
    }

    // zugzwang: posiciones de final donde mover empeora respecto a "pasar"
    const zz = {};
    if (opts.zugzwang !== false) {
      let budget = 10;
      for (let i = 0; i < n - 1 && budget > 0; i++) {
        if (cancelled()) return null;
        const fen = game.fens[i];
        if (terminal(fen)) continue;
        const P = T.parseFen(fen);
        if (T.pieceCount(P.b) > 12 || T.nonPawnMaterial(P.b) > 16) continue;
        const ch = new Chess(fen);
        if (ch.in_check()) continue;
        const nf = nullFen(fen), probe = new Chess();
        if (!probe.load(nf)) continue;
        budget--;
        const r = await engine.analyze(nf, depth, 1);
        if (!r.lines || !r.lines[0]) continue;
        const side = fen.split(' ')[1];
        const nullW = (side === 'w' ? -1 : 1) * r.lines[0].cp;      // blancas, con el rival a mover
        const sgn = side === 'w' ? 1 : -1;
        const gain = sgn * nullW - sgn * evals[i];
        if (gain >= 100) zz[i] = Math.round(gain);
      }
    }

    const analysis = { depth, multipv: mpvOpt, evals, bests, lines, zz };
    return { analysis, derived: derive(game, analysis, opts) };
  }

  /** Rasgos por jugada y estadísticas de la partida (sirve para ambos bandos). */
  function derive(game, analysis, opts) {
    opts = opts || {};
    const n = game.moves.length;
    const boards = game.fens.map(f => T.parseFen(f));
    const matDiff = k => { const b = boards[Math.min(k, boards.length - 1)].b; return T.material(b, 'w') - T.material(b, 'b'); };
    const cpOf = (L, sgn) => (L ? sgn * L.cp : null);

    // mejor jugada de cada posición, con sus temas
    const bestInfo = [];
    for (let k = 0; k <= n; k++) {
      const L = analysis.lines[k] || [];
      if (!L.length || !L[0].pv.length) { bestInfo[k] = null; continue; }
      const turn = game.fens[k].split(' ')[1];
      bestInfo[k] = T.analyzeMove(game.fens[k], L[0].pv[0], { pv: L[0].pv, cp: cpOf(L[0], turn === 'w' ? 1 : -1) });
    }

    const recs = [], exercises = [];
    for (let i = 0; i < n; i++) {
      const m = game.moves[i], c = m.color, e = T.other(c), sgn = c === 'w' ? 1 : -1;
      const fen = game.fens[i];
      const L0 = analysis.lines[i] || [];
      const bi = bestInfo[i];
      const pi = T.analyzeMove(fen, m.uci, {}) || { exch: 0, themes: [], fwd: 0, check: false, castle: false };
      const rec = { i, c, san: m.san, uci: m.uci, ph: T.phaseOf(fen, i) };
      const evOk = analysis.evals[i] != null && analysis.evals[i + 1] != null;
      let loss = 0, wb = null, wa = null;

      if (evOk) {
        const before = sgn * analysis.evals[i];
        let afterW = analysis.evals[i + 1];
        const top = L0.find(l => l.pv[0] === m.uci);
        if (top) afterW = top.cp;
        const after = sgn * afterW;
        wb = winPct(before); wa = winPct(after);
        loss = Math.max(0, wb - wa);
        let cpl = Math.max(0, clampCp(before) - clampCp(after));
        const best = L0[0] && L0[0].pv[0] || null;
        let cls;
        if (m.uci === best) { cls = 'best'; loss = 0; cpl = 0; } else cls = classOf(loss);
        Object.assign(rec, { cls, loss: +loss.toFixed(2), cpl: Math.round(cpl), ev0: analysis.evals[i], ev1: analysis.evals[i + 1], wb: +wb.toFixed(1), wa: +wa.toFixed(1), best });
        if (L0.length >= 2) {
          const gap = winPct(sgn * L0[0].cp) - winPct(sgn * L0[1].cp);
          rec.gap = +gap.toFixed(1); rec.only = gap >= 15 ? 1 : 0;
        }
        rec.bestSan = bi ? bi.san : null;
        rec.pvSan = L0[0] ? pvToSan(fen, L0[0].pv, 6) : [];
        rec.bt = bi ? bi.themes : [];
        if (loss >= 10 && bestInfo[i + 1]) {
          rec.allowed = bestInfo[i + 1].themes;
          rec.thr = bestInfo[i + 1].capture && bestInfo[i + 1].exch >= 2 ? 1 : 0;
        }
        if (bi && bi.mate && !(after >= 9000)) rec.mm = 1;
        // la jugada permite un mate que antes no existía
        if (sgn * analysis.evals[i + 1] <= -9000 && sgn * analysis.evals[i] > -9000) rec.ma = 1;
      }

      // complejidad de la posición
      try {
        const legal = new Chess(fen).moves({ verbose: true });
        const caps = legal.filter(x => /[ce]/.test(x.flags)).length;
        rec.cx = (legal.length >= 35 || caps >= 4 || rec.only) ? 1 : 0;
      } catch (err) { rec.cx = 0; }

      // rasgos de la jugada
      const forcing = !!(m.captured || pi.check);
      if (forcing) rec.fc = 1;
      if (m.captured) rec.cap = 1;
      if (pi.check) rec.chk = 1;
      const d0 = sgn * matDiff(i), d2 = sgn * matDiff(i + 2);
      const next = game.moves[i + 1];
      if (m.captured && T.VAL[m.captured] >= 3 && next && next.captured && next.to === m.to && d2 - d0 === 0) rec.trade = 1;
      const toIdx = T.sqIdx(m.to);
      const attacksBig = T.attacksFrom(boards[i + 1].b, toIdx).some(s => { const p = boards[i + 1].b[s]; return p && T.colorOf(p) === e && T.VAL[T.typeOf(p)] >= 3; });
      const isMate = /#/.test(m.san);
      if (pi.exch <= -2 && !isMate && (forcing || attacksBig) && m.piece !== 'k') { rec.sac = 1; rec.sacMat = Math.round(d2 - d0); }
      if (evOk && !rec.sac && loss >= 8 && T.hangTargets(boards[i + 1].b, e).length > 0) rec.hang = 1;
      const hangOpp = T.hangTargets(boards[i].b, c);
      if (hangOpp.length) {
        rec.ho = hangOpp.length;
        if (evOk && loss >= 8 && !(m.captured && hangOpp.some(h => h.sq === toIdx))) rec.mh = 1;
      }
      if (evOk && forcing && loss >= 15) rec.ff = 1;
      if (!m.captured && !pi.check && m.piece !== 'p' && m.piece !== 'k' && !pi.castle && pi.fwd < 0) rec.pas = 1;
      if (bi && (bi.capture || bi.check || bi.fwd > 0)) rec.ba = 1;
      if (evOk && wb >= 70 && wa <= 55) rec.la = 1;
      if (evOk && loss >= 10) {
        const tactic = (rec.allowed || []).some(t => ['fork', 'pin', 'skewer', 'discovered', 'deflection', 'overload', 'mate', 'backrank', 'xray'].includes(t));
        rec.nat = rec.mm ? 'mate' : rec.ma ? 'allowmate' : rec.sac ? 'sac' : rec.hang ? 'hang' : rec.ff ? 'calc' : rec.la ? 'adv' : tactic ? 'tactic' : rec.pas ? 'pas' : 'pos';
      }
      if (evOk && (rec.only || Math.abs(analysis.evals[i + 1] - analysis.evals[i]) >= 0 && Math.abs(winPct(analysis.evals[i + 1]) - winPct(analysis.evals[i])) >= 15)) rec.crit = 1;

      // tiempo
      if (m.clk != null) {
        const prev = i >= 2 ? game.moves[i - 2].clk : game.tc.base;
        rec.left = Math.round(m.clk * 10) / 10;
        if (prev != null) rec.sp = Math.round(Math.max(0, prev - m.clk + (game.tc.inc || 0)) * 10) / 10;
      }

      // ejercicio de entrenamiento
      if (evOk && L0.length && (loss >= 10 || (loss >= 5 && rec.bt && rec.bt.length))) {
        exercises.push({
          key: fen.split(' ').slice(0, 4).join(' '), fen, ply: i, c, played: m.uci, playedSan: m.san,
          best: rec.best, bestSan: rec.bestSan, pv: rec.pvSan, evBest: sgn * L0[0].cp,
          lines: L0.slice(0, 3).map(l => ({ u: l.pv[0], cp: sgn * l.cp, san: pvToSan(fen, l.pv, 1)[0] })),
          loss: rec.loss, themes: rec.bt || [], allowed: rec.allowed || [], ph: rec.ph, nat: rec.nat || null,
        });
      }
      recs.push(rec);
    }

    // marcas relativas al ritmo del propio jugador en esta partida
    for (const col of ['w', 'b']) {
      const sp = recs.filter(r => r.c === col && r.sp != null).map(r => r.sp).sort((a, b) => a - b);
      if (!sp.length) continue;
      const med = sp[Math.floor(sp.length / 2)];
      const base = game.tc.base;
      recs.forEach(r => {
        if (r.c !== col || r.sp == null) return;
        if (r.sp <= Math.max(2, 0.35 * med)) r.fast = 1;
        if (r.sp >= Math.max(15, 3 * med)) r.long = 1;
        if (base != null && r.left != null && r.left <= Math.max(30, 0.1 * base)) r.press = 1;
      });
    }

    // posiciones de zugzwang
    const zzList = Object.entries(analysis.zz || {}).map(([i, d]) => ({ i: +i, c: game.fens[+i].split(' ')[1], d }));

    // estadísticas por bando
    const stats = {};
    for (const col of ['w', 'b']) {
      const mine = recs.filter(r => r.c === col && r.cls);
      const counts = Object.fromEntries(CLASS_ORDER.map(k => [k, 0]));
      mine.forEach(r => counts[r.cls]++);
      stats[col] = {
        n: mine.length, counts,
        acc: mine.length ? +(mine.reduce((s, r) => s + accOfLoss(r.loss), 0) / mine.length).toFixed(1) : null,
        acpl: mine.length ? Math.round(mine.reduce((s, r) => s + r.cpl, 0) / mine.length) : null,
        maxAdv: analysis.evals.reduce((mx, v) => (v == null ? mx : Math.max(mx, winPct((col === 'w' ? 1 : -1) * v))), 0),
      };
    }

    const sans = game.moves.map(m => m.san);
    const h = game.headers;
    return {
      v: 2,
      opening: C.openings.identify(sans, h),
      tc: game.tc, hasClock: game.hasClock, result: game.result, plies: n,
      names: { w: h.White || '?', b: h.Black || '?' },
      elo: { w: h.WhiteElo || null, b: h.BlackElo || null },
      date: h.Date || h.UTCDate || null,
      depth: analysis.depth, multipv: analysis.multipv,
      moves: recs, exercises, zz: zzList, stats,
      principles: { w: C.openings.principles(game, 'w'), b: C.openings.principles(game, 'b') },
      endState: (() => { const g = new Chess(game.fens[n]); return g.in_checkmate() ? 'mate' : g.in_stalemate() ? 'stalemate' : g.in_draw() ? 'draw' : null; })(),
    };
  }

  C.util = { winPct, clampCp, CLASS_ORDER, CLASS_INFO, classOf, accOfLoss, fmtEval, pvToSan };
  C.analysis = { analyzeGame, derive, terminal };
})();
