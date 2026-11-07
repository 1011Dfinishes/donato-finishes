// Donato Plumbing - Plumbing Finishes app
'use strict';

const ADDRESS = '1011 1 AVE';
const APP_URL = 'https://fushekrujetown.github.io/donato-finishes/';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UNIT_NUMS = Object.keys(UNITS).map(Number).sort((a, b) => a - b);
const FLOORS = [11, 12, 13];

const sb = new Supa(SB_URL, SB_KEY);
const S = { photos: {}, sigs: {}, project: { project_location: '' }, editor: false, loaded: false, live: false, pending: {} };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pkey = (f, u, k) => f + '|' + u + '|' + k;
const thumbOf = path => path.replace(/\.jpg$/, '_t.jpg');
const medOf = path => path.replace(/\.jpg$/, '_m.jpg');
const sizesOf = path => [path, thumbOf(path), medOf(path)];
const slug = s => s.toLowerCase().replace(/#/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const two = n => String(n).padStart(2, '0');

function fmtStamp(d) {
  const h = d.getHours();
  return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + '  ' + (h % 12 || 12) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function fmtDay(d) { return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
function fmtISODay(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return MON[m - 1] + ' ' + d + ', ' + y; }
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }
function localInput(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes()); }

function itemsFor(u) {
  const seen = {};
  return UNITS[u].map(caption => {
    seen[caption] = (seen[caption] || 0) + 1;
    return { caption, key: seen[caption] > 1 ? caption + '#' + seen[caption] : caption };
  });
}

function unitStats(f, u) {
  const items = itemsFor(u);
  const done = items.filter(it => S.photos[pkey(f, u, it.key)]).length;
  const signed = !!(S.sigs[pkey(f, u, 'donato')] && S.sigs[pkey(f, u, 'ccm')]);
  return { total: items.length, done, signed };
}

function floorStats(f) {
  let total = 0, done = 0, signed = 0;
  UNIT_NUMS.forEach(u => { const s = unitStats(f, u); total += s.total; done += s.done; signed += s.signed ? 1 : 0; });
  return { total, done, signed };
}

function statusPill(done, signed, all) {
  if (signed && all) return '<span class="pill ok">Signed</span>';
  return done ? '<span class="pill prog">In progress</span>' : '<span class="pill todo">Not started</span>';
}

// ---------------------------------------------------------------- toasts & sheets
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

function openSheet(html, onMount) {
  const wrap = $('#sheetWrap');
  wrap.innerHTML = '<div class="dim"></div><div class="sheet">' + html + '</div>';
  wrap.classList.add('on');
  const close = () => { wrap.classList.remove('on'); wrap.innerHTML = ''; };
  $('.dim', wrap).onclick = close;
  if (onMount) onMount($('.sheet', wrap), close);
  return close;
}

function choose(title, options) {          // options: [{label, value, style}]
  return new Promise(res => {
    const close = openSheet('<div class="sh-title">' + esc(title) + '</div>' +
      options.map((o, i) => '<button class="sh-btn ' + (o.style || '') + '" data-i="' + i + '">' + esc(o.label) + '</button>').join('') +
      '<button class="sh-btn cancel" data-i="-1">Cancel</button>', (el, done) => {
      el.querySelectorAll('button').forEach(b => b.onclick = () => { done(); const i = +b.dataset.i; res(i < 0 ? null : options[i].value); });
    });
    $('#sheetWrap .dim').onclick = () => { close(); res(null); };
  });
}

function busy(msg) {
  const b = $('#busy');
  if (msg === false) { b.classList.remove('on'); return; }
  b.querySelector('.bmsg').textContent = msg;
  b.classList.add('on');
}

// ---------------------------------------------------------------- data
async function loadAll() {
  try {
    const [photos, sigs, proj] = await Promise.all([
      sb.select('photos', 'select=floor,unit,item_key,caption,path,taken_at,created_at&limit=5000'),
      sb.select('signatures', 'select=floor,unit,role,print_name,signed_on,path,created_at'),
      sb.select('project', 'select=project_location&id=eq.1')
    ]);
    S.photos = {}; photos.forEach(p => { S.photos[pkey(p.floor, p.unit, p.item_key)] = p; });
    S.sigs = {}; sigs.forEach(s => { S.sigs[pkey(s.floor, s.unit, s.role)] = s; });
    if (proj && proj[0]) S.project = proj[0];
    S.loaded = true;
    render();
  } catch (e) {
    if (!S.loaded) $('#view').innerHTML = '<div class="empty">Can’t reach the server right now.<br>Check your signal and pull down to refresh.</div>';
  }
}

let reloadTimer;
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 400); }

