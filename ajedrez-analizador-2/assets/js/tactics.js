/* tactics.js — detección de motivos tácticos con tablero propio (ataques, SEE, clavadas, etc.) */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});

  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const FILES = 'abcdefgh';
  const sqName = i => FILES[i & 7] + (8 - (i >> 3));
  const sqIdx = s => (8 - (+s[1])) * 8 + FILES.indexOf(s[0]);
  const colorOf = ch => (ch ? (ch === ch.toUpperCase() ? 'w' : 'b') : null);
  const typeOf = ch => ch.toLowerCase();
  const other = c => (c === 'w' ? 'b' : 'w');

  const THEME_LABELS = {
    hanging: 'Pieza indefensa',
    fork: 'Ataque doble',
    pin: 'Clavada',
    skewer: 'Ensartada (skewer)',
    xray: 'Rayos X',
    discovered: 'Ataque descubierto',
    deflection: 'Desviación',
    overload: 'Sobrecarga',
    sacrifice: 'Sacrificio',
    possac: 'Sacrificio posicional',
    mate: 'Red de mate',
    backrank: 'Mate de pasillo',
    smothered: 'Mate ahogado',
    weaksq: 'Casilla débil / puesto avanzado',
    zugzwang: 'Zugzwang',
  };

  /* ---------- tablero ---------- */
  function parseFen(fen) {
    const [pl, turn, castle, ep] = fen.split(' ');
    const b = new Array(64).fill(null);
    let i = 0;
    for (const ch of pl) {
      if (ch === '/') continue;
      if (/\d/.test(ch)) i += +ch; else b[i++] = ch;
    }
    return { b, turn, castle, ep };
  }

  const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const DB = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const DR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DQ = DB.concat(DR);

  function dirsOf(t) { return t === 'b' ? DB : t === 'r' ? DR : t === 'q' ? DQ : null; }

  /** Casillas atacadas (o defendidas) por la pieza en i */
  function attacksFrom(b, i) {
    const ch = b[i]; if (!ch) return [];
    const t = typeOf(ch), f = i & 7, r = i >> 3, res = [];
    if (t === 'p') {
      const dr = colorOf(ch) === 'w' ? -1 : 1;
      for (const df of [-1, 1]) {
        const nf = f + df, nr = r + dr;
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) res.push(nr * 8 + nf);
      }
      return res;
    }
    if (t === 'n' || t === 'k') {
      for (const [df, dr] of (t === 'n' ? KN : KG)) {
        const nf = f + df, nr = r + dr;
        if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) res.push(nr * 8 + nf);
      }
      return res;
    }
    for (const [df, dr] of dirsOf(t)) {
      let nf = f + df, nr = r + dr;
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const s = nr * 8 + nf; res.push(s);
        if (b[s]) break;
        nf += df; nr += dr;
      }
    }
    return res;
  }

  function attackersOf(b, sq, color) {
    const res = [];
    for (let i = 0; i < 64; i++) {
      const ch = b[i];
      if (ch && colorOf(ch) === color && attacksFrom(b, i).includes(sq)) res.push(i);
    }
    return res;
  }

  function material(b, color) {
    let s = 0;
    for (const ch of b) if (ch && colorOf(ch) === color && typeOf(ch) !== 'k') s += VAL[typeOf(ch)];
    return s;
  }
  function nonPawnMaterial(b) {
    let s = 0;
    for (const ch of b) if (ch) { const t = typeOf(ch); if (t !== 'p' && t !== 'k') s += VAL[t]; }
    return s;
  }
  function pieceCount(b) { return b.filter(Boolean).length; }

  /** Ganancia neta para `color` al capturar en sq con la secuencia óptima de cambios (≥0). */
  function seeRec(b, sq, color, depth) {
    depth = depth || 0;
    if (depth > 12) return 0;
    const target = b[sq]; if (!target) return 0;
    let best = -1, bv = 1e9;
    for (let i = 0; i < 64; i++) {
      const ch = b[i];
      if (ch && colorOf(ch) === color && attacksFrom(b, i).includes(sq)) {
        const v = VAL[typeOf(ch)];
        if (v < bv) { bv = v; best = i; }
      }
    }
    if (best < 0) return 0;
    const nb = b.slice(); nb[sq] = nb[best]; nb[best] = null;
    return Math.max(0, VAL[typeOf(target)] - seeRec(nb, sq, other(color), depth + 1));
  }

  /** Piezas enemigas (≥ min) que `by` puede ganar materialmente. */
  function hangTargets(b, by, min) {
    min = min || 3;
    const e = other(by), res = [];
    for (let i = 0; i < 64; i++) {
      const ch = b[i];
      if (!ch || colorOf(ch) !== e || typeOf(ch) === 'k') continue;
      if (VAL[typeOf(ch)] < 3) continue;
      const g = seeRec(b, i, by);
      if (g >= min) res.push({ sq: i, gain: g });
    }
    return res;
  }

  /* ---------- patrones de rayos ---------- */
  function rayPatterns(b, color) {
    const res = [];
    for (let s = 0; s < 64; s++) {
      const ch = b[s];
      if (!ch || colorOf(ch) !== color) continue;
      const t = typeOf(ch), dirs = dirsOf(t);
      if (!dirs) continue;
      const f0 = s & 7, r0 = s >> 3;
      for (const [df, dr] of dirs) {
        let nf = f0 + df, nr = r0 + dr, x = -1;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const q = nr * 8 + nf;
          if (b[q]) {
            if (x < 0) { if (colorOf(b[q]) === color) break; x = q; }
            else { if (colorOf(b[q]) !== color) res.push({ s, x, y: q }); break; }
          }
          nf += df; nr += dr;
        }
      }
    }
    return res;
  }

  function sliderTargets(b, color) {
    const set = new Set();
    for (let s = 0; s < 64; s++) {
      const ch = b[s];
      if (!ch || colorOf(ch) !== color || !dirsOf(typeOf(ch))) continue;
      for (const t of attacksFrom(b, s)) {
        const p = b[t];
        if (p && colorOf(p) !== color && VAL[typeOf(p)] >= 3) set.add(s + '>' + t);
      }
    }
    return set;
  }

  function isOutpost(b, sq, color) {
    const r = sq >> 3, f = sq & 7;
    const rel = color === 'w' ? 8 - r : r + 1;
    if (rel < 4 || rel > 6) return false;
    const pr = color === 'w' ? r + 1 : r - 1;
    let supported = false;
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf < 0 || nf > 7 || pr < 0 || pr > 7) continue;
      const p = b[pr * 8 + nf];
      if (p && typeOf(p) === 'p' && colorOf(p) === color) supported = true;
    }
    if (!supported) return false;
    for (const df of [-1, 1]) {
      const nf = f + df; if (nf < 0 || nf > 7) continue;
      for (let rr = 0; rr < 8; rr++) {
        const p = b[rr * 8 + nf];
        if (p && typeOf(p) === 'p' && colorOf(p) !== color) {
          if (color === 'w' && rr < r) return false;
          if (color === 'b' && rr > r) return false;
        }
      }
    }
    return true;
  }

  function overloaded(P0, c, ti) {
    const e = other(c), map = new Map();
    for (let t = 0; t < 64; t++) {
      const p = P0.b[t];
      if (!p || colorOf(p) !== e || typeOf(p) === 'k') continue;
      if (!attackersOf(P0.b, t, c).length) continue;
      const defs = attackersOf(P0.b, t, e);
      if (defs.length === 1) { const d = defs[0]; if (!map.has(d)) map.set(d, []); map.get(d).push(t); }
    }
    for (const ts of map.values()) if (ts.length >= 2 && ts.includes(ti)) return true;
    return false;
  }

  function deflection(fen, pv) {
    if (!pv || pv.length < 3) return false;
    try {
      const ch = new Chess(fen), P0 = parseFen(fen);
      const m0 = ch.move({ from: pv[0].slice(0, 2), to: pv[0].slice(2, 4), promotion: pv[0][4] });
      if (!m0 || !(m0.captured || /[+#]/.test(m0.san))) return false;
      const m1 = ch.move({ from: pv[1].slice(0, 2), to: pv[1].slice(2, 4), promotion: pv[1][4] });
      if (!m1) return false;
      const P2 = parseFen(ch.fen());
      const m2 = ch.move({ from: pv[2].slice(0, 2), to: pv[2].slice(2, 4), promotion: pv[2][4] });
      if (!m2 || !m2.captured || VAL[m2.captured] < 3 || m2.to === m1.to) return false;
      const d0 = sqIdx(m1.from), d1 = sqIdx(m1.to), t = sqIdx(m2.to);
      return attacksFrom(P0.b, d0).includes(t) && !attacksFrom(P2.b, d1).includes(t);
    } catch (e) { return false; }
  }

  function mateInfo(fen, pv) {
    if (!pv || !pv.length) return { pattern: 'mate' };
    try {
      const ch = new Chess(fen);
      let last = null;
      for (const u of pv) {
        const mv = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        if (!mv) return { pattern: 'mate' };
        last = mv;
        if (ch.in_checkmate()) break;
      }
      if (!ch.in_checkmate()) return { pattern: 'mate' };
      const P = parseFen(ch.fen());
      const loser = ch.turn();
      let k = P.b.findIndex(ch2 => ch2 && typeOf(ch2) === 'k' && colorOf(ch2) === loser);
      const kr = k >> 3, kf = k & 7;
      let allBlockedByOwn = true, nbrs = 0, backAll = true;
      for (const [df, dr] of KG) {
        const nf = kf + df, nr = kr + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        nbrs++;
        const p = P.b[nr * 8 + nf];
        if (!(p && colorOf(p) === loser)) allBlockedByOwn = false;
        const onBack = (loser === 'b' && nr === 0) || (loser === 'w' && nr === 7);
        if (!onBack && !(p && colorOf(p) === loser)) backAll = false;
      }
      if (last.piece === 'n' && allBlockedByOwn && nbrs > 0) return { pattern: 'smothered' };
      const onBackRank = (loser === 'b' && kr === 0) || (loser === 'w' && kr === 7);
      if ((last.piece === 'r' || last.piece === 'q') && onBackRank && backAll) return { pattern: 'backrank' };
      return { pattern: 'mate' };
    } catch (e) { return { pattern: 'mate' }; }
  }

  /**
   * Analiza una jugada (uci) en una posición (fen).
   * ctx: { pv:[uci…], cp: evaluación (puntos de vista del bando que mueve) de la línea, si se conoce }
   */
  function analyzeMove(fen, uci, ctx) {
    ctx = ctx || {};
    if (!uci) return null;
    let ch, mv;
    try {
      ch = new Chess(fen);
      mv = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch (e) { return null; }
    if (!mv) return null;
    const c = mv.color, e = other(c);
    const P0 = parseFen(fen), P1 = parseFen(ch.fen());
    const fi = sqIdx(mv.from), ti = sqIdx(mv.to);
    const info = {
      san: mv.san, piece: mv.piece, capture: !!mv.captured, captured: mv.captured || null,
      check: /[+#]/.test(mv.san), promo: !!mv.promotion, castle: /[kq]/.test(mv.flags),
      fwd: c === 'w' ? (fi >> 3) - (ti >> 3) : (ti >> 3) - (fi >> 3),
      themes: [], mate: null, exch: 0, fenAfter: ch.fen(),
    };
    const add = t => { if (!info.themes.includes(t)) info.themes.push(t); };

    // mate
    if (ctx.cp != null && ctx.cp >= 9000) {
      const mi = mateInfo(fen, ctx.pv || [uci]);
      info.mate = { n: 10000 - ctx.cp, pattern: mi.pattern };
      add(mi.pattern === 'mate' ? 'mate' : mi.pattern);
    } else if (ch.in_checkmate()) {
      const mi = mateInfo(fen, [uci]);
      add(mi.pattern === 'mate' ? 'mate' : mi.pattern);
    }

    // resultado neto de la jugada sobre la casilla de destino
    const enemyGainOnTo = seeRec(P1.b, ti, e);
    info.exch = (mv.captured ? VAL[mv.captured] : 0) - enemyGainOnTo;

    // pieza indefensa / captura ganadora
    if (mv.captured && VAL[mv.captured] >= 3 && info.exch >= 2) add('hanging');

    // sacrificio
    if (mv.piece !== 'k' && info.exch <= -2 && !ch.in_checkmate()) {
      if (ctx.cp != null && ctx.cp < 150 && ctx.cp > -150) add('possac'); else add('sacrifice');
    }

    // ataque doble
    if (mv.piece !== 'k') {
      const att = attacksFrom(P1.b, ti), targets = [];
      for (const t of att) {
        const p = P1.b[t];
        if (!p || colorOf(p) !== e) continue;
        const tv = VAL[typeOf(p)];
        if (tv < 3 && typeOf(p) !== 'k') continue;
        const undefended = attackersOf(P1.b, t, e).length === 0;
        if (typeOf(p) === 'k' || tv > VAL[mv.piece] || undefended) targets.push(t);
      }
      if (targets.length >= 2 && enemyGainOnTo <= 0) add('fork');
    }

    // clavadas / ensartadas / rayos X nuevos
    const old = new Set(rayPatterns(P0.b, c).map(p => p.s + '-' + p.x + '-' + p.y));
    for (const p of rayPatterns(P1.b, c)) {
      if (old.has(p.s + '-' + p.x + '-' + p.y)) continue;
      const vx = VAL[typeOf(P1.b[p.x])], vy = VAL[typeOf(P1.b[p.y])];
      if (vy > vx && (vx >= 3 || typeOf(P1.b[p.y]) === 'k')) add('pin');
      else if (vx > vy && vx >= 5) add('skewer');
      else if (vx === vy && vx >= 3) add('xray');
    }

    // ataque descubierto
    const t0 = sliderTargets(P0.b, c);
    for (const key of sliderTargets(P1.b, c)) {
      const s = +key.split('>')[0];
      if (s === fi || s === ti || t0.has(key)) continue;
      add('discovered');
    }

    // sobrecarga y desviación
    if (overloaded(P0, c, ti)) add('overload');
    if (deflection(fen, ctx.pv)) add('deflection');

    // casilla débil / puesto avanzado
    if ((mv.piece === 'n' || mv.piece === 'b') && isOutpost(P1.b, ti, c) && !isOutpost(P0.b, fi, c)) add('weaksq');

    return info;
  }

  function phaseOf(fen, ply) {
    const P = parseFen(fen), np = nonPawnMaterial(P.b);
    if (np <= 24) return 'endgame';
    if (ply <= 20) return 'opening';
    return 'middlegame';
  }

  C.tactics = {
    VAL, THEME_LABELS, parseFen, attacksFrom, attackersOf, seeRec, hangTargets, material,
    nonPawnMaterial, pieceCount, sqName, sqIdx, colorOf, typeOf, other, analyzeMove, phaseOf, isOutpost,
  };
})();
