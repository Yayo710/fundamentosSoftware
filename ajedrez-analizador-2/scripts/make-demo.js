/* Genera assets/demo.pgn: partidas de ejemplo (jugador "Demo") validadas con chess.js, con relojes [%clk]. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/chess.js'), 'utf8'), ctx);
const Chess = ctx.Chess;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const G = [
  { w: 'Demo', b: 'Rival A', r: '1-0', date: '2026.10.12', tc: '180+0', ev: 'Blitz casual', m: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Ncb4 O-O c6 d4 Kd7 Rd1' },
  { w: 'Rival B', b: 'Demo', r: '1-0', date: '2026.10.14', tc: '180+0', ev: 'Blitz casual', m: 'e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#' },
  { w: 'Rival C', b: 'Demo', r: '0-1', date: '2026.10.20', tc: '180+0', ev: 'Blitz casual', eco: 'B90', m: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5 g5 b4 Ne2 Ne8 f4 a5' },
  { w: 'Demo', b: 'Rival D', r: '1/2-1/2', date: '2026.10.25', tc: '600+0', ev: 'Rápida', m: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7' },
  { w: 'Rival E', b: 'Demo', r: '1-0', date: '2026.10.29', tc: '300+0', ev: 'Blitz', m: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 Nxe4 O-O Bxc3 d5 Bf6 Re1 Ne7 Rxe4 d6 Bg5 Bxg5 Nxg5 h6 Qe2 hxg5 Re1 Be6 dxe6 f6 Re3 Qd7' },
  { w: 'Demo', b: 'Rival F', r: '0-1', date: '2026.11.02', tc: '600+0', ev: 'Rápida', m: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5 Bxe7 Qxe7 O-O Nxc3 Rxc3 e5 Qc2 exd4 Nxd4 Nf6 h3 Rd8 Qe2 Bd7 Rd1 Rac8 Nb3 Be6 Bxe6 Qxe6 Nc5 Qe5 f4 Qxc5' },
  { w: 'Rival G', b: 'Demo', r: '0-1', date: '2026.11.05', tc: '600+0', ev: 'Rápida', m: 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O Bd3 Nbc6 Qh5 Ng6 Nf3 Qc7 Bxg6 hxg6 Qxg6 fxg6' },
  { w: 'Demo', b: 'Rival H', r: '1-0', date: '2026.11.07', tc: '600+0', ev: 'Rápida', m: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6 Bf4 Ngf6 O-O-O Be7 Ne4 Qa5 Kb1 Nxe4 Qxe4 O-O Ne5 Nxe5 Bxe5 Bf6 Bxf6 Qxf6 Qxb7' },
];
const clk = s => { s = Math.round(s); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
let out = '', kept = 0;
for (const g of G) {
  const base = +g.tc.split('+')[0], ch = new Chess(), sans = [];
  for (const s of g.m.split(' ')) { const mv = ch.move(s, { sloppy: true }); if (!mv) { console.error('ilegal, se trunca:', g.w, g.b, s); break; } sans.push(mv.san); }
  if (sans.length < 4) continue;
  const left = [base, base], h = { Event: g.ev, Site: 'Demo', Date: g.date, White: g.w, Black: g.b, Result: g.r, TimeControl: g.tc, WhiteElo: '1450', BlackElo: '1500' };
  if (g.eco) h.ECO = g.eco;
  out += Object.entries(h).map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n';
  let line = '';
  sans.forEach((s, i) => {
    const c = i % 2, scale = base / 180, spent = (i < 8 ? 1 + rnd() * 3 : 2 + rnd() * 9) * scale * (rnd() < 0.12 ? 0.25 : 1) * (rnd() < 0.08 ? 3 : 1);
    left[c] = Math.max(1, left[c] - spent);
    line += (c === 0 ? `${i / 2 + 1}. ` : '') + `${s} {[%clk ${clk(left[c])}]} `;
  });
  out += line.trim() + ' ' + g.r + '\n\n'; kept++;
}
fs.writeFileSync(path.join(__dirname, '../assets/demo.pgn'), out);
console.log('assets/demo.pgn:', kept, 'partidas');
