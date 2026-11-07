// Tiny PDF writer (JPEG images, lines, Times text) and the unit export,
// laid out like the Donato photo book: letterhead, PLUMBING FINISHES / UNIT n,
// 3 x 2 photo frames with italic captions, signature block, page footer.

const PDF_FONTS = { R: 'Times-Roman', B: 'Times-Bold', I: 'Times-Italic' };
const WINANSI = { '–': 150, '—': 151, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '…': 133, '€': 128 };

function pdfBytes(str) {                       // text -> WinAnsi bytes
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (WINANSI[ch]) out.push(WINANSI[ch]);
    else if (c < 256) out.push(c);
    else out.push(63);
  }
  return out;
}

function pdfStr(str) {
  let s = '(';
  for (const b of pdfBytes(str)) {
    if (b === 40 || b === 41 || b === 92) s += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

function textWidth(str, font, size) {
  const w = TIMES_WIDTHS[PDF_FONTS[font]];
  let t = 0;
  for (const b of pdfBytes(str)) t += (b >= 32 && b <= 126) ? w[b - 32] : 500;
  return t * size / 1000;
}

function wrapText(str, font, size, maxW) {
  const words = str.split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (!cur || textWidth(t, font, size) <= maxW) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function jpegInfo(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const m = bytes[i + 1];
    if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8], comps: bytes[i + 9] };
    }
    i += 2 + len;
  }
  throw new Error('Not a JPEG image');
}

const f2 = n => (Math.round(n * 100) / 100).toString();

class PdfDoc {
  constructor() { this.images = []; this.pages = []; }

  addJpeg(bytes) {
    const info = jpegInfo(bytes);
    const img = { name: 'Im' + (this.images.length + 1), bytes, ...info };
    this.images.push(img);
    return img;
  }

  page() {
    const p = { ops: [], imgs: new Set() };
    this.pages.push(p);
    return p;
  }