async function checkEditor() {
  if (!sb.session) { S.editor = false; return; }
  try { S.editor = (await sb.rpc('is_editor')) === true; } catch (e) { if (e.status === 401) { await sb.refresh(); } }
}

// ---------------------------------------------------------------- routing
function route() {
  const m = location.hash.match(/^#\/f\/(\d+)(?:\/u\/(\d+)(\/sign)?)?/);
  if (m && FLOORS.includes(+m[1])) {
    if (m[2] && UNITS[m[2]]) return { view: m[3] ? 'sign' : 'unit', floor: +m[1], unit: +m[2] };
    return { view: 'floor', floor: +m[1] };
  }
  return { view: 'home' };
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function render() {
  const r = route();
  if (r.view === 'home') {
    const signed = FLOORS.reduce((t, f) => t + floorStats(f).signed, 0);
    $('#tbRight').innerHTML = '<span class="tb-sub">' + signed + ' of ' + FLOORS.length * UNIT_NUMS.length + ' units signed</span>';
  } else $('#tbRight').textContent = r.view === 'floor' ? 'FLOOR ' + r.floor : 'UNIT ' + r.unit;
  if (!S.loaded) return;
  if (r.view === 'home') renderHome();
  else if (r.view === 'floor') renderFloor(r.floor);
  else if (r.view === 'unit') renderUnit(r.floor, r.unit);
  else renderSign(r.floor, r.unit);
}

function modeBar() {
  const live = '<span class="live ' + (S.live ? 'up' : '') + '"><i></i>' + (S.live ? 'Live' : 'Connecting') + '</span>';
  if (S.editor) return '<div class="mbar"><span class="pill pe">✓ Editor</span>' + live + '<button class="link" id="signOut">Sign out</button></div>';
  if (sb.session) return '<div class="mbar"><span class="pill pv">View only</span>' + live + '<button class="link" id="signOut">Sign out</button></div>';
  return '<div class="mbar"><span class="pill pv">View only</span>' + live + '<button class="link" id="signIn">Editor sign in</button></div>';
}

function bindModeBar() {
  const a = $('#signIn'), b = $('#signOut');
  if (a) a.onclick = signInSheet;
  if (b) b.onclick = async () => { await sb.signOut(); S.editor = false; live.restart(); render(); toast('Signed out'); };
}

// ---------------------------------------------------------------- home
function renderHome() {
  const pr = S.project;
  let h = modeBar();
  if (sb.session && !S.editor) h += '<div class="note">This email isn’t on the editor list, so you can view but not add photos or sign.</div>';
  h += '<div class="flds"><div class="fld"><b>Project / Location:</b>' +
    (S.editor ? '<input class="fin" data-k="project_location" value="' + esc(pr.project_location) + '" autocomplete="off">' : '<span class="fv">' + esc(pr.project_location) + '</span>') + '</div></div>';
  h += '<div class="ul">' + FLOORS.map(f => {
    const st = floorStats(f);
    return '<a class="uc fc" href="#/f/' + f + '"><div class="urw"><span>Floor ' + f + '</span>' + statusPill(st.done, st.signed === UNIT_NUMS.length, true) + '</div>' +
      '<div class="bar"><i style="width:' + (100 * st.done / st.total).toFixed(1) + '%"></i></div>' +
      '<div class="mt">' + st.done + ' of ' + st.total + ' photos · ' + st.signed + ' of ' + UNIT_NUMS.length + ' units signed</div></a>';
  }).join('') + '</div>';
  $('#view').innerHTML = h;
  bindModeBar();
  document.querySelectorAll('.fin').forEach(inp => {
    inp.onchange = async () => {
      const patch = {}; patch[inp.dataset.k] = inp.value.trim(); patch.updated_at = new Date().toISOString();
      try { await sb.update('project', 'id=eq.1', patch); S.project[inp.dataset.k] = inp.value.trim(); toast('Saved'); }
      catch (e) { toast('Couldn’t save: ' + e.message); }
    };
  });
}

function renderFloor(f) {
  const fs = floorStats(f);
  let h = '<div class="srow"><a class="bk" href="#/">‹ All floors</a><span>' + fs.signed + ' of ' + UNIT_NUMS.length + ' units signed</span></div>';
  h += '<div class="ul">' + UNIT_NUMS.map(u => {
    const st = unitStats(f, u);
    return '<a class="uc" href="#/f/' + f + '/u/' + u + '"><div class="urw"><span>Unit ' + u + '</span>' + statusPill(st.done, st.signed, true) + '</div>' +
      '<div class="bar"><i style="width:' + (100 * st.done / st.total).toFixed(1) + '%"></i></div>' +
      '<div class="mt">' + st.done + ' of ' + st.total + ' photos</div></a>';
  }).join('') + '</div>';
  h += '<div class="actions"><button class="btn alt" id="expF">Export Floor ' + f + ' PDF</button></div>';
  $('#view').innerHTML = h;
  $('#expF').onclick = () => exportFloor(f);
}

// ---------------------------------------------------------------- unit grid
const CAM_SVG = '<svg width="34" height="27" viewBox="0 0 38 30"><path d="M4 7h7l3-4h10l3 4h7a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="17" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const CHK = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.2 6.3l2.4 2.4 5.2-5.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderUnit(f, u) {
  const items = itemsFor(u), st = unitStats(f, u);
  let h = '<div class="srow"><a class="bk" href="#/f/' + f + '">‹ Floor ' + f + '</a><span class="' + (st.done === st.total ? 'okc' : '') + '">' + st.done + ' of ' + st.total + ' photos' + (st.done === st.total ? ' ✓' : '') + '</span></div>';
  h += '<div class="grid">' + items.map((it, i) => {
    const k = pkey(f, u, it.key), row = S.photos[k], pend = S.pending[k];
    let inner;
    if (pend) inner = '<img src="' + pend.url + '" alt=""><span class="badge wait">' + (pend.state === 'queued' ? 'Waiting for signal' : 'Uploading…') + '</span>';
    else if (row) inner = '<img src="' + sb.publicUrl(thumbOf(row.path)) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'' + sb.publicUrl(row.path) + '\'"><span class="chk">' + CHK + '</span>';
    else inner = S.editor ? '<span class="em">' + CAM_SVG + '<span>Tap to add photo</span></span>' : '<span class="em vw">No photo yet</span>';
    return '<div class="tl" data-i="' + i + '"><div class="ph">' + inner + '</div><div class="tc">' + esc(it.caption) + '</div></div>';
  }).join('') + '</div>';
  h += '<div class="actions">' + (S.editor ? '<button class="btn" id="goSign">Sign off Unit ' + u + '</button>' : '<button class="btn alt" id="goSign">Signatures</button>') +
    '<button class="btn alt" id="exp">Export Unit ' + u + ' PDF</button></div>';
  $('#view').innerHTML = h;
  document.querySelectorAll('.tl').forEach(el => el.onclick = () => tileTap(f, u, items[+el.dataset.i]));
  $('#goSign').onclick = async () => {
    const left = st.total - st.done;
    if (S.editor && left > 0) {
      const ok = await choose(left + (left === 1 ? ' box is' : ' boxes are') + ' still empty. Sign anyway?', [{ label: 'Go to signatures', value: true }]);
      if (!ok) return;
    }
    location.hash = '#/f/' + f + '/u/' + u + '/sign';
  };
  $('#exp').onclick = () => exportUnit(f, u);
}

async function tileTap(f, u, it) {
  const k = pkey(f, u, it.key), row = S.photos[k];
  if (S.pending[k]) { toast(S.pending[k].state === 'queued' ? 'Saved on this phone. It uploads when you have signal.' : 'Uploading…'); return; }
  if (row) { viewPhoto(f, u, it, row); return; }
  if (!S.editor) return;
  addPhoto(f, u, it);
}

async function addPhoto(f, u, it) {
  const how = await choose(it.caption, [{ label: 'Take Photo', value: 'cam' }, { label: 'Choose from Photos', value: 'lib' }]);
  if (!how) return;
  const inp = $(how === 'cam' ? '#camIn' : '#libIn');
  inp.value = '';
  inp.onchange = () => { const file = inp.files && inp.files[0]; if (file) handleFile(f, u, it, file, how); };
  inp.click();
}

function viewPhoto(f, u, it, row) {
  const d = new Date(row.taken_at);
  openSheet('<div class="pv-wrap"><img src="' + sb.publicUrl(row.path) + '" alt=""></div>' +
    '<div class="pv-cap">' + esc(it.caption) + '</div><div class="pv-meta">Floor ' + f + ', Unit ' + u + ' · taken ' + esc(fmtStamp(d)) + '</div>' +
    (S.editor ? '<button class="sh-btn" id="rep">Replace photo</button><button class="sh-btn danger" id="del">Delete photo</button>' : '') +
    '<button class="sh-btn cancel" id="cls">Close</button>', (el, close) => {
    $('#cls', el).onclick = close;
    if (!S.editor) return;
    $('#rep', el).onclick = () => { close(); addPhoto(f, u, it); };
    $('#del', el).onclick = async () => {
      close();
      const ok = await choose('Delete the photo for ' + it.caption + '?', [{ label: 'Delete photo', value: true, style: 'danger' }]);
      if (!ok) return;
      try {
        await sb.remove('photos', 'floor=eq.' + f + '&unit=eq.' + u + '&item_key=eq.' + encodeURIComponent(it.key));
        delete S.photos[pkey(f, u, it.key)];
        sb.removeFiles(sizesOf(row.path)).catch(() => {});
        render(); toast('Photo deleted');
      } catch (e) { toast('Couldn’t delete: ' + e.message); }
    };
  });
}

// ---------------------------------------------------------------- photo processing
function parseExifDate(buf) {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 12 || v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
        const t = off + 10, le = v.getUint16(t) === 0x4949;
        const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
        const entries = o => { const n = u16(o), m = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; m[u16(e)] = e; } return m; };
        const ascii = e => { const cnt = u32(e + 4), at = cnt > 4 ? u32(e + 8) : e + 8; let s = ''; for (let i = 0; i < cnt; i++) { const c = v.getUint8(t + at + i); if (!c) break; s += String.fromCharCode(c); } return s; };
        const ifd0 = entries(u32(4));
        let s = null;
        if (ifd0[0x8769]) {
          const ex = entries(u32(ifd0[0x8769] + 8));
          if (ex[0x9003]) s = ascii(ex[0x9003]); else if (ex[0x9004]) s = ascii(ex[0x9004]);
        }
        if (!s && ifd0[0x0132]) s = ascii(ifd0[0x0132]);
        const m = s && s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (!m || m[1] === '0000') return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      }
      if (marker === 0xFFDA || (marker & 0xFF00) !== 0xFF00) break;
      off += 2 + len;
    }
  } catch (e) { /* no usable date */ }
  return null;
}

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error('That photo couldn’t be opened.'); }
  return { img, done: () => URL.revokeObjectURL(url) };
}

