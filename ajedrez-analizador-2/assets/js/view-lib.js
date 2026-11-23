/* view-lib.js — Biblioteca (importar, listar, analizar) y Ajustes (perfil del jugador y motor) */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const S = C.store, U = C.ui, { esc } = U;

  let sel = new Set(), filter = '', root = null, lastMsg = null;

  const opText = g => { const o = (g.derived && g.derived.opening) || (g.meta && g.meta.opening); return o ? o.family + (o.variation ? ' · ' + o.variation : '') : '–'; };

  function rowHtml(g) {
    const h = g.headers || {}, eff = C.coach.sideOf(g, S.profile), an = !!g.derived;
    const nm = (c, n) => (eff === c ? `<b>${esc(n || '?')}</b>` : esc(n || '?'));
    const acc = an && eff && g.derived.stats && g.derived.stats[eff] ? g.derived.stats[eff].acc : null;
    return `<tr data-id="${esc(g.id)}">
      <td><input type="checkbox" data-sel="${esc(g.id)}"${sel.has(g.id) ? ' checked' : ''} aria-label="Seleccionar"></td>
      <td>${esc(h.Date || '')}</td>
      <td>${nm('w', h.White)} – ${nm('b', h.Black)}</td>
      <td>${esc(h.Result || '*')}</td>
      <td>${esc(opText(g))}</td>
      <td><select data-side="${esc(g.id)}" aria-label="Mi bando"><option value="">Auto${eff && !g.side ? ' (' + U.SIDE[eff] + ')' : ''}</option><option value="w"${g.side === 'w' ? ' selected' : ''}>Blancas</option><option value="b"${g.side === 'b' ? ' selected' : ''}>Negras</option></select></td>
      <td>${g.plies || ''}</td>
      <td>${an ? `<span class="tag ok">Analizada · p${g.derived.depth}</span>${acc != null ? ` <small>${acc.toFixed(0)} %</small>` : ''}` : '<span class="tag">Pendiente</span>'}</td>
      <td class="acts"><button class="btn small" data-open="${esc(g.id)}" data-ply="0">Abrir</button><button class="btn small secondary" data-an="${esc(g.id)}">${an ? 'Re-analizar' : 'Analizar'}</button><button class="btn small secondary" data-del="${esc(g.id)}" title="Eliminar">🗑</button></td></tr>`;
  }

  function filtered() {
    const f = filter.trim().toLowerCase();
    return !f ? S.games : S.games.filter(g => { const h = g.headers || {}; return [h.White, h.Black, h.Event, h.Date, opText(g)].join(' ').toLowerCase().includes(f); });
  }

  function render(r) {
    root = r;
    const pending = S.games.filter(g => !g.derived), noSide = S.games.filter(g => !C.coach.sideOf(g, S.profile)).length;
    const list = filtered();
    root.innerHTML = `
      <div class="grid2">
        <section class="card">
          <h2>Importar partidas</h2>
          <p class="hint">Pega una o varias partidas en PGN, o sube uno o varios archivos <code>.pgn</code> (por ejemplo, tu exportación de Lichess o Chess.com).</p>
          <textarea id="imp-text" spellcheck="false" placeholder="[Event &quot;…&quot;]&#10;[White &quot;…&quot;]&#10;…&#10;1. e4 e5 2. Nf3 …"></textarea>
          <div class="row">
            <label class="btn secondary">Subir .pgn<input type="file" id="imp-file" accept=".pgn,.txt" multiple hidden></label>
            <label class="inline">Yo juego con <select id="imp-side"><option value="auto">Detectar por mi nombre</option><option value="w">Blancas (todas)</option><option value="b">Negras (todas)</option></select></label>
            <button class="btn" id="imp-go">Importar</button>
            <button class="btn secondary" id="imp-demo" title="Carga unas partidas de ejemplo para probar">Cargar ejemplo</button>
          </div>
          <div id="imp-msg" class="msg" role="status">${lastMsg || ''}</div>
        </section>
        <section class="card">
          <h2>Tu perfil de jugador</h2>
          ${S.profile.names.length ? `<p>Nombres de usuario: <b>${esc(S.profile.names.join(', '))}</b> · bando por defecto: <b>${S.profile.defaultSide === 'auto' ? 'según el nombre' : U.SIDE[S.profile.defaultSide]}</b>.</p>` : '<p class="msg">Aún no has indicado tu nombre de usuario. Sin él, el sistema no sabe qué lado de cada partida eres tú.</p>'}
          <p class="hint">${noSide ? `<b>${noSide}</b> partida(s) sin bando asignado: elige «Blancas/Negras» en su fila o configura tu nombre.` : 'Todas las partidas tienen bando asignado.'}</p>
          <div class="row"><button class="btn secondary" data-tab-go="settings">Configurar perfil y motor</button></div>
          <p class="hint">Motor: <b>${esc(engineLabel())}</b> · profundidad <b>${S.profile.depth}</b> · MultiPV <b>${S.profile.multipv}</b>${S.profile.onlyMine ? ' · solo mi bando' : ' · ambos bandos'}.</p>
        </section>
      </div>
      <section class="card">
        <div class="lib-head"><h2>Biblioteca <small>${S.games.length} partida(s)</small></h2>
          <div class="row"><input type="search" id="lib-filter" placeholder="Buscar jugador, apertura, fecha…" value="${esc(filter)}">
            <button class="btn" id="an-pending"${pending.length ? '' : ' disabled'}>Analizar pendientes (${pending.length})</button>
            <button class="btn secondary" id="an-sel"${sel.size ? '' : ' disabled'}>Analizar seleccionadas (${sel.size})</button>
            <button class="btn secondary danger" id="del-sel"${sel.size ? '' : ' disabled'}>Eliminar seleccionadas</button></div></div>
        ${S.games.length ? `<div class="tablewrap"><table class="lib"><thead><tr><th><input type="checkbox" id="sel-all" aria-label="Seleccionar todas"></th><th>Fecha</th><th>Partida</th><th>Res.</th><th>Apertura</th><th>Mi bando</th><th>Sem.</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(rowHtml).join('')}</tbody></table></div>` : U.empty('Tu biblioteca está vacía', 'Importa tus partidas para empezar. Cuantas más partidas analices, más fiable será el diagnóstico.')}
      </section>`;
    wire();
  }

  function engineLabel() { return { auto: 'Stockfish (servidor si existe, si no navegador)', server: 'Stockfish del servidor', wasm: 'Stockfish en el navegador (WASM)' }[S.profile.engine] || S.profile.engine; }

  function wire() {
    const q = id => U.$(id, root);
    q('#imp-go').onclick = async () => {
      const files = q('#imp-file').files; let text = q('#imp-text').value;
      for (const f of files) text += '\n\n' + await f.text();
      await doImport(text, q('#imp-side').value);
    };
    q('#imp-file').onchange = async e => {
      const names = [...e.target.files].map(f => f.name).join(', ');
      if (names) q('#imp-msg').textContent = 'Archivos listos: ' + names + '. Pulsa «Importar».';
    };
    q('#imp-demo').onclick = async () => {
      const r = await fetch('assets/demo.pgn'); if (!r.ok) return U.toast('No se encontró assets/demo.pgn', 'err');
      // las partidas de ejemplo las juega «Demo»: se añade a tus nombres para que el bando se detecte solo
      if (!S.profile.names.some(n => n.toLowerCase() === 'demo')) { S.profile.names.push('Demo'); try { await S.saveProfile(); } catch (e) { /* se ignora */ } }
      await doImport(await r.text(), 'auto', true);
    };
    const flt = q('#lib-filter'); if (flt) flt.oninput = U.debounce(() => { filter = flt.value; render(root); const f = U.$('#lib-filter', root); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250);
    const all = q('#sel-all'); if (all) all.onchange = () => { filtered().forEach(g => (all.checked ? sel.add(g.id) : sel.delete(g.id))); render(root); };
    q('#an-pending').onclick = () => C.app.analyze(S.games.filter(g => !g.derived).map(g => g.id));
    q('#an-sel').onclick = () => C.app.analyze([...sel]);
    q('#del-sel').onclick = () => delIds([...sel]);
    root.onclick = e => {
      const a = e.target.closest('[data-an]'); if (a) return C.app.analyze([a.dataset.an]);
      const d = e.target.closest('[data-del]'); if (d) return delIds([d.dataset.del]);
    };
    root.onchange = async e => {
      const s = e.target.closest('[data-sel]'); if (s) { s.checked ? sel.add(s.dataset.sel) : sel.delete(s.dataset.sel); return render(root); }
      const sd = e.target.closest('[data-side]');
      if (sd) {
        try { await S.patchGame(sd.dataset.side, { side: sd.value || null }); C.training.sync(S.training, S.games, S.profile); S.saveTraining(); render(root); } catch (err) { U.toast(err.message, 'err'); }
      }
    };
  }

  async function doImport(text, side, quiet) {
    if (!text.trim()) { lastMsg = ''; U.$('#imp-msg', root).textContent = 'Pega primero una partida en PGN o sube un archivo.'; return; }
    const btn = U.$('#imp-go', root); btn.disabled = true;
    try {
      const r = await S.importText(text, side);
      let m = `Importadas ${r.added} de ${r.total}${r.existed ? ` (${r.existed} ya estaban en la biblioteca)` : ''}.`;
      if (r.errors.length) m += ' Problemas: ' + r.errors.slice(0, 5).map(esc).join(' · ') + (r.errors.length > 5 ? ` … (+${r.errors.length - 5})` : '');
      lastMsg = m; if (!quiet || true) U.toast(`Importadas ${r.added} partida(s)`, r.errors.length ? 'err' : '');
      C.training.sync(S.training, S.games, S.profile);
      render(root);
    } catch (e) { U.toast(e.message, 'err'); btn.disabled = false; U.$('#imp-msg', root).textContent = e.message; }
  }

  async function delIds(ids) {
    if (!ids.length || !confirm(`¿Eliminar ${ids.length} partida(s) de la biblioteca? Los ejercicios ya generados se conservan.`)) return;
    try { await S.deleteGames(ids); ids.forEach(i => sel.delete(i)); render(root); } catch (e) { U.toast(e.message, 'err'); }
  }

  /* ================= Ajustes ================= */
  function renderSettings(r) {
    root = r; const p = S.profile;
    root.innerHTML = `
      <div class="grid2">
        <section class="card">
          <h2>Perfil del jugador</h2>
          <label class="field">Tus nombres de usuario (separados por comas)
            <input type="text" id="st-names" value="${esc(p.names.join(', '))}" placeholder="Brayan, brayan123, TuUsuarioLichess"></label>
          <p class="hint">El sistema los compara con las cabeceras <code>White</code> y <code>Black</code> para saber qué lado eres tú en cada partida. No distingue mayúsculas.</p>
          <label class="field">Si no se puede deducir, asumir que juego con
            <select id="st-side"><option value="auto"${p.defaultSide === 'auto' ? ' selected' : ''}>Preguntar (sin asignar)</option><option value="w"${p.defaultSide === 'w' ? ' selected' : ''}>Blancas</option><option value="b"${p.defaultSide === 'b' ? ' selected' : ''}>Negras</option></select></label>
          <p class="hint">También puedes cambiar el bando partida por partida en la biblioteca o dentro de cada partida.</p>
        </section>
        <section class="card">
          <h2>Motor de análisis</h2>
          <label class="field">Motor
            <select id="st-engine"><option value="auto"${p.engine === 'auto' ? ' selected' : ''}>Automático (servidor si existe, si no navegador)</option><option value="server"${p.engine === 'server' ? ' selected' : ''}>Stockfish del servidor (nativo, más rápido)</option><option value="wasm"${p.engine === 'wasm' ? ' selected' : ''}>Stockfish en el navegador (WebAssembly)</option></select></label>
          <div class="row"><label class="inline">Profundidad <select id="st-depth">${[8, 10, 12, 14, 16, 18, 20].map(v => `<option${+p.depth === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="inline">Variantes (MultiPV) <select id="st-mpv">${[1, 2, 3].map(v => `<option${+p.multipv === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>
          <label class="inline"><input type="checkbox" id="st-mine"${p.onlyMine ? ' checked' : ''}> Analizar a fondo solo mi bando (más rápido)</label>
          <p class="hint">Más profundidad = análisis más fiable pero más lento. Con profundidad menor de 10 las evaluaciones son poco fiables (úsala solo para pruebas); 12–14 es un buen equilibrio. Con MultiPV ≥ 2 se detectan «jugadas únicas» y los ejercicios tienen varias respuestas válidas.</p>
          <div class="row"><button class="btn secondary" id="st-test">Probar motor</button><span id="st-test-msg" class="msg"></span></div>
        </section>
      </div>
      <div class="row"><button class="btn" id="st-save">Guardar ajustes</button><span id="st-msg" class="msg"></span></div>
      <section class="card">
        <h2>Comparación con partidas de maestros</h2>
        <p>El explorador de aperturas de Lichess exige un token personal. Créalo gratis en <code>lichess.org/account/oauth/token</code> (sin marcar ningún permiso) y pégalo en <code>config.php</code> (<code>lichess_token</code>) o en la variable de entorno <code>LICHESS_TOKEN</code>. Sin token, el resto de la aplicación funciona igual y esta comparación se desactiva.</p>
        <div class="row"><button class="btn secondary" id="st-masters">Comprobar conexión con el explorador</button><span id="st-masters-msg" class="msg"></span></div>
      </section>
      <section class="card">
        <h2>Datos</h2>
        <p class="hint">Todo se guarda en la carpeta <code>data/</code> del servidor (JSON). Puedes hacer copia de seguridad copiándola.</p>
        <div class="row"><button class="btn secondary danger" id="st-reset">Reiniciar progreso del entrenador</button></div>
      </section>`;
    const q = id => U.$(id, root);
    q('#st-save').onclick = async () => {
      S.profile.names = q('#st-names').value.split(',').map(s => s.trim()).filter(Boolean);
      S.profile.defaultSide = q('#st-side').value; S.profile.engine = q('#st-engine').value;
      S.profile.depth = +q('#st-depth').value; S.profile.multipv = +q('#st-mpv').value; S.profile.onlyMine = q('#st-mine').checked;
      try { await S.saveProfile(); C.training.sync(S.training, S.games, S.profile); S.saveTraining(); q('#st-msg').textContent = 'Guardado.'; U.toast('Ajustes guardados'); } catch (e) { q('#st-msg').textContent = e.message; q('#st-msg').className = 'msg err'; }
    };
    q('#st-test').onclick = async () => {
      const m = q('#st-test-msg'); m.className = 'msg'; m.textContent = 'Probando…';
      try {
        const mode = q('#st-engine').value, t0 = performance.now();
        const e = await C.engine.create(mode); const r = await e.analyze('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 10, 1);
        if (mode !== 'server' && e.terminate && mode !== 'auto') e.terminate();
        m.textContent = `Funciona (${e.kind === 'server' ? 'servidor' : 'navegador'}): evaluación ${C.util.fmtEval(-r.lines[0].cp)} en ${(performance.now() - t0).toFixed(0)} ms.`;
      } catch (e) { m.className = 'msg err'; m.textContent = e.message; }
    };
    q('#st-masters').onclick = async () => {
      const m = q('#st-masters-msg'); m.className = 'msg'; m.textContent = 'Consultando…';
      const r = await S.fetchMasters('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      if (r.error) { m.className = 'msg err'; m.textContent = r.message || r.error; } else m.textContent = `Conectado: ${r.total.toLocaleString('es')} partidas de maestros en la posición inicial.`;
    };
    q('#st-reset').onclick = async () => {
      if (!confirm('¿Reiniciar el progreso del entrenador? Los ejercicios se regenerarán desde tus partidas, pero se perderá el historial de intentos.')) return;
      S.training = C.training.emptyState(); C.training.sync(S.training, S.games, S.profile); S.saveTraining(); U.toast('Progreso reiniciado');
    };
  }

  C.views.library = { render };
  C.views.settings = { render: renderSettings };
})();
