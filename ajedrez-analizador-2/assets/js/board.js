/* board.js — tablero HTML/SVG con flechas, marcas, insignias y entrada de jugadas por clics */
(function () {
  'use strict';
  const C = (globalThis.Coach = globalThis.Coach || {});
  const FILES = 'abcdefgh';
  const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let uid = 0;

  function grid(fen) {
    return fen.split(' ')[0].split('/').map(r => { const row = []; for (const ch of r) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) row.push(null); else row.push(ch); } return row; });
  }

  class Board {
    /** opts: { onMove(uci), size } */
    constructor(el, opts) {
      this.el = el; this.opts = opts || {}; this.id = ++uid; this.sel = null;
      this.state = { fen: START, flipped: false, last: null, badge: null, arrows: [], marks: [], interactive: false };
      el.classList.add('boardbox');
      el.innerHTML = `<div class="bgrid"></div><svg class="barrows" viewBox="0 0 8 8" aria-hidden="true"><defs>
        <marker id="ah-g-${this.id}" markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#3b9c2f"/></marker>
        <marker id="ah-r-${this.id}" markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#d33f3a"/></marker>
        <marker id="ah-b-${this.id}" markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#3b82c4"/></marker></defs></svg>
        <div class="promo" hidden></div>`;
      this.gridEl = el.querySelector('.bgrid'); this.svg = el.querySelector('.barrows'); this.promo = el.querySelector('.promo');
      this.gridEl.addEventListener('click', e => this.click(e));
      this.promo.addEventListener('click', e => {
        const b = e.target.closest('[data-p]'); if (!b) return;
        const p = this.pending; this.promo.hidden = true; this.pending = null;
        if (p && b.dataset.p !== 'x') this.emit(p.from + p.to + b.dataset.p);
        else this.clearSel();
      });
      this.render();
    }

    set(patch) { Object.assign(this.state, patch); this.sel = null; this.promo.hidden = true; this.render(); }
    get fen() { return this.state.fen; }

    clearSel() { this.sel = null; this.render(); }
    emit(uci) { this.sel = null; if (this.opts.onMove) this.opts.onMove(uci); else this.render(); }

    click(e) {
      const sqEl = e.target.closest('.sq'); if (!sqEl || !this.state.interactive) return;
      const sq = sqEl.dataset.sq, ch = new Chess(this.state.fen), turn = this.state.fen.split(' ')[1];
      if (this.sel && this.sel.to.includes(sq)) {
        const cands = ch.moves({ square: this.sel.from, verbose: true }).filter(m => m.to === sq);
        if (cands.some(m => m.promotion)) { this.pending = { from: this.sel.from, to: sq }; this.showPromo(turn); return; }
        return this.emit(this.sel.from + sq);
      }
      const p = ch.get(sq);
      if (p && p.color === turn) {
        this.sel = { from: sq, to: ch.moves({ square: sq, verbose: true }).map(m => m.to) };
      } else this.sel = null;
      this.render();
    }

    showPromo(turn) {
      this.promo.innerHTML = '<div class="promo-box"><span>Promocionar a:</span>' + ['q', 'r', 'b', 'n'].map(p => `<button data-p="${p}" class="${turn === 'w' ? 'w' : 'b'}">${GLYPH[p]}︎</button>`).join('') + '<button data-p="x" class="cancel">✕</button></div>';
      this.promo.hidden = false;
    }

    render() {
      const s = this.state, G = grid(s.fen), selTo = this.sel ? this.sel.to : [];
      const marks = new Map((s.marks || []).map(m => [m.sq, m.cls]));
      let html = '';
      for (let vr = 0; vr < 8; vr++) for (let vc = 0; vc < 8; vc++) {
        const r = s.flipped ? 7 - vr : vr, f = s.flipped ? 7 - vc : vc, sq = FILES[f] + (8 - r), p = G[r][f];
        let cls = 'sq ' + ((r + f) % 2 ? 'dark' : 'light');
        if (s.last && (sq === s.last[0] || sq === s.last[1])) cls += ' last';
        if (this.sel && this.sel.from === sq) cls += ' sel';
        if (selTo.includes(sq)) cls += p ? ' cap' : ' tgt';
        if (marks.has(sq)) cls += ' ' + marks.get(sq);
        if (s.interactive) cls += ' act';
        html += `<div class="${cls}" data-sq="${sq}">`;
        if (p) html += `<span class="pc ${p === p.toUpperCase() ? 'w' : 'b'}">${GLYPH[p.toLowerCase()]}︎</span>`;
        if (vc === 0) html += `<i class="co r">${8 - r}</i>`;
        if (vr === 7) html += `<i class="co f">${FILES[f]}</i>`;
        if (s.badge && s.badge.sq === sq && s.badge.sym) html += `<b class="badge" style="background:${s.badge.color}">${s.badge.sym}</b>`;
        html += '</div>';
      }
      this.gridEl.innerHTML = html;
      this.svg.querySelectorAll('line').forEach(l => l.remove());
      const pt = sq => { const f = FILES.indexOf(sq[0]), r = 8 - +sq[1]; return [(s.flipped ? 7 - f : f) + 0.5, (s.flipped ? 7 - r : r) + 0.5]; };
      for (const a of s.arrows || []) {
        const [x1, y1] = pt(a.from), [x2, y2] = pt(a.to), l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const col = a.color === 'red' ? 'r' : a.color === 'blue' ? 'b' : 'g';
        l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
        l.setAttribute('stroke', col === 'r' ? '#d33f3a' : col === 'b' ? '#3b82c4' : '#3b9c2f'); l.setAttribute('stroke-width', '0.16');
        l.setAttribute('stroke-linecap', 'round'); l.setAttribute('opacity', '.85'); l.setAttribute('marker-end', `url(#ah-${col}-${this.id})`);
        this.svg.appendChild(l);
      }
    }
  }

  C.Board = Board;
})();
