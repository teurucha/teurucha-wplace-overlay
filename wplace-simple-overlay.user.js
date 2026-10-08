// ==UserScript==
// @name         teurucha-wplace-overlay
// @namespace    teurucha-woverlay
// @version      0.6
// @description  Turn any picture into Wplace colors, fit it to an area, overlay it, and see which color goes where
// @license      MIT
// @homepageURL  https://github.com/teurucha/teurucha-wplace-overlay
// @supportURL   https://github.com/teurucha/teurucha-wplace-overlay/issues
// @match        https://wplace.live/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  const KEY = 'simpleOverlay';
  const FREE = [[0,0,0],[60,60,60],[120,120,120],[210,210,210],[255,255,255],[96,0,24],[237,28,36],[255,127,39],[246,170,9],[249,221,59],[255,250,188],[14,185,104],[19,230,123],[135,255,94],[12,129,110],[16,174,166],[19,225,190],[40,80,158],[64,147,228],[96,247,242],[107,80,246],[153,177,251],[120,12,153],[170,56,185],[224,159,249],[203,0,122],[236,31,128],[243,141,169],[104,70,52],[149,104,42],[248,178,119]];
  const PREM = [[170,170,170],[165,14,30],[250,128,114],[228,92,26],[214,181,148],[156,132,49],[197,173,49],[232,212,95],[74,107,58],[90,148,74],[132,197,115],[15,121,159],[187,250,242],[125,199,255],[77,49,184],[74,66,132],[122,113,196],[181,174,241],[219,164,99],[209,128,81],[255,197,165],[155,82,73],[209,128,120],[250,182,164],[123,99,82],[156,132,107],[51,57,65],[109,117,141],[179,185,209],[109,100,63],[148,140,107],[205,197,158]];
  const NAMES = ['Black','Dark Gray','Gray','Light Gray','White','Deep Red','Red','Orange','Gold','Yellow','Light Yellow','Dark Green','Green','Light Green','Dark Teal','Teal','Light Teal','Dark Blue','Blue','Cyan','Indigo','Light Indigo','Dark Purple','Purple','Light Purple','Dark Pink','Pink','Light Pink','Dark Brown','Brown','Beige',
    'Medium Gray','Dark Red','Light Red','Dark Orange','Light Tan','Dark Goldenrod','Goldenrod','Light Goldenrod','Dark Olive','Olive','Light Olive','Dark Cyan','Light Cyan','Light Blue','Dark Indigo','Dark Slate Blue','Slate Blue','Light Slate Blue','Light Brown','Dark Beige','Light Beige','Dark Peach','Peach','Light Peach','Dark Tan','Tan','Dark Slate','Slate','Light Slate','Dark Stone','Stone','Light Stone'];
  const PAL = FREE.concat(PREM);

  let S = { img: null, name: '', tx: 0, ty: 0, px: 0, py: 0, aw: 0, ah: 0, stretch: false, op: 0.6, focus: null, dither: false, premium: false, hidden: false, x: 12, y: 70, min: false };
  try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}

  // Saved settings come from localStorage, so treat them as untrusted and validate every field.
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  ['tx', 'ty', 'px', 'py', 'aw', 'ah'].forEach(k => (S[k] = Math.min(2000000, Math.max(0, Math.floor(num(S[k], 0))))));
  S.op = Math.min(1, Math.max(0.1, num(S.op, 0.6)));
  S.x = num(S.x, 12); S.y = num(S.y, 70);
  S.stretch = !!S.stretch; S.min = !!S.min; S.dither = !!S.dither; S.premium = !!S.premium; S.hidden = !!S.hidden;
  S.name = typeof S.name === 'string' ? S.name.slice(0, 100) : '';
  S.focus = Number.isInteger(S.focus) && S.focus >= 0 && S.focus < PAL.length ? S.focus : null;
  if (typeof S.img !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(S.img)) S.img = null;

  const nearest = (r, g, b, allowed) => {
    let best = 0, bd = 1e12;
    const n = allowed ? allowed.length : PAL.length;
    for (let k = 0; k < n; k++) {
      const i = allowed ? allowed[k] : k;
      const p = PAL[i], rm = (r + p[0]) / 2, dr = r - p[0], dg = g - p[1], db = b - p[2];
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  // template info: palette index per pixel + count per color
  let tpl = null, onTpl = null, bitmap = null, capturing = false, onPick = () => {};
  function buildTpl(img) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const ids = new Uint8Array(c.width * c.height).fill(255), counts = new Array(PAL.length).fill(0), cache = new Map();
    for (let i = 0; i < ids.length; i++) {
      if (d[i * 4 + 3] < 128) continue;
      const k = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
      let id = cache.get(k);
      if (id === undefined) { id = nearest(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); cache.set(k, id); }
      ids[i] = id; counts[id]++;
    }
    tpl = { w: c.width, h: c.height, ids, counts };
  }
  if (S.img) {
    const i = new Image();
    i.onload = () => { buildTpl(i); createImageBitmap(i).then(b => (bitmap = b)); if (onTpl) onTpl(); };
    i.src = S.img;
  }

  // Intercept tile downloads and draw the overlay on top.
  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await realFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input.url;
      if (!/(^|\.)wplace\.live$/.test(new URL(url, location.href).hostname)) return res;
      const pm = capturing && url.match(/\/pixel\/(\d+)\/(\d+)/);
      if (pm) {
        const q = new URL(url, location.href).searchParams;
        if (q.has('x') && q.has('y')) { capturing = false; onPick(+pm[1], +pm[2], +q.get('x'), +q.get('y')); }
      }
      const m = bitmap && !S.hidden && url.match(/\/tiles\/(\d+)\/(\d+)\.png/);
      if (!m) return res;
      const tx = +m[1], ty = +m[2];
      const tile = await createImageBitmap(await res.clone().blob());
      const s = tile.width / 1000;
      const dx = (S.tx * 1000 + S.px - tx * 1000) * s;
      const dy = (S.ty * 1000 + S.py - ty * 1000) * s;
      const dw = bitmap.width * s, dh = bitmap.height * s;
      if (dx >= tile.width || dy >= tile.height || dx + dw <= 0 || dy + dh <= 0) return res;
      let c, x;
      if (S.focus != null && tpl && s === 1) {
        // focus mode: only show the pixels that still need the chosen color
        const K = 3, col = PAL[S.focus];
        const tc = new OffscreenCanvas(tile.width, tile.height), tctx = tc.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(tile, 0, 0);
        const td = tctx.getImageData(0, 0, tile.width, tile.height).data;
        c = new OffscreenCanvas(tile.width * K, tile.height * K); x = c.getContext('2d');
        x.imageSmoothingEnabled = false;
        x.drawImage(tile, 0, 0, c.width, c.height);
        x.globalAlpha = 0.25; x.drawImage(bitmap, dx * K, dy * K, dw * K, dh * K); x.globalAlpha = 1;
        const dot = (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11) > 140 ? '#000' : '#fff';
        const i0 = Math.max(0, -dx), i1 = Math.min(tpl.w, tile.width - dx);
        const j0 = Math.max(0, -dy), j1 = Math.min(tpl.h, tile.height - dy);
        for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
          if (tpl.ids[j * tpl.w + i] !== S.focus) continue;
          const X = dx + i, Y = dy + j, o = (Y * tile.width + X) * 4;
          if (td[o + 3] >= 128 && td[o] === col[0] && td[o + 1] === col[1] && td[o + 2] === col[2]) continue;
          x.fillStyle = 'rgb(' + col + ')'; x.fillRect(X * K, Y * K, K, K);
          x.fillStyle = dot; x.fillRect(X * K + 1, Y * K + 1, 1, 1);
        }
      } else {
        c = new OffscreenCanvas(tile.width, tile.height); x = c.getContext('2d');
        x.drawImage(tile, 0, 0);
        x.imageSmoothingEnabled = false; x.globalAlpha = S.op;
        x.drawImage(bitmap, dx, dy, dw, dh);
      }
      const blob = await c.convertToBlob({ type: 'image/png' });
      return new Response(blob, { status: res.status, headers: res.headers });
    } catch (e) { return res; }
  };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch (e) { return false; }
  }

  const CSS = `
  #so{position:fixed;z-index:99999;width:264px;box-sizing:border-box;background:rgba(24,26,34,.95);
    backdrop-filter:blur(8px);color:#eceef4;font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.45);user-select:none;touch-action:none}
  #so *{box-sizing:border-box}
  #so .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:grab;border-bottom:1px solid rgba(255,255,255,.08)}
  #so .hd:active{cursor:grabbing}
  #so .dot{width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,#4093e4,#aa38b9)}
  #so .ttl{font-weight:700;flex:1;letter-spacing:.2px}
  #so .mn{background:none;border:0;color:#9aa0b4;font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
  #so .mn:hover{color:#fff}
  #so .bd{padding:12px;display:flex;flex-direction:column;gap:12px;max-height:calc(100vh - 110px);overflow:auto}
  #so.min .bd{display:none}
  #so .sec{display:flex;flex-direction:column;gap:6px}
  #so .lb{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#8b92a8;font-weight:600}
  #so .btn{border:0;border-radius:8px;padding:9px 10px;font:inherit;font-weight:600;cursor:pointer;color:#fff;background:#3a3f55;width:100%}
  #so .btn:hover{background:#464c66}
  #so .btn.pri{background:#4093e4}#so .btn.pri:hover{background:#3380cc}
  #so .btn.go{background:#2e7d5b}#so .btn.go:hover{background:#27694c}
  #so .btn.ghost{background:transparent;color:#9aa0b4;border:1px solid rgba(255,255,255,.14);font-weight:500}
  #so .btn.ghost:hover{color:#fff;background:rgba(255,255,255,.06)}
  #so .btn.act{background:#c9772b}
  #so input[type=number]{width:100%;background:#12141b;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;padding:6px 7px;font:inherit}
  #so .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  #so .wl{display:flex;flex-direction:column;gap:2px;font-size:11px;color:#8b92a8}
  #so .grid label{display:flex;flex-direction:column;gap:2px;font-size:11px;color:#8b92a8}
  #so .rg{display:flex;align-items:center;gap:8px}
  #so input[type=range]{flex:1;accent-color:#4093e4}
  #so .hint{font-size:12px;color:#9aa0b4;min-height:16px}
  #so .fn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #so .ck{display:flex;align-items:center;gap:6px;font-size:12px;color:#c5c9d8;cursor:pointer}
  #so details{font-size:12px;color:#8b92a8}
  #so summary{cursor:pointer;margin-bottom:6px}
  #so input[type=file]{display:none}
  #so .leg{max-height:170px;overflow:auto;display:flex;flex-direction:column;gap:2px}
  #so .row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;cursor:pointer}
  #so .row:hover{background:rgba(255,255,255,.07)}
  #so .row.on{background:rgba(64,147,228,.28);outline:1px solid #4093e4}
  #so .sw{width:18px;height:18px;border-radius:4px;border:1px solid rgba(255,255,255,.4);flex:none}
  #so .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #so .ct{color:#9aa0b4}`;

  window.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const p = document.createElement('div');
    p.id = 'so';
    p.innerHTML = `
      <div class="hd"><span class="dot"></span><span class="ttl">Overlay</span><button class="mn" title="Minimize">&minus;</button></div>
      <div class="bd">
        <div class="sec"><div class="lb">1. Choose your picture</div>
          <button class="btn" id="so_pick">Choose image…</button>
          <input type="file" id="so_f" accept="image/*">
          <div class="hint fn" id="so_fn">No image chosen</div>
          <label class="ck"><input type="checkbox" id="so_prem"> I have the premium (★) colors</label>
          <label class="ck"><input type="checkbox" id="so_dith"> Smooth shading (dithering)</label>
        </div>
        <div class="sec"><div class="lb">2. Where to put it</div>
          <button class="btn pri" id="so_ar">Pick an area to place picture</button>
          <button class="btn" id="so_tl">Or just pick the top-left corner</button>
          <label class="wl">Picture width in pixels (optional)<input id="so_w" type="number" min="1" placeholder="its own size"></label>
          <div class="hint" id="so_area"></div>
          <label class="ck"><input type="checkbox" id="so_stretch"> Stretch picture to fill the area exactly</label>
        </div>
        <div class="sec"><div class="lb">3. Colors to use</div>
          <div class="hint" id="so_lh">Choose a picture first.</div>
          <div class="leg" id="so_leg"></div>
          <button class="btn ghost" id="so_all" hidden>Show everything again</button>
        </div>
        <div class="sec"><div class="lb">See-through level</div>
          <div class="rg"><input id="so_o" type="range" min="0.1" max="1" step="0.1"><span id="so_ov">60%</span>
            <label class="ck" style="white-space:nowrap"><input type="checkbox" id="so_hide"> Hide</label></div>
        </div>
        <div class="sec">
          <button class="btn go" id="so_a">Apply</button>
          <button class="btn ghost" id="so_c">Remove overlay</button>
          <div class="hint" id="so_st"></div>
        </div>
        <details><summary>Manual position &amp; size</summary>
          <div class="grid">
            <label>Tile X<input id="so_tx" type="number"></label><label>Tile Y<input id="so_ty" type="number"></label>
            <label>Pixel X<input id="so_px" type="number"></label><label>Pixel Y<input id="so_py" type="number"></label>
          </div>
        </details>
      </div>`;
    document.body.appendChild(p);
    const $ = id => p.querySelector('#' + id);
    const status = t => ($('so_st').textContent = t);

    ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel', 'contextmenu'].forEach(ev =>
      p.addEventListener(ev, e => e.stopPropagation(), { passive: true }));

    // position + drag
    const place = () => {
      S.x = Math.min(Math.max(0, S.x), Math.max(0, innerWidth - 60));
      S.y = Math.min(Math.max(0, S.y), Math.max(0, innerHeight - 40));
      p.style.left = S.x + 'px'; p.style.top = S.y + 'px';
    };
    place(); p.classList.toggle('min', S.min);
    window.addEventListener('resize', place);
    const hd = p.querySelector('.hd');
    let drag = null;
    hd.addEventListener('pointerdown', e => {
      if (e.target.closest('.mn')) return;
      drag = { dx: e.clientX - S.x, dy: e.clientY - S.y };
      hd.setPointerCapture(e.pointerId);
    });
    hd.addEventListener('pointermove', e => { if (drag) { S.x = e.clientX - drag.dx; S.y = e.clientY - drag.dy; place(); } });
    hd.addEventListener('pointerup', () => { if (drag) { drag = null; save(); } });
    p.querySelector('.mn').onclick = e => {
      S.min = !S.min; p.classList.toggle('min', S.min);
      e.target.innerHTML = S.min ? '+' : '&minus;'; save();
    };
    p.querySelector('.mn').innerHTML = S.min ? '+' : '&minus;';

    let chosen = null, chosenName = '', savedImg = null;
    const src = () => chosen || savedImg;
    const hasArea = () => S.aw > 0 && S.ah > 0;
    const sizeFor = im => {
      const mw = +$('so_w').value;
      if (mw > 0) return { w: mw, h: Math.max(1, Math.round(im.height * mw / im.width)) };
      if (hasArea()) {
        if (S.stretch) return { w: S.aw, h: S.ah };
        const w = Math.max(1, Math.min(S.aw, Math.floor(S.ah * im.width / im.height)));
        return { w, h: Math.max(1, Math.round(im.height * w / im.width)) };
      }
      return { w: im.width, h: im.height };
    };
    const info = () => {
      const im = src();
      let t = hasArea() ? 'Area: ' + S.aw + ' × ' + S.ah + ' pixels' : 'Picture keeps its own size (or the width above).';
      if (im) { const z = sizeFor(im); t += ' → picture ' + z.w + ' × ' + z.h; }
      $('so_area').textContent = t;
    };

    // color list: what to place, with a swatch, name and how many pixels
    function buildLegend() {
      const box = $('so_leg'); box.innerHTML = '';
      if (!tpl) return;
      const rows = [];
      tpl.counts.forEach((n, i) => { if (n) rows.push(i); });
      rows.sort((a, b) => tpl.counts[b] - tpl.counts[a]);
      rows.forEach(i => {
        const r = document.createElement('div');
        r.className = 'row' + (S.focus === i ? ' on' : '');
        r.innerHTML = '<span class="sw" style="background:rgb(' + PAL[i] + ')"></span><span class="nm">' +
          NAMES[i] + (i >= FREE.length ? ' ★' : '') + '</span><span class="ct">' + tpl.counts[i] + '</span>';
        r.onclick = () => { S.focus = S.focus === i ? null : i; save(); location.reload(); };
        box.appendChild(r);
      });
      $('so_all').hidden = S.focus == null;
      $('so_lh').textContent = S.focus == null
        ? 'Tap a color to see only where to place it. ★ = premium color.'
        : 'Showing only ' + NAMES[S.focus] + '. Place that color on every dotted square.';
    }
    onTpl = buildLegend;
    if (tpl) buildLegend();
    $('so_all').onclick = () => { S.focus = null; save(); location.reload(); };

    $('so_tx').value = S.tx; $('so_ty').value = S.ty; $('so_px').value = S.px; $('so_py').value = S.py;
    $('so_o').value = S.op; $('so_ov').textContent = Math.round(S.op * 100) + '%';
    $('so_stretch').checked = !!S.stretch;
    $('so_o').oninput = () => ($('so_ov').textContent = Math.round($('so_o').value * 100) + '%');
    $('so_hide').checked = S.hidden;
    $('so_hide').onchange = () => { S.hidden = $('so_hide').checked; save(); location.reload(); };
    $('so_w').oninput = info;
    $('so_prem').checked = S.premium; $('so_dith').checked = S.dither;
    $('so_prem').onchange = () => { S.premium = $('so_prem').checked; save(); status('Choose your picture again to use this.'); };
    $('so_dith').onchange = () => { S.dither = $('so_dith').checked; save(); status('Choose your picture again to use this.'); };
    $('so_stretch').onchange = () => { S.stretch = $('so_stretch').checked; save(); info(); };
    if (S.img) {
      const si = new Image();
      si.onload = () => {
        savedImg = si;
        $('so_fn').textContent = 'Saved: ' + (S.name || 'image') + ' (' + si.width + '×' + si.height + ')';
        status('Your last overlay is saved and loads automatically.');
        info();
      };
      si.src = S.img;
    }
    info();

    $('so_pick').onclick = () => $('so_f').click();
    $('so_f').onchange = () => {
      const f = $('so_f').files[0]; if (!f) return;
      const im = new Image();
      im.onload = () => {
        chosen = im; chosenName = f.name;
        $('so_fn').textContent = f.name; info();
        status(hasArea() ? 'Press Apply to fit it to your area.' : 'Now pick an area on the map, or press Apply.');
      };
      im.src = URL.createObjectURL(f);
    };

    // snap every pixel to a real Wplace color (only free colors unless premium is ticked)
    function toPalette(c, w, h) {
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const img = ctx.getImageData(0, 0, w, h), a = img.data;
      const allowed = []; for (let i = 0; i < (S.premium ? PAL.length : FREE.length); i++) allowed.push(i);
      const buf = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) { buf[i * 3] = a[i * 4]; buf[i * 3 + 1] = a[i * 4 + 1]; buf[i * 3 + 2] = a[i * 4 + 2]; }
      const cl = v => Math.min(255, Math.max(0, v));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (a[i * 4 + 3] < 128) { a[i * 4 + 3] = 0; continue; }
        const r = cl(buf[i * 3]), g = cl(buf[i * 3 + 1]), b = cl(buf[i * 3 + 2]);
        const pc = PAL[nearest(r, g, b, allowed)];
        a[i * 4] = pc[0]; a[i * 4 + 1] = pc[1]; a[i * 4 + 2] = pc[2]; a[i * 4 + 3] = 255;
        if (S.dither) {
          const er = r - pc[0], eg = g - pc[1], eb = b - pc[2];
          const sp = (dx, dy, f) => {
            const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny >= h) return;
            const j = (ny * w + nx) * 3; buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
          };
          sp(1, 0, 7 / 16); sp(-1, 1, 3 / 16); sp(0, 1, 5 / 16); sp(1, 1, 1 / 16);
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    function apply() {
      S.tx = +$('so_tx').value; S.ty = +$('so_ty').value; S.px = +$('so_px').value; S.py = +$('so_py').value; S.op = +$('so_o').value;
      const finish = () => { if (save()) location.reload(); else status('Image too big to save. Use a smaller one.'); };
      const im = src();
      if (!im) return finish();
      const { w, h } = sizeFor(im);
      if (w > 2000 || h > 2000) return status('Too big. Keep the picture under 2000 pixels wide and tall.');
      if (!chosen && w === im.width && h === im.height) return finish();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingEnabled = !!chosen && w < im.width; x.imageSmoothingQuality = 'high';
      x.drawImage(im, 0, 0, w, h);
      toPalette(c, w, h);
      S.img = c.toDataURL('image/png'); S.focus = null; if (chosen) S.name = chosenName; finish();
    }
    $('so_a').onclick = apply;

    // pick an area: click two opposite corners on the map
    $('so_ar').onclick = () => {
      let a = null;
      $('so_ar').classList.add('act');
      $('so_ar').textContent = 'Click the first corner…';
      status('Click one corner pixel on the map.');
      capturing = true;
      onPick = (tx, ty, px, py) => {
        a = { x: tx * 1000 + px, y: ty * 1000 + py };
        $('so_ar').textContent = 'Now click the opposite corner…';
        status('Now click the opposite corner pixel.');
        capturing = true;
        onPick = (tx2, ty2, px2, py2) => {
          const b = { x: tx2 * 1000 + px2, y: ty2 * 1000 + py2 };
          const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
          S.aw = Math.abs(a.x - b.x) + 1; S.ah = Math.abs(a.y - b.y) + 1;
          $('so_tx').value = Math.floor(x0 / 1000); $('so_ty').value = Math.floor(y0 / 1000);
          $('so_px').value = x0 % 1000; $('so_py').value = y0 % 1000;
          $('so_w').value = '';
          $('so_ar').textContent = 'Pick a different area'; $('so_ar').classList.remove('act');
          info();
          if (src()) { status('Fitting your picture…'); apply(); }
          else { save(); status('Area saved. Now choose a picture and press Apply.'); }
        };
      };
    };

    // corner only: click the top-left pixel, picture keeps its own size (good for group art)
    $('so_tl').onclick = () => {
      $('so_tl').classList.add('act');
      $('so_tl').textContent = 'Click the top-left pixel…';
      status('Click the pixel where the top-left of the picture goes.');
      capturing = true;
      onPick = (tx, ty, px, py) => {
        S.aw = 0; S.ah = 0;
        $('so_tx').value = tx; $('so_ty').value = ty; $('so_px').value = px; $('so_py').value = py;
        $('so_tl').textContent = 'Pick a different corner'; $('so_tl').classList.remove('act');
        $('so_ar').textContent = 'Pick an area to place picture'; $('so_ar').classList.remove('act');
        info();
        if (src()) { status('Placing your picture…'); apply(); }
        else { save(); status('Corner saved. Now choose a picture and press Apply.'); }
      };
    };

    $('so_c').onclick = () => { S.img = null; S.focus = null; save(); location.reload(); };
  });
})();