  save() {
    const enc = new TextEncoder();
    const chunks = [], offsets = [];
    let pos = 0;
    const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
    const latin = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
    let n = 0;
    const objs = [];                                    // [num, writer]
    const alloc = () => ++n;
    const catalog = alloc(), pagesObj = alloc();
    const fontObj = { R: alloc(), B: alloc(), I: alloc() };
    const imgObj = this.images.map(() => alloc());
    const pageObjs = this.pages.map(() => ({ page: alloc(), content: alloc() }));

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const begin = (num) => { offsets[num] = pos; put(num + ' 0 obj\n'); };
    const end = () => put('\nendobj\n');

    begin(catalog); put('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>'); end();
    begin(pagesObj); put('<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' + pageObjs.map(p => p.page + ' 0 R').join(' ') + '] >>'); end();
    for (const k of Object.keys(fontObj)) {
      begin(fontObj[k]); put('<< /Type /Font /Subtype /Type1 /BaseFont /' + PDF_FONTS[k] + ' /Encoding /WinAnsiEncoding >>'); end();
    }
    this.images.forEach((im, i) => {
      const cs = im.comps === 1 ? '/DeviceGray' : im.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      begin(imgObj[i]);
      put('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace ' + cs +
          ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n');
      put(im.bytes); put('\nendstream'); end();
    });
    const fontRes = '/Font << /F1 ' + fontObj.R + ' 0 R /F2 ' + fontObj.B + ' 0 R /F3 ' + fontObj.I + ' 0 R >>';
    this.pages.forEach((p, i) => {
      const xo = [...p.imgs].map(im => '/' + im.name + ' ' + imgObj[this.images.indexOf(im)] + ' 0 R').join(' ');
      begin(pageObjs[i].page);
      put('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 612 792] /Contents ' + pageObjs[i].content +
          ' 0 R /Resources << ' + fontRes + (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >> >>');
      end();
      const body = latin(p.ops.join('\n'));
      begin(pageObjs[i].content); put('<< /Length ' + body.length + ' >>\nstream\n'); put(body); put('\nendstream'); end();
    });
    const xref = pos;
    let x = 'xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= n; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + (n + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(pos);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

// drawing helpers (PDF points, origin bottom-left)
const fontKey = { R: 'F1', B: 'F2', I: 'F3' };
function pText(p, x, y, s, font, size, gray = 0) { p.ops.push('BT /' + fontKey[font] + ' ' + size + ' Tf ' + f2(gray) + ' g 1 0 0 1 ' + f2(x) + ' ' + f2(y) + ' Tm ' + pdfStr(s) + ' Tj ET'); }
function pTextR(p, x, y, s, font, size, gray = 0) { pText(p, x - textWidth(s, font, size), y, s, font, size, gray); }
function pTextC(p, x, y, s, font, size, gray = 0) { pText(p, x - textWidth(s, font, size) / 2, y, s, font, size, gray); }
function pLine(p, x1, y1, x2, y2, w, gray) { p.ops.push(f2(gray) + ' G ' + f2(w) + ' w ' + f2(x1) + ' ' + f2(y1) + ' m ' + f2(x2) + ' ' + f2(y2) + ' l S'); }
function pRect(p, x, y, w, h, lw, gray) { p.ops.push(f2(gray) + ' G ' + f2(lw) + ' w ' + f2(x) + ' ' + f2(y) + ' ' + f2(w) + ' ' + f2(h) + ' re S'); }
function pImage(p, im, x, y, w, h) { p.imgs.add(im); p.ops.push('q ' + f2(w) + ' 0 0 ' + f2(h) + ' ' + f2(x) + ' ' + f2(y) + ' cm /' + im.name + ' Do Q'); }

// ---------- the unit export
const PW = 612, PH = 792, PL = 54, PR = 558, PTW = PR - PL;
const COLS = 3, ROWS = 2, PER_PAGE = 6, GAP_X = 12, GAP_Y = 40;
const FW = (PTW - (COLS - 1) * GAP_X) / COLS, FH = FW * 4 / 3;
const CAP_GAP = 16, CAP_SIZE = 10.25, CAP_LEAD = 12.5, FOOTER_Y = 46;
const GREY = 0x4D / 255, RULE = 0x22 / 255, FRAME = 0x6F / 255;
const LDW = 360, LDH = 360 * 195 / 1377;

// photos: array (same order as items) of {jpeg: Uint8Array} or null
// sigs: {donato: {name, date, jpeg, w, h}, ccm: {...}} (any may be missing)
function buildUnitPdf(unit, items, photos, sigs, letterheadJpeg) {
  const doc = new PdfDoc();
  const lh = doc.addJpeg(letterheadJpeg);
  const photoPages = Math.ceil(items.length / PER_PAGE);
  const lastCount = items.length - PER_PAGE * (photoPages - 1);
  const signPage = lastCount > COLS;
  const total = photoPages + (signPage ? 1 : 0);
  const imgs = photos.map(ph => (ph && ph.jpeg ? doc.addJpeg(ph.jpeg) : null));
  const sigImgs = {};
  for (const r of ['donato', 'ccm']) if (sigs[r] && sigs[r].jpeg) sigImgs[r] = doc.addJpeg(sigs[r].jpeg);

  for (let sheet = 0; sheet < total; sheet++) {
    const p = doc.page();
    const signOnly = signPage && sheet === photoPages;
    // letterhead + rules
    pImage(p, lh, PL, PH - 38 - LDH, LDW, LDH);
    let y = PH - 38 - LDH - 10;
    pLine(p, PL, y, PR, y, 1.5, RULE);
    pLine(p, PL, y - 3, PR, y - 3, 0.5, RULE);
    y -= 3;
    y -= 31;
    pText(p, PL, y, 'PLUMBING FINISHES', 'B', 15);
    pTextR(p, PR, y, 'UNIT ' + unit, 'B', 15);
    pLine(p, PL, y - 6, PR, y - 6, 0.5, RULE);
    const areaTop = y - 6, areaBottom = FOOTER_Y + 18;
    const blockH = ROWS * (FH + CAP_GAP) + (ROWS - 1) * GAP_Y;
    const gridTop = areaTop - ((areaTop - areaBottom) - blockH) / 2;
    const idx = signOnly ? [] : items.map((_, i) => i).slice(sheet * PER_PAGE, (sheet + 1) * PER_PAGE);
    const rows = idx.length === 4 ? [idx.slice(0, 2), idx.slice(2, 4)] : [idx.slice(0, 3), idx.slice(3, 6)];
    rows.forEach((row, r) => {
      if (!row.length) return;
      const rowW = row.length * FW + (row.length - 1) * GAP_X;
      const x0 = PL + (PTW - rowW) / 2;
      const top = gridTop - r * (FH + CAP_GAP + GAP_Y);
      row.forEach((i, k) => {
        const x = x0 + k * (FW + GAP_X);
        if (imgs[i]) pImage(p, imgs[i], x, top - FH, FW, FH);
        pRect(p, x, top - FH, FW, FH, 0.75, FRAME);
        wrapText(items[i].caption, 'I', CAP_SIZE, FW - 4).forEach((ln, j) =>
          pTextC(p, x + FW / 2, top - FH - CAP_GAP - j * CAP_LEAD, ln, 'I', CAP_SIZE));
      });
    });
    if (sheet === total - 1) {
      const sigY = signOnly ? (areaTop + areaBottom) / 2 + 80 : gridTop - FH - CAP_GAP - CAP_LEAD - 44;
      drawSignatures(p, sigY, sigs, sigImgs);
    }
    pLine(p, PL, FOOTER_Y, PR, FOOTER_Y, 0.5, RULE);
    pText(p, PL, FOOTER_Y - 12, 'Donato Plumbing Group Inc.', 'R', 9, GREY);
    pTextR(p, PR, FOOTER_Y - 12, 'Page ' + (sheet + 1) + ' of ' + total, 'R', 9, GREY);
  }
  return doc.save();
}

function drawSignatures(p, y, sigs, sigImgs) {
  pText(p, PL, y, 'SIGNATURES', 'B', 12);
  pLine(p, PL, y - 5, PR, y - 5, 0.5, RULE);
  y -= 26;
  const colw = (PTW - 40) / 2;
  [[PL, 'Donato Representative', 'donato'], [PL + colw + 40, 'CCM Representative', 'ccm']].forEach(([x, who, role]) => {
    pText(p, x, y, who, 'B', 12);
    const s = sigs[role] || {};
    const nameY = y - 34, sigY = nameY - 42, dateY = sigY - 36;
    if (sigImgs[role]) {                       // signature first, so the labels print on top of it
      const h = 27, w = Math.min(colw - 4, h * (s.w / s.h));
      pImage(p, sigImgs[role], x + 2, sigY + 1.5, w, h);
    }
    if (s.name) pText(p, x + 2, nameY + 4, s.name, 'R', 12);
    if (s.date) pText(p, x + 2, dateY + 4, s.date, 'R', 12);
    [['Print Name', nameY], ['Signature', sigY], ['Date', dateY]].forEach(([label, yy]) => {
      pLine(p, x, yy, x + colw, yy, 0.6, 0);
      pText(p, x, yy - 11, label, 'R', 9.5, GREY);
    });
  });
}