const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Couldn’t save the photo.'))), type, q));

// Crop to the 3:4 box so the photo fills it, then burn in the date/time and address.
async function stampPhoto(img, date) {
  const W = 1200, H = 1600;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const sw = img.naturalWidth, sh = img.naturalHeight, s = Math.max(W / sw, H / sh);
  x.drawImage(img, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
  const g = x.createLinearGradient(0, H - 300, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
  x.fillStyle = g; x.fillRect(0, H - 300, W, 300);
  x.font = '600 52px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
  x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 6; x.shadowOffsetY = 2;
  x.fillText(fmtStamp(date), 46, H - 120);
  x.fillText(ADDRESS, 46, H - 50);
  const main = await toBlob(c, 'image/jpeg', 0.86);
  const m = document.createElement('canvas'); m.width = 720; m.height = 960;
  m.getContext('2d').drawImage(c, 0, 0, 720, 960);
  const med = await toBlob(m, 'image/jpeg', 0.8);
  const t = document.createElement('canvas'); t.width = 360; t.height = 480;
  t.getContext('2d').drawImage(c, 0, 0, 360, 480);
  const thumb = await toBlob(t, 'image/jpeg', 0.75);
  return { main, med, thumb };
}

function askDate(fallback) {
  return new Promise(res => {
    openSheet('<div class="sh-title">This photo doesn’t have its date saved. When was it taken?</div>' +
      '<input type="datetime-local" class="dt" id="dt" value="' + localInput(fallback) + '">' +
      '<button class="sh-btn strong" id="ok">Use this date</button><button class="sh-btn cancel" id="no">Cancel</button>', (el, close) => {
      $('#ok', el).onclick = () => { const v = $('#dt', el).value; close(); res(v ? new Date(v) : fallback); };
      $('#no', el).onclick = () => { close(); res(null); };
    });
  });
}

async function handleFile(f, u, it, file, how) {
  let date = null;
  try { date = parseExifDate(await file.slice(0, 256 * 1024).arrayBuffer()); } catch (e) { date = null; }
  if (how === 'cam') date = date || new Date();
  else if (!date) { date = await askDate(new Date(file.lastModified || Date.now())); if (!date) return; }
  busy('Stamping photo…');
  let out;
  try {
    const { img, done } = await loadImage(file);
    out = await stampPhoto(img, date);
    done();
  } catch (e) { busy(false); toast(e.message || 'That photo couldn’t be opened.'); return; }
  busy(false);
  const rec = { id: pkey(f, u, it.key), floor: f, unit: u, key: it.key, caption: it.caption, taken: date.toISOString(), main: out.main, med: out.med, thumb: out.thumb };
  setPending(rec, 'uploading');
  render();
  try {
    await uploadRec(rec);
    clearPending(rec.id);
    render();
    toast('✓ Saved and uploaded');
  } catch (e) {
    if (isNetworkError(e)) {
      await Queue.put(rec).catch(() => {});
      setPending(rec, 'queued'); render();
      toast('No signal. The photo is saved on this phone and uploads when you have signal.', 4200);
    } else {
      clearPending(rec.id); render();
      toast(e.status === 403 || /security|policy/i.test(e.message) ? 'Your email isn’t on the editor list.' : 'Upload failed: ' + e.message, 4200);
    }
  }
}

function isNetworkError(e) { return !e.status || e.status >= 500 || e.name === 'TypeError'; }

function setPending(rec, state) {
  const old = S.pending[rec.id];
  S.pending[rec.id] = { url: old ? old.url : URL.createObjectURL(rec.thumb), state };
}
function clearPending(id) {
  if (S.pending[id]) URL.revokeObjectURL(S.pending[id].url);
  delete S.pending[id];
}

async function uploadRec(rec) {
  const base = 'f' + rec.floor + '/u' + rec.unit + '/' + slug(rec.key) + '-' + Date.now();
  await sb.upload(base + '.jpg', rec.main, 'image/jpeg');
  if (rec.med) await sb.upload(base + '_m.jpg', rec.med, 'image/jpeg');
  await sb.upload(base + '_t.jpg', rec.thumb, 'image/jpeg');
  const old = S.photos[rec.id];
  const rows = await sb.upsert('photos', [{ floor: rec.floor, unit: rec.unit, item_key: rec.key, caption: rec.caption, path: base + '.jpg', taken_at: rec.taken }], 'floor,unit,item_key');
  if (rows && rows[0]) S.photos[rec.id] = rows[0];
  await Queue.del(rec.id).catch(() => {});
  if (old && old.path !== base + '.jpg') sb.removeFiles(sizesOf(old.path)).catch(() => {});
}

// photos waiting for signal, kept on the phone (IndexedDB)
const Queue = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('donato-finishes', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('queue', mode), st = t.objectStore('queue'), req = fn(st);
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  },
  put(rec) { return this.tx('readwrite', st => st.put(rec)); },
  del(id) { return this.tx('readwrite', st => st.delete(id)); },
  all() { return this.tx('readonly', st => st.getAll()); }
};

let flushing = false;
async function flushQueue() {
  if (flushing || !S.editor) return;
  flushing = true;
  try {
    const recs = await Queue.all();
    for (const rec of recs) {
      setPending(rec, 'uploading');
      try { await uploadRec(rec); clearPending(rec.id); toast('✓ Uploaded ' + rec.caption); }
      catch (e) { setPending(rec, 'queued'); if (isNetworkError(e)) break; await Queue.del(rec.id).catch(() => {}); clearPending(rec.id); }
    }
  } catch (e) { /* storage unavailable */ }
  flushing = false;
  render();
}

// ---------------------------------------------------------------- signatures
function renderSign(f, u) {
  const st = unitStats(f, u);
  let h = '<div class="srow"><a class="bk" href="#/f/' + f + '/u/' + u + '">‹ Back to photos</a><span class="' + (st.done === st.total ? 'okc' : '') + '">' + st.done + ' of ' + st.total + ' photos' + (st.done === st.total ? ' ✓' : '') + '</span></div>';
  h += '<div class="sec">SIGNATURES</div>';
  const rk = f + '-' + u;
  const editing = S.editor && (S.redo === rk || !(S.sigs[pkey(f, u, 'donato')] && S.sigs[pkey(f, u, 'ccm')]));
  for (const [role, who] of [['donato', 'Donato Representative'], ['ccm', 'CCM Representative']]) {
    const s = S.sigs[pkey(f, u, role)];
    h += '<div class="sig"><div class="sgl">' + who + '</div>';
    if (editing && (!s || S.redo === rk)) {
      h += '<div class="pad"><canvas data-role="' + role + '"></canvas><span class="hn">Sign here with your finger</span><button class="clr" data-role="' + role + '">Clear</button></div>' +
        '<div class="fr"><label class="f"><input class="nm" data-role="' + role + '" placeholder=" " autocomplete="name" value="' + esc(s ? s.print_name : '') + '"><span>Print Name</span></label>' +
        '<label class="f dte"><input type="date" class="dd" data-role="' + role + '" value="' + todayISO() + '"><span>Date</span></label></div>';
    } else if (s) {
      h += '<div class="pad done"><img src="' + sb.publicUrl(s.path) + '" alt="Signature"></div>' +
        '<div class="fr"><div class="f"><div class="v">' + esc(s.print_name) + '</div><span>Print Name</span></div><div class="f dte"><div class="v">' + esc(fmtISODay(s.signed_on)) + '</div><span>Date</span></div></div>';
    } else {
      h += '<div class="pad done"><span class="ns">Not signed yet</span></div>';
    }
    h += '</div>';
  }
  if (st.signed && !editing) h += '<div class="bn">✓ Unit ' + u + ' signed</div>';
  h += '<div class="actions">';
  if (editing) h += '<button class="btn" id="saveSig">Save signatures</button>';
  else if (S.editor) h += '<button class="btn alt" id="redo">Redo signatures</button>';
  h += '<button class="btn alt" id="exp">Export Unit ' + u + ' PDF</button></div>';
  $('#view').innerHTML = h;
  document.querySelectorAll('.pad canvas').forEach(setupPad);
  document.querySelectorAll('.clr').forEach(b => b.onclick = () => { const c = $('canvas[data-role="' + b.dataset.role + '"]'); c.clear(); });
  if ($('#saveSig')) $('#saveSig').onclick = () => saveSignatures(f, u);
  if ($('#redo')) $('#redo').onclick = () => { S.redo = rk; render(); };
  $('#exp').onclick = () => exportUnit(f, u);
}

function setupPad(c) {
  const r = c.getBoundingClientRect(), dpr = Math.max(2, window.devicePixelRatio || 1);
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const x = c.getContext('2d');
  x.scale(dpr, dpr); x.lineWidth = 2.6; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#13223a';
  let last = null, mid = null;
  c.inked = false;
  const pt = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { c.setPointerCapture(e.pointerId); last = pt(e); mid = last; x.beginPath(); x.arc(last[0], last[1], 1.2, 0, 7); x.fillStyle = '#13223a'; x.fill(); c.inked = true; c.parentNode.classList.add('inked'); };
  c.onpointermove = e => {
    if (!last) return;
    const p = pt(e), m = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2];
    x.beginPath(); x.moveTo(mid[0], mid[1]); x.quadraticCurveTo(last[0], last[1], m[0], m[1]); x.stroke();
    last = p; mid = m;
  };
  c.onpointerup = c.onpointercancel = () => { last = null; };
  c.clear = () => { x.clearRect(0, 0, c.width, c.height); c.inked = false; c.parentNode.classList.remove('inked'); };
}

