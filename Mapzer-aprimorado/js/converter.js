/*!
 * Mapzer - núcleo de conversão GeoJSON -> Shapefile
 * Funciona no navegador (window.MapzerConverter) e no Node (require).
 * Sem dependências. Não toca em DOM, então pode ser testado isoladamente.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapzerConverter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHP_POINT = 1, SHP_POLYLINE = 3, SHP_POLYGON = 5, SHP_MULTIPOINT = 8;
  const WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  const enc = new TextEncoder();

  /* Modos de agrupamento (valem para polígonos e linhas):
   *  simple  - um registro por polígono/linha (MultiPolygon é desmembrado)
   *  feature - um registro por feição/Placemark (MultiPolygon vira multipartes)
   *  single  - o arquivo inteiro vira um único registro multipartes            */
  const MODES = ['simple', 'feature', 'single'];

  /* Propriedades de estilo/ruído que o KML/togeojson injeta e que não interessam no DBF */
  const STYLE_KEYS = /^(styleUrl|styleHash|styleMapHash|stroke(-.*)?|fill(-.*)?|icon|marker-.*|visibility|open|drawOrder|tessellate|extrude|altitudeMode|gx_.*|_.*)$/i;

  /* ---------------------------------------------------------------- geometria */

  const isNum = v => typeof v === 'number' && isFinite(v);

  function cleanCoord(c) {
    if (!Array.isArray(c) || !isNum(c[0]) || !isNum(c[1])) return null;
    return [c[0], c[1]]; // descarta altitude
  }
  function cleanCoords(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const c of arr) {
      const p = cleanCoord(c);
      if (!p) return []; // não conecta trechos separados por coordenadas inválidas
      if (!out.length || p[0] !== out[out.length - 1][0] || p[1] !== out[out.length - 1][1]) out.push(p);
    }
    return out;
  }
  function closeRing(r) {
    if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r = r.concat([r[0]]);
    return r;
  }
  function cleanPolygon(rings) {
    if (!Array.isArray(rings) || !rings.length) return [];
    const out = [];
    for (const raw of rings) {
      const r = closeRing(cleanCoords(raw));
      // Um furo inválido também invalida o polígono: removê-lo acrescentaria área.
      if (r.length < 4 || ringArea2(r) === 0) return [];
      out.push(r);
    }
    return out; // [] se o anel externo for inválido
  }

  /* Achata GeometryCollection e normaliza coordenadas.
   * Devolve [{kind:'point'|'multipoint'|'line'|'polygon', parts:[...], properties}] por feição */
  function normalize(geojson) {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error('Esperada uma FeatureCollection GeoJSON');
    }
    const items = [];
    let skipped = 0;
    const visit = (g, props, featureId) => {
      if (!g) { skipped++; return; }
      switch (g.type) {
        case 'GeometryCollection': {
          if (!Array.isArray(g.geometries) || !g.geometries.length) { skipped++; break; }
          g.geometries.forEach(x => visit(x, props, featureId)); break;
        }
        case 'Point': { const p = cleanCoord(g.coordinates); p ? items.push({ kind: 'point', coords: p, properties: props }) : skipped++; break; }
        case 'MultiPoint': { const pts = cleanCoords(g.coordinates); pts.length ? items.push({ kind: 'multipoint', coords: pts, properties: props }) : skipped++; break; }
        case 'LineString': { const l = cleanCoords(g.coordinates); l.length >= 2 ? items.push({ kind: 'line', lines: [l], properties: props }) : skipped++; break; }
        case 'MultiLineString': {
          const raw = Array.isArray(g.coordinates) ? g.coordinates : [];
          const ls = raw.map(cleanCoords).filter(l => l.length >= 2);
          skipped += raw.length - ls.length;
          if (ls.length) items.push({ kind: 'line', lines: ls, properties: props });
          else if (!raw.length) skipped++;
          break;
        }
        case 'Polygon': { const p = cleanPolygon(g.coordinates); p.length ? items.push({ kind: 'polygon', polys: [p], properties: props }) : skipped++; break; }
        case 'MultiPolygon': {
          const raw = Array.isArray(g.coordinates) ? g.coordinates : [];
          const ps = raw.map(cleanPolygon).filter(p => p.length);
          skipped += raw.length - ps.length;
          if (ps.length) items.push({ kind: 'polygon', polys: ps, properties: props });
          else if (!raw.length) skipped++;
          break;
        }
        default: skipped++;
      }
    };
    geojson.features.forEach((f, featureId) => {
      const start = items.length;
      visit(f && f.geometry, (f && f.properties) || {}, featureId);
      for (let i = start; i < items.length; i++) items[i].featureId = featureId;
    });
    return { items, skipped };
  }

  function countGeometries(items) {
    const c = {};
    for (const it of items) {
      if (it.kind === 'polygon') c.Polygon = (c.Polygon || 0) + it.polys.length;
      else if (it.kind === 'line') c.LineString = (c.LineString || 0) + it.lines.length;
      else if (it.kind === 'point') c.Point = (c.Point || 0) + 1;
      else if (it.kind === 'multipoint') c.MultiPoint = (c.MultiPoint || 0) + 1;
    }
    return c;
  }

  /* ----------------------------------------------------------- escrita do .shp */

  function ringArea2(ring) { // >0 = horário (convenção do shapefile p/ anel externo)
    let s = 0;
    for (let i = 0; i < ring.length - 1; i++) s += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
    return s;
  }
  const newBBox = () => ({ xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity });
  function extend(b, coords) {
    for (const [x, y] of coords) {
      if (x < b.xmin) b.xmin = x; if (x > b.xmax) b.xmax = x;
      if (y < b.ymin) b.ymin = y; if (y > b.ymax) b.ymax = y;
    }
  }

  class ShapeWriter {
    constructor(shapeType) { this.shapeType = shapeType; this.records = []; this.bbox = newBBox(); }
    get count() { return this.records.length; }
    _add(buf, b) {
      this.records.push(buf);
      const t = this.bbox;
      t.xmin = Math.min(t.xmin, b.xmin); t.xmax = Math.max(t.xmax, b.xmax);
      t.ymin = Math.min(t.ymin, b.ymin); t.ymax = Math.max(t.ymax, b.ymax);
    }
    addPoint([x, y]) {
      const buf = new ArrayBuffer(20), dv = new DataView(buf);
      dv.setInt32(0, SHP_POINT, true); dv.setFloat64(4, x, true); dv.setFloat64(12, y, true);
      this._add(buf, { xmin: x, xmax: x, ymin: y, ymax: y });
    }
    addMultiPoint(coords) {
      const b = newBBox(); extend(b, coords);
      const buf = new ArrayBuffer(40 + 16 * coords.length), dv = new DataView(buf);
      dv.setInt32(0, SHP_MULTIPOINT, true);
      [b.xmin, b.ymin, b.xmax, b.ymax].forEach((v, i) => dv.setFloat64(4 + 8 * i, v, true));
      dv.setInt32(36, coords.length, true);
      coords.forEach(([x, y], i) => { dv.setFloat64(40 + 16 * i, x, true); dv.setFloat64(48 + 16 * i, y, true); });
      this._add(buf, b);
    }
    /* rings: lista de anéis já orientados. */
    _addParts(type, rings) {
      const b = newBBox(), starts = []; let n = 0;
      for (const r of rings) { starts.push(n); n += r.length; extend(b, r); }
      const buf = new ArrayBuffer(44 + 4 * rings.length + 16 * n), dv = new DataView(buf);
      dv.setInt32(0, type, true);
      [b.xmin, b.ymin, b.xmax, b.ymax].forEach((v, i) => dv.setFloat64(4 + 8 * i, v, true));
      dv.setInt32(36, rings.length, true); dv.setInt32(40, n, true);
      starts.forEach((s, i) => dv.setInt32(44 + 4 * i, s, true));
      let o = 44 + 4 * rings.length;
      for (const r of rings) for (const [x, y] of r) { dv.setFloat64(o, x, true); dv.setFloat64(o + 8, y, true); o += 16; }
      this._add(buf, b);
    }
    addPolyLine(lines) { this._addParts(SHP_POLYLINE, lines); }
    /* polys: [ [externo, furo, furo...], ... ]  -> externo horário, furos anti-horário */
    addPolygon(polys) {
      const rings = [];
      for (const poly of polys) poly.forEach((ring, i) => {
        const cw = ringArea2(ring) > 0;
        rings.push((i === 0) === cw ? ring : ring.slice().reverse());
      });
      this._addParts(SHP_POLYGON, rings);
    }
    build() {
      const total = 100 + this.records.reduce((s, r) => s + 8 + r.byteLength, 0);
      const shp = new ArrayBuffer(total), shx = new ArrayBuffer(100 + 8 * this.records.length);
      const sd = new DataView(shp), xd = new DataView(shx);
      const b = this.records.length ? this.bbox : { xmin: 0, ymin: 0, xmax: 0, ymax: 0 };
      const header = (dv, words) => {
        dv.setInt32(0, 9994, false); dv.setInt32(24, words, false);
        dv.setInt32(28, 1000, true); dv.setInt32(32, this.shapeType, true);
        [b.xmin, b.ymin, b.xmax, b.ymax].forEach((v, i) => dv.setFloat64(36 + 8 * i, v, true));
      };
      header(sd, total / 2); header(xd, shx.byteLength / 2);
      let so = 100, xo = 100;
      this.records.forEach((rec, i) => {
        const words = rec.byteLength / 2;
        sd.setInt32(so, i + 1, false); sd.setInt32(so + 4, words, false);
        new Uint8Array(shp, so + 8).set(new Uint8Array(rec));
        xd.setInt32(xo, so / 2, false); xd.setInt32(xo + 4, words, false);
        so += 8 + rec.byteLength; xo += 8;
      });
      return { shp, shx };
    }
  }

  /* ----------------------------------------------------------- escrita do .dbf */

  const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
  function cleanString(v) { return String(v).replace(/[\u0000-\u001f]+/g, ' '); }

  /* corta uma string em no máximo `max` bytes UTF-8 sem partir um caractere ao meio */
  function truncateUtf8(str, max) {
    let bytes = enc.encode(str);
    if (bytes.length <= max) return bytes;
    let end = max;
    while (end > 0 && (bytes[end] & 0xC0) === 0x80) end--;
    return bytes.slice(0, end);
  }

  function sanitizeFieldName(name) {
    const ascii = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return ascii.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 10) || 'FIELD';
  }

  function inferFields(rows) {
    const keys = [], seen = new Set();
    for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    const used = new Set();
    return keys.map(k => {
      let numeric = true, dec = 0, maxLen = 1;
      for (const r of rows) {
        const v = r[k];
        if (v === undefined || v === null || v === '') continue;
        const s = cleanString(v);
        maxLen = Math.max(maxLen, enc.encode(s).length);
        if (numeric) {
          // Sem passar strings por Number: identificadores grandes devem permanecer exatos.
          const ok = (typeof v === 'number' || typeof v === 'string') && NUM_RE.test(s) &&
            (s.split('.')[1] || '').length <= 8;
          if (!ok) numeric = false;
          else { const d = s.indexOf('.'); if (d >= 0) dec = Math.max(dec, Math.min(8, s.length - d - 1)); }
        }
      }
      let base = sanitizeFieldName(k), name = base, n = 1;
      while (used.has(name.toUpperCase())) { const suf = String(n++); name = base.slice(0, 10 - suf.length) + suf; }
      used.add(name.toUpperCase());
      if (numeric && maxLen > 0 && rows.some(r => r[k] !== undefined && r[k] !== null && r[k] !== '')) {
        let len = 1;
        for (const r of rows) { const v = r[k]; if (v !== undefined && v !== null && v !== '') len = Math.max(len, numericText(v, dec).length); }
        if (len <= 19) return { key: k, name, type: 'N', length: len, decimals: dec };
      }
      return { key: k, name, type: 'C', length: Math.min(254, Math.max(1, maxLen)), decimals: 0 };
    });
  }

  function numericText(value, decimals) {
    const [integer, fraction = ''] = String(value).split('.');
    return integer + (decimals ? '.' + fraction.padEnd(decimals, '0') : '');
  }

  function buildDbf(fields, rows) {
    const headerSize = 32 + 32 * fields.length + 1;
    const recSize = 1 + fields.reduce((s, f) => s + f.length, 0);
    if (headerSize > 65535 || recSize > 65535) throw new Error('Atributos excedem o limite de tamanho do DBF');
    const buf = new ArrayBuffer(headerSize + recSize * rows.length + 1);
    const dv = new DataView(buf), u8 = new Uint8Array(buf), now = new Date();
    dv.setUint8(0, 0x03); dv.setUint8(1, now.getFullYear() - 1900); dv.setUint8(2, now.getMonth() + 1); dv.setUint8(3, now.getDate());
    dv.setUint32(4, rows.length, true); dv.setUint16(8, headerSize, true); dv.setUint16(10, recSize, true);
    let o = 32;
    for (const f of fields) {
      u8.set(enc.encode(f.name), o);
      dv.setUint8(o + 11, f.type.charCodeAt(0)); dv.setUint8(o + 16, f.length); dv.setUint8(o + 17, f.decimals || 0);
      o += 32;
    }
    u8[o++] = 0x0d;
    for (const row of rows) {
      u8[o++] = 0x20;
      for (const f of fields) {
        const v = row[f.key];
        const empty = v === undefined || v === null || v === '';
        if (f.type === 'N') {
          let s = empty ? '' : numericText(v, f.decimals);
          if (s.length > f.length || (!empty && !NUM_RE.test(s))) throw new Error('Valor não cabe no campo DBF: ' + f.name);
          s = s.padStart(f.length, ' ');
          u8.set(enc.encode(s), o);
        } else {
          const bytes = truncateUtf8(empty ? '' : cleanString(v), f.length);
          u8.fill(0x20, o, o + f.length);
          u8.set(bytes, o);
        }
        o += f.length;
      }
    }
    u8[o] = 0x1a;
    return buf;
  }

  /* ------------------------------------------------------------ propriedades */

  function stripHtml(s) {
    return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  }

  function cleanProps(props, opts) {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object') continue;                 // "[object Object]" do togeojson
      if (opts.dropStyle && STYLE_KEYS.test(k)) continue;
      if (typeof v === 'boolean') { out[k] = v ? 'true' : 'false'; continue; }
      out[k] = k === 'description' ? stripHtml(v) : v;
    }
    if ('description' in out && !('descricao' in out)) { out.descricao = out.description; delete out.description; }
    return out;
  }

  /* --------------------------------------------------------------- conversão */

  const slug = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'shapefile';

  /**
   * @param {object} geojson   FeatureCollection (saída do togeojson)
   * @param {string} baseName  nome-base do arquivo
   * @param {{mode?:'simple'|'feature'|'single', dropStyle?:boolean}} options
   * @returns {{files:{name:string,data:ArrayBuffer|string}[], layers:object[], skipped:number}}
   */
  function convert(geojson, baseName, options) {
    const opts = Object.assign({ mode: 'simple', dropStyle: true }, options || {});
    if (!MODES.includes(opts.mode)) throw new Error('Modo inválido: ' + opts.mode);
    baseName = slug(baseName);
    const { items, skipped } = normalize(geojson);
    if (!items.length) throw new Error('Nenhuma geometria válida encontrada');

    const files = [], layers = [], warnings = [];
    const emit = (suffix, writer, rows) => {
      const name = baseName + suffix;
      const fields = inferFields(rows);
      for (const f of fields) {
        if (f.type === 'C' && rows.some(r => r[f.key] != null && enc.encode(cleanString(r[f.key])).length > f.length)) {
          warnings.push(`${name}: o campo ${f.key} foi limitado a ${f.length} bytes no DBF`);
        }
      }
      const { shp, shx } = writer.build();
      files.push({ name: name + '.shp', data: shp }, { name: name + '.shx', data: shx },
        { name: name + '.dbf', data: buildDbf(fields, rows) },
        { name: name + '.prj', data: WGS84_PRJ }, { name: name + '.cpg', data: 'UTF-8' });
      layers.push({ name, records: writer.count, fields: fields.map(f => f.name),
        fieldMapping: fields.map(f => ({ original: f.key, dbf: f.name, type: f.type, bytes: f.length })) });
    };
    const props = it => cleanProps(it.properties, opts);
    const single = () => ({ name: baseName });

    const of = k => items.filter(i => i.kind === k);

    // pontos (sem modos: cada ponto = 1 registro)
    const pts = of('point');
    if (pts.length) { const w = new ShapeWriter(SHP_POINT); pts.forEach(i => w.addPoint(i.coords)); emit('_pontos', w, pts.map(props)); }
    const mpts = of('multipoint');
    if (mpts.length) { const w = new ShapeWriter(SHP_MULTIPOINT); mpts.forEach(i => w.addMultiPoint(i.coords)); emit('_multipontos', w, mpts.map(props)); }

    // linhas e polígonos respeitam o modo
    const grouped = (kind, partsKey, type, add, suffix) => {
      const list = of(kind);
      if (!list.length) return;
      const w = new ShapeWriter(type), rows = [];
      if (opts.mode === 'single') {
        add(w, list.flatMap(i => i[partsKey])); rows.push(single());
      } else if (opts.mode === 'feature') {
        const groups = new Map();
        for (const i of list) {
          if (!groups.has(i.featureId)) groups.set(i.featureId, { item: i, parts: [] });
          groups.get(i.featureId).parts.push(...i[partsKey]);
        }
        for (const group of groups.values()) { add(w, group.parts); rows.push(props(group.item)); }
      } else {
        for (const i of list) for (const part of i[partsKey]) { add(w, [part]); rows.push(props(i)); }
      }
      emit(suffix, w, rows);
    };
    grouped('line', 'lines', SHP_POLYLINE, (w, p) => w.addPolyLine(p), '_linhas');
    grouped('polygon', 'polys', SHP_POLYGON, (w, p) => w.addPolygon(p), '_poligonos');

    return { files, layers, skipped, warnings };
  }

  return { convert, normalize, countGeometries, buildDbf, inferFields, truncateUtf8, slug, ShapeWriter, MODES, WGS84_PRJ };
});
