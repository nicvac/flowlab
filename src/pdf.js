/* ==========================================================================
   FlowLab — scrittura di file PDF (senza librerie esterne)
   Pagine A4 (o di dimensioni a piacere, modulo continuo) con testo nei font standard (Helvetica, Courier: codifica
   WinAnsi, che comprende le lettere accentate italiane) e immagini JPEG.
   Le coordinate passate ai metodi partono dall'angolo in alto a sinistra.
   ========================================================================== */
'use strict';

const PdfLib = (() => {
  const PW = 595.28, PH = 841.89; // A4 in punti
  const MAXH = 14400; // altezza massima di una pagina PDF (200 pollici)
  const FONTS = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Courier', F4: 'Helvetica-Oblique', F5: 'Courier-Bold', F6: 'Courier-Oblique' };
  // caratteri fuori da WinAnsi: sostituzioni leggibili
  const SUBST = { '←': '<-', '→': '->', '≠': '!=', '≤': '<=', '≥': '>=', 'π': 'pi', '▦': '', '⋯': '...', '✖': 'x', '■': '', '▶': '>', '⏸': '||', '↺': '', '⚠': '!', '\t': '    ' };
  const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
  /* testo → byte WinAnsi, già scritto come stringa PDF tra parentesi */
  function pdfStr(text) {
    let out = '(';
    for (const ch of String(text)) {
      let s = SUBST[ch] !== undefined ? SUBST[ch] : ch;
      for (const c of s) {
        let b = c.codePointAt(0);
        if (CP1252[c] !== undefined) b = CP1252[c];
        else if (b > 255 || (b >= 0x80 && b < 0xa0)) b = 63; // ?
        if (b === 40 || b === 41 || b === 92) out += '\\' + c;
        else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
        else out += c;
      }
    }
    return out + ')';
  }
  const num = (x) => (Math.round(x * 100) / 100).toString();
  const rgb = (c) => c.map((v) => num(v / 255)).join(' ');

  class Doc {
    constructor() { this.pages = []; this.images = []; }
    get W() { return PW; }
    get H() { return PH; }
    /* nuova pagina A4; con h (e w), alta h punti e larga w punti, o come un A4 (modulo continuo) */
    page(h, w) {
      const p = { ops: [], imgs: new Set(), h: Math.min(MAXH, Math.max(72, h || PH)), w: Math.min(MAXH, Math.max(PW, w || PW)) };
      this.pages.push(p); return p;
    }
    get maxH() { return MAXH; }
    text(p, x, y, str, o) {
      const f = (o && o.font) || 'F1', size = (o && o.size) || 11, col = (o && o.color) || [23, 34, 45];
      p.ops.push(`BT ${rgb(col)} rg /${f} ${num(size)} Tf ${num(x)} ${num(p.h - y)} Td ${pdfStr(str)} Tj ET`);
    }
    line(p, x1, y1, x2, y2, o) {
      const col = (o && o.color) || [200, 210, 220], w = (o && o.width) || 0.8;
      p.ops.push(`${rgb(col)} RG ${num(w)} w ${num(x1)} ${num(p.h - y1)} m ${num(x2)} ${num(p.h - y2)} l S`);
    }
    rect(p, x, y, w, h, o) {
      const fill = o && o.fill, stroke = o && o.stroke;
      let s = '';
      if (fill) s += `${rgb(fill)} rg `;
      if (stroke) s += `${rgb(stroke)} RG ${num(o.width || 0.8)} w `;
      p.ops.push(`${s}${num(x)} ${num(p.h - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    }
    /* immagine JPEG (data URL) di pw × ph pixel */
    addJpeg(dataUrl, pw, ph) {
      const bin = atob(dataUrl.split(',')[1]);
      const img = { name: 'Im' + (this.images.length + 1), w: pw, h: ph, bin };
      this.images.push(img);
      return img;
    }
    image(p, img, x, y, w, h) {
      p.imgs.add(img);
      p.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(p.h - y - h)} cm /${img.name} Do Q`);
    }
    /* file PDF come Blob */
    build(info) {
      const chunks = []; let off = 0; const offsets = [];
      const put = (s) => { chunks.push(s); off += s.length; };
      const obj = (n, body) => { offsets[n] = off; put(`${n} 0 obj\n${body}\nendobj\n`); };
      put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
      let n = 1;
      const catalog = n++, pagesN = n++, infoN = n++;
      const fontN = {}; for (const f of Object.keys(FONTS)) fontN[f] = n++;
      const imgN = new Map(); for (const im of this.images) imgN.set(im, n++);
      const pageN = this.pages.map(() => { const a = n++; const b = n++; return [a, b]; });
      obj(catalog, `<< /Type /Catalog /Pages ${pagesN} 0 R >>`);
      obj(pagesN, `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageN.map(([a]) => `${a} 0 R`).join(' ')}] >>`);
      const d = new Date(); const pd = (x) => String(x).padStart(2, '0');
      obj(infoN, `<< /Title ${pdfStr(info.title || '')} /Author ${pdfStr(info.author || '')} /Creator (FlowLab) /CreationDate (D:${d.getFullYear()}${pd(d.getMonth() + 1)}${pd(d.getDate())}${pd(d.getHours())}${pd(d.getMinutes())}${pd(d.getSeconds())}) >>`);
      for (const [f, base] of Object.entries(FONTS)) obj(fontN[f], `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
      for (const im of this.images) {
        offsets[imgN.get(im)] = off;
        put(`${imgN.get(im)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bin.length} >>\nstream\n`);
        put(im.bin);
        put('\nendstream\nendobj\n');
      }
      const fontRes = Object.keys(FONTS).map((f) => `/${f} ${fontN[f]} 0 R`).join(' ');
      this.pages.forEach((p, i) => {
        const [pn, cn] = pageN[i];
        const xo = [...p.imgs].map((im) => `/${im.name} ${imgN.get(im)} 0 R`).join(' ');
        obj(pn, `<< /Type /Page /Parent ${pagesN} 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}] /Resources << /Font << ${fontRes} >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${cn} 0 R >>`);
        const stream = p.ops.join('\n');
        obj(cn, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      });
      const xref = off;
      let x = `xref\n0 ${n}\n0000000000 65535 f \n`;
      for (let k = 1; k < n; k++) x += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`;
      put(x);
      put(`trailer\n<< /Size ${n} /Root ${catalog} 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      const bytes = new Uint8Array(off); let k = 0;
      for (const c of chunks) for (let i = 0; i < c.length; i++) bytes[k++] = c.charCodeAt(i) & 0xff;
      return new Blob([bytes], { type: 'application/pdf' });
    }
  }
  /* larghezza approssimata del testo in punti (Helvetica ≈ Arial; Courier: 0,6 em) */
  const _cv = (() => { try { return document.createElement('canvas').getContext('2d'); } catch (e) { return null; } })();
  function textWidth(str, font, size) {
    if (font === 'F3' || font === 'F5' || font === 'F6') return [...String(str)].length * 0.6 * size;
    if (!_cv) return String(str).length * 0.52 * size;
    _cv.font = `${font === 'F2' ? 'bold ' : font === 'F4' ? 'italic ' : ''}${size}px Helvetica, Arial, sans-serif`;
    return _cv.measureText(String(str)).width;
  }
  /* spezza il testo in righe larghe al massimo maxW punti */
  function wrap(str, font, size, maxW) {
    const out = [];
    for (const para of String(str).split('\n')) {
      let cur = '';
      for (const w of para.split(/(\s+)/)) {
        if (textWidth(cur + w, font, size) <= maxW) { cur += w; continue; }
        if (cur.trim()) out.push(cur.trimEnd());
        cur = w.trimStart();
        while (textWidth(cur, font, size) > maxW && cur.length > 1) {
          let k = cur.length; while (k > 1 && textWidth(cur.slice(0, k), font, size) > maxW) k--;
          out.push(cur.slice(0, k)); cur = cur.slice(k);
        }
      }
      out.push(cur.trimEnd());
    }
    return out;
  }
  return { Doc, textWidth, wrap, pdfStr };
})();