function trimCanvas(c) {
  const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
    if (d[(y * c.width + xx) * 4 + 3] > 10) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return c;
  const pad = Math.round(c.height * 0.06);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

async function saveSignatures(f, u) {
  const jobs = [];
  for (const role of ['donato', 'ccm']) {
    const c = $('canvas[data-role="' + role + '"]');
    if (!c) continue;
    const name = $('.nm[data-role="' + role + '"]').value.trim(), date = $('.dd[data-role="' + role + '"]').value || todayISO();
    if (c.inked && !name) { toast('Add the print name for the ' + (role === 'donato' ? 'Donato' : 'CCM') + ' rep.'); return; }
    if (c.inked) jobs.push({ role, name, date, c });
  }
  if (!jobs.length) { toast('Sign in the box first.'); return; }
  busy('Saving signatures…');
  try {
    for (const j of jobs) {
      const blob = await toBlob(trimCanvas(j.c), 'image/png');
      const path = 'sig/f' + f + '/u' + u + '/' + j.role + '-' + Date.now() + '.png';
      await sb.upload(path, blob, 'image/png');
      const old = S.sigs[pkey(f, u, j.role)];
      const rows = await sb.upsert('signatures', [{ floor: f, unit: u, role: j.role, print_name: j.name, signed_on: j.date, path }], 'floor,unit,role');
      if (rows && rows[0]) S.sigs[pkey(f, u, j.role)] = rows[0];
      if (old && old.path !== path) sb.removeFiles([old.path]).catch(() => {});
    }
    S.redo = null;
    busy(false); render();
    toast(unitStats(f, u).signed ? '✓ Unit ' + u + ' signed' : '✓ Signature saved');
  } catch (e) {
    busy(false);
    toast(isNetworkError(e) ? 'No signal. Try saving again when you have signal.' : 'Couldn’t save: ' + e.message, 4200);
  }
}

// ---------------------------------------------------------------- PDF export
async function fetchBytes(url) {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok) throw new Error('download failed');
  return r.blob();
}

