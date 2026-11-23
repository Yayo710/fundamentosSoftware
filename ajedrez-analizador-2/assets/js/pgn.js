/* pgn.js — lectura de PGN multi-partida con relojes (%clk) y control de tiempo */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});

  const HEADER_RE = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/;

  /** Divide un texto con muchas partidas en bloques de texto (uno por partida). */
  function splitGames(text) {
    text = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    const games = [];
    let cur = [], state = 'headers', hasContent = false;
    const flush = () => {
      if (hasContent) games.push(cur.join('\n').trim());
      cur = []; state = 'headers'; hasContent = false;
    };
    for (const line of text.split('\n')) {
      const isHeader = HEADER_RE.test(line);
      if (isHeader) {
        if (state === 'moves') flush();
        cur.push(line); hasContent = true;
      } else if (line.trim() === '') {
        cur.push(line);
      } else {
        state = 'moves'; hasContent = true; cur.push(line);
      }
    }
    flush();
    return games.filter(g => /\S/.test(g));
  }

  /** Extrae segundos de un comentario con [%clk h:mm:ss(.d)] */
  function clkFromComment(c) {
    const m = c.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
  }

  /** Tokeniza el texto de jugadas: devuelve {tokens:[{san, clk}], result} */
  function tokenize(mt) {
    const out = []; let i = 0; const n = mt.length; let result = null;
    const attach = c => {
      const clk = clkFromComment(c);
      if (clk != null && out.length) out[out.length - 1].clk = clk;
    };
    while (i < n) {
      const ch = mt[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '{') { const j = mt.indexOf('}', i); attach(mt.slice(i + 1, j < 0 ? n : j)); i = j < 0 ? n : j + 1; continue; }
      if (ch === ';') { const j = mt.indexOf('\n', i); i = j < 0 ? n : j + 1; continue; }
      if (ch === '(') {
        let d = 1; i++;
        while (i < n && d > 0) {
          if (mt[i] === '(') d++;
          else if (mt[i] === ')') d--;
          else if (mt[i] === '{') { const j = mt.indexOf('}', i); i = j < 0 ? n : j; }
          i++;
        }
        continue;
      }
      if (ch === '$') { i++; while (i < n && /\d/.test(mt[i])) i++; continue; }
      if (ch === ')' || ch === '}') { i++; continue; }
      let j = i;
      while (j < n && !/[\s{};($)]/.test(mt[j])) j++;
      let tok = mt.slice(i, j); i = j;
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) { result = tok; continue; }
      tok = tok.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
      if (!tok) continue;
      tok = tok.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
      out.push({ san: tok, clk: null });
    }
    return { tokens: out, result };
  }

  /** Control de tiempo → {base, inc, cat} (cat: bullet|blitz|rapid|classical|unknown) */
  function parseTimeControl(h) {
    let base = null, inc = 0;
    const tc = h.TimeControl;
    if (tc && /^\d+(\+\d+)?$/.test(tc)) {
      const p = tc.split('+'); base = +p[0]; inc = +(p[1] || 0);
    }
    let cat = 'unknown';
    if (base != null) {
      const est = base + 40 * inc;
      cat = est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical';
    } else {
      const s = (h.Event || '') + ' ' + (h.Speed || '') + ' ' + (h.TimeControl || '');
      const m = s.match(/bullet|blitz|rapid|classical|correspondence/i);
      if (m) cat = m[0].toLowerCase() === 'correspondence' ? 'classical' : m[0].toLowerCase();
      else if (tc && tc !== '-' && tc !== '?') cat = 'classical';
    }
    return { base, inc, cat };
  }

  /** Procesa el texto PGN de UNA partida. Devuelve el objeto de partida (con .error si hubo jugada ilegal). */
  function parseGame(raw) {
    const headers = {};
    const body = [];
    for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
      const m = line.match(HEADER_RE);
      if (m) headers[m[1]] = m[2].replace(/\\(.)/g, '$1'); else body.push(line);
    }
    const { tokens, result } = tokenize(body.join('\n'));
    const startFen = headers.FEN && headers.SetUp !== '0' ? headers.FEN : null;
    const r = startFen ? new Chess(startFen) : new Chess();
    const fens = [r.fen()];
    const moves = [];
    let error = null;
    for (const t of tokens) {
      const mv = r.move(t.san, { sloppy: true });
      if (!mv) { error = `Jugada ilegal o ilegible «${t.san}» en la semijugada ${moves.length + 1}`; break; }
      moves.push({
        san: mv.san, from: mv.from, to: mv.to, color: mv.color, piece: mv.piece,
        captured: mv.captured || null, flags: mv.flags, promotion: mv.promotion || null,
        uci: mv.from + mv.to + (mv.promotion || ''), clk: t.clk,
      });
      fens.push(r.fen());
    }
    if (!headers.Result) headers.Result = result || '*';
    return {
      headers, moves, fens, startFen, error, pgn: raw.trim(),
      result: headers.Result, tc: parseTimeControl(headers),
      hasClock: moves.some(m => m.clk != null),
    };
  }

  /** Convierte un resultado PGN en puntos del lado indicado: 1, .5, 0 o null */
  function scoreFor(result, side) {
    if (result === '1/2-1/2') return 0.5;
    if (result === '1-0') return side === 'w' ? 1 : 0;
    if (result === '0-1') return side === 'b' ? 1 : 0;
    return null;
  }

  C.pgn = { splitGames, tokenize, parseGame, parseTimeControl, scoreFor };
})();
