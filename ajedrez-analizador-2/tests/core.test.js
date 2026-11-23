/* Prueba de integración del núcleo (Node ≥ 18) con Stockfish nativo.
 *   node tests/core.test.js [ruta-a-stockfish]
 * Carga los mismos módulos que usa el navegador, analiza partidas reales y comprueba el resultado. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SF = process.argv[2] || process.env.STOCKFISH_PATH || ['/usr/games/stockfish', '/usr/bin/stockfish', '/usr/local/bin/stockfish'].find(p => fs.existsSync(p));
if (!SF) { console.error('No se encontró Stockfish. Pasa la ruta como argumento.'); process.exit(2); }

/* ---------- entorno de módulos (igual que el navegador) ---------- */
const ctx = vm.createContext({ console, setTimeout, clearTimeout, Date, Math, JSON, fetch: undefined });
ctx.globalThis = ctx;
const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
load('vendor/chess.js');
['pgn', 'tactics', 'openings', 'analysis', 'engine', 'coach', 'training'].forEach(n => load(`assets/js/${n}.js`));
const C = ctx.Coach;

/* ---------- motor nativo con la misma interfaz que el adaptador del navegador ---------- */
class NativeEngine {
  constructor() {
    this.p = spawn(SF); this.buf = ''; this.h = []; this.mpv = 1; this.chain = Promise.resolve();
    this.p.stdout.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.h.slice().forEach(f => f(l)); } });
  }
  send(s) { this.p.stdin.write(s + '\n'); }
  wait(pred) { return new Promise(res => { const f = l => { if (pred(l)) { this.h = this.h.filter(x => x !== f); res(l); } }; this.h.push(f); }); }
  async init() { this.send('uci'); await this.wait(l => l === 'uciok'); this.send('isready'); await this.wait(l => l === 'readyok'); }
  analyze(fen, depth, mpv) { const run = () => this._a(fen, depth, mpv || 1); const p = this.chain.then(run, run); this.chain = p.catch(() => {}); return p; }
  _a(fen, depth, mpv) {
    return new Promise(res => {
      const lines = [];
      const f = l => {
        if (l.startsWith('info') && l.includes(' pv ') && !/(lower|upper)bound/.test(l)) {
          const mm = l.match(/ multipv (\d+)/), sc = l.match(/ score (cp|mate) (-?\d+)/);
          if (sc) lines[(mm ? +mm[1] : 1) - 1] = { cp: sc[1] === 'cp' ? +sc[2] : C.engine.mateToCp(+sc[2]), pv: l.split(' pv ')[1].trim().split(/\s+/) };
        } else if (l.startsWith('bestmove')) { this.h = this.h.filter(x => x !== f); res({ lines: lines.filter(Boolean) }); }
      };
      this.h.push(f);
      if (mpv !== this.mpv) { this.send('setoption name MultiPV value ' + mpv); this.mpv = mpv; }
      this.send('position fen ' + fen); this.send('go depth ' + depth);
    });
  }
  close() { this.send('quit'); }
}

/* ---------- utilidades de prueba ---------- */
let pass = 0, fail = 0;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); } };
const clk = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60); return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; };

/** Construye un PGN con relojes: spent[i] = segundos gastados en la semijugada i. */
function withClocks(headers, sans, spent, base) {
  let out = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n';
  const left = { 0: base, 1: base };
  sans.forEach((s, i) => {
    const c = i % 2; left[c] = Math.max(1, left[c] - (spent[i] == null ? 4 : spent[i]));
    out += (c === 0 ? `${i / 2 + 1}. ` : '') + `${s} {[%clk ${clk(left[c])}]} `;
  });
  return out.trim() + ' ' + (headers.Result || '*');
}
const H = (w, b, res, extra) => Object.assign({ Event: 'Prueba', Date: '2026.11.01', White: w, Black: b, Result: res, TimeControl: '180+0', WhiteElo: '1400', BlackElo: '1450' }, extra || {});

