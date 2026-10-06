(function () {
  'use strict';
  const C = window.MapzerConverter;
  const $ = id => document.getElementById(id);

  /* ---------------------------------------------------------------- tema */
  const themeToggle = $('themeToggle');
  const store = {
    get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ } }
  };
  let leafletMap = null, tileLayer = null, geoJsonLayer = null;

  const TILES = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
  };

  function applyTheme(theme) {
    const dark = theme !== 'light';
    document.body.classList.toggle('light-mode', !dark);
    themeToggle.textContent = dark ? '🌙 Escuro' : '☀️ Claro';
    if (tileLayer) tileLayer.setUrl(dark ? TILES.dark : TILES.light);
  }
  applyTheme(store.get('mapzer-theme', 'dark'));
  themeToggle.addEventListener('click', () => {
    const next = document.body.classList.contains('light-mode') ? 'dark' : 'light';
    store.set('mapzer-theme', next);
    applyTheme(next);
    if (leafletMap) setTimeout(() => leafletMap.invalidateSize(), 300);
  });
  $('year').textContent = new Date().getFullYear();

  /* ------------------------------------------------------------ elementos */
  const uploadZone = $('uploadZone'), fileInput = $('fileInput');
  const statusMessage = $('statusMessage'), mapSection = $('mapSection');
  const legendSection = $('legendSection'), legendItems = $('legendItems');
  const geometryOptions = $('geometryOptions'), convertBtn = $('convertBtn');
  const uploadTitle = $('uploadTitle'), uploadSubtitle = $('uploadSubtitle');
  const mapExtent = $('mapExtent'), modeHint = $('modeHint'), dropStyle = $('dropStyle');
  const metricFeatures = $('metricFeatures'), metricGeometries = $('metricGeometries'), metricLayers = $('metricLayers');
  const statusReady = $('statusReady'), statusMap = $('statusMap');

  let currentGeoJSON = null, currentItems = [], currentBaseName = 'shapefile';
  let geometryMode = 'simple';

  function showStatus(msg, isError) {
    statusMessage.textContent = msg;
    statusMessage.classList.add('show');
    statusMessage.classList.toggle('error', !!isError);
  }

  /* ---------------------------------------------------------------- modos */
  const MODE_TEXT = {
    simple: 'Um registro por polígono. Um MultiPolígono do KML é desmembrado em vários registros, repetindo os atributos.',
    feature: 'Um registro por Placemark. Placemarks com vários polígonos viram um único MultiPolígono.',
    single: 'O arquivo inteiro vira um único registro MultiPolígono. O nome do arquivo é usado como atributo.'
  };

  function recordsFor(mode) {
    const poly = currentItems.filter(i => i.kind === 'polygon');
    if (!poly.length) return null;
    if (mode === 'simple') return poly.reduce((s, i) => s + i.polys.length, 0);
    if (mode === 'feature') return poly.length;
    return 1;
  }

  function renderModeHint() {
    const n = recordsFor(geometryMode);
    modeHint.textContent = MODE_TEXT[geometryMode] + (n === null ? '' : ` → ${n} registro(s) de polígono.`);
    document.querySelectorAll('.geo-option').forEach(b => {
      const active = b.dataset.mode === geometryMode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
  }
  document.querySelectorAll('.geo-option').forEach(btn => btn.addEventListener('click', () => {
    geometryMode = btn.dataset.mode;
    renderModeHint();
  }));

  /* -------------------------------------------------------------- arquivo */
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-active'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-active'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-active');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  function readText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
      r.readAsText(file);
    });
  }

  async function kmlTextFrom(file) {
    if (/\.kmz$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(f => !f.dir && /\.kml$/i.test(f.name));
      if (!entries.length) throw new Error('Nenhum .kml dentro do KMZ');
      const main = entries.find(f => /(^|\/)doc\.kml$/i.test(f.name)) || entries[0];
      return main.async('string');
    }
    return readText(file);
  }

  async function handleFile(file) {
    if (!/\.(kml|kmz)$/i.test(file.name)) { showStatus('❌ Selecione um arquivo .kml ou .kmz', true); return; }
    currentBaseName = C.slug(file.name.replace(/\.(kml|kmz)$/i, ''));
    uploadTitle.textContent = file.name;
    uploadSubtitle.textContent = 'clique para trocar';
    showStatus('📖 Lendo arquivo...');
    try {
      const text = await kmlTextFrom(file);
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      if (xml.querySelector('parsererror')) throw new Error('XML inválido');
      const geojson = toGeoJSON.kml(xml);
      const { items, skipped } = C.normalize(geojson);
      if (!items.length) { showStatus('❌ Nenhuma geometria válida encontrada', true); return; }
      currentGeoJSON = geojson;
      currentItems = items;
      analyzeAndShow(geojson, items, skipped);
    } catch (err) {
      showStatus('❌ Erro: ' + err.message, true);
    }
  }

  const LABELS = {
    Point: ['Pontos', 'point'], MultiPoint: ['Multi-pontos', 'multipoint'],
    LineString: ['Linhas', 'line'], Polygon: ['Polígonos', 'polygon']
  };

  function analyzeAndShow(geojson, items, skipped) {
    const counts = C.countGeometries(items);
    legendItems.innerHTML = '';
    for (const [t, n] of Object.entries(counts)) {
      const [label, cls] = LABELS[t];
      const row = document.createElement('div');
      row.className = 'legend-item';
      const sw = document.createElement('div'); sw.className = 'legend-swatch ' + cls;
      const nm = document.createElement('div'); nm.className = 'legend-name'; nm.textContent = label;
      const ct = document.createElement('div'); ct.className = 'legend-count'; ct.textContent = n;
      row.append(sw, nm, ct);
      legendItems.appendChild(row);
    }
    const kinds = Object.keys(counts).length;
    metricFeatures.textContent = geojson.features.length;
    metricGeometries.textContent = Object.values(counts).reduce((a, b) => a + b, 0);
    metricLayers.textContent = kinds;
    statusReady.textContent = 'Arquivo pronto';
    statusReady.classList.remove('inactive');
    statusMap.textContent = 'Mapa ativo';
    statusMap.classList.remove('inactive');

    legendSection.classList.add('show');
    geometryOptions.classList.add('show');
    renderModeHint();
    showMap(geojson);
    let msg = `✓ ${geojson.features.length} feição(ões) lida(s)`;
    if (skipped) msg += ` — ${skipped} ignorada(s) por geometria vazia ou inválida`;
    showStatus(msg);
  }

  /* ------------------------------------------------------------------ mapa */
  const STYLE = {
    Point: { radius: 8, color: '#0ea5e9', weight: 2, fillColor: '#06b6d4', fillOpacity: 1 },
    LineString: { color: '#3b82f6', weight: 3, opacity: 0.9 },
    Polygon: { color: '#0284c7', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.3 }
  };
  const styleFor = t => /Point/.test(t) ? STYLE.Point : /Line/.test(t) ? STYLE.LineString : STYLE.Polygon;

  function showMap(geojson) {
    mapSection.classList.add('show');
    setTimeout(() => {
      if (!leafletMap) {
        leafletMap = L.map('mapPreview', { scrollWheelZoom: true, attributionControl: false, zoomControl: true });
        const dark = !document.body.classList.contains('light-mode');
        tileLayer = L.tileLayer(dark ? TILES.dark : TILES.light, { maxZoom: 19 }).addTo(leafletMap);
      }
      if (geoJsonLayer) leafletMap.removeLayer(geoJsonLayer);
      geoJsonLayer = L.geoJSON(geojson, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, styleFor(f.geometry.type)),
        style: f => styleFor(f.geometry.type),
        onEachFeature: (f, layer) => {
          const name = f.properties && (f.properties.name || f.properties.Name);
          if (name) {                       // textContent: evita HTML injetado pelo KML
            const el = document.createElement('strong');
            el.textContent = String(name);
            layer.bindPopup(el);
          }
        }
      }).addTo(leafletMap);
      leafletMap.invalidateSize();
      const b = geoJsonLayer.getBounds();
      if (b.isValid()) {
        leafletMap.fitBounds(b, { padding: [50, 50] });
        const c = b.getCenter();
        mapExtent.textContent = `${c.lat.toFixed(4)}° ${c.lng.toFixed(4)}°`;
      }
    }, 100);
  }

  /* ------------------------------------------------------------- conversão */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  convertBtn.addEventListener('click', async () => {
    if (!currentGeoJSON) { showStatus('Carregue um arquivo KML primeiro', true); return; }
    convertBtn.disabled = true;
    convertBtn.textContent = '⏳ Convertendo...';
    showStatus('🔄 Gerando shapefiles...');
    try {
      const result = C.convert(currentGeoJSON, currentBaseName, { mode: geometryMode, dropStyle: dropStyle.checked });
      const zip = new JSZip();
      for (const f of result.files) zip.file(f.name, f.data);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      download(blob, currentBaseName + '.zip');
      const resumo = result.layers.map(l => `${l.name}.shp (${l.records})`).join(', ');
      showStatus(`✓ ${currentBaseName}.zip gerado: ${resumo}`);
      convertBtn.textContent = '✓ Concluído!';
      setTimeout(() => { convertBtn.textContent = '🚀 Gerar Shapefile (.zip)'; }, 2000);
    } catch (err) {
      showStatus('❌ Erro: ' + err.message, true);
      convertBtn.textContent = '🚀 Gerar Shapefile (.zip)';
    } finally {
      convertBtn.disabled = false;
    }
  });
})();
