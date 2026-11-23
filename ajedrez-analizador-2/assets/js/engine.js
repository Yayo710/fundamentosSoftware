/* engine.js — adaptadores de motor: Stockfish WASM (Web Worker) y Stockfish nativo vía PHP.
 * Ambos exponen: init(), analyze(fen, depth, multipv) → {lines:[{cp, pv:[uci…]}]}
 * cp se expresa desde el punto de vista del bando que mueve (mate n → ±(10000−n)). */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const mateToCp = v => (v > 0 ? 10000 - v : -10000 - v);

  class WasmEngine {
    constructor(opts) {
      this.kind = 'wasm';
      this.url = (opts && opts.url) || (typeof WebAssembly === 'object' ? 'vendor/stockfish.wasm.js' : 'vendor/stockfish.js');
      this.w = null; this.handlers = []; this.mpv = 1; this.chain = Promise.resolve(); this.ready = false;
    }
    _send(s) { this.w.postMessage(s); }
    _wait(pred, ms) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { this.handlers = this.handlers.filter(x => x !== h); reject(new Error('El motor no respondió a tiempo')); }, ms);
        const h = l => { if (pred(l)) { clearTimeout(t); this.handlers = this.handlers.filter(x => x !== h); resolve(l); } };
        this.handlers.push(h);
      });
    }
    async init() {
      if (this.ready) return;
      this.w = new Worker(this.url);
      this.w.onmessage = e => { const l = String(e.data); this.handlers.slice().forEach(h => h(l)); };
      this.w.onerror = e => { console.error('Error del worker del motor', e.message || e); };
      this._send('uci');
      await this._wait(l => l === 'uciok', 40000);
      this._send('setoption name Hash value 32');
      this._send('isready');
      await this._wait(l => l === 'readyok', 40000);
      this.ready = true;
    }
    analyze(fen, depth, mpv) {
      const run = () => this._analyze(fen, depth, mpv || 1);
      const p = this.chain.then(run, run);
      this.chain = p.catch(() => {});
      return p;
    }
    _analyze(fen, depth, mpv) {
      return new Promise((resolve, reject) => {
        const lines = [];
        const clean = () => { clearTimeout(t); this.handlers = this.handlers.filter(x => x !== h); };
        const t = setTimeout(() => { clean(); this._send('stop'); reject(new Error('Tiempo de análisis agotado')); }, 240000);
        const h = l => {
          if (l.startsWith('info') && l.includes(' pv ') && !/(lower|upper)bound/.test(l)) {
            const mm = l.match(/ multipv (\d+)/), sc = l.match(/ score (cp|mate) (-?\d+)/);
            if (sc) lines[(mm ? +mm[1] : 1) - 1] = { cp: sc[1] === 'cp' ? +sc[2] : mateToCp(+sc[2]), pv: l.split(' pv ')[1].trim().split(/\s+/) };
          } else if (l.startsWith('bestmove')) {
            clean();
            const out = lines.filter(Boolean), bm = l.split(' ')[1];
            if (!out.length && bm && bm !== '(none)') out.push({ cp: 0, pv: [bm] });
            resolve({ lines: out });
          }
        };
        this.handlers.push(h);
        if (mpv !== this.mpv) { this._send('setoption name MultiPV value ' + mpv); this.mpv = mpv; }
        this._send('position fen ' + fen);
        this._send('go depth ' + depth);
      });
    }
    stop() { if (this.w && this.ready) this._send('stop'); }
    terminate() { if (this.w) this.w.terminate(); this.w = null; this.ready = false; }
  }

  class ServerEngine {
    constructor() { this.kind = 'server'; }
    async init() {
      const st = await status(true);
      if (!st.available) throw new Error(st.message || 'No hay un motor Stockfish disponible en el servidor');
    }
    async analyze(fen, depth, mpv) {
      const r = await fetch('api.php?action=engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fen, depth, multipv: mpv || 1 }) });
      let j = null;
      try { j = await r.json(); } catch (e) { /* respuesta no JSON */ }
      if (!r.ok || !j || j.error) throw new Error((j && j.error) || 'Error del motor del servidor');
      return { lines: (j.lines || []).map(l => ({ cp: l.t === 'cp' ? l.v : mateToCp(l.v), pv: l.pv || [] })) };
    }
    stop() {}
    terminate() {}
  }

  let cached = null;
  async function status(force) {
    if (cached && !force) return cached;
    try {
      const r = await fetch('api.php?action=engine_status');
      cached = await r.json();
    } catch (e) { cached = { available: false, message: 'No se pudo contactar con api.php (¿ejecutas con PHP?)' }; }
    return cached;
  }

  /** mode: 'server' | 'wasm' | 'auto' (servidor si existe) */
  async function create(mode) {
    if (mode === 'auto') mode = (await status()).available ? 'server' : 'wasm';
    const e = mode === 'server' ? new ServerEngine() : new WasmEngine();
    await e.init();
    return e;
  }

  C.engine = { WasmEngine, ServerEngine, status, create, mateToCp };
})();
