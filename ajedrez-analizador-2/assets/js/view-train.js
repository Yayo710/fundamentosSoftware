/* view-train.js — Entrenador: ejercicios de tus propios errores, respuesta en el tablero, evaluación con Stockfish y progreso */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const S = C.store, U = C.ui, { esc } = U;

  let root = null, board = null, cur = null, answered = false, recorded = false, evaluating = false;
  let hintLevel = 0, filters = { theme: '', phase: '' }, lastRes = null, showSolution = false;

  const themeLabel = id => C.tactics.THEME_LABELS[id] || C.coach.NAT_LABEL[id] || (id === 'otros' ? 'Sin motivo concreto' : id);
  const sideName = c => (c === 'w' ? 'Blancas' : 'Negras');

  function themesAvailable() {
    const m = {};
    Object.values(S.training.items).forEach(x => (x.themes.length ? x.themes : x.nat ? [x.nat] : []).forEach(t => (m[t] = (m[t] || 0) + 1)));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }

  function pick(key) {
    const st = S.training;
    if (key && st.items[key]) return st.items[key];
    return C.training.queue(st, filters).due[0] || null;
  }

  function open(key) { cur = pick(key); answered = recorded = evaluating = showSolution = false; hintLevel = 0; lastRes = null; }

  /* ---------- progreso ---------- */
  function progressHtml(P) {
    const days = P.days.slice(-14), mx = Math.max(1, ...days.map(x => x.n));
    const bars = days.length ? `<svg viewBox="0 0 ${days.length * 22} 60" class="daybars" role="img" aria-label="Intentos por día">${days.map((x, i) => `<g><title>${x.day}: ${x.ok}/${x.n} aciertos</title><rect x="${i * 22 + 2}" y="${60 - x.n / mx * 54}" width="18" height="${x.n / mx * 54}" fill="var(--bad)" opacity=".5"/><rect x="${i * 22 + 2}" y="${60 - x.ok / mx * 54}" width="18" height="${x.ok / mx * 54}" fill="var(--accent)"/></g>`).join('')}</svg>` : '<p class="hint">Aún no hay intentos.</p>';
    const rate = (a) => a.map(t => `<tr><td>${esc(themeLabel(t.id))}</td><td>${t.n}</td><td>${U.pct(t.rate)}</td><td><div class="sbar low"><i style="width:${(t.rate || 0) * 100}%"></i></div></td></tr>`).join('');
    return `<section class="card"><h2>Tu progreso</h2>
      <div class="grid3"><div class="stat"><span>Aciertos</span><b>${P.attempts ? U.pct(P.rate) : '–'}</b></div><div class="stat"><span>A la primera</span><b>${P.firstTryRate != null ? U.pct(P.firstTryRate) : '–'}</b></div><div class="stat"><span>Racha</span><b>${P.streak}</b></div></div>
      ${P.trend ? `<p class="${P.trend.after >= P.trend.before ? 'ok' : 'msg'}">Evolución: ${U.pct(P.trend.before)} en la primera mitad de tus intentos → <b>${U.pct(P.trend.after)}</b> en la segunda.</p>` : '<p class="hint">Con 10 intentos o más verás cómo evoluciona tu tasa de acierto.</p>'}
      <h4>Últimos 14 días con actividad</h4>${bars}
      ${P.byTheme.length ? `<h4>Acierto por tema</h4><table class="det"><tbody>${rate(P.byTheme.slice(0, 8))}</tbody></table>` : ''}
      ${P.byPhase.length ? `<h4>Por fase</h4><table class="det"><tbody>${P.byPhase.map(t => `<tr><td>${esc(U.PHASE[t.id] || t.id)}</td><td>${t.n}</td><td>${U.pct(t.rate)}</td></tr>`).join('')}</tbody></table>` : ''}</section>`;
  }

  function listHtml() {
    const items = Object.values(S.training.items).sort((a, b) => (a.box - b.box) || (b.loss - a.loss)).slice(0, 15);
    if (!items.length) return '';
    return `<section class="card"><h2>Tus ejercicios <small>${Object.keys(S.training.items).length}</small></h2><div class="tablewrap"><table class="ptable"><thead><tr><th>Posición</th><th>Tema</th><th>Pérdida original</th><th>Dominio</th><th>Intentos</th><th></th></tr></thead><tbody>${items.map(x => `<tr><td>vs ${esc(x.opp)} · ${esc(x.date || '')} · jugada ${Math.floor((x.gply - 1) / 2) + 1}</td><td>${esc((x.themes[0] && themeLabel(x.themes[0])) || (x.nat ? themeLabel(x.nat) : '–'))}</td><td>−${x.loss.toFixed(0)} %</td><td>${'●'.repeat(x.box)}${'○'.repeat(4 - x.box)}</td><td>${x.correct}/${x.attempts}</td><td><button class="btn small secondary" data-start="${esc(x.key)}">Practicar</button></td></tr>`).join('')}</tbody></table></div></section>`;
  }

  /* ---------- tablero ---------- */
  function setBoard() {
    if (!cur || !board) return;
    const marks = [], arrows = [];
    if (hintLevel >= 2 && !answered) marks.push({ sq: cur.best.slice(0, 2), cls: 'hintsq' });
    if (answered && lastRes) {
      if (!lastRes.ok || showSolution) arrows.push({ from: cur.best.slice(0, 2), to: cur.best.slice(2, 4), color: 'green' });
    }
    if (showSolution && !answered) arrows.push({ from: cur.best.slice(0, 2), to: cur.best.slice(2, 4), color: 'green' });
    board.set({ fen: cur.fen, flipped: cur.c === 'b', interactive: !answered && !evaluating && !showSolution, marks, arrows, last: null });
  }

  function promptHtml() {
    if (!cur) return '';
    const hint1 = hintLevel >= 1 && cur.themes.length ? `<p>💡 Pista: ${cur.themes.map(t => `<span class="chip">${esc(themeLabel(t))}</span>`).join(' ')}</p>` : hintLevel >= 1 ? '<p>💡 Pista: no hay un motivo táctico claro; busca la jugada que mejor mejora tu posición o frena la amenaza del rival.</p>' : '';
    const nat = cur.nat ? ` (${esc(themeLabel(cur.nat).toLowerCase())})` : '';
    return `<div class="card prompt"><h2>Encuentra la mejor jugada</h2>
      <p><b>Juegan ${sideName(cur.c)}.</b> Esta posición es de tu partida contra <b>${esc(cur.opp)}</b>${cur.date ? ' (' + esc(cur.date) + ')' : ''}, jugada ${Math.floor((cur.gply - 1) / 2) + 1}. Aquí cometiste un error${nat}. Mueve una pieza en el tablero.</p>
      ${hint1}
      ${evaluating ? '<p class="msg">Evaluando tu jugada con Stockfish…</p>' : ''}
      <div class="row"><button class="btn secondary" data-hint ${answered || showSolution ? 'disabled' : ''}>Pista${hintLevel ? ' (' + hintLevel + '/2)' : ''}</button><button class="btn secondary" data-solution ${answered || showSolution ? 'disabled' : ''}>Ver solución</button><button class="btn secondary" data-skip>Saltar</button><button class="btn secondary" data-open="${esc(cur.gid)}" data-ply="${cur.gply}">Ver la partida</button></div></div>`;
  }

  function resultHtml() {
    const r = lastRes; if (!r) return '';
    const lines = (cur.lines || []).filter(l => C.util.winPct(cur.evBest) - C.util.winPct(l.cp) <= 5 && l.u !== cur.best).map(l => l.san).filter(Boolean);
    const title = r.kind === 'best' ? '¡Mejor jugada!' : r.kind === 'good' ? 'Buena alternativa' : r.wasMistake ? 'Repetiste el error de la partida' : 'No es la mejor jugada';
    return `<div class="card result ${r.kind}"><h2>${title}</h2>
      <p>Tu respuesta: <b>${esc(r.san)}</b> (${C.util.fmtEval(r.ev * (cur.c === 'w' ? 1 : -1))}) · Mejor: <b>${esc(cur.bestSan)}</b> (${C.util.fmtEval(cur.evBest * (cur.c === 'w' ? 1 : -1))}) · Diferencia: <b>${r.lossPct} %</b> de probabilidad de ganar${r.from === 'motor' ? ' <small>(evaluada ahora con Stockfish)</small>' : ''}.</p>
      ${cur.pv && cur.pv.length ? `<p>Línea de Stockfish: <b>${esc(cur.pv.join(' '))}</b></p>` : ''}
      ${lines.length ? `<p>También válidas: ${lines.map(l => `<b>${esc(l)}</b>`).join(', ')}</p>` : ''}
      <p class="hint">En la partida jugaste <b>${esc(cur.playedSan)}</b> y perdiste ${cur.loss.toFixed(0)} %.${cur.themes.length ? ' Motivo que te perdiste: ' + cur.themes.map(t => esc(themeLabel(t))).join(', ') + '.' : ''}</p>
      <div class="row"><button class="btn" data-next>Siguiente ejercicio</button>${r.ok ? '' : '<button class="btn secondary" data-retry>Intentar de nuevo</button>'}</div></div>`;
  }

  /* ---------- acciones ---------- */
  async function handleMove(uci) {
    if (!cur || answered || evaluating) return;
    evaluating = true; setBoard(); paintSide();
    try {
      const needs = uci !== cur.best && !(cur.lines || []).some(l => l.u === uci);
      const eng = needs ? await S.getEngine() : null;
      lastRes = await C.training.evaluate(cur, uci, eng, Math.max(10, +S.profile.depth || 12));
    } catch (e) { evaluating = false; U.toast(e.message, 'err'); setBoard(); paintSide(); return; }
    evaluating = false; answered = true;
    if (!recorded) { recorded = true; C.training.record(S.training, cur.key, lastRes); S.saveTraining(); paintStats(); }
    // muestra la jugada del usuario en el tablero
    try { const ch = new Chess(cur.fen); const m = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); board.set({ fen: ch.fen(), flipped: cur.c === 'b', last: [m.from, m.to], interactive: false, arrows: lastRes.ok ? [] : [{ from: cur.best.slice(0, 2), to: cur.best.slice(2, 4), color: 'green' }], badge: null }); } catch (e) { setBoard(); }
    paintSide();
  }

  function paintStats() {
    const P = C.training.progress(S.training), q = C.training.queue(S.training, filters), el = U.$('#tr-stats', root);
    if (el) el.innerHTML = `<div class="stat"><span>Ejercicios</span><b>${P.total}</b></div><div class="stat"><span>Pendientes hoy</span><b>${q.due.length}</b></div><div class="stat"><span>Dominados</span><b>${P.mastered}</b></div><div class="stat"><span>En aprendizaje</span><b>${P.learning}</b></div>`;
  }
  function paintSide() {
    const el = U.$('#tr-side', root); if (!el) return;
    el.innerHTML = answered ? resultHtml() : promptHtml();
  }

  function nextDueText() {
    const items = Object.values(S.training.items).filter(x => x.due > Date.now()).sort((a, b) => a.due - b.due)[0];
    if (!items) return '';
    const d = Math.ceil((items.due - Date.now()) / 86400000);
    return ` El siguiente repaso toca ${d <= 1 ? 'mañana' : 'dentro de ' + d + ' días'}.`;
  }

  function render(r) {
    root = r;
    if (!S.training.items || !Object.keys(S.training.items).length) {
      root.innerHTML = U.empty('Todavía no hay ejercicios', 'Los ejercicios se generan automáticamente de <b>tus errores</b> (jugadas que perdieron ≥10 % de probabilidad de ganar) en las partidas analizadas. Importa tus partidas, indica tu bando y analízalas en la <a href="#" data-tab-go="library">Biblioteca</a>.');
      return;
    }
    const P = C.training.progress(S.training), q = C.training.queue(S.training, filters);
    if (!cur || !S.training.items[cur.key]) open();
    root.innerHTML = `
      <div class="grid4" id="tr-stats"></div>
      <div class="row filters"><label class="inline">Tema <select id="tr-theme"><option value="">Todos</option>${themesAvailable().map(([t, n]) => `<option value="${esc(t)}"${filters.theme === t ? ' selected' : ''}>${esc(themeLabel(t))} (${n})</option>`).join('')}</select></label>
        <label class="inline">Fase <select id="tr-phase"><option value="">Todas</option>${['opening', 'middlegame', 'endgame'].map(p => `<option value="${p}"${filters.phase === p ? ' selected' : ''}>${U.PHASE[p]}</option>`).join('')}</select></label>
        <button class="btn secondary" id="tr-new">Siguiente pendiente</button></div>
      ${cur ? `<div class="tr-layout"><div class="tr-board"><div id="tr-board"></div><p class="hint center">Toca la pieza y luego su destino.</p></div><div id="tr-side"></div></div>` : `<section class="card">${U.empty('Todo al día', 'No quedan ejercicios pendientes con este filtro.' + nextDueText())}</section>`}
      ${progressHtml(P)}${listHtml()}`;
    paintStats();
    if (cur) { board = new C.Board(U.$('#tr-board', root), { onMove: handleMove }); setBoard(); paintSide(); }

    root.onclick = e => {
      if (e.target.closest('[data-hint]')) { hintLevel = Math.min(2, hintLevel + 1); setBoard(); paintSide(); return; }
      if (e.target.closest('[data-solution]')) {
        showSolution = true; answered = true; lastRes = { kind: 'bad', ok: false, san: '—', ev: cur.evBest, evBest: cur.evBest, lossPct: 0, from: 'solucion', wasMistake: false, revealed: true };
        if (!recorded) { recorded = true; C.training.record(S.training, cur.key, { ok: false, kind: 'bad' }); S.saveTraining(); paintStats(); }
        setBoard(); U.$('#tr-side', root).innerHTML = `<div class="card result bad"><h2>Solución</h2><p>La mejor jugada era <b>${esc(cur.bestSan)}</b> (${C.util.fmtEval(cur.evBest * (cur.c === 'w' ? 1 : -1))}).</p>${cur.pv && cur.pv.length ? `<p>Línea de Stockfish: <b>${esc(cur.pv.join(' '))}</b></p>` : ''}${cur.themes.length ? `<p>Motivo: ${cur.themes.map(t => esc(themeLabel(t))).join(', ')}</p>` : ''}<p class="hint">En la partida jugaste <b>${esc(cur.playedSan)}</b> (−${cur.loss.toFixed(0)} %). Se contará como fallo para que vuelva a salir.</p><div class="row"><button class="btn" data-next>Siguiente ejercicio</button></div></div>`;
        return;
      }
      if (e.target.closest('[data-skip]') || e.target.closest('[data-next]')) { const skipKey = cur && cur.key; if (e.target.closest('[data-skip]')) { const t = S.training.items[skipKey]; if (t) t.due = Date.now() + 60000; } open(); render(root); return; }
      if (e.target.closest('[data-retry]')) { answered = false; lastRes = null; showSolution = false; setBoard(); paintSide(); return; }
      const st = e.target.closest('[data-start]'); if (st) { open(st.dataset.start); render(root); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    };
    root.onchange = e => {
      if (e.target.id === 'tr-theme') { filters.theme = e.target.value; open(); render(root); }
      else if (e.target.id === 'tr-phase') { filters.phase = e.target.value; open(); render(root); }
    };
    const nb = U.$('#tr-new', root); if (nb) nb.onclick = () => { open(); render(root); };
  }

  C.views.train = { render, open };
})();