async function asJpeg(blob, maxW, maxH, white) {
  const { img, done } = await loadImage(blob);
  const s = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext('2d');
  if (white) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(img, 0, 0, c.width, c.height);
  done();
  const b = await toBlob(c, 'image/jpeg', 0.82);
  return { jpeg: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height };
}

async function photoJpeg(row) {
  let blob;
  try { blob = await fetchBytes(sb.publicUrl(medOf(row.path))); } catch (e) { blob = await fetchBytes(sb.publicUrl(row.path)); }
  return asJpeg(blob, 720, 960, false);
}

async function unitData(f, u, progress) {
  const items = itemsFor(u), photos = [];
  for (let i = 0; i < items.length; i++) {
    const row = S.photos[pkey(f, u, items[i].key)];
    photos.push(row ? await photoJpeg(row) : null);
    if (progress) progress();
  }
  const sigs = {};
  for (const role of ['donato', 'ccm']) {
    const s = S.sigs[pkey(f, u, role)];
    if (!s) continue;
    const j = await asJpeg(await fetchBytes(sb.publicUrl(s.path)), 1200, 400, true);
    sigs[role] = { name: s.print_name, date: fmtISODay(s.signed_on), jpeg: j.jpeg, w: j.w, h: j.h };
  }
  return { unit: u, label: 'FLOOR ' + f + ' \u00b7 UNIT ' + u, items, photos, sigs };
}

