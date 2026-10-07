// Rodar com:  node --test
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/converter.js');

const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const fc = features => ({ type: 'FeatureCollection', features });
const multi = fc([
  { type: 'Feature', properties: { name: 'Capão Redondo', styleUrl: '#s', styleHash: 'x' }, geometry: { type: 'Polygon', coordinates: [sq(0, 0, 1)] } },
  { type: 'Feature', properties: { name: 'Dois pedaços' }, geometry: { type: 'MultiPolygon', coordinates: [[sq(2, 0, 1)], [sq(4, 0, 1)]] } },
]);

const dbfRecords = r => new DataView(r.files.find(f => f.name.endsWith('.dbf')).data).getUint32(4, true);
const shxRecords = r => (r.files.find(f => f.name.endsWith('.shx')).data.byteLength - 100) / 8;

for (const [mode, expected] of [['simple', 3], ['feature', 2], ['single', 1]]) {
  test(`modo ${mode}: ${expected} registro(s), SHP/SHX/DBF consistentes`, () => {
    const r = C.convert(multi, 'x', { mode });
    assert.strictEqual(r.layers[0].records, expected);
    assert.strictEqual(shxRecords(r), expected);
    assert.strictEqual(dbfRecords(r), expected);
  });
}

test('remove campos de estilo do KML', () => {
  const r = C.convert(multi, 'x', { mode: 'feature', dropStyle: true });
  assert.deepStrictEqual(r.layers[0].fields, ['name']);
});

test('DBF com acentos não desalinha campos (UTF-8 por bytes)', () => {
  const g = fc([{ type: 'Feature', properties: { a: 'ãõçéíú', b: 'fim' }, geometry: { type: 'Point', coordinates: [1, 2] } }]);
  const buf = new Uint8Array(C.convert(g, 'x').files.find(f => f.name.endsWith('.dbf')).data);
  const dv = new DataView(buf.buffer), head = dv.getUint16(8, true), rec = dv.getUint16(10, true);
  const text = new TextDecoder().decode(buf.slice(head + 1, head + rec));
  assert.strictEqual(text, 'ãõçéíú' + 'fim');
});

test('fecha anéis abertos, ignora altitude e geometrias vazias', () => {
  const g = fc([
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0, 9], [1, 0, 9], [1, 1, 9], [0, 1, 9]]] } },
    { type: 'Feature', properties: {}, geometry: null },
  ]);
  const r = C.convert(g, 'x');
  assert.strictEqual(r.layers[0].records, 1);
  assert.strictEqual(r.skipped, 1);
});

test('GeometryCollection é separada em camadas por tipo', () => {
  const g = fc([{ type: 'Feature', properties: { name: 'm' }, geometry: { type: 'GeometryCollection', geometries: [
    { type: 'Point', coordinates: [0, 0] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { type: 'Polygon', coordinates: [sq(0, 0, 1)] }] } }]);
  assert.deepStrictEqual(C.convert(g, 'x').layers.map(l => l.name), ['x_pontos', 'x_linhas', 'x_poligonos']);
});
