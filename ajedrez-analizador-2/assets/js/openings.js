/* openings.js — reconocimiento de aperturas (tabla compacta) y revisión de principios de apertura */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});

  // [secuencia SAN, familia, variante]  — gana la coincidencia más larga
  const T = [
    ['e4', 'Apertura de peón rey', ''],
    ['e4 e5', 'Juego abierto (1.e4 e5)', ''],
    ['e4 e5 Nf3', 'Juego abierto (1.e4 e5)', '2.Cf3'],
    ['e4 e5 Nf3 Nc6 Bb5', 'Ruy López', ''],
    ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy López', 'Morphy (3...a6)'],
    ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4', 'Ruy López', 'Variante abierta'],
    ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', 'Ruy López', 'Variante cerrada'],
    ['e4 e5 Nf3 Nc6 Bb5 a6 Bxc6', 'Ruy López', 'Variante del cambio'],
    ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'Ruy López', 'Defensa Berlín'],
    ['e4 e5 Nf3 Nc6 Bb5 f5', 'Ruy López', 'Gambito Schliemann'],
    ['e4 e5 Nf3 Nc6 Bc4', 'Apertura Italiana', ''],
    ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Apertura Italiana', 'Giuoco Piano'],
    ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'Apertura Italiana', 'Giuoco Piano, c3'],
    ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'Apertura Italiana', 'Gambito Evans'],
    ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Apertura Italiana', 'Defensa de los dos caballos'],
    ['e4 e5 Nf3 Nc6 d4', 'Apertura Escocesa', ''],
    ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'Partida de los cuatro caballos', ''],
    ['e4 e5 Nf3 Nc6 Nc3', 'Apertura de los tres caballos', ''],
    ['e4 e5 Nf3 Nf6', 'Defensa Petrov', ''],
    ['e4 e5 Nf3 d6', 'Defensa Philidor', ''],
    ['e4 e5 f4', 'Gambito de Rey', ''],
    ['e4 e5 Nc3', 'Apertura Vienesa', ''],
    ['e4 e5 Bc4', 'Apertura del Alfil', ''],
    ['e4 e5 d4', 'Apertura del Centro', ''],
    ['e4 c5', 'Defensa Siciliana', ''],
    ['e4 c5 Nf3', 'Defensa Siciliana', 'Variante abierta (2.Cf3)'],
    ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Defensa Siciliana', 'Najdorf'],
    ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'Defensa Siciliana', 'Dragón'],
    ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6', 'Defensa Siciliana', 'Scheveningen'],
    ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6', 'Defensa Siciliana', 'Variante clásica'],
    ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6', 'Defensa Siciliana', 'Dragón acelerado'],
    ['e4 c5 Nf3 e6', 'Defensa Siciliana', 'Variante con ...e6'],
    ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6', 'Defensa Siciliana', 'Taimanov'],
    ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6', 'Defensa Siciliana', 'Kan'],
    ['e4 c5 Nf3 Nc6 Bb5', 'Defensa Siciliana', 'Rossolimo'],
    ['e4 c5 c3', 'Defensa Siciliana', 'Alapin'],
    ['e4 c5 Nc3', 'Defensa Siciliana', 'Variante cerrada'],
    ['e4 c5 d4 cxd4 c3', 'Defensa Siciliana', 'Gambito Smith-Morra'],
    ['e4 e6', 'Defensa Francesa', ''],
    ['e4 e6 d4 d5', 'Defensa Francesa', ''],
    ['e4 e6 d4 d5 Nc3 Bb4', 'Defensa Francesa', 'Winawer'],
    ['e4 e6 d4 d5 Nc3 Nf6', 'Defensa Francesa', 'Variante clásica'],
    ['e4 e6 d4 d5 e5', 'Defensa Francesa', 'Variante del avance'],
    ['e4 e6 d4 d5 Nd2', 'Defensa Francesa', 'Tarrasch'],
    ['e4 e6 d4 d5 exd5', 'Defensa Francesa', 'Variante del cambio'],
    ['e4 c6', 'Defensa Caro-Kann', ''],
    ['e4 c6 d4 d5 e5', 'Defensa Caro-Kann', 'Variante del avance'],
    ['e4 c6 d4 d5 Nc3 dxe4 Nxe4', 'Defensa Caro-Kann', 'Variante clásica'],
    ['e4 c6 d4 d5 exd5 cxd5', 'Defensa Caro-Kann', 'Variante del cambio'],
    ['e4 c6 d4 d5 Nd2', 'Defensa Caro-Kann', 'Variante Nd2'],
    ['e4 d5', 'Defensa Escandinava', ''],
    ['e4 d5 exd5 Qxd5', 'Defensa Escandinava', 'Dama recapturando'],
    ['e4 d5 exd5 Nf6', 'Defensa Escandinava', 'Variante con ...Cf6'],
    ['e4 d6', 'Defensa Pirc / Moderna', ''],
    ['e4 d6 d4 Nf6 Nc3 g6', 'Defensa Pirc / Moderna', 'Pirc'],
    ['e4 g6', 'Defensa Pirc / Moderna', 'Defensa Moderna'],
    ['e4 Nf6', 'Defensa Alekhine', ''],
    ['e4 Nc6', 'Defensa Nimzowitsch', ''],
    ['d4', 'Apertura de peón dama', ''],
    ['d4 d5', 'Peón dama (1.d4 d5)', ''],
    ['d4 d5 c4', 'Gambito de Dama', ''],
    ['d4 d5 c4 e6', 'Gambito de Dama', 'Rechazado'],
    ['d4 d5 c4 dxc4', 'Gambito de Dama', 'Aceptado'],
    ['d4 d5 c4 c6', 'Defensa Eslava', ''],
    ['d4 d5 Bf4', 'Sistema Londres', ''],
    ['d4 d5 Nf3 Nf6 Bf4', 'Sistema Londres', ''],
    ['d4 Nf6 Bf4', 'Sistema Londres', ''],
    ['d4 Nf6', 'Defensas indias', ''],
    ['d4 Nf6 c4', 'Defensas indias', ''],
    ['d4 Nf6 c4 g6', 'Defensa India de Rey', ''],
    ['d4 Nf6 c4 g6 Nc3 d5', 'Defensa Grünfeld', ''],
    ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6', 'Defensa India de Rey', 'Variante clásica'],
    ['d4 Nf6 c4 e6 Nc3 Bb4', 'Defensa Nimzoindia', ''],
    ['d4 Nf6 c4 e6 Nf3 b6', 'Defensa India de Dama', ''],
    ['d4 Nf6 c4 e6 g3', 'Apertura Catalana', ''],
    ['d4 Nf6 c4 c5', 'Defensa Benoni', ''],
    ['d4 f5', 'Defensa Holandesa', ''],
    ['c4', 'Apertura Inglesa', ''],
    ['c4 e5', 'Apertura Inglesa', 'Siciliana invertida'],
    ['c4 c5', 'Apertura Inglesa', 'Simétrica'],
    ['c4 Nf6', 'Apertura Inglesa', 'Defensa india'],
    ['Nf3', 'Apertura Réti / Cf3', ''],
    ['Nf3 d5 c4', 'Apertura Réti / Cf3', 'Gambito Réti'],
    ['Nf3 d5 g3', 'Apertura Réti / Cf3', 'Ataque indio de rey'],
    ['g3', 'Apertura g3', ''],
    ['b3', 'Apertura Larsen', ''],
    ['f4', 'Apertura Bird', ''],
    ['b4', 'Apertura Polaca', ''],
    ['e3', 'Apertura e3', ''],
  ].map(([seq, fam, v]) => ({ seq: seq.split(' '), fam, v }));

  const norm = s => s.replace(/[+#?!]/g, '');

  function identify(sans, headers) {
    const s = sans.slice(0, 16).map(norm);
    let best = null;
    for (const e of T) {
      if (e.seq.length > s.length) continue;
      let ok = true;
      for (let i = 0; i < e.seq.length; i++) if (e.seq[i] !== s[i]) { ok = false; break; }
      if (ok && (!best || e.seq.length > best.seq.length)) best = e;
    }
    headers = headers || {};
    const eco = headers.ECO && headers.ECO !== '?' ? headers.ECO : null;
    if (best) return { family: best.fam, variation: best.v, eco, plies: best.seq.length };
    if (headers.Opening && headers.Opening !== '?') {
      const [fam, ...rest] = headers.Opening.split(':');
      return { family: fam.trim(), variation: rest.join(':').trim(), eco, plies: 0 };
    }
    return { family: sans.length ? 'Otra apertura (' + sans.slice(0, 2).map(norm).join(' ') + '…)' : 'Sin jugadas', variation: '', eco, plies: 0 };
  }

  const HOME = {
    w: { b1: ['n', 'caballo de dama'], g1: ['n', 'caballo de rey'], c1: ['b', 'alfil de casillas oscuras'], f1: ['b', 'alfil de casillas claras'] },
    b: { b8: ['n', 'caballo de dama'], g8: ['n', 'caballo de rey'], c8: ['b', 'alfil de casillas claras'], f8: ['b', 'alfil de casillas oscuras'] },
  };

  function homeMinors(fen, color) {
    const P = C.tactics.parseFen(fen), res = [];
    for (const [sq, [t, name]] of Object.entries(HOME[color])) {
      const ch = P.b[C.tactics.sqIdx(sq)];
      if (ch && ch.toLowerCase() === t && C.tactics.colorOf(ch) === color) res.push(name + ' (' + sq + ')');
    }
    return res;
  }

  /** Revisa principios de apertura de un bando: enroque, desarrollo, dama temprana, repetición de piezas. */
  function principles(game, color) {
    const own = [];
    game.moves.forEach((m, i) => { if (m.color === color) own.push(i); });
    const res = { n: own.length, castledAt: null, lateCastle: false, undeveloped: [], earlyQueen: false, repeated: [] };
    own.slice(0, 12).forEach((i, k) => {
      if (/[kq]/.test(game.moves[i].flags) && res.castledAt == null) res.castledAt = k + 1;
    });
    if (own.length >= 12 && res.castledAt == null) res.lateCastle = true;
    if (own.length >= 10) res.undeveloped = homeMinors(game.fens[own[9] + 1], color);
    // dama temprana
    for (let k = 0; k < Math.min(6, own.length); k++) {
      const m = game.moves[own[k]];
      if (m.piece === 'q' && !m.captured && homeMinors(game.fens[own[k] + 1], color).length >= 2) { res.earlyQueen = true; break; }
    }
    // mismas piezas movidas 3+ veces en las 10 primeras
    const idAt = {}, cnt = {};
    for (const i of own.slice(0, 10)) {
      const m = game.moves[i];
      if (m.piece === 'p' || /[kq]/.test(m.flags)) { delete idAt[m.from]; continue; }
      const id = idAt[m.from] || m.from;
      delete idAt[m.from]; idAt[m.to] = id;
      cnt[id] = (cnt[id] || 0) + 1;
    }
    for (const [id, n] of Object.entries(cnt)) if (n >= 3) res.repeated.push(id);
    return res;
  }

  C.openings = { identify, principles, homeMinors, TABLE: T };
})();
