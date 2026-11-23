/* app.js — arranque, navegación por pestañas y cola global de análisis */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const S = C.store, U = C.ui, { esc } = U;

  const TABS = [
    ['library', '📚 Biblioteca'], ['game', '♟ Partida'], ['diagnosis', '🩺 Diagnóstico'], ['openings', '📖 Aperturas'],
    ['tactics', '⚔ Tácticas'], ['time', '⏱ Tiempo'], ['train', '🎯 Entrenador'], ['settings', '⚙ Ajustes'],
  ];
  let current = 'library';

  function nav() {
    U.$('#tabs').innerHTML = TABS.map(([id, label]) => `<button class="mtab${id === current ? ' active' : ''}" data-tab-go="${id}">${label}</button>`).join('');
  }

  function show(name, params) {
    if (!C.views[name]) name = 'library';
    if (name === 'game' && params && params.id) C.views.game.open(params.id, params.ply || 0);
    if (name === 'train' && params && params.key) C.views.train.open(params.key);
    current = name; nav();
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// u otros */ }
    const root = U.$('#view'); root.onclick = root.onchange = root.oninput = null;
    try { C.views[name].render(root); } catch (e) { console.error(e); root.innerHTML = `<div class="empty-state"><h3>Error al mostrar la vista</h3><p>${esc(e.message)}</p></div>`; }
    window.scrollTo({ top: 0 });
  }
  const refresh = () => show(current);

  /* ---------- análisis con barra de progreso global ---------- */
  async function analyze(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return U.toast('No hay partidas que analizar');
    if (S.busy) return U.toast('Ya hay un análisis en curso');
    const bar = U.$('#anbar'); bar.hidden = false;
    const set = (t, f) => { U.$('#anbar-text').textContent = t; U.$('#anbar-fill').style.width = (f * 100).toFixed(0) + '%'; };
    set('Preparando el motor Stockfish…', 0);
    U.$('#anbar-cancel').onclick = () => { S.cancel = true; if (S.engine && S.engine.stop) S.engine.stop(); set('Cancelando…', 0); };
    const t0 = Date.now();
    try {
      const res = await S.analyzeIds(ids, {
        progress: (done, total, i, n, id) => {
          const rec = S.byId(id), h = rec ? rec.headers : {};
          set(`Analizando partida ${Math.min(done + 1, total)} de ${total} (${h.White || '?'} – ${h.Black || '?'}) · posición ${i} de ${n}`, (done + i / n) / total);
        },
      });
      const noSide = ids.filter(id => { const g = S.byId(id); return g && g.derived && !C.coach.sideOf(g, S.profile); }).length;
      U.toast(`${res.cancelled ? 'Cancelado: ' : ''}${res.done} partida(s) analizada(s) en ${((Date.now() - t0) / 1000).toFixed(0)} s` + (noSide ? `. ${noSide} sin bando asignado: no cuentan para tu diagnóstico` : ''), noSide ? 'err' : '');
    } catch (e) { U.toast('Error del motor: ' + e.message, 'err'); }
    bar.hidden = true;
    refresh();
  }

  /* ---------- eventos globales ---------- */
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); show('game', { id: open.dataset.open, ply: +open.dataset.ply || 0 }); return; }
    const tg = e.target.closest('[data-tab-go]');
    if (tg) { e.preventDefault(); show(tg.dataset.tabGo); return; }
    const a = e.target.closest('a[href="#"]'); if (a) e.preventDefault();
  });

  async function boot() {
    nav();
    const root = U.$('#view');
    if (typeof Chess === 'undefined') { root.innerHTML = U.empty('Falta chess.js', 'No se pudo cargar <code>vendor/chess.js</code>.'); return; }
    root.innerHTML = '<p class="hint center">Cargando tus datos…</p>';
    try { await S.loadAll(); } catch (e) {
      root.innerHTML = `<div class="empty-state"><h3>No se pudo conectar con el servidor</h3><p>${esc(e.message)}</p><p>Desde la carpeta del proyecto ejecuta: <code>php -S localhost:8000</code> y abre <code>http://localhost:8000</code>.</p></div>`;
      return;
    }
    const h = (location.hash || '').replace('#', '');
    show(TABS.some(t => t[0] === h) && h !== 'game' ? h : 'library');
  }

  C.app = { show, refresh, analyze };
  document.addEventListener('DOMContentLoaded', boot);
})();
