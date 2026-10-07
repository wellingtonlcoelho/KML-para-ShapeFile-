const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/converter');
const square = (x = 0) => [[x, 0], [x + 2, 0], [x + 2, 2], [x, 2], [x, 0]];
const feature = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const fc = (...features) => ({ type: 'FeatureCollection', features });
const polygon = coordinates => ({ type: 'Polygon', coordinates });
const point = properties => feature({ type: 'Point', coordinates: [1, 2] }, properties);

function cells(properties) {
  const result = C.convert(fc(point(properties)), 'dados');
  const data = result.files.find(f => f.name.endsWith('.dbf')).data;
  const view = new DataView(data);
  let offset = view.getUint16(8, true) + 1;
  return result.layers[0].fieldMapping.map(f => {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data, offset, f.bytes)).trim();
    offset += f.bytes;
    return { ...f, value };
  });
}

test('anel externo inválido não promove um furo a polígono', () => {
  const r = C.normalize(fc(feature(polygon([[[0, 0], [1, 1]], square()]))));
  assert.equal(r.items.length, 0);
  assert.equal(r.skipped, 1);
});

test('furo inválido não é removido silenciosamente', () => {
  assert.equal(C.normalize(fc(feature(polygon([square(), [[0, 0], [NaN, 1], [1, 0]]])))).items.length, 0);
});

test('geometria degenerada e coordenada inválida são rejeitadas', () => {
  const result = C.normalize(fc(
    feature(polygon([[[0, 0], [1, 1], [2, 2], [0, 0]]])),
    feature({ type: 'LineString', coordinates: [[0, 0], [NaN, 2], [1, 1]] }),
    feature({ type: 'LineString', coordinates: [[0, 0], [0, 0]] }),
    feature({ type: 'Polygon', coordinates: {} }), null));
  assert.equal(result.items.length, 0);
  assert.equal(result.skipped, 5);
});

test('multipartes informa partes rejeitadas', () => {
  const r = C.normalize(fc(feature({ type: 'MultiPolygon', coordinates: [[square()], [[]]] })));
  assert.equal(r.items.length, 1);
  assert.equal(r.skipped, 1);
});

test('modo feature agrupa GeometryCollection pelo Placemark de origem', () => {
  const input = fc(feature({ type: 'GeometryCollection', geometries: [polygon([square()]),
    { type: 'GeometryCollection', geometries: [polygon([square(4)])] }] }, { name: 'Área' }),
    feature(polygon([square(8)]), { name: 'Outra' }));
  assert.equal(C.convert(input, 'x', { mode: 'feature' }).layers[0].records, 2);
  assert.equal(C.convert(input, 'x', { mode: 'simple' }).layers[0].records, 3);
  assert.equal(C.convert(input, 'x', { mode: 'single' }).layers[0].records, 1);
});

test('números grandes, pequenos, casas decimais e códigos permanecem exatos', () => {
  const values = { id: '9007199254740993', huge: '123456789012345678901234', tiny: 1e-7,
    precise: '1.123456789', code: '00123', negative: '-123.45' };
  for (const cell of cells(values)) assert.equal(cell.value, String(values[cell.original]));
});

test('DBF numérico preenche decimais sem perder precisão', () => {
  const rows = [{ n: '9007199254740993' }, { n: '1.25' }];
  const fields = C.inferFields(rows);
  const data = C.buildDbf(fields, rows);
  const header = new DataView(data).getUint16(8, true);
  assert.equal(new TextDecoder().decode(new Uint8Array(data, header + 1, fields[0].length)), '9007199254740993.00');
});

test('DBF rejeita overflow em vez de cortar os dígitos iniciais', () => {
  assert.throws(() => C.buildDbf([{ key: 'n', name: 'n', type: 'N', length: 2, decimals: 0 }], [{ n: 123 }]), /não cabe/);
});

test('campos com nomes iguais após normalização são mapeados sem colisões', () => {
  const r = cells({ 'descrição longa': 'a', 'descricao longa': 'b', DESCRICAO_: 'c' });
  assert.equal(new Set(r.map(f => f.dbf.toUpperCase())).size, 3);
  assert.ok(r.every(f => f.dbf.length <= 10));
});

test('description não sobrescreve descricao existente', () => {
  const r = cells({ description: '<b>Original</b>', descricao: 'Outro campo' });
  assert.deepEqual(r.map(f => f.value), ['Original', 'Outro campo']);
});

test('truncamento UTF-8 é válido e reportado', () => {
  const input = fc(point({ texto: '🗺'.repeat(100) }));
  const r = C.convert(input, 'x');
  assert.equal(r.warnings.length, 1);
  assert.ok(cells(input.features[0].properties)[0].value.length > 0);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(C.truncateUtf8('á😀fim', 5)), 'á');
});

test('SHP e SHX possuem offsets, comprimentos e bounding box consistentes', () => {
  const r = C.convert(fc(point({ n: 1 }), feature({ type: 'Point', coordinates: [-5, 8] }, { n: 2 })), 'x');
  const shp = new DataView(r.files.find(f => f.name.endsWith('.shp')).data);
  const shx = new DataView(r.files.find(f => f.name.endsWith('.shx')).data);
  assert.equal(shp.getInt32(0), 9994);
  assert.equal(shp.getInt32(24) * 2, shp.byteLength);
  assert.equal(shx.getInt32(24) * 2, shx.byteLength);
  assert.deepEqual([36, 44, 52, 60].map(p => shp.getFloat64(p, true)), [-5, 2, 1, 8]);
  for (let i = 0; i < 2; i++) {
    const offset = shx.getInt32(100 + i * 8) * 2;
    assert.equal(shp.getInt32(offset), i + 1);
    assert.equal(shp.getInt32(offset + 4), shx.getInt32(104 + i * 8));
  }
});

test('entrada incorreta produz erro compreensível', () => {
  assert.throws(() => C.convert({}, 'x'), /FeatureCollection/);
});
