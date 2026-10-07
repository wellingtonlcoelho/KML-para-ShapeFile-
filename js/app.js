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
  let backgroundStatus = { message: 'Carregando mapa de fundo', error: false };
  const OSM = {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  };

  function applyTheme(theme) {
    const dark = theme !== 'light';
    document.body.classList.toggle('light-mode', !dark);
    themeToggle.textContent = dark ? '🌙 Escuro' : '☀️ Claro';

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
  let loadVersion = 0, converting = false;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  convertBtn.disabled = true;

  function showStatus(msg, isError) {
    statusMessage.textContent = msg;
    statusMessage.classList.add('show');
    statusMessage.classList.toggle('error', !!isError);
  }

  /* ---------------------------------------------------------------- modos */
  const MODE_TEXT = {
    simple: 'Um registro por polígono ou linha, repetindo os atributos nas partes separadas.',
    feature: 'Um registro por Placemark em cada camada de linhas ou polígonos, preservando os atributos.',
    single: 'Um registro por camada de linhas ou polígonos. Somente o nome do arquivo é mantido como atributo. Pontos não são agrupados.'
  };

  function recordsFor(mode) {
    const poly = currentItems.filter(i => i.kind === 'polygon');
    if (!poly.length) return null;
    if (mode === 'simple') return poly.reduce((s, i) => s + i.polys.length, 0);
    if (mode === 'feature') return new Set(poly.map(i => i.featureId)).size;
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
  uploadZone.addEventListener('click', e => { if (e.target !== fileInput && !converting) fileInput.click(); });
  uploadZone.addEventListener('keydown', e => {
    if (!converting && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fileInput.click(); }
  });
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-active'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-active'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-active');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    fileInput.value = '';
    if (file) handleFile(file);
  });

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
    if (converting) return;
    const version = ++loadVersion;
    currentGeoJSON = null;
    currentItems = [];
    convertBtn.disabled = true;
    mapSection.classList.remove('show');
    legendSection.classList.remove('show');
    geometryOptions.classList.remove('show');
    metricFeatures.textContent = metricGeometries.textContent = metricLayers.textContent = '0';
    statusReady.textContent = 'Aguardando arquivo válido';
    statusReady.classList.add('inactive');
    statusMap.textContent = 'Sem mapa';
    statusMap.classList.add('inactive');
    uploadTitle.textContent = file.name;
    uploadSubtitle.textContent = 'clique para trocar';
    showStatus('📖 Lendo arquivo...');
    try {
      if (!/\.(kml|kmz)$/i.test(file.name)) throw new Error('Selecione um arquivo .kml ou .kmz');
      if (file.size > MAX_FILE_BYTES) throw new Error('O limite por arquivo é de 50 MB');
      if (typeof toGeoJSON === 'undefined' || typeof JSZip === 'undefined') {
        throw new Error('As bibliotecas de leitura não carregaram. Verifique sua conexão e recarregue a página');
      }
      const text = await kmlTextFrom(file);
      if (version !== loadVersion) return;
      if (text.length > MAX_FILE_BYTES) throw new Error('O KML extraído excede o limite de 50 milhões de caracteres');
      const xml = new DOMParser().parseFromString(text, 'text/xml');
      if (xml.querySelector('parsererror')) throw new Error('XML inválido');
      if (!xml.documentElement || xml.documentElement.localName.toLowerCase() !== 'kml') throw new Error('O documento não é um KML');
      const geojson = toGeoJSON.kml(xml);
      const { items, skipped } = C.normalize(geojson);
      if (!items.length) { showStatus('❌ Nenhuma geometria válida encontrada', true); return; }
      currentGeoJSON = geojson;
      currentItems = items;
      currentBaseName = C.slug(file.name.replace(/\.(kml|kmz)$/i, ''));
      convertBtn.disabled = false;
      analyzeAndShow(geojson, items, skipped);
    } catch (err) {
      if (version !== loadVersion) return;
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

    legendSection.classList.add('show');
    geometryOptions.classList.add('show');
    renderModeHint();
    showMap(previewGeoJSON(items), loadVersion);
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

  function previewGeoJSON(items) {
    return { type: 'FeatureCollection', features: items.map(i => ({
      type: 'Feature', properties: i.properties,
      geometry: i.kind === 'point' ? { type: 'Point', coordinates: i.coords } :
        i.kind === 'multipoint' ? { type: 'MultiPoint', coordinates: i.coords } :
        i.kind === 'line' ? { type: 'MultiLineString', coordinates: i.lines } :
        { type: 'MultiPolygon', coordinates: i.polys }
    })) };
  }

  function showMap(geojson, version) {
    if (typeof L === 'undefined') {
      statusMap.textContent = 'Mapa indisponível; conversão disponível';
      return;
    }
    mapSection.classList.add('show');
    setTimeout(() => {
      if (version !== loadVersion) return;
      try {
      if (!leafletMap) {
        leafletMap = L.map('mapPreview', { scrollWheelZoom: true, attributionControl: true, zoomControl: true });
        reloadTiles();
      }
      if (geoJsonLayer) leafletMap.removeLayer(geoJsonLayer);
      geoJsonLayer = L.geoJSON(geojson, {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, styleFor(f.geometry.type)),
        style: f => styleFor(f.geometry.type),
        onEachFeature: (f, layer) => {
          const props = f.properties || {};
          const name = props.name || props.Name || 'Feição sem nome';
          const tooltip = document.createElement('span');
          tooltip.textContent = String(name);
          layer.bindTooltip(tooltip, { sticky: true });
          const popup = document.createElement('div');
          popup.className = 'feature-info';
          const title = document.createElement('strong');
          title.textContent = String(name);
          const type = document.createElement('p');
          type.textContent = 'Geometria: ' + ({ Point: 'Ponto', MultiPoint: 'Multipontos', MultiLineString: 'Linha', MultiPolygon: 'Polígono' }[f.geometry.type] || f.geometry.type);
          const details = document.createElement('dl');
          for (const [key, value] of Object.entries(props)) {
            if (/^(name|style.*|stroke.*|fill.*|icon|marker.*|visibility|open|_.*)$/i.test(key) || value == null || value === '' || typeof value === 'object') continue;
            const label = document.createElement('dt');
            label.textContent = key === 'description' ? 'Descrição' : key;
            const text = document.createElement('dd');
            text.textContent = key === 'description' ? String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : String(value);
            details.append(label, text);
          }
          popup.append(title, type, details);
          layer.bindPopup(popup, { maxWidth: 340 });
        }
      }).addTo(leafletMap);
      leafletMap.invalidateSize();
      const b = geoJsonLayer.getBounds();
      if (b.isValid()) {
        leafletMap.fitBounds(b, { padding: [50, 50], maxZoom: 16 });
        const c = b.getCenter();
        mapExtent.textContent = `${c.lat.toFixed(4)}° ${c.lng.toFixed(4)}°`;
      }
      statusMap.textContent = backgroundStatus.message;
      statusMap.classList.toggle('inactive', backgroundStatus.error);
      } catch (err) {
        console.warn('Não foi possível exibir a pré-visualização do mapa:', err);
        statusMap.textContent = 'Mapa indisponível; conversão disponível';
        statusMap.classList.add('inactive');
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

  /* ------------------------------------------------- mapa OpenStreetMap */
  function reloadTiles() {
    if (!leafletMap) return;
    const cfg = OSM;
    if (tileLayer) { leafletMap.removeLayer(tileLayer); tileLayer.off(); }
    const layer = L.tileLayer(cfg.url, {
      maxNativeZoom: 19,
      maxZoom: 22, attribution: cfg.attribution
    });
    tileLayer = layer;
    let failures = 0, loaded = 0;
    const report = (message, error) => {
      backgroundStatus = { message, error: !!error };
      statusMap.textContent = message;
      statusMap.classList.toggle('inactive', !!error);
      $('mapNotice').textContent = error ? message + '. As delimitações e a conversão continuam disponíveis.' : '';
    };
    report('Carregando mapa de fundo', false);
    layer.on('loading', () => {
      if (tileLayer !== layer) return;
      failures = loaded = 0;
      report('Carregando mapa de fundo', false);
    });
    layer.on('tileload', () => {
      if (tileLayer !== layer) return;
      loaded++;
      if (!failures) report('Mapa de fundo carregado', false);
    });
    layer.on('tileerror', () => {
      if (tileLayer !== layer) return;
      failures++;
      report('Falha no mapa de fundo — verifique a conexão e tente novamente', true);
    });
    layer.on('load', () => {
      if (tileLayer !== layer) return;
      if (failures) report(loaded ? 'Mapa de fundo carregado parcialmente — tente novamente' : 'Mapa de fundo indisponível — verifique a conexão', true);
      else if (loaded) report('Mapa de fundo carregado', false);
    });
    layer.addTo(leafletMap);
  }

  $('retryMapBtn').addEventListener('click', reloadTiles);

  convertBtn.addEventListener('click', async () => {
    if (converting) return;
    if (!currentGeoJSON) { showStatus('Carregue um arquivo KML primeiro', true); return; }
    convertBtn.disabled = true;
    converting = true;
    fileInput.disabled = true;
    convertBtn.textContent = '⏳ Convertendo...';
    showStatus('🔄 Gerando shapefiles...');
    try {
      const result = C.convert(currentGeoJSON, currentBaseName, { mode: geometryMode, dropStyle: dropStyle.checked });
      const zip = new JSZip();
      for (const f of result.files) zip.file(f.name, f.data);
      zip.file('campos.json', JSON.stringify(result.layers.map(l => ({ camada: l.name, campos: l.fieldMapping })), null, 2));
      if (result.warnings.length) zip.file('avisos.txt', result.warnings.join('\n'));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      download(blob, currentBaseName + '.zip');
      const resumo = result.layers.map(l => `${l.name}.shp (${l.records})`).join(', ');
      showStatus(`✓ ${currentBaseName}.zip gerado: ${resumo}` + (result.warnings.length ? ' — Há campos truncados; consulte avisos.txt no ZIP.' : ''));
      convertBtn.textContent = '✓ Concluído!';
      setTimeout(() => { convertBtn.textContent = '🚀 Gerar Shapefile (.zip)'; }, 2000);
    } catch (err) {
      showStatus('❌ Erro: ' + err.message, true);
      convertBtn.textContent = '🚀 Gerar Shapefile (.zip)';
    } finally {
      converting = false;
      fileInput.disabled = false;
      convertBtn.disabled = false;
    }
  });
})();
