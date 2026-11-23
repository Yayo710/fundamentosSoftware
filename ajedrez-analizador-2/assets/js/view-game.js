/* view-game.js — vista de una partida: tablero, evaluación, errores, líneas, tiempo y lectura del entrenador */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const S = C.store, U = C.ui, { esc } = U;
  const CI = () => C.util.CLASS_INFO;

  let rec = null, game = null, ply = 0, flipped = false, tab = 'summary', board = null, showBest = true, root = null;

  const d = () => (rec && rec.derived) || null;
  const an = () => (rec && rec.analysis) || null;
  const mySide = () => (rec ? C.coach.sideOf(rec, S.profile) : null);
  const evAt = p => (an() && an().evals ? an().evals[p] : null);
  const sans = (fen, pv, n) => C.util.pvToSan(fen, pv, n);
  const TL = () => C.tactics.THEME_LABELS;

  /* ---------- apertura de una partida ---------- */
  function open(id, p) {
    const r = S.byId(id); if (!r) return false;
    rec = r; game = C.pgn.parseGame(r.pgn);
    ply = Math.max(0, Math.min(p == null ? 0 : p, game.moves.length));
    const s = mySide(); flipped = s === 'b';
    return true;
  }

  /* ---------- lectura del entrenador (solo datos reales de esta partida) ---------- */
  function insights(side) {
    const D = d(); if (!D) return [];
    const out = [], mv = D.moves.filter(r => r.c === side);
    const lab = r => `<a href="#" class="exl" data-go="${r.i + 1}">${esc(C.coach.moveLabel(r))}</a>`;
    const st = D.stats[side];
    const s = C.pgn.scoreFor(D.result, side);
    if (st && st.maxAdv >= 75 && s != null && s < 1) {
      const la = mv.find(r => r.la);
      out.push({ k: 'warn', t: `Llegaste a una posición ganadora (${st.maxAdv.toFixed(0)} % de probabilidad) y ${s === 0 ? 'perdiste' : 'no ganaste'}${la ? `: la ventaja se escapó en ${lab(la)}` : ''}. Esto es un problema de conversión.` });
    }
    mv.filter(r => r.sac && r.loss >= 10).slice(0, 2).forEach(r => out.push({ k: 'warn', t: `Sacrificio sin compensación en ${lab(r)} (−${r.loss.toFixed(0)} %). Riesgo excesivo: calcula antes qué recibes a cambio.` }));
    mv.filter(r => r.mh).slice(0, 2).forEach(r => out.push({ k: 'warn', t: `Había una pieza rival que se podía ganar y no la aprovechaste en ${lab(r)}${r.bestSan ? ` (mejor: <b>${esc(r.bestSan)}</b>)` : ''}. Falta de visión táctica.` }));
    mv.filter(r => r.hang).slice(0, 2).forEach(r => out.push({ k: 'warn', t: `${lab(r)} dejó una pieza en prise (−${r.loss.toFixed(0)} %). Revisa las amenazas del rival antes de mover.` }));
    mv.filter(r => r.mm).slice(0, 1).forEach(r => out.push({ k: 'warn', t: `Tenías mate forzado en ${lab(r)}: <b>${esc(r.bestSan || '')}</b>.` }));
    mv.filter(r => r.ff).slice(0, 2).forEach(r => out.push({ k: 'warn', t: `Captura o jaque que falló en ${lab(r)} (−${r.loss.toFixed(0)} %): errores de cálculo en jugadas forzadas.` }));
    mv.filter(r => r.fast && r.cx && r.loss >= 10).slice(0, 2).forEach(r => out.push({ k: 'warn', t: `Jugaste rápido (${U.fmtSec(r.sp)}) en una posición compleja y fue error: ${lab(r)}.` }));
    mv.filter(r => r.press && r.loss >= 10).slice(0, 1).forEach(r => out.push({ k: 'warn', t: `Error con poco tiempo en ${lab(r)} (te quedaban ${U.fmtSec(r.left)}).` }));
    mv.filter(r => r.pas && r.ba && r.loss >= 5).slice(0, 1).forEach(r => out.push({ k: 'warn', t: `Jugada pasiva en ${lab(r)}: existía una continuación activa (<b>${esc(r.bestSan || '')}</b>).` }));
    const p = D.principles && D.principles[side];
    if (p) {
      if (p.lateCastle) out.push({ k: 'warn', t: 'No enrocaste en tus primeras 12 jugadas.' });
      if (p.earlyQueen) out.push({ k: 'warn', t: 'Sacaste la dama demasiado pronto, con piezas menores sin desarrollar.' });
      if (p.undeveloped && p.undeveloped.length >= 2) out.push({ k: 'warn', t: `En la jugada 10 aún tenías sin desarrollar: ${esc(p.undeveloped.join(', '))}.` });
    }
    // errores serios que no encajan en ningún patrón anterior: se explican igualmente
    const special = r => r.sac || r.mh || r.hang || r.mm || r.ff || (r.fast && r.cx) || r.press || (r.pas && r.ba);
    mv.filter(r => r.cls && r.loss >= 10 && !special(r)).sort((a, b) => b.loss - a.loss).slice(0, 3).forEach(r => {
      const allowed = (r.allowed || []).map(t => TL()[t] || t).join(', ');
      const what = r.ma ? 'permite un <b>mate</b> al rival' : r.nat === 'tactic' ? `permite una táctica del rival (${esc(allowed)})` : 'es una jugada que pierde mucho';
      out.push({ k: 'warn', t: `${lab(r)} ${what} (−${r.loss.toFixed(0)} %).${r.bestSan ? ` Era mejor <b>${esc(r.bestSan)}</b>.` : ''} Antes de mover, revisa qué puede hacer el rival tras tu jugada.` });
    });
    const good = mv.filter(r => r.cls === 'best').length;
    if (st && st.n) out.push({ k: 'ok', t: `Jugaste la mejor jugada del motor en ${good} de ${st.n} ocasiones (${Math.round(100 * good / st.n)} %). Precisión: ${st.acc != null ? st.acc.toFixed(1) : '–'} %.` });
    if (!out.some(i => i.k === 'warn') && !mv.some(r => r.loss >= 10)) out.unshift({ k: 'ok', t: 'No se detectaron patrones de error relevantes en esta partida.' });
    return out;
  }

  /* ---------- fragmentos ---------- */
  function playerHtml(c) {
    const h = rec.headers, D = d(), name = (c === 'w' ? h.White : h.Black) || SIDE_L(c), elo = c === 'w' ? h.WhiteElo : h.BlackElo;
    const me = mySide() === c;
    const acc = D && D.stats && D.stats[c] && D.stats[c].acc != null ? D.stats[c].acc.toFixed(1) + ' %' : '';
    return `<span>${c === 'w' ? '⚪' : '⚫'} <b>${esc(name)}</b>${elo ? ` <small>(${esc(elo)})</small>` : ''}${me ? ' <em class="me">tú</em>' : ''}</span><span class="acc">${acc}</span>`;
  }
  const SIDE_L = c => (c === 'w' ? 'Blancas' : 'Negras');

  function infoHtml() {
    if (ply === 0) {
      const e = evAt(0);
      return `<div class="mv">Posición inicial</div><div class="sm">Usa ← → o pulsa una jugada.${e != null ? ' Evaluación: <b>' + C.util.fmtEval(e) + '</b>' : ''}</div>`;
    }
    const r = d() && d().moves[ply - 1], m = game.moves[ply - 1];
    const label = `${Math.floor((ply - 1) / 2) + 1}${m.color === 'w' ? '.' : '...'} ${m.san}`;
    let h = `<div class="mv">${esc(label)}`;
    if (r && r.cls) h += ` <span class="cl" style="color:${CI()[r.cls].color}">${CI()[r.cls].sym} ${CI()[r.cls].label}</span>`;
    h += '</div>';
    if (r && r.cls) {
      h += `<div class="sm">Evaluación: ${C.util.fmtEval(r.ev0)} → <b>${C.util.fmtEval(r.ev1)}</b>${r.cls !== 'best' ? ` · pierde <b>${r.loss.toFixed(1)} %</b> de probabilidad de ganar` : ''}</div>`;
      if (!['best', 'excellent', 'good'].includes(r.cls) && r.bestSan) {
        h += `<div class="sm">Era mejor <b>${esc(r.bestSan)}</b>${r.pvSan && r.pvSan.length > 1 ? ' — línea: ' + esc(r.pvSan.join(' ')) : ''}</div>`;
        if (r.bt && r.bt.length) h += `<div class="sm">Qué te perdiste: ${r.bt.map(t => `<span class="chip">${esc(TL()[t] || t)}</span>`).join(' ')}</div>`;
        if (r.allowed && r.allowed.length) h += `<div class="sm">Lo que permitiste al rival: ${r.allowed.map(t => `<span class="chip warn">${esc(TL()[t] || t)}</span>`).join(' ')}</div>`;
        if (r.nat) h += `<div class="sm">Tipo de error: ${esc(C.coach.NAT_LABEL[r.nat] || r.nat)}</div>`;
      } else if (r.only) h += '<div class="sm">Era la única jugada que mantenía la posición.</div>';
      if (r.sp != null) h += `<div class="sm">Tiempo: ${U.fmtSec(r.sp)} (${U.fmtSec(r.left)} restantes)${r.fast ? ' · <span class="chip">rápida</span>' : ''}${r.long ? ' · <span class="chip">larga reflexión</span>' : ''}${r.cx ? ' · <span class="chip">posición compleja</span>' : ''}</div>`;
      const key = game.fens[ply - 1].split(' ').slice(0, 4).join(' ');
      if (S.training.items[key]) h += `<div class="sm"><button class="btn small" data-train="${esc(key)}">🎯 Practicar esta posición</button></div>`;
    } else if (!an()) h += '<div class="sm">Esta partida aún no está analizada.</div>';
    return h;
  }

  function movesPane() {
    let h = '';
    const D = d();
    for (let i = 0; i < game.moves.length; i += 2) {
      h += `<div class="mrow"><span class="mnum">${i / 2 + 1}.</span>`;
      for (const j of [i, i + 1]) {
        if (j >= game.moves.length) { h += '<span></span>'; continue; }
        const r = D && D.moves[j], c = r && r.cls ? CI()[r.cls] : null, ev = evAt(j + 1);
        h += `<button class="mcell${ply === j + 1 ? ' active' : ''}" data-go="${j + 1}">${c ? `<i class="dot" style="background:${c.color}"></i>` : ''}<span>${esc(game.moves[j].san)}</span>${c && c.sym ? `<em style="color:${c.color}">${c.sym}</em>` : ''}<small>${ev != null ? C.util.fmtEval(ev) : ''}</small></button>`;
      }
      h += '</div>';
    }
    return h;
  }

  function summaryPane() {
    const D = d(); if (!D) return U.empty('Sin análisis', 'Pulsa «Analizar» para evaluar la partida con Stockfish.');
    const side = mySide(), sides = side ? [side] : ['w', 'b'];
    const card = c => {
      const st = D.stats[c], rows = C.util.CLASS_ORDER.map(k => `<li><span><i class="dot" style="background:${CI()[k].color}"></i>${CI()[k].label}</span><b>${st.counts[k]}</b></li>`).join('');
      const ph = ['opening', 'middlegame', 'endgame'].map(p => { const m = D.moves.filter(r => r.c === c && r.ph === p && r.cls); return m.length ? `<li><span>${U.PHASE[p]}</span><b>${(m.reduce((s, r) => s + C.util.accOfLoss(r.loss), 0) / m.length).toFixed(0)} %</b></li>` : ''; }).join('');
      return `<div class="pcard${side === c ? ' mine' : ''}"><h3>${c === 'w' ? '⚪' : '⚫'} ${esc((c === 'w' ? rec.headers.White : rec.headers.Black) || SIDE_L(c))}</h3><div class="big">${st.acc != null ? st.acc.toFixed(1) : '–'}<small> % precisión</small></div><ul><li><span>Pérdida media (cp)</span><b>${st.acpl != null ? st.acpl : '–'}</b></li>${rows}</ul><h4>Por fase</h4><ul>${ph || '<li><span>–</span></li>'}</ul></div>`;
    };
    let h = '';
    if (side) {
      h += `<h4>Lectura del entrenador · ${SIDE_L(side)}</h4><ul class="insights">${insights(side).map(i => `<li class="${i.k}">${i.t}</li>`).join('')}</ul>`;
    } else h += '<p class="hint">Indica con qué piezas jugaste (selector «Jugué con») para obtener la lectura personalizada de esta partida.</p>';
    h += `<div class="stats">${card('w')}${card('b')}</div>`;
    const crit = D.moves.filter(r => (!side || r.c === side) && r.cls && r.loss >= 10).sort((a, b) => b.loss - a.loss).slice(0, 8);
    h += '<h4>Errores principales</h4>' + (crit.length ? '<div class="key">' + crit.map(r => `<button data-go="${r.i + 1}"><i class="dot" style="background:${CI()[r.cls].color}"></i><b>${esc(C.coach.moveLabel(r))}</b> ${CI()[r.cls].sym}<span class="muted">${r.bestSan ? 'mejor: ' + esc(r.bestSan) + ' · ' : ''}−${r.loss.toFixed(0)} %</span></button>`).join('') + '</div>' : '<p class="hint">Sin errores ni errores graves. ¡Partida limpia!</p>');
    const cm = D.moves.filter(r => r.crit && (!side || r.c === side)).slice(0, 10);
    if (cm.length) h += '<h4>Posiciones críticas</h4><p class="hint">Momentos donde la evaluación se jugaba (solo una jugada mantenía la ventaja o la evaluación cambió mucho).</p><div class="key">' + cm.map(r => `<button data-go="${r.i + 1}">${U.clsDot(r.cls)}<b>${esc(C.coach.moveLabel(r))}</b><span class="muted">${r.only ? 'jugada única' : 'cambio brusco'}${r.cls ? ' · ' + CI()[r.cls].label : ''}</span></button>`).join('') + '</div>';
    if (D.zz && D.zz.length) h += '<h4>Zugzwang</h4><p class="hint">Posiciones donde mover empeoraba la situación respecto a pasar el turno: ' + D.zz.slice(0, 6).map(z => `<a href="#" class="exl" data-go="${z.i}">${Math.floor(z.i / 2) + 1}${z.c === 'w' ? '.' : '...'} (${z.c === 'w' ? 'blancas' : 'negras'})</a>`).join(' · ') + '</p>';
    return h;
  }

  function linesPane() {
    const a = an(); if (!a || !a.lines) return U.empty('Sin análisis', 'Analiza la partida para ver las variantes principales.');
    const L = a.lines[ply] || [];
    if (!L.length) return '<p class="hint">No hay variantes en esta posición (final de la partida).</p>';
    const fen = game.fens[ply];
    return `<p class="hint">Mejores continuaciones desde esta posición (Stockfish, prof. ${a.depth}, MultiPV ${a.multipv}).</p>` + L.map((l, i) => `<div class="pvline"><b class="pvev">${C.util.fmtEval(l.cp)}</b><span>${esc(sans(fen, l.pv, 8).join(' '))}</span></div>`).join('');
  }

  function timePane() {
    const D = d(); if (!D) return U.empty('Sin análisis', 'Analiza la partida primero.');
    if (!D.hasClock) return U.empty('Esta partida no trae reloj', 'Para analizar el tiempo, el PGN debe incluir comentarios <code>[%clk h:mm:ss]</code>. En Lichess: exportar con «Incluir tiempos de reloj».');
    const M = C.coach.criticalMap(D), W = 640, H = 150, mid = H / 2, cap = Math.max(10, ...M.map(m => m.sp || 0).map(v => Math.min(v, 60)));
    const bw = Math.max(3, Math.min(14, (W - 10) / M.length - 1));
    let s = `<rect width="${W}" height="${H}" fill="var(--panel2)" rx="6"/><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="#666" stroke-width="1"/>`;
    M.forEach((m, i) => {
      if (m.sp == null) return;
      const x = 6 + i * ((W - 12) / M.length), hh = Math.max(2, Math.min(m.sp, 60) / cap * (mid - 14));
      const col = m.cls ? CI()[m.cls].color : '#8a8780', y = m.c === 'w' ? mid - hh : mid;
      s += `<g class="tb" data-go="${i + 1}"><title>${esc(C.coach.moveLabel(m))} · ${U.fmtSec(m.sp)}${m.cls ? ' · ' + CI()[m.cls].label : ''}${m.cx ? ' · compleja' : ''}</title><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${hh.toFixed(1)}" fill="${col}" ${m.cx ? 'stroke="#fff" stroke-width="1.2"' : ''} opacity="${ply === i + 1 ? 1 : .85}"/>${m.crit ? `<text x="${(x + bw / 2).toFixed(1)}" y="${m.c === 'w' ? 11 : H - 3}" font-size="10" text-anchor="middle" fill="#ffd54a">★</text>` : ''}</g>`;
    });
    const side = mySide();
    const mine = M.filter(m => (!side || m.c === side) && m.sp != null);
    const slowCrit = mine.filter(m => m.crit), fastErr = mine.filter(m => m.fast && m.loss >= 10), longErr = mine.filter(m => m.long && m.loss >= 10);
    const avg = a => (a.length ? a.reduce((x, y) => x + y.sp, 0) / a.length : null);
    return `<p class="hint">Cada barra es el tiempo gastado en una jugada (blancas arriba, negras abajo; color = calidad; borde blanco = posición compleja; ★ = momento crítico). Pulsa una barra para ir a la jugada.</p>
      <svg viewBox="0 0 ${W} ${H}" class="timemap">${s}</svg>
      <ul class="insights">
        <li class="ok">Tiempo medio por jugada${side ? ' (tú)' : ''}: <b>${U.fmtSec(avg(mine))}</b></li>
        <li class="${slowCrit.length && avg(slowCrit) < (avg(mine) || 0) ? 'warn' : 'ok'}">En momentos críticos: <b>${slowCrit.length ? U.fmtSec(avg(slowCrit)) : '–'}</b> (${slowCrit.length} jugadas)${slowCrit.length && avg(slowCrit) < (avg(mine) || 0) ? ' — pensaste menos que de costumbre justo donde más importaba.' : ''}</li>
        <li class="${fastErr.length ? 'warn' : 'ok'}">Errores jugando muy rápido: <b>${fastErr.length}</b></li>
        <li class="${longErr.length ? 'warn' : 'ok'}">Errores tras pensar mucho: <b>${longErr.length}</b></li></ul>`;
  }

  function detailsPane() {
    const h = rec.headers, D = d();
    const L = [['Event', 'Evento'], ['Site', 'Sitio'], ['Date', 'Fecha'], ['Round', 'Ronda'], ['White', 'Blancas'], ['WhiteElo', 'Elo blancas'], ['Black', 'Negras'], ['BlackElo', 'Elo negras'], ['Result', 'Resultado'], ['ECO', 'ECO'], ['Opening', 'Apertura'], ['TimeControl', 'Control de tiempo'], ['Termination', 'Terminación']];
    const rows = L.filter(([k]) => h[k] && h[k] !== '?' && h[k] !== '????.??.??').map(([k, l]) => `<tr><th>${l}</th><td>${esc(h[k])}</td></tr>`);
    const mv = game.moves, op = (D && D.opening) || (rec.meta && rec.meta.opening);
    if (op) rows.push(`<tr><th>Apertura detectada</th><td>${esc(op.family)}${op.variation ? ' · ' + esc(op.variation) : ''}</td></tr>`);
    rows.push(`<tr><th>Ritmo</th><td>${esc(game.tc.cat)}</td></tr>`);
    rows.push(`<tr><th>Jugadas</th><td>${Math.ceil(mv.length / 2)} (${mv.length} semijugadas)</td></tr>`);
    rows.push(`<tr><th>Capturas · jaques · enroques</th><td>${mv.filter(m => m.captured).length} · ${mv.filter(m => /[+#]/.test(m.san)).length} · ${mv.filter(m => /[kq]/.test(m.flags)).length}</td></tr>`);
    if (D) rows.push(`<tr><th>Análisis</th><td>profundidad ${D.depth} · MultiPV ${D.multipv}${D.endState ? ' · final: ' + ({ mate: 'jaque mate', stalemate: 'ahogado', draw: 'tablas' }[D.endState]) : ''}</td></tr>`);
    return `<table class="det">${rows.join('')}</table>`;
  }

  /* ---------- pintado ---------- */
  function paintBoard() {
    const r = d() && ply > 0 ? d().moves[ply - 1] : null, m = ply > 0 ? game.moves[ply - 1] : null;
    const arrows = [];
    if (showBest && r && ['inaccuracy', 'mistake', 'blunder'].includes(r.cls) && r.best) {
      arrows.push({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), color: 'green' });
      if (r.cls !== 'inaccuracy') arrows.push({ from: m.from, to: m.to, color: 'red' });
    }
    board.set({ fen: game.fens[ply], flipped, last: m ? [m.from, m.to] : null, arrows, badge: m && r && r.cls && CI()[r.cls].sym ? { sq: m.to, sym: CI()[r.cls].sym, color: CI()[r.cls].color } : null });
    const e = evAt(ply), fill = U.$('.evfill', root), t = U.$('.evtext', root);
    if (e == null) { fill.style.height = '50%'; t.textContent = ''; } else {
      fill.style.height = C.util.winPct(e) + '%';
      t.textContent = C.util.fmtEval(e).replace('+', ''); t.style.top = e >= 0 ? 'auto' : '3px'; t.style.bottom = e >= 0 ? '3px' : 'auto';
    }
  }

  function paintGraph() {
    const svg = U.$('#gv-graph', root), a = an(), n = game.fens.length - 1, W = 600, H = 110;
    let s = `<rect width="${W}" height="${H}" fill="#403d39"/>`;
    if (a && a.evals) {
      const pts = [];
      for (let i = 0; i <= n; i++) if (a.evals[i] != null) pts.push([n ? i / n * W : 0, H * (1 - C.util.winPct(a.evals[i]) / 100), i]);
      if (pts.length > 1) {
        const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        s += `<polygon points="0,${H} ${line} ${pts[pts.length - 1][0]},${H}" fill="#e9e9e9"/><polyline points="${line}" fill="none" stroke="#888" stroke-width="1"/>`;
      }
      s += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#777" stroke-dasharray="3 3"/>`;
      const side = mySide();
      if (d()) pts.forEach(p => { const r = p[2] > 0 ? d().moves[p[2] - 1] : null; if (r && (r.cls === 'blunder' || r.cls === 'mistake') && (!side || r.c === side)) s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" fill="${CI()[r.cls].color}" stroke="#000" stroke-width=".6"/>`; });
    }
    const cx = n ? ply / n * W : 0;
    svg.innerHTML = s + `<line x1="${cx}" x2="${cx}" y1="0" y2="${H}" stroke="#81b64c" stroke-width="2"/>`;
  }

  function paintAll() {
    U.$('#gv-ptop', root).innerHTML = playerHtml(flipped ? 'w' : 'b');
    U.$('#gv-pbot', root).innerHTML = playerHtml(flipped ? 'b' : 'w');
    paintBoard(); paintGraph();
    U.$('#gv-info', root).innerHTML = infoHtml();
    paintPane();
  }
  function paintPane() {
    U.$$('.tab', root).forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const el = U.$('#gv-pane', root);
    el.innerHTML = { summary: summaryPane, moves: movesPane, lines: linesPane, time: timePane, details: detailsPane }[tab]();
    if (tab === 'moves') { const a = U.$('.mcell.active', el); if (a) el.scrollTop = Math.max(0, a.offsetTop - el.offsetTop - 80); }
  }
  function goTo(p) {
    ply = Math.max(0, Math.min(game.moves.length, p));
    paintBoard(); paintGraph();
    U.$('#gv-info', root).innerHTML = infoHtml();
    if (tab === 'moves') { U.$$('.mcell', root).forEach(b => b.classList.toggle('active', +b.dataset.go === ply)); const a = U.$('.mcell.active', root); const el = U.$('#gv-pane', root); if (a) { const top = a.offsetTop - el.offsetTop; if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 40) el.scrollTop = top - 80; } }
    else if (tab === 'lines' || tab === 'time') paintPane();
  }

  function render(r) {
    root = r;
    if (!rec || !S.byId(rec.id)) {
      rec = null;
      root.innerHTML = U.empty('Ninguna partida abierta', 'Ve a la <a href="#" data-tab-go="library">Biblioteca</a>, importa tus partidas y pulsa «Abrir».');
      return;
    }
    rec = S.byId(rec.id);
    const h = rec.headers, side = mySide();
    root.innerHTML = `
      <div class="gv-head"><div><h2>${esc(h.White || '?')} – ${esc(h.Black || '?')} <small>${esc(h.Result || '*')}</small></h2><p class="hint">${esc(h.Event || '')} ${h.Date ? '· ' + esc(h.Date) : ''}</p></div>
        <div class="gv-actions">
          <label class="inline">Jugué con <select id="gv-side"><option value="">Auto${side && !rec.side ? ' (' + SIDE_L(side) + ')' : ''}</option><option value="w"${rec.side === 'w' ? ' selected' : ''}>Blancas</option><option value="b"${rec.side === 'b' ? ' selected' : ''}>Negras</option></select></label>
          <button class="btn" id="gv-analyze">${rec.derived ? 'Re-analizar' : 'Analizar'}</button>
        </div></div>
      ${game.error ? `<p class="msg err">Aviso: ${esc(game.error)}. Se muestran las jugadas válidas hasta ese punto.</p>` : ''}
      <div class="gv">
        <div class="gv-left">
          <div class="pl" id="gv-ptop"></div>
          <div class="bwrap"><div class="evbar" title="Evaluación"><div class="evfill"></div><span class="evtext"></span></div><div id="gv-board"></div></div>
          <div class="pl" id="gv-pbot"></div>
          <div class="ctl">
            <button data-nav="start" title="Inicio">⏮</button><button data-nav="prev" title="Anterior (←)">◀</button><button data-nav="next" title="Siguiente (→)">▶</button><button data-nav="end" title="Final">⏭</button><button data-nav="flip" title="Girar (F)">⇅</button>
            <label class="inline"><input type="checkbox" id="gv-best"${showBest ? ' checked' : ''}> Mostrar mejor jugada</label>
          </div>
          <div class="info" id="gv-info"></div>
        </div>
        <div class="gv-right">
          <div class="card graphcard"><svg id="gv-graph" viewBox="0 0 600 110" preserveAspectRatio="none"></svg></div>
          <div class="card"><div class="tabs"><button class="tab" data-tab="summary">Resumen</button><button class="tab" data-tab="moves">Jugadas</button><button class="tab" data-tab="lines">Variantes</button><button class="tab" data-tab="time">Tiempo</button><button class="tab" data-tab="details">Partida</button></div><div class="pane" id="gv-pane"></div></div>
        </div>
      </div>`;
    board = new C.Board(U.$('#gv-board', root), {});
    paintAll();

    root.onclick = e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { const a = nav.dataset.nav; if (a === 'start') goTo(0); else if (a === 'prev') goTo(ply - 1); else if (a === 'next') goTo(ply + 1); else if (a === 'end') goTo(game.moves.length); else { flipped = !flipped; paintAll(); } return; }
      const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); goTo(+go.dataset.go); return; }
      const t = e.target.closest('.tab'); if (t) { tab = t.dataset.tab; paintPane(); return; }
      const tr = e.target.closest('[data-train]'); if (tr) { C.app.show('train', { key: tr.dataset.train }); return; }
      if (e.target.id === 'gv-analyze') C.app.analyze([rec.id]);
      const gr = e.target.closest('#gv-graph'); if (gr) { const b = gr.getBoundingClientRect(); goTo(Math.round((e.clientX - b.left) / b.width * game.moves.length)); }
    };
    root.onchange = async e => {
      if (e.target.id === 'gv-best') { showBest = e.target.checked; paintBoard(); }
      else if (e.target.id === 'gv-side') { try { await S.patchGame(rec.id, { side: e.target.value || null }); flipped = C.coach.sideOf(rec, S.profile) === 'b'; C.training.sync(S.training, S.games, S.profile); S.saveTraining(); render(root); } catch (err) { U.toast(err.message, 'err'); } }
    };
  }

  function key(e) {
    if (!root || !rec || !document.body.contains(U.$('#gv-board', root)) || /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') { goTo(ply - 1); e.preventDefault(); } else if (e.key === 'ArrowRight') { goTo(ply + 1); e.preventDefault(); }
    else if (e.key === 'Home') { goTo(0); e.preventDefault(); } else if (e.key === 'End') { goTo(game.moves.length); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'f') { flipped = !flipped; paintAll(); }
  }
  document.addEventListener('keydown', key);

  C.views.game = { open, render };
})();
