const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/converter');

// DOM mínimo: exercita estados assíncronos sem depender de CDN ou navegador.
function harness(withMap = false) {
  const elements = new Map(), reads = [], downloads = [];
  const tiles = [];
  function element() {
    const classes = new Set();
    return { textContent: '', style: {}, value: '', checked: true, disabled: false,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
        toggle: (x, active) => active ? classes.add(x) : classes.delete(x) },
      listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; },
      append() {}, appendChild() {}, setAttribute() {}, focus() {}, click() { if (this.download) downloads.push(this.download); } };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const body = element(); body.appendChild = body.removeChild = () => {};
  const document = { body, getElementById: get, querySelectorAll: () => [], createElement: element };
  let finishZip;
  class Zip { file() {} generateAsync() { return new Promise(resolve => { finishZip = resolve; }); } }
  const context = { window: { MapzerConverter: C }, document, localStorage: { getItem: k => k === 'mapzer-provider' ? 'stadia' : null, setItem() {} },
    console, setTimeout(fn, delay) { if (withMap && delay <= 100) setImmediate(fn); }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, JSZip: Zip,
    FileReader: class { readAsText(file) { reads.push(() => { this.result = file.text; this.onload(); }); } },
    DOMParser: class { parseFromString(text) { return { text, documentElement: { localName: 'kml' }, querySelector: () => null }; } },
    toGeoJSON: { kml: xml => JSON.parse(xml.text) } };
  if (withMap) context.L = {
    map: () => ({ removeLayer() {}, invalidateSize() {}, fitBounds() {} }),
    tileLayer: (url, options) => {
      const events = {};
      const layer = { url, options, on(name, callback) { events[name] = callback; return this; },
        off() { for (const key of Object.keys(events)) delete events[key]; }, addTo() { return this; },
        emit(name) { if (events[name]) events[name](); } };
      tiles.push(layer); return layer;
    },
    geoJSON: () => ({ addTo() { return this; }, getBounds: () => ({ isValid: () => true, getCenter: () => ({ lat: -23, lng: -46 }) }) })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8'), context);
  const load = (name, x = 0) => get('uploadZone').listeners.drop({ preventDefault() {}, dataTransfer: { files: [{
    name, size: 100, text: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: {}, geometry: { type: 'Point', coordinates: [x, 0] } }] }) }] } });
  return { get, reads, load, downloads, tiles, finish: () => finishZip({}) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('a leitura mais recente vence mesmo quando termina antes da anterior', async () => {
  const h = harness();
  h.load('primeiro.kml'); h.load('segundo.kml');
  h.reads[1](); await flush();
  h.reads[0](); await flush();
  const done = h.get('convertBtn').listeners.click();
  h.finish(); await done;
  assert.deepEqual(h.downloads, ['segundo.zip']);
});

test('arquivo inválido desativa a conversão e limpa as métricas anteriores', async () => {
  const h = harness();
  h.load('valido.kml'); h.reads[0](); await flush();
  assert.equal(h.get('convertBtn').disabled, false);
  h.load('invalido.txt'); await flush();
  assert.equal(h.get('convertBtn').disabled, true);
  assert.equal(h.get('metricFeatures').textContent, '0');
  await h.get('convertBtn').listeners.click();
  assert.deepEqual(h.downloads, []);
});

test('ausência do mapa não impede conversão; troca durante exportação é bloqueada', async () => {
  const h = harness();
  h.load('original.kml'); h.reads[0](); await flush();
  assert.match(h.get('statusMap').textContent, /Mapa indisponível/);
  assert.equal(h.get('convertBtn').disabled, false);
  const done = h.get('convertBtn').listeners.click();
  h.load('outro.kml');
  assert.equal(h.reads.length, 1);
  h.finish(); await done;
  assert.deepEqual(h.downloads, ['original.zip']);
  assert.equal(h.get('convertBtn').disabled, false);
});

test('fundo inicia em OSM mesmo com provedor antigo salvo e usa limite nativo de zoom', async () => {
  const h = harness(true);
  h.load('mapa.kml'); h.reads[0](); await flush(); await flush();
  assert.equal(h.tiles[0].url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(h.tiles[0].options.maxNativeZoom, 19);
  assert.equal(h.get('statusMap').textContent, 'Carregando mapa de fundo');
  h.tiles[0].emit('tileload'); h.tiles[0].emit('load');
  assert.equal(h.get('statusMap').textContent, 'Mapa de fundo carregado');
});

test('falha no fundo é visível e restauração substitui apenas a camada de tiles', async () => {
  const h = harness(true);
  h.load('mapa.kml'); h.reads[0](); await flush(); await flush();
  h.tiles[0].emit('tileerror'); h.tiles[0].emit('load');
  assert.match(h.get('mapNotice').textContent, /indisponível/);
  assert.equal(h.get('convertBtn').disabled, false);
  h.get('retryMapBtn').listeners.click();
  assert.equal(h.tiles.length, 2);
  h.tiles[1].emit('tileload'); h.tiles[1].emit('load');
  assert.equal(h.get('mapNotice').textContent, '');
  assert.equal(h.get('statusMap').textContent, 'Mapa de fundo carregado');
});