const GAMES = {
  // el jugador (Tester) con Blancas sacrifica en el Hígado Frito y gana jugando rápido
  fried: withClocks(H('Tester', 'Rival1', '1-0'), 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Ncb4 O-O c6 d4 Kd7'.split(' ').concat(['Rd1']), [2, 2, 3, 3, 4, 3, 2, 3, 2, 4, 1, 3, 1, 4, 3, 6, 2, 5, 2, 9, 3], 180),
  // Tester con Negras cae en el mate del pastor
  scholar: withClocks(H('Rival2', 'Tester', '1-0'), 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#'.split(' '), [2, 2, 3, 2, 3, 1, 5], 180),
  // Siciliana Najdorf del jugador con Negras
  sicilian: withClocks(H('Rival3', 'Tester', '0-1', { ECO: 'B90' }), 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5 g5 b4 Ne2 Ne8 f4 a5'.split(' '), [], 180),
  // Ruy López, Tester con Blancas
  ruy: withClocks(H('Tester', 'Rival4', '1/2-1/2'), 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7'.split(' '), [], 180),
};

(async () => {
  const eng = new NativeEngine();
  await eng.init();
  const DEPTH = 10;

  console.log('\n[PGN]');
  const multi = Object.values(GAMES).join('\n\n\n');
  const parts = C.pgn.splitGames(multi);
  ok(parts.length === 4, 'splitGames separa 4 partidas', parts.length);
  const parsed = {};
  for (const [k, v] of Object.entries(GAMES)) parsed[k] = C.pgn.parseGame(v);
  ok(Object.values(parsed).every(g => !g.error), 'todas las partidas se leen sin jugadas ilegales', Object.values(parsed).map(g => g.error));
  ok(parsed.scholar.moves.length === 7 && /#$/.test(parsed.scholar.moves[6].san), 'mate del pastor: 7 semijugadas y mate');
  ok(parsed.fried.hasClock && parsed.fried.moves[0].clk != null, 'se leen los relojes %clk');
  ok(parsed.fried.tc.cat === 'blitz', 'ritmo 180+0 → blitz', parsed.fried.tc);
  ok(C.pgn.parseGame('[Event "x"]\n\n1. e4 e5 2. Ke4').error != null, 'jugada ilegal se reporta como error');
  const lichessStyle = C.pgn.parseGame('[White "a"]\n[Black "b"]\n[Result "1-0"]\n\n1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Nf3 $1 Nc6?! (2... d6 3. d4) 1-0');
  ok(!lichessStyle.error && lichessStyle.moves.length === 4 && lichessStyle.moves[0].clk === 180, 'formato Lichess (comentarios, NAG, variantes) se lee bien', lichessStyle.error);

  console.log('\n[Análisis con Stockfish real, MultiPV 2, profundidad ' + DEPTH + ']');
  const stored = {};
  let t0 = Date.now();
  for (const [k, g] of Object.entries(parsed)) {
    const r = await C.analysis.analyzeGame(g, { depth: DEPTH, multipv: 2, zugzwang: true }, eng, {});
    ok(r && r.analysis.evals.every(v => typeof v === 'number'), `${k}: evaluación de las ${g.fens.length} posiciones`);
    const rec = { id: k.padEnd(40, '0'), headers: g.headers, side: null, analysis: r.analysis, derived: JSON.parse(JSON.stringify(r.derived)), meta: { sans: g.moves.slice(0, 16).map(m => m.san), opening: r.derived.opening } };
    stored[k] = rec;
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  stored.fried.side = 'w'; stored.scholar.side = 'b'; stored.sicilian.side = 'b'; stored.ruy.side = 'w';

  console.log('\n[Clasificación y rasgos]');
  const sch = stored.scholar.derived.moves;
  const nf6 = sch[5];
  ok(nf6.san === 'Nf6' && ['blunder', 'mistake'].includes(nf6.cls), 'mate del pastor: 3...Nf6 se marca como error/error grave', { cls: nf6.cls, loss: nf6.loss });
  ok(nf6.bestSan && nf6.bestSan !== 'Nf6', 'se indica la mejor jugada alternativa', nf6.bestSan);
  ok(stored.scholar.derived.exercises.some(e => e.played === 'g8f6'), 'se genera un ejercicio con ese error');
  ok(nf6.ma === 1 && nf6.nat === 'allowmate', '3...Nf6 se explica como «permite un mate» (no como error posicional)', { ma: nf6.ma, nat: nf6.nat });
  ok(/#/.test(sch[6].san) && sch[6].cls === 'best', 'Qxf7# es la mejor jugada');
  const sacMove = stored.fried.derived.moves.find(m => m.san === 'Nxf7');
  ok(sacMove && sacMove.sac === 1, 'Nxf7 (Hígado Frito) detectado como sacrificio', sacMove);
  const strat = stored.fried.derived.stats.w;
  ok(strat.acc > 0 && strat.acc <= 100 && strat.n === 11, 'estadísticas de precisión del bando', strat);
  ok(stored.sicilian.derived.opening.variation === 'Najdorf', 'Siciliana Najdorf reconocida', stored.sicilian.derived.opening);
  ok(stored.ruy.derived.opening.family === 'Ruy López', 'Ruy López reconocida', stored.ruy.derived.opening);
  ok(stored.fried.derived.moves.some(m => m.sp != null && m.left != null), 'tiempos por jugada calculados');
  ok(JSON.stringify(stored.fried.derived).length < 200000, 'el registro derivado es compacto', JSON.stringify(stored.fried.derived).length);

  console.log('\n[Diagnóstico de patrones]');
  const items = Object.values(stored);
  const profile = { names: ['tester'] };
  const noSide = items.map(g => Object.assign({}, g, { side: null }));
  ok(C.coach.usable(noSide, profile).length === 4, 'bando detectado automáticamente por nombre ("Tester")');
  ok(C.coach.usable(noSide, {}).length === 0, 'sin nombre ni bando no se analiza ninguna partida');
  ok(C.coach.usable(noSide, { defaultSide: 'w' }).length === 4, 'bando por defecto del perfil');
  const diag = C.coach.diagnose(items, profile);
  ok(diag.games === 4 && diag.patterns.length >= 10, 'tabla de patrones con puntuación', { games: diag.games, n: diag.patterns.length });
  ok(diag.patterns.every(p => p.score === null || (p.score >= 0 && p.score <= 100)), 'las puntuaciones están en 0–100');
  ok(diag.patterns.filter(p => p.score == null).every(p => p.reason), 'cada patrón sin muestra explica por qué');
  ok(diag.patterns.find(p => p.id === 'sac').den >= 1, 'patrón de sacrificios cuenta la partida del Hígado Frito', diag.patterns.find(p => p.id === 'sac'));
  ok(diag.summary.wdl.n === 4 && diag.summary.wdl.w === 2, 'balance de resultados (2 victorias de 4)', diag.summary.wdl);
  ok(diag.phases.opening.n > 0, 'estadísticas por fase');
  console.log('   ', diag.patterns.map(p => `${p.id}:${p.score == null ? '—' : p.score}(${p.num}/${p.den})`).join('  '));

  console.log('\n[Aperturas]');
  const op = C.coach.openingsReport(items, profile);
  ok(op.white.length >= 2 && op.black.length >= 2, 'repertorio separado en blancas y negras', { w: op.white.map(x => x.family), b: op.black.map(x => x.family) });
  const sic = op.black.find(x => x.family === 'Defensa Siciliana');
  ok(sic && sic.n === 1 && sic.w === 1 && sic.mainVariation === 'Najdorf', 'Siciliana: 1 partida, 1 victoria, variante Najdorf', sic && { n: sic.n, w: sic.w, v: sic.mainVariation });
  ok(sic && sic.opponentReplies[0].name === '1.e4', 'respuesta del rival detectada (1.e4)', sic && sic.opponentReplies);
  ok(typeof sic.mainProblem === 'string' && sic.mainProblem.length > 0, 'siempre hay un diagnóstico de apertura');
  // desviación respecto a maestros con un explorador simulado
  const fake = async fen => fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP') ? { total: 1000, moves: [{ uci: 'e2e4', san: 'e4', games: 600 }, { uci: 'd2d4', san: 'd4', games: 390 }, { uci: 'a2a3', san: 'a3', games: 10 }] } : { total: 10, moves: [] };
  const dv1 = await C.coach.masterDeviation(parsed.fried, 'w', fake);
  ok(dv1.out === true || dv1.dev === null, 'maestros: 1.e4 está en la teoría');
  const bookless = C.pgn.parseGame('[White "a"]\n[Black "b"]\n\n1. a3 e5 *');
  const dv2 = await C.coach.masterDeviation(bookless, 'w', fake);
  ok(dv2.dev && dv2.dev.san === 'a3' && dv2.dev.top[0].san === 'e4', 'maestros: 1.a3 se marca como desviación y se sugiere 1.e4', dv2);
  const dv3 = await C.coach.masterDeviation(bookless, 'w', async () => ({ error: 'no_token', message: 'sin token' }));
  ok(dv3.error === 'sin token', 'maestros: el error de autenticación se propaga sin inventar datos');

  console.log('\n[Tácticas]');
  const tac = C.coach.tacticsReport(items, profile);
  ok(Array.isArray(tac.themes) && tac.extras.hangMissed && tac.extras.zugzwang, 'informe táctico completo');
  console.log('   ', tac.themes.slice(0, 6).map(t => `${t.id}: ${t.found} vistos / ${t.missed} pasados`).join(' | ') || '(sin temas)');
  const posThemes = C.tactics.analyzeMove('rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2', 'g8f6', {});
  ok(posThemes && posThemes.san === 'Nf6', 'analyzeMove funciona suelto');
  // tácticas conocidas: ataque doble (caballo), clavada, ataque descubierto
  const fork = C.tactics.analyzeMove('r3k3/8/8/3N4/8/8/8/R3K3 w - - 0 1', 'd5c7', {});
  ok(fork && fork.themes.includes('fork'), 'ataque doble detectado (Cc7+ a rey y torre)', fork && fork.themes);
  const pin = C.tactics.analyzeMove('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5', {});
  ok(pin && pin.themes.includes('pin'), 'clavada detectada (Ab5 clava el caballo c6 contra el rey)', pin && pin.themes);
  const disc = C.tactics.analyzeMove('4q1k1/8/8/8/4N3/8/8/4R1K1 w - - 0 1', 'e4g5', {});
  ok(disc && disc.themes.includes('discovered'), 'ataque descubierto detectado (el caballo libera la torre contra la dama)', disc && disc.themes);
  const hang = C.tactics.analyzeMove('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', 'd1d5', {});
  ok(hang && hang.themes.includes('hanging'), 'captura de pieza indefensa detectada', hang && hang.themes);

  console.log('\n[Tiempo]');
  const tm = C.coach.timeReport(items, profile);
  ok(tm.games === 4 && tm.moves > 20 && tm.avg > 0, 'informe de tiempo con relojes', { games: tm.games, moves: tm.moves });
  ok(C.coach.timeReport(items.map(g => Object.assign({}, g, { derived: Object.assign({}, g.derived, { hasClock: false }) })), profile).games === 0, 'sin relojes → informe vacío explícito');
  const pace = C.coach.paceReport(items, profile);
  ok(pace.blitz && pace.blitz.games === 4, 'rendimiento por ritmo (blitz)', pace);
  ok(C.coach.criticalMap(stored.fried.derived).length === stored.fried.derived.moves.length, 'mapa de momentos críticos');

  console.log('\n[Entrenador]');
  let st = C.training.emptyState();
  const s = C.training.sync(st, items, profile);
  st = s.state;
  ok(s.added >= 1, 'ejercicios generados de tus errores', s.added);
  ok(C.training.sync(st, items, profile).added === 0, 'sincronizar de nuevo no duplica ejercicios');
  const q = C.training.queue(st);
  ok(q.due.length === s.added, 'la cola contiene los ejercicios nuevos');
  const exr = st.items[Object.keys(st.items).find(k => st.items[k].played === 'g8f6')] || q.due[0];
  const rBest = await C.training.evaluate(exr, exr.best, eng, DEPTH);
  ok(rBest.kind === 'best' && rBest.ok, 'responder la mejor jugada → correcto', rBest);
  const rBad = await C.training.evaluate(exr, exr.played, eng, DEPTH);
  ok(rBad.kind === 'bad' && !rBad.ok && rBad.wasMistake, 'repetir el error original → incorrecto', rBad);
  // una jugada que no está en las líneas guardadas se evalúa con el motor
  const legal = new ctx.Chess(exr.fen).moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
  const other = legal.find(u => u !== exr.best && u !== exr.played && !(exr.lines || []).some(l => l.u === u));
  const rOther = await C.training.evaluate(exr, other, eng, DEPTH);
  ok(rOther.from === 'motor' && typeof rOther.lossPct === 'number', 'jugada nueva evaluada con Stockfish', { other, from: rOther.from, loss: rOther.lossPct });
  C.training.record(st, exr.key, rBad, 1000);
  ok(st.items[exr.key].box === 0 && st.items[exr.key].due === 1000, 'fallo → caja 0 y se repite enseguida');
  C.training.record(st, exr.key, rBest, 2000);
  ok(st.items[exr.key].box === 1 && st.items[exr.key].due === 2000 + 86400000, 'acierto → caja 1 y repaso en 1 día');
  C.training.record(st, exr.key, rBest, 3000);
  ok(st.items[exr.key].box === 2, 'otro acierto → caja 2');
  const pg = C.training.progress(st, 4000);
  ok(pg.attempts === 3 && pg.correct === 2 && Math.abs(pg.rate - 2 / 3) < 1e-9 && pg.streak === 2, 'progreso: intentos, aciertos y racha', pg);
  ok(pg.firstTryRate === 0, 'acierto a la primera: este ejercicio falló en el primer intento', pg.firstTryRate);
  const roundtrip = JSON.parse(JSON.stringify(st));
  ok(C.training.progress(roundtrip, 4000).attempts === 3, 'el estado sobrevive a JSON (guardado en el servidor)');

  eng.close();
  console.log(`\n${pass} correctas, ${fail} fallidas`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
