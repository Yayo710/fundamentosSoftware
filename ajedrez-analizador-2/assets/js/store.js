/* store.js — datos de la aplicación: biblioteca, perfil, entrenamiento y cola de análisis (hablan con api.php) */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});

  const defaultProfile = () => ({ names: [], defaultSide: 'auto', engine: 'auto', depth: 12, multipv: 2, onlyMine: false });
  const S = (C.store = {
    games: [], profile: defaultProfile(), training: C.training.emptyState(),
    engine: null, engineMode: null, busy: false, cancel: false, loaded: false,
  });

  async function api(action, body, query) {
    let r;
    try {
      r = await fetch('api.php?action=' + action + (query || ''), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    } catch (e) { throw new Error('No se pudo contactar con api.php. Ejecuta el proyecto con PHP (php -S localhost:8000).'); }
    let j = null;
    try { j = await r.json(); } catch (e) { throw new Error('El servidor no devolvió JSON. ¿Estás sirviendo la carpeta con PHP?'); }
    if (!r.ok || (j && j.error)) { const e = new Error((j && (j.message || j.error)) || 'Error del servidor'); e.code = j && j.error; throw e; }
    return j;
  }

  async function loadAll() {
    const [g, p, t] = await Promise.all([api('games'), api('profile_get'), api('training_get')]);
    S.games = g.items || [];
    const prof = p.profile && !Array.isArray(p.profile) ? p.profile : {};
    S.profile = Object.assign(defaultProfile(), prof);
    if (!Array.isArray(S.profile.names)) S.profile.names = [];
    S.training = t.training && !Array.isArray(t.training) && t.training.items ? t.training : C.training.emptyState();
    C.training.sync(S.training, S.games, S.profile);
    S.loaded = true;
  }

  const byId = id => S.games.find(g => g.id === id);
  const metaOf = game => {
    const sans = game.moves.map(m => m.san);
    return { sans: sans.slice(0, 16), opening: C.openings.identify(sans, game.headers), tc: game.tc, hasClock: game.hasClock, result: game.result, plies: game.moves.length };
  };

  /** Importa uno o varios PGN. sideChoice: 'auto' | 'w' | 'b'. Devuelve {added, existed, errors:[]}. */
  async function importText(text, sideChoice) {
    const parts = C.pgn.splitGames(text), valid = [], metas = [], errors = [];
    parts.forEach((raw, i) => {
      const g = C.pgn.parseGame(raw);
      const name = `${g.headers.White || '?'} – ${g.headers.Black || '?'}`;
      if (g.error) errors.push(`Partida ${i + 1} (${name}): ${g.error}`);
      else if (!g.moves.length) errors.push(`Partida ${i + 1} (${name}): no tiene jugadas`);
      else { valid.push(raw); metas.push(metaOf(g)); }
    });
    if (!parts.length) throw new Error('No se encontró ninguna partida en el texto.');
    let added = 0, existed = 0;
    for (let off = 0; off < valid.length; off += 200) {
      const res = await api('import', { games: valid.slice(off, off + 200) });
      for (let k = 0; k < res.items.length; k++) {
        const it = res.items[k];
        if (!it.id) { errors.push(it.error || 'Error al guardar una partida'); continue; }
        if (it.existed) { existed++; continue; }
        added++;
        await api('game_save', { id: it.id, meta: metas[off + k], side: sideChoice === 'w' || sideChoice === 'b' ? sideChoice : null });
      }
    }
    const g = await api('games'); S.games = g.items || [];
    return { added, existed, errors, total: parts.length };
  }

  async function patchGame(id, patch) {
    await api('game_save', Object.assign({ id }, patch));
    const g = byId(id); if (g) Object.assign(g, patch);
  }

  async function deleteGames(ids) {
    await api('game_delete', { ids });
    S.games = S.games.filter(g => !ids.includes(g.id));
  }

  async function saveProfile() { await api('profile_save', { profile: S.profile }); }
  const saveTraining = C.ui.debounce(() => { api('training_save', { training: S.training }).catch(e => C.ui.toast('No se pudo guardar el progreso: ' + e.message, 'err')); }, 600);

  async function getEngine() {
    const mode = S.profile.engine || 'auto';
    if (S.engine && S.engineMode === mode) return S.engine;
    if (S.engine && S.engine.terminate) S.engine.terminate();
    S.engine = null;
    S.engine = await C.engine.create(mode);
    S.engineMode = mode;
    return S.engine;
  }

  /** Analiza una lista de ids en cola. hooks.progress(doneGames, totalGames, ply, plies, id) */
  async function analyzeIds(ids, hooks) {
    hooks = hooks || {};
    if (S.busy) throw new Error('Ya hay un análisis en curso');
    S.busy = true; S.cancel = false;
    let done = 0, failed = [];
    try {
      const eng = await getEngine();
      for (const id of ids) {
        if (S.cancel) break;
        const rec = byId(id); if (!rec) continue;
        const game = C.pgn.parseGame(rec.pgn);
        if (game.error || !game.moves.length) { failed.push(id); continue; }
        const side = C.coach.sideOf(rec, S.profile);
        const opts = { depth: +S.profile.depth || 12, multipv: +S.profile.multipv || 2, mySide: side, both: !(S.profile.onlyMine && side) };
        const r = await C.analysis.analyzeGame(game, opts, eng, {
          cancelled: () => S.cancel,
          progress: (i, n) => hooks.progress && hooks.progress(done, ids.length, i, n, id),
        });
        if (!r) break;
        const patch = { analysis: r.analysis, derived: JSON.parse(JSON.stringify(r.derived)), meta: metaOf(game) };
        await patchGame(id, patch);
        done++;
        hooks.progress && hooks.progress(done, ids.length, 1, 1, id);
      }
    } finally { S.busy = false; }
    C.training.sync(S.training, S.games, S.profile);
    saveTraining();
    return { done, failed, cancelled: S.cancel };
  }

  async function fetchMasters(fen) {
    try {
      const r = await fetch('api.php?action=masters&fen=' + encodeURIComponent(fen));
      return await r.json();
    } catch (e) { return { error: 'red', message: 'No se pudo contactar con el servidor' }; }
  }

  Object.assign(S, { api, loadAll, byId, metaOf, importText, patchGame, deleteGames, saveProfile, saveTraining, getEngine, analyzeIds, fetchMasters });
})();