function pdfReady(title, name, bytes) {
  const file = new File([bytes], name, { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  openSheet('<div class="sh-title">' + esc(title) + ' is ready</div>' +
    (navigator.canShare && navigator.canShare({ files: [file] }) ? '<button class="sh-btn strong" id="shr">Share or save</button>' : '') +
    '<a class="sh-btn" href="' + url + '" download="' + esc(name) + '" target="_blank" rel="noopener">Open PDF</a>' +
    '<button class="sh-btn cancel" id="cls">Close</button>', (el, close) => {
    $('#cls', el).onclick = () => { close(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
    const b = $('#shr', el);
    if (b) b.onclick = async () => { try { await navigator.share({ files: [file], title: name }); } catch (e) { /* cancelled */ } };
  });
}

async function exportUnit(f, u) {
  try {
    busy('Building PDF…');
    const lh = new Uint8Array(await (await fetchBytes('letterhead.jpg')).arrayBuffer());
    const n = itemsFor(u).length; let k = 0;
    const data = await unitData(f, u, () => busy('Building PDF… ' + (++k) + ' of ' + n));
    const bytes = buildUnitPdf(data, lh, 'Plumbing Finishes - Floor ' + f + ', Unit ' + u);
    busy(false);
    pdfReady('Floor ' + f + ', Unit ' + u + ' PDF', 'Floor ' + f + ' Unit ' + u + ' - Plumbing Finishes.pdf', bytes);
  } catch (e) {
    busy(false);
    toast('Couldn’t build the PDF. Check your signal and try again.', 4200);
  }
}

async function exportFloor(f) {
  try {
    busy('Building PDF…');
    const lh = new Uint8Array(await (await fetchBytes('letterhead.jpg')).arrayBuffer());
    const total = floorStats(f).total; let k = 0;
    const units = UNIT_NUMS.map(u => ({ unit: u, items: itemsFor(u) }));
    const bytes = await buildFloorPdf({ floor: f, project: S.project.project_location || '', units }, lh,
      'Plumbing Finishes - Floor ' + f, i => unitData(f, units[i].unit, () => busy('Building PDF… photo ' + (++k) + ' of ' + total)));
    busy(false);
    pdfReady('Floor ' + f + ' PDF', 'Floor ' + f + ' - Plumbing Finishes.pdf', bytes);
  } catch (e) {
    busy(false);
    toast('Couldn’t build the PDF. Check your signal and try again.', 4200);
  }
}

// ---------------------------------------------------------------- sign in
function signInSheet() {
  let mode = 'in';
  const draw = (el, close) => {
    el.innerHTML = '<div class="sh-title big">' + (mode === 'in' ? 'Editor sign in' : 'Create your editor password') + '</div>' +
      '<div class="sh-text">' + (mode === 'in' ? 'Only approved editors can add photos and sign. Anyone with the link can still view.'
        : 'Use the email that’s on the editor list. We’ll email you a link to confirm it.') + '</div>' +
      '<label class="lab">Email</label><input class="inp" id="em" type="email" autocomplete="email" autocapitalize="none" placeholder="you@company.com">' +
      '<label class="lab">Password</label><input class="inp" id="pw" type="password" autocomplete="' + (mode === 'in' ? 'current-password' : 'new-password') + '" placeholder="' + (mode === 'in' ? 'Password' : 'At least 6 characters') + '">' +
      '<button class="sh-btn strong" id="go">' + (mode === 'in' ? 'Sign in' : 'Create password') + '</button>' +
      '<button class="sh-btn link2" id="sw">' + (mode === 'in' ? 'First time? Create your password' : 'I already have a password') + '</button>' +
      '<div class="sh-err" id="err"></div>';
    $('#sw', el).onclick = () => { mode = mode === 'in' ? 'up' : 'in'; draw(el, close); };
    $('#go', el).onclick = async () => {
      const em = $('#em', el).value.trim(), pw = $('#pw', el).value, err = $('#err', el);
      if (!em || !pw) { err.textContent = 'Enter your email and password.'; return; }
      $('#go', el).disabled = true; err.textContent = '';
      try {
        if (mode === 'in') {
          await sb.signIn(em, pw);
        } else {
          const now = await sb.signUp(em, pw, APP_URL);
          if (!now) { el.innerHTML = '<div class="sh-title big">Check your email</div><div class="sh-text">We sent a confirmation link to ' + esc(em) + '. Tap it, then come back here and sign in with your new password.</div><button class="sh-btn strong" id="ok">OK</button>'; $('#ok', el).onclick = close; return; }
        }
        await checkEditor(); close(); live.restart(); flushQueue(); render();
        toast(S.editor ? '✓ Signed in as editor' : 'Signed in. This email isn’t on the editor list.', 3600);
      } catch (e) {
        $('#go', el).disabled = false;
        err.textContent = /invalid login/i.test(e.message) ? 'Wrong email or password.' : /not confirmed/i.test(e.message) ? 'Confirm your email first: tap the link we sent you.' : e.message;
      }
    };
  };
  openSheet('', draw);
}

// ---------------------------------------------------------------- start
const live = new Live(sb, ['photos', 'signatures', 'project'], () => scheduleReload(), up => { S.live = up; if (route().view === 'home') { const l = $('.live'); if (l) { l.classList.toggle('up', up); l.lastChild.textContent = up ? 'Live' : 'Connecting'; } } });

async function start() {
  render();
  if (sb.session) { await sb.fresh(); await checkEditor(); }
  await loadAll();
  live.start();
  try { (await Queue.all()).forEach(r => setPending(r, 'queued')); render(); } catch (e) { /* no storage */ }
  flushQueue();
  setInterval(() => { flushQueue(); if (!S.live) loadAll(); }, 30000);
  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadAll(); flushQueue(); } });
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('df_a2hs') === '1'; } catch (e) { /* ignore */ }
  if (!standalone && /iPhone|iPad/.test(navigator.userAgent) && !dismissed) {
    const b = $('#a2hs'); b.classList.add('on'); document.body.classList.add('a2hs-on');
    b.querySelector('button').onclick = () => { b.classList.remove('on'); document.body.classList.remove('a2hs-on'); try { localStorage.setItem('df_a2hs', '1'); } catch (e) { /* ignore */ } };
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
