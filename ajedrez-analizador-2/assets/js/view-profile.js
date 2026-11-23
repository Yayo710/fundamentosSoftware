/* view-profile.js — Diagnóstico, Aperturas, Tácticas y Tiempo (todo calculado de tus partidas analizadas) */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const S = C.store, U = C.ui, { esc } = U;

  const needGames = (n) => U.empty('Aún no hay partidas analizadas con tu bando', `Importa partidas en la <a href="#" data-tab-go="library">Biblioteca</a>, indica tu nombre de usuario (o el bando) y analízalas. ${n ? '' : ''}`);
  const ready = () => C.coach.usable(S.games, S.profile).length;

  /* ================= Diagnóstico ================= */
  function renderDiag(root) {
    if (!ready()) return (root.innerHTML = needGames());
    const D = C.coach.diagnose(S.games, S.profile), sm = D.summary, ph = D.phases;
    const warn = D.games < 5 ? `<p class="msg">Con solo ${D.games} partida(s) analizada(s) las puntuaciones son orientativas. A partir de unas 20 partidas el diagnóstico se vuelve fiable.</p>` : '';
    const rows = D.patterns.map(p => `
      <tr class="prow ${p.level}" data-p="${p.id}">
        <td><b>${esc(p.name)}</b><div class="rule">${p.score == null ? esc(p.reason || '') : esc(p.num + ' de ' + p.den + ' ' + p.unit)}</div></td>
        <td>${esc(p.diag)}</td>
        <td>${U.scoreBar(p.score, p.level)}</td>
        <td><span class="lvl ${p.level}">${U.LEVEL[p.level]}</span></td>
        <td><button class="btn small secondary" data-expand="${p.id}">Detalle</button></td></tr>
      <tr class="pdetail" id="pd-${p.id}" hidden><td colspan="5">
        <p><b>Cómo se mide:</b> ${esc(p.rule)}</p>
        ${p.examples.length ? `<p><b>Ejemplos en tus partidas:</b> ${U.exList(p.examples, true)}</p>` : ''}
        <p><b>Cómo mejorar:</b> ${esc(p.tip)}</p></td></tr>`).join('');
    const phRow = (k, n) => `<tr><td>${n}</td><td>${ph[k].n}</td><td>${ph[k].acc != null ? ph[k].acc.toFixed(1) + ' %' : '–'}</td><td>${ph[k].acpl != null ? ph[k].acpl : '–'}</td><td>${ph[k].errRate != null ? U.pct(ph[k].errRate) : '–'}</td></tr>`;
    const prior = D.weak.slice(0, 3);
    root.innerHTML = `
      <div class="grid3">
        <div class="stat"><span>Partidas analizadas</span><b>${sm.games}</b></div>
        <div class="stat"><span>Precisión media</span><b>${sm.acc != null ? sm.acc.toFixed(1) + ' %' : '–'}</b></div>
        <div class="stat"><span>Pérdida media (cp)</span><b>${sm.acpl != null ? sm.acpl : '–'}</b></div>
        <div class="stat"><span>Resultados</span><b>${sm.wdl.n ? `${sm.wdl.w}G · ${sm.wdl.d}T · ${sm.wdl.l}P` : '–'}</b></div>
      </div>
      ${warn}
      <section class="card"><h2>Tabla de patrones</h2>
        <p class="hint">Cada patrón se calcula con tus jugadas reales. <b>Puntuación 0–100 = gravedad</b> (más alto, peor): compara con qué frecuencia ocurre frente a un umbral de referencia. «Sin datos» significa que aún no hay muestra suficiente; no se inventa nada. Es una descripción de patrones de juego, no un diagnóstico psicológico.</p>
        <div class="tablewrap"><table class="ptable"><thead><tr><th>Patrón detectado</th><th>Diagnóstico</th><th>Puntuación</th><th>Nivel</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>
      <div class="grid2">
        <section class="card"><h2>Prioridades de entrenamiento</h2>
          ${prior.length ? '<ol class="prior">' + prior.map(p => `<li><b>${esc(p.name)}</b> <span class="lvl ${p.level}">${p.score}</span><br><small>${esc(p.tip)}</small></li>`).join('') + '</ol>' : '<p class="hint">Ningún patrón alcanza gravedad media con la muestra actual.</p>'}
          ${D.strong.length ? '<h4>Fortalezas</h4><p>' + D.strong.slice(0, 5).map(p => `<span class="chip ok">${esc(p.good || p.name)}</span>`).join(' ') + '</p>' : ''}
          <div class="row"><button class="btn" data-tab-go="train">🎯 Ir al entrenador</button></div>
        </section>
        <section class="card"><h2>Por fase de la partida</h2>
          <table class="det"><thead><tr><th>Fase</th><th>Jugadas</th><th>Precisión</th><th>Pérd. media</th><th>Errores ≥10 %</th></tr></thead><tbody>${phRow('opening', 'Apertura')}${phRow('middlegame', 'Medio juego')}${phRow('endgame', 'Final')}</tbody></table>
          <h4>Cómo se producen tus errores</h4>
          ${D.natures.length ? '<table class="det"><tbody>' + D.natures.map(n => `<tr><th>${esc(n.label)}</th><td>${n.n} (${U.pct(n.share)})</td><td>${U.exList(n.examples.slice(0, 2))}</td></tr>`).join('') + '</tbody></table>' : '<p class="hint">Sin errores ≥10 % en la muestra.</p>'}
        </section>
      </div>`;
    root.onclick = e => {
      const b = e.target.closest('[data-expand]'); if (!b) return;
      const el = U.$('#pd-' + b.dataset.expand, root); el.hidden = !el.hidden; b.textContent = el.hidden ? 'Detalle' : 'Ocultar';
    };
  }

  /* ================= Aperturas ================= */
  const masterCache = {};
  async function masterCheck(entry, out) {
    out.innerHTML = '<p class="hint">Comparando con partidas de maestros…</p>';
    const ids = entry.ids.slice(0, 12), devs = {}, inBook = [];
    let err = null, checked = 0;
    for (const id of ids) {
      const rec = S.byId(id); if (!rec) continue;
      const game = C.pgn.parseGame(rec.pgn); if (game.error) continue;
      const r = await C.coach.masterDeviation(game, entry.side, async fen => { const k = fen.split(' ').slice(0, 4).join(' '); return masterCache[k] || (masterCache[k] = await S.fetchMasters(fen)); });
      if (r.error) { err = r.error; break; }
      checked++;
      if (r.dev) { const k = r.dev.fen.split(' ').slice(0, 4).join(' ') + '|' + r.dev.san; const e = devs[k] = devs[k] || Object.assign({ n: 0, gid: id }, r.dev); e.n++; } else inBook.push(r.inBook || 0);
    }
    if (err) { out.innerHTML = `<p class="msg err">${esc(err)}</p>`; return; }
    const list = Object.values(devs).sort((a, b) => b.n - a.n).slice(0, 4);
    let h = `<p class="hint">Comparadas ${checked} partida(s) con la base de maestros de Lichess.</p>`;
    if (list.length) h += '<ul class="insights">' + list.map(v => `<li class="warn">${v.n}× en <a href="#" class="exl" data-open="${esc(v.gid)}" data-ply="${v.ply + 1}">${Math.floor(v.ply / 2) + 1}${entry.side === 'w' ? '.' : '...'} ${esc(v.san)}</a>: solo el ${(v.share * 100).toFixed(1)} % de los maestros la juega. <b>Alternativas:</b> ${v.top.map(t => `${esc(t.san)} (${(t.share * 100).toFixed(0)} %)`).join(', ')}.</li>`).join('') + '</ul>';
    if (inBook.length) h += `<p class="ok">En ${inBook.length} partida(s) sigues la teoría de maestros durante tus primeras ${Math.min(...inBook)}+ jugadas.</p>`;
    out.innerHTML = h;
  }

  function openingCard(e) {
    return `<div class="card opening" data-key="${esc(e.key)}">
      <div class="op-head"><h3>${esc(e.family)}</h3><span class="n">${e.n} partida${e.n === 1 ? '' : 's'}</span></div>
      ${U.wdl(e.w, e.d, e.l)}
      <p class="pcts"><b class="w">${U.pct(e.winPct)}</b> victorias · <b>${U.pct(e.drawPct)}</b> tablas · <b class="l">${U.pct(e.lossPct)}</b> derrotas</p>
      <table class="det"><tbody>
        <tr><th>Variante más usada</th><td>${esc(e.mainVariation || '–')}</td></tr>
        ${e.variations.length > 1 ? `<tr><th>Variantes</th><td>${e.variations.map(v => `${esc(v.name)} (${v.n})`).join(', ')}</td></tr>` : ''}
        <tr><th>Respuestas del rival</th><td>${e.opponentReplies.map(r => `${esc(r.name)} (${U.pct(r.share)})`).join(', ') || '–'}</td></tr>
        ${e.commonLine ? `<tr><th>Línea típica</th><td>${esc(e.commonLine)}</td></tr>` : ''}
        <tr><th>Principal problema</th><td>${esc(e.mainProblem)}</td></tr></tbody></table>
      ${e.issues.length > 1 ? '<ul class="insights">' + e.issues.slice(1).map(i => `<li class="warn">${esc(i.text)}</li>`).join('') + '</ul>' : ''}
      <div class="row"><button class="btn small secondary" data-master="${esc(e.key)}">Comparar con maestros</button><small>${e.analyzed}/${e.n} analizadas</small></div>
      <div class="master-out"></div></div>`;
  }

  function renderOpenings(root) {
    const rep = C.coach.openingsReport(S.games, S.profile);
    if (!rep.all.length) return (root.innerHTML = U.empty('Sin repertorio todavía', 'Importa partidas y asigna tu bando (nombre de usuario o selector) para construir tu repertorio. No hace falta analizarlas con el motor para ver aperturas y resultados.'));
    const col = (t, a) => `<div><h2>${t} <small>${a.reduce((s, x) => s + x.n, 0)} partidas</small></h2>${a.length ? a.map(openingCard).join('') : '<p class="hint">Sin partidas con este color.</p>'}</div>`;
    root.innerHTML = `<p class="hint">Los datos (partidas, porcentajes, variantes y respuestas) se calculan de tus partidas importadas. Los problemas recurrentes necesitan partidas analizadas.</p><div class="grid2 top">${col('♔ Con blancas', rep.white)}${col('♚ Con negras', rep.black)}</div>`;
    root.onclick = e => {
      const b = e.target.closest('[data-master]'); if (!b) return;
      const entry = rep.all.find(x => x.key === b.dataset.master), out = U.$('.master-out', b.closest('.opening'));
      b.disabled = true; masterCheck(entry, out).finally(() => (b.disabled = false));
    };
  }

  /* ================= Tácticas ================= */
  function renderTactics(root) {
    if (!ready()) return (root.innerHTML = needGames());
    const T = C.coach.tacticsReport(S.games, S.profile), X = T.extras;
    const rows = T.themes.map(t => `<tr><td><b>${esc(t.label)}</b></td><td>${t.found}</td><td>${t.missed}</td><td>${t.missRate == null ? '–' : U.pct(t.missRate)}</td><td>${t.allowed}</td><td>${U.exList(t.examples, true) || '–'}</td></tr>`).join('');
    const card = (title, n, of, ex, text) => `<div class="card mini"><h3>${title}</h3><div class="big">${n}${of != null ? `<small> de ${of}</small>` : ''}</div><p class="hint">${text}</p>${ex.length ? '<p>' + U.exList(ex, true) + '</p>' : ''}</div>`;
    root.innerHTML = `
      ${T.blind.length ? `<section class="card"><h2>Patrones que sueles pasar por alto</h2><div class="chips">${T.blind.map(t => `<span class="chip warn big">${esc(t.label)} · ${t.missed} de ${t.opp} (${U.pct(t.missRate)})</span>`).join('')}</div><p class="hint">Temas donde la mejor jugada del motor los contenía, no la jugaste y perdiste ≥8 %, al menos en 2 ocasiones y el 40 % de las veces.</p></section>` : ''}
      <section class="card"><h2>Motivos tácticos en tus partidas</h2>
        <p class="hint"><b>Vistos</b>: la mejor jugada tenía ese motivo y la jugaste (o una equivalente). <b>Pasados</b>: no la jugaste y perdiste ≥8 %. <b>Permitidos</b>: motivos que el rival tenía disponibles tras tus errores (≥10 %). Detección heurística sobre las líneas del motor; puede no ser exhaustiva.</p>
        ${rows ? `<div class="tablewrap"><table class="ptable"><thead><tr><th>Motivo</th><th>Vistos</th><th>Pasados</th><th>% pasados</th><th>Permitidos</th><th>Ejemplos (jugada pasada)</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="hint">Aún no hay suficientes posiciones con motivos tácticos. Analiza más partidas.</p>'}</section>
      <div class="grid3">
        ${card('Piezas indefensas sin aprovechar', X.hangMissed.n, X.hangMissed.of, X.hangMissed.examples, 'Oportunidades de ganar una pieza que no tomaste.')}
        ${card('Piezas dejadas en prise', X.leftHanging.n, null, X.leftHanging.examples, 'Jugadas tras las cuales el rival podía ganar una pieza.')}
        ${card('Mates no vistos', X.mates.n, null, X.mates.examples, 'Tenías mate forzado y jugaste otra cosa.')}
        ${card('Errores de cálculo', X.calc.n, X.calc.of, X.calc.examples, 'Capturas o jaques que perdieron ≥15 %.')}
        ${card('Zugzwang', X.zugzwang.n, null, X.zugzwang.examples, `Posiciones donde mover empeoraba (en ${X.zugzwang.bad} cometiste error).`)}
      </div>`;
  }

  /* ================= Tiempo ================= */
  function renderTime(root) {
    const pace = C.coach.paceReport(S.games, S.profile), T = C.coach.timeReport(S.games, S.profile);
    if (!ready()) return (root.innerHTML = needGames());
    const paceRows = Object.entries(pace).map(([k, v]) => `<tr><td><b>${{ bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápidas', classical: 'Clásicas', unknown: 'Sin ritmo indicado' }[k]}</b></td><td>${v.games}</td><td>${v.w}G ${v.d}T ${v.l}P</td><td>${v.acc != null ? v.acc.toFixed(1) + ' %' : '–'}</td><td>${U.pct(v.blunders, 1)}</td></tr>`).join('');
    let h = `<section class="card"><h2>Rendimiento según el ritmo</h2><div class="tablewrap"><table class="ptable"><thead><tr><th>Ritmo</th><th>Partidas</th><th>Resultados</th><th>Precisión</th><th>Errores graves</th></tr></thead><tbody>${paceRows}</tbody></table></div></section>`;
    if (!T.games) {
      h += `<section class="card">${U.empty('Tus partidas no incluyen reloj', 'Para analizar el tiempo y la toma de decisiones, el PGN debe traer comentarios <code>[%clk 0:02:31]</code>. En Lichess: exportar con la opción «Incluir tiempos de reloj». Chess.com solo los incluye en algunas descargas.')}</section>`;
      return (root.innerHTML = h);
    }
    const cmp = (label, a, extra) => `<tr><td>${label}</td><td>${a.n}</td><td>${U.fmtSec(a.avg)}</td><td>${a.err == null ? '–' : U.pct(a.err)}</td><td>${extra || ''}</td></tr>`;
    const base = T.normal.err;
    const v = (a) => (a.err != null && base != null && a.n >= 5 ? (a.err > base * 1.5 ? '<span class="lvl high">peor que tu media</span>' : a.err < base * 0.7 ? '<span class="lvl low">mejor que tu media</span>' : '') : '');
    h = `<div class="grid3"><div class="stat"><span>Partidas con reloj</span><b>${T.games}</b></div><div class="stat"><span>Tiempo medio por jugada</span><b>${U.fmtSec(T.avg)}</b></div><div class="stat"><span>Mediana</span><b>${U.fmtSec(T.median)}</b></div></div>` + h;
    h += `<section class="card"><h2>Decisiones y tiempo</h2>
      <p class="hint">Tasa de error = jugadas que perdieron ≥10 % de probabilidad de ganar. Rápida = ≤35 % de tu tiempo habitual; larga = ≥3× tu mediana; presión = quedaba ≤10 % del tiempo inicial.</p>
      <div class="tablewrap"><table class="ptable"><thead><tr><th>Situación</th><th>Jugadas</th><th>Tiempo medio</th><th>Tasa de error</th><th></th></tr></thead><tbody>
      ${cmp('Posiciones sencillas', T.simple)}${cmp('Posiciones complejas', T.complex, T.complex.avg != null && T.simple.avg != null && T.complex.avg < T.simple.avg ? '<span class="lvl high">piensas menos en las complejas</span>' : '')}
      ${cmp('Jugadas rápidas', T.fast, v(T.fast))}${cmp('Rápidas en posición compleja', Object.assign({ avg: null }, T.fastComplex), v(T.fastComplex))}${cmp('Tras pensar mucho', T.long, v(T.long))}${cmp('Con poco tiempo (presión)', T.press, v(T.press))}${cmp('Momentos críticos', T.crit)}${cmp('Resto de jugadas', Object.assign({ avg: null }, T.normal))}
      </tbody></table></div>
      <h4>Tiempo por fase</h4><p>${['opening', 'middlegame', 'endgame'].map(p => `<span class="chip">${U.PHASE[p]}: ${U.fmtSec(T.byPhase[p].avg)} (${T.byPhase[p].n})</span>`).join(' ')}</p>
      <p class="hint">El mapa jugada a jugada de momentos críticos está en cada partida, pestaña <b>Tiempo</b>.</p></section>`;
    root.innerHTML = h;
  }

  C.views.diagnosis = { render: renderDiag };
  C.views.openings = { render: renderOpenings };
  C.views.tactics = { render: renderTactics };
  C.views.time = { render: renderTime };
})();
