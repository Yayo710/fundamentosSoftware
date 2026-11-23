/* coach.js — del análisis de muchas partidas al perfil del jugador:
 * diagnóstico con puntuación, repertorio de aperturas, patrones tácticos, tiempo y ritmo.
 * Todo se calcula a partir de las partidas importadas; nada se inventa: si no hay muestra suficiente, se dice. */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});

  /* ================= selección de partidas y bando ================= */
  function sideOf(g, profile) {
    if (g.side === 'w' || g.side === 'b') return g.side;
    const names = ((profile && profile.names) || []).map(s => String(s).trim().toLowerCase()).filter(Boolean);
    const h = g.headers || {};
    if (names.length) {
      const mw = names.includes(String(h.White || '').toLowerCase()), mb = names.includes(String(h.Black || '').toLowerCase());
      if (mw && !mb) return 'w';
      if (mb && !mw) return 'b';
    }
    if (profile && (profile.defaultSide === 'w' || profile.defaultSide === 'b')) return profile.defaultSide;
    return null;
  }

  /** Partidas analizadas con bando conocido. */
  function usable(items, profile) {
    const out = [];
    for (const g of items || []) {
      const side = sideOf(g, profile);
      if (side && g.derived && g.derived.moves) out.push({ g, d: g.derived, side });
    }
    return out;
  }

  function rowsOf(U) {
    const rows = [];
    for (const u of U) for (const r of u.d.moves) if (r.c === u.side) rows.push({ r, u });
    return rows;
  }

  const ex = (x, extra) => Object.assign({ gid: x.u.g.id, ply: x.r.i + 1, san: moveLabel(x.r), loss: x.r.loss == null ? null : Math.round(x.r.loss) }, extra || {});
  function moveLabel(r) { return `${Math.floor(r.i / 2) + 1}${r.c === 'w' ? '.' : '...'} ${r.san}`; }
  const pct = (a, b) => (b ? a / b : 0);
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const levelOf = s => (s == null ? 'na' : s < 34 ? 'low' : s < 67 ? 'mid' : 'high');

  /* ================= 1. diagnóstico de patrones ================= */
  const hasLoss = x => x.r.loss != null && x.r.cls;

  // Cada patrón: den = situaciones donde podía darse; hit = veces que ocurrió. score = 100·min(1, tasa/hi).
  const PATTERNS = [
    {
      id: 'sac', good: 'Sacrificios bien calculados', name: 'Sacrificios sin compensación', diag: 'Riesgo excesivo', hi: 0.6, min: 3, unit: 'sacrificios',
      rule: 'Sacrificios de material donde la jugada perdió ≥10 % de probabilidad de ganar.',
      tip: 'Antes de sacrificar, calcula la respuesta más fuerte del rival y exige una compensación concreta (mate, pieza recuperada o iniciativa clara).',
      fn: (R) => { const den = R.filter(x => x.r.sac); return { den: den.length, hit: den.filter(x => x.r.loss >= 10) }; },
    },
    {
      id: 'hanging', good: 'Aprovecha las piezas indefensas', name: 'No aprovecha piezas indefensas', diag: 'Falta de visión táctica', hi: 0.5, min: 4, unit: 'oportunidades',
      rule: 'Posiciones donde el rival dejó una pieza que se podía ganar y la jugada elegida perdió ≥8 % sin capturarla.',
      tip: 'En cada turno, antes de tu plan, pregúntate: «¿qué pieza del rival está sin defender o mal defendida?».',
      fn: (R) => { const den = R.filter(x => x.r.ho); return { den: den.length, hit: den.filter(x => x.r.mh) }; },
    },
    {
      id: 'simplify', good: 'Cambia piezas con criterio cuando tiene ventaja', name: 'Intercambia piezas en posiciones favorables', diag: 'Simplificación innecesaria', hi: 0.4, min: 4, unit: 'cambios con ventaja',
      rule: 'Cambios de piezas con ventaja (≥60 % de probabilidad de ganar) tras los cuales la ventaja cayó ≥5 %.',
      tip: 'Con ventaja, cambia solo si mantiene la presión (piezas del rival activas) o llegas a un final claramente ganado; si no, mejora tu posición primero.',
      fn: (R) => { const den = R.filter(x => x.r.trade && x.r.wb >= 60); return { den: den.length, hit: den.filter(x => x.r.loss >= 5) }; },
    },
    {
      id: 'convert', good: 'Convierte sus ventajas', name: 'Pierde ventajas ganadoras', diag: 'Problemas de conversión', hi: 0.5, min: 3, unit: 'partidas con ventaja', level: 'game',
      rule: 'Partidas donde llegaste a ≥75 % de probabilidad de ganar y no terminaste ganando.',
      tip: 'Con ventaja: elimina los contrajuegos del rival, evita complicar, convierte con un plan simple y revisa cada jaque/captura del rival.',
      fn: (R, U) => {
        const den = U.filter(u => u.d.stats && u.d.stats[u.side] && u.d.stats[u.side].maxAdv >= 75 && C.pgn.scoreFor(u.d.result, u.side) != null);
        const hit = den.filter(u => C.pgn.scoreFor(u.d.result, u.side) < 1);
        return { den: den.length, hit: hit.map(u => { const r = u.d.moves.find(m => m.c === u.side && m.la) || u.d.moves.find(m => m.c === u.side && m.loss >= 10); return r ? { r, u } : { r: { i: 0, c: u.side, san: '—' }, u }; }) };
      },
    },
    {
      id: 'fast', good: 'Mantiene la calma en posiciones complejas', name: 'Juega rápido en posiciones complejas', diag: 'Posible impulsividad', hi: 0.35, min: 4, unit: 'jugadas rápidas en posiciones complejas', needsClock: true,
      rule: 'Jugadas muy rápidas (≤35 % de tu tiempo habitual) en posiciones complejas que resultaron error (≥10 %).',
      tip: 'Cuando haya capturas, jaques o muchas opciones, haz una pausa de seguridad: lista 2–3 candidatas y comprueba la respuesta del rival.',
      fn: (R) => { const den = R.filter(x => x.r.fast && x.r.cx && hasLoss(x)); return { den: den.length, hit: den.filter(x => x.r.loss >= 10) }; },
    },
    {
      id: 'passive', good: 'Juega con iniciativa', name: 'Defiende pasivamente', diag: 'Falta de iniciativa', hi: 0.1, min: 15, unit: 'jugadas de medio juego/final',
      rule: 'Retrocesos sin capturar ni dar jaque cuando la mejor jugada era activa, con pérdida ≥5 %.',
      tip: 'Antes de retroceder, busca la jugada activa: una captura, un jaque, una amenaza o mejorar tu pieza peor colocada.',
      fn: (R) => { const den = R.filter(x => x.r.ph !== 'opening' && x.r.ba && hasLoss(x)); return { den: den.length, hit: den.filter(x => x.r.pas && x.r.loss >= 5) }; },
    },
    {
      id: 'blunders', good: 'Pocos descuidos graves', name: 'Errores graves (descuidos)', diag: 'Falta de control de amenazas', hi: 0.08, min: 20, unit: 'jugadas',
      rule: 'Jugadas que pierden ≥20 % de probabilidad de ganar.',
      tip: 'Rutina de seguridad antes de mover: ¿qué amenaza el rival?, ¿qué deja mi jugada sin defensa?, ¿hay jaques o capturas para él?',
      fn: (R) => { const den = R.filter(hasLoss); return { den: den.length, hit: den.filter(x => x.r.cls === 'blunder') }; },
    },
    {
      id: 'threats', good: 'Ve las amenazas del rival', name: 'No ve las amenazas del rival', diag: 'Ceguera ante amenazas', hi: 0.5, min: 4, unit: 'errores',
      rule: 'Entre tus errores (≥10 %), los que dejaron una pieza en prise, permitieron un mate o una táctica del rival (ataque doble, clavada…) o una captura ganadora.',
      tip: 'Mira siempre la última jugada del rival: ¿qué pretende? Revisa piezas sueltas (sin defensa) y las líneas abiertas hacia tu rey.',
      fn: (R) => { const den = R.filter(x => hasLoss(x) && x.r.loss >= 10); return { den: den.length, hit: den.filter(x => x.r.hang || x.r.thr || x.r.ma || x.r.nat === 'tactic') }; },
    },
    {
      id: 'calc', good: 'Calcula bien las jugadas forzadas', name: 'Errores en jugadas forzadas (capturas y jaques)', diag: 'Errores de cálculo', hi: 0.1, min: 10, unit: 'capturas/jaques',
      rule: 'Capturas o jaques que perdieron ≥15 % de probabilidad de ganar.',
      tip: 'En líneas forzadas, calcula hasta el final de la secuencia (la última captura, el último jaque) antes de empezar.',
      fn: (R) => { const den = R.filter(x => x.r.fc && hasLoss(x)); return { den: den.length, hit: den.filter(x => x.r.ff) }; },
    },
    {
      id: 'pressure', good: 'Buena gestión con poco tiempo', name: 'Se equivoca con poco tiempo', diag: 'Gestión del reloj', hi: 0.3, min: 5, unit: 'jugadas con poco tiempo', needsClock: true,
      rule: 'Jugadas con ≤10 % del tiempo inicial (mín. 30 s) que fueron error (≥10 %).',
      tip: 'Reparte el tiempo: decide rápido en lo teórico y simple, y reserva minutos para los momentos críticos.',
      fn: (R) => { const den = R.filter(x => x.r.press && hasLoss(x)); return { den: den.length, hit: den.filter(x => x.r.loss >= 10) }; },
    },
    {
      id: 'opening', good: 'Respeta los principios de apertura', name: 'Incumple principios de apertura', diag: 'Apertura descuidada', hi: 0.6, min: 4, unit: 'partidas', level: 'game',
      rule: 'Partidas con enroque tardío, dama sacada pronto, ≥2 piezas menores sin desarrollar en la jugada 10 o la misma pieza movida 3 veces.',
      tip: 'Desarrolla piezas menores, controla el centro, enroca pronto y no muevas la misma pieza varias veces sin motivo.',
      fn: (R, U) => {
        const bad = u => { const p = u.d.principles && u.d.principles[u.side]; return !!p && (p.lateCastle || p.earlyQueen || (p.undeveloped || []).length >= 2 || (p.repeated || []).length > 0); };
        const den = U.filter(u => u.d.principles && u.d.principles[u.side] && u.d.principles[u.side].n >= 8);
        return { den: den.length, hit: den.filter(bad).map(u => ({ r: { i: 0, c: u.side, san: 'apertura' }, u })) };
      },
    },
    {
      id: 'endgame', good: 'Buena técnica en los finales', name: 'Imprecisiones en los finales', diag: 'Técnica de finales', hi: 0.12, min: 15, unit: 'jugadas de final',
      rule: 'Jugadas de final (poco material) que perdieron ≥10 %.',
      tip: 'Estudia los finales básicos (rey y peones, torres) y activa el rey; en finales cada tempo cuenta.',
      fn: (R) => { const den = R.filter(x => x.r.ph === 'endgame' && hasLoss(x)); return { den: den.length, hit: den.filter(x => x.r.loss >= 10) }; },
    },
  ];

  function diagnose(items, profile) {
    const U = usable(items, profile), R = rowsOf(U);
    const clockRows = R.filter(x => x.r.sp != null).length;
    const patterns = PATTERNS.map(p => {
      const out = { id: p.id, good: p.good, name: p.name, diag: p.diag, rule: p.rule, tip: p.tip, unit: p.unit, min: p.min };
      if (p.needsClock && !clockRows) return Object.assign(out, { score: null, level: 'na', num: 0, den: 0, rate: null, reason: 'Sin datos de reloj en tus partidas (el PGN necesita [%clk]).', examples: [] });
      const { den, hit } = p.fn(R, U);
      const num = hit.length, rate = pct(num, den);
      const score = den >= p.min ? Math.round(100 * Math.min(1, rate / p.hi)) : null;
      const examples = hit.slice().sort((a, b) => (b.r.loss || 0) - (a.r.loss || 0)).slice(0, 5).map(x => ex(x));
      return Object.assign(out, { num, den, rate, score, level: levelOf(score), examples, reason: score == null ? `Muestra insuficiente (${den} de ${p.min} ${p.unit} necesarias).` : null });
    });
    const scored = patterns.filter(p => p.score != null);
    const weak = scored.filter(p => p.score >= 34).sort((a, b) => b.score - a.score);
    const strong = scored.filter(p => p.score < 20).sort((a, b) => a.score - b.score);
    return { games: U.length, moves: R.filter(hasLoss).length, patterns, weak, strong, phases: phaseStats(R), natures: natureStats(R), summary: summary(U, R) };
  }

  function summary(U, R) {
    const mv = R.filter(hasLoss), accOf = C.util ? C.util.accOfLoss : (l => 100 - l);
    const wdl = { w: 0, d: 0, l: 0, n: 0 };
    for (const u of U) { const s = C.pgn.scoreFor(u.d.result, u.side); if (s == null) continue; wdl.n++; if (s === 1) wdl.w++; else if (s === 0.5) wdl.d++; else wdl.l++; }
    const counts = {}; (C.util ? C.util.CLASS_ORDER : []).forEach(k => (counts[k] = 0)); mv.forEach(x => counts[x.r.cls]++);
    return { acc: mv.length ? +mean(mv.map(x => accOf(x.r.loss))).toFixed(1) : null, acpl: mv.length ? Math.round(mean(mv.map(x => x.r.cpl))) : null, counts, wdl, games: U.length, moves: mv.length };
  }

  function phaseStats(R) {
    const accOf = C.util.accOfLoss, res = {};
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const m = R.filter(x => x.r.ph === ph && hasLoss(x));
      res[ph] = { n: m.length, acc: m.length ? +mean(m.map(x => accOf(x.r.loss))).toFixed(1) : null, acpl: m.length ? Math.round(mean(m.map(x => x.r.cpl))) : null, errRate: m.length ? pct(m.filter(x => x.r.loss >= 10).length, m.length) : null };
    }
    return res;
  }

  const NAT_LABEL = {
    mate: 'No ve un mate propio', allowmate: 'Permite un mate al rival', tactic: 'Permite una táctica del rival', sac: 'Sacrificio sin compensación', hang: 'Deja una pieza en prise', calc: 'Error de cálculo en jugada forzada',
    adv: 'Entrega una ventaja ganadora', pas: 'Jugada pasiva', pos: 'Error posicional / plan',
  };
  /** Cómo se producen tus errores (≥10 %): distribución por naturaleza. */
  function natureStats(R) {
    const m = R.filter(x => x.r.nat), total = m.length, by = {};
    m.forEach(x => (by[x.r.nat] = by[x.r.nat] || []).push(x));
    return Object.keys(by).map(k => ({ id: k, label: NAT_LABEL[k] || k, n: by[k].length, share: pct(by[k].length, total), examples: by[k].sort((a, b) => b.r.loss - a.r.loss).slice(0, 4).map(x => ex(x)) })).sort((a, b) => b.n - a.n);
  }

  /* ================= 2. repertorio de aperturas ================= */
  function openingOf(g) { return (g.derived && g.derived.opening) || (g.meta && g.meta.opening) || null; }
  function sansOf(g) { return (g.meta && g.meta.sans) || (g.derived && g.derived.moves ? g.derived.moves.slice(0, 16).map(m => m.san) : []); }
  function resultOf(g) { return (g.headers && g.headers.Result) || (g.derived && g.derived.result) || '*'; }

  function openingsReport(items, profile) {
    const map = {};
    for (const g of items || []) {
      const side = sideOf(g, profile), op = openingOf(g);
      if (!side || !op) continue;
      const key = side + '|' + op.family;
      const e = map[key] = map[key] || { key, side, family: op.family, games: [], w: 0, d: 0, l: 0, variations: {}, replies: {}, lines: {}, ids: [] };
      e.games.push(g); e.ids.push(g.id);
      const s = C.pgn.scoreFor(resultOf(g), side);
      if (s === 1) e.w++; else if (s === 0.5) e.d++; else if (s === 0) e.l++;
      const v = op.variation || '(sin variante concreta)';
      e.variations[v] = (e.variations[v] || 0) + 1;
      const sans = sansOf(g);
      const reply = side === 'w' ? sans[1] && '1...' + sans[1] : sans[0] && '1.' + sans[0];
      if (reply) e.replies[reply] = (e.replies[reply] || 0) + 1;
      const line = sans.slice(0, 6).join(' ');
      if (line) e.lines[line] = (e.lines[line] || 0) + 1;
    }
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n || 3);
    const list = Object.values(map).map(e => {
      const n = e.games.length, decided = e.w + e.d + e.l;
      const an = e.games.filter(g => g.derived && g.derived.moves && sideOf(g, profile));
      const issues = openingIssues(an, e.side, profile);
      return {
        key: e.key, side: e.side, family: e.family, n, w: e.w, d: e.d, l: e.l,
        winPct: decided ? e.w / decided : null, drawPct: decided ? e.d / decided : null, lossPct: decided ? e.l / decided : null,
        score: decided ? (e.w + e.d / 2) / decided : null,
        mainVariation: top(e.variations, 1)[0] ? top(e.variations, 1)[0][0] : null,
        variations: top(e.variations, 5).map(([name, c]) => ({ name, n: c })),
        opponentReplies: top(e.replies, 4).map(([name, c]) => ({ name, n: c, share: c / n })),
        commonLine: top(e.lines, 1)[0] ? top(e.lines, 1)[0][0] : null,
        analyzed: an.length, ids: e.ids, issues,
        mainProblem: issues.length ? issues[0].text : (an.length ? 'Sin un problema recurrente detectado en la muestra' : 'Analiza estas partidas para ver los errores recurrentes'),
      };
    }).sort((a, b) => b.n - a.n);
    return { white: list.filter(x => x.side === 'w'), black: list.filter(x => x.side === 'b'), all: list };
  }

  /** Problemas recurrentes en una apertura (solo con partidas analizadas). */
  function openingIssues(games, side, profile) {
    const n = games.length, out = [];
    if (!n) return out;
    const thr = Math.max(2, Math.ceil(n * 0.3));
    const undev = {}; let late = 0, earlyQ = 0, rep = 0;
    const errMoves = {}, errAt = [];
    for (const g of games) {
      const d = g.derived, p = d.principles && d.principles[side];
      if (p) {
        if (p.lateCastle) late++;
        if (p.earlyQueen) earlyQ++;
        if (p.repeated && p.repeated.length) rep++;
        (p.undeveloped || []).forEach(u => (undev[u] = (undev[u] || 0) + 1));
      }
      const first = d.moves.find(m => m.c === side && m.ph === 'opening' && m.loss >= 10);
      if (first) { const k = moveLabel(first); errMoves[k] = (errMoves[k] || 0) + 1; errAt.push(Math.floor(first.i / 2) + 1); }
    }
    const topU = Object.entries(undev).sort((a, b) => b[1] - a[1])[0];
    if (topU && topU[1] >= thr) out.push({ kind: 'undeveloped', n: topU[1], text: `Desarrollo tardío: ${topU[0].replace(/\s*\(.*\)/, '')} sigue en casa en la jugada 10 (${topU[1]} de ${n} partidas)` });
    if (late >= thr) out.push({ kind: 'castle', n: late, text: `Enroque tardío o ausente (${late} de ${n} partidas)` });
    if (earlyQ >= thr) out.push({ kind: 'queen', n: earlyQ, text: `Dama sacada demasiado pronto (${earlyQ} de ${n} partidas)` });
    if (rep >= thr) out.push({ kind: 'repeat', n: rep, text: `Mueve la misma pieza varias veces en la apertura (${rep} de ${n} partidas)` });
    const topE = Object.entries(errMoves).sort((a, b) => b[1] - a[1])[0];
    if (topE && topE[1] >= 2) out.push({ kind: 'move', n: topE[1], text: `Repite el error ${topE[0]} (${topE[1]} veces)` });
    if (errAt.length >= thr) out.push({ kind: 'early', n: errAt.length, text: `Primer error serio en la apertura en ${errAt.length} de ${n} partidas (jugada ${Math.round(median(errAt))} en promedio)` });
    return out.sort((a, b) => b.n - a.n);
  }

  /** Compara tus jugadas con partidas de maestros. fetchMasters(fen) → {total, moves:[{uci,san,games}]} | {error}. */
  async function masterDeviation(game, side, fetchMasters, maxOwn) {
    maxOwn = maxOwn || 10;
    let own = 0;
    for (let i = 0; i < game.moves.length && own < maxOwn; i++) {
      const m = game.moves[i];
      if (m.color !== side) continue;
      own++;
      const data = await fetchMasters(game.fens[i]);
      if (!data || data.error) return { error: (data && (data.message || data.error)) || 'sin respuesta' };
      if (data.total < 30) return { out: true, atPly: i, inBook: own - 1 };
      const pm = data.moves.find(x => x.uci === m.uci);
      const share = pm ? pm.games / data.total : 0;
      if (share < 0.03) return { dev: { ply: i, san: m.san, share, total: data.total, fen: game.fens[i], top: data.moves.slice(0, 3).map(x => ({ san: x.san, share: x.games / data.total, games: x.games })) } };
    }
    return { dev: null, inBook: own };
  }

  /* ================= 3. patrones tácticos ================= */
  function tacticsReport(items, profile) {
    const U = usable(items, profile), R = rowsOf(U);
    const L = C.tactics.THEME_LABELS, themes = {};
    const t = id => (themes[id] = themes[id] || { id, label: L[id] || id, found: 0, missed: 0, allowed: 0, miss: [], all: [] });
    for (const x of R) {
      const r = x.r; if (!hasLoss(x)) continue;
      for (const th of r.bt || []) {
        const e = t(th);
        if (r.cls === 'best' || r.loss <= 3) e.found++;
        else if (r.loss >= 8) { e.missed++; e.miss.push(x); }
      }
      if (r.loss >= 10) for (const th of r.allowed || []) { const e = t(th); e.allowed++; e.all.push(x); }
    }
    const list = Object.values(themes).map(e => ({
      id: e.id, label: e.label, found: e.found, missed: e.missed, allowed: e.allowed, opp: e.found + e.missed,
      missRate: e.found + e.missed >= 2 ? e.missed / (e.found + e.missed) : null,
      examples: e.miss.sort((a, b) => b.r.loss - a.r.loss).slice(0, 4).map(x => ex(x, { best: x.r.bestSan })),
      allowedExamples: e.all.sort((a, b) => b.r.loss - a.r.loss).slice(0, 3).map(x => ex(x)),
    })).filter(e => e.opp || e.allowed).sort((a, b) => b.missed - a.missed || b.allowed - a.allowed);
    const blind = list.filter(e => e.missed >= 2 && e.missRate >= 0.4).slice(0, 4);
    const mates = R.filter(x => x.r.mm);
    const zz = [];
    for (const u of U) for (const z of u.d.zz || []) if (z.c === u.side) { const r = u.d.moves[z.i]; zz.push({ gid: u.g.id, ply: z.i + 1, san: r ? moveLabel(r) : '', d: z.d, loss: r && r.loss != null ? Math.round(r.loss) : null }); }
    return {
      games: U.length, themes: list, blind,
      extras: {
        hangMissed: { n: R.filter(x => x.r.mh).length, of: R.filter(x => x.r.ho).length, examples: R.filter(x => x.r.mh).sort((a, b) => b.r.loss - a.r.loss).slice(0, 4).map(x => ex(x)) },
        leftHanging: { n: R.filter(x => x.r.hang).length, examples: R.filter(x => x.r.hang).sort((a, b) => b.r.loss - a.r.loss).slice(0, 4).map(x => ex(x)) },
        mates: { n: mates.length, examples: mates.slice(0, 4).map(x => ex(x, { best: x.r.bestSan })) },
        calc: { n: R.filter(x => x.r.ff).length, of: R.filter(x => x.r.fc && hasLoss(x)).length, examples: R.filter(x => x.r.ff).sort((a, b) => b.r.loss - a.r.loss).slice(0, 4).map(x => ex(x)) },
        zugzwang: { n: zz.length, bad: zz.filter(z => z.loss != null && z.loss >= 10).length, examples: zz.slice(0, 4) },
      },
    };
  }

  /* ================= 4. tiempo, decisiones y ritmo ================= */
  function timeReport(items, profile) {
    const U = usable(items, profile).filter(u => u.d.hasClock), R = rowsOf(U).filter(x => x.r.sp != null);
    if (!R.length) return { games: 0 };
    const err = a => { const m = a.filter(hasLoss); return { n: m.length, err: m.length ? pct(m.filter(x => x.r.loss >= 10).length, m.length) : null }; };
    const avg = a => { const v = a.map(x => x.r.sp); return { n: a.length, avg: mean(v), med: median(v) }; };
    const sp = R.map(x => x.r.sp);
    const byPhase = {}; for (const ph of ['opening', 'middlegame', 'endgame']) byPhase[ph] = avg(R.filter(x => x.r.ph === ph));
    const simple = R.filter(x => !x.r.cx), complex = R.filter(x => x.r.cx);
    const rest = R.filter(x => !x.r.fast && !x.r.press);
    return {
      games: U.length, moves: R.length, avg: mean(sp), median: median(sp), byPhase,
      simple: Object.assign(avg(simple), err(simple)), complex: Object.assign(avg(complex), err(complex)),
      fast: Object.assign(avg(R.filter(x => x.r.fast)), err(R.filter(x => x.r.fast))),
      long: Object.assign(avg(R.filter(x => x.r.long)), err(R.filter(x => x.r.long))),
      press: Object.assign(avg(R.filter(x => x.r.press)), err(R.filter(x => x.r.press))),
      normal: err(rest),
      fastComplex: err(R.filter(x => x.r.fast && x.r.cx)),
      crit: Object.assign(avg(R.filter(x => x.r.crit)), err(R.filter(x => x.r.crit))),
    };
  }

  /** Rendimiento por ritmo (bullet, blitz, rapid, classical): usa todas las partidas analizadas del jugador. */
  function paceReport(items, profile) {
    const U = usable(items, profile), res = {};
    for (const cat of ['bullet', 'blitz', 'rapid', 'classical', 'unknown']) {
      const G = U.filter(u => (u.d.tc && u.d.tc.cat || 'unknown') === cat);
      if (!G.length) continue;
      const R = rowsOf(G).filter(hasLoss), accOf = C.util.accOfLoss;
      let w = 0, d = 0, l = 0;
      G.forEach(u => { const s = C.pgn.scoreFor(u.d.result, u.side); if (s === 1) w++; else if (s === 0.5) d++; else if (s === 0) l++; });
      res[cat] = { games: G.length, acc: R.length ? +mean(R.map(x => accOf(x.r.loss))).toFixed(1) : null, blunders: R.length ? pct(R.filter(x => x.r.cls === 'blunder').length, R.length) : null, w, d, l };
    }
    return res;
  }

  /** Mapa de momentos críticos de UNA partida: [{i, c, sp, left, cx, crit, loss, cls}] */
  function criticalMap(d) {
    return d.moves.map(r => ({ i: r.i, c: r.c, san: r.san, sp: r.sp == null ? null : r.sp, left: r.left == null ? null : r.left, cx: !!r.cx, crit: !!r.crit, loss: r.loss == null ? null : r.loss, cls: r.cls || null, fast: !!r.fast, long: !!r.long }));
  }

  C.coach = { NAT_LABEL, moveLabel, sideOf, usable, PATTERNS, diagnose, openingsReport, openingIssues, masterDeviation, tacticsReport, timeReport, paceReport, criticalMap, levelOf };
})();
