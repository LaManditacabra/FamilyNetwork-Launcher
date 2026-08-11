// src/renderer/js/mods.js
// Ventana de Mods: catálogo vertical estilo TLauncher (tarjetas de ítem)
// con Fabric + búsqueda/instalación desde Modrinth.

// ---- Schema de ítem del catálogo ----
// Cada tarjeta usa: { id, title, author, description, thumbnailUrl,
//   downloads, updatedAt, mcVersion, tags, isInstalled }
// searchHitsToCatalog() adapta las respuestas del API de Modrinth a este schema.

// Datos de ejemplo (igual schema que el catálogo) para previsualizar la lista
// antes de hacer una búsqueda real.
const SAMPLE_CATALOG = [
  {
    id: 'sample-gunpack',
    title: 'Ultimate Gun Pack',
    author: 'nythraxx_exe',
    description: 'Añade decenas de armas realistas, munición y recámaras personalizables. Compatible con servidores modificados y arranca directo con Fabric.',
    thumbnailUrl: '',
    downloads: 1000000,
    updatedAt: '2025-12-26T00:00:00Z',
    mcVersion: '1.20.1',
    tags: ['combat', 'fabric', 'guns'],
    loaders: ['fabric'],
    isInstalled: false
  },
  {
    id: 'sample-sodium',
    title: 'Sodium',
    author: 'jellysquid3',
    description: 'Motor de renderizado moderno que duplica los FPS y reduce stutter. El mod de rendimiento más usado de Fabric.',
    thumbnailUrl: '',
    downloads: 203381177,
    updatedAt: '2026-07-02T00:00:00Z',
    mcVersion: '1.21.1',
    tags: ['performance', 'fabric', 'client'],
    loaders: ['fabric'],
    isInstalled: false
  },
  {
    id: 'sample-lithium',
    title: 'Lithium',
    author: 'jellysquid3',
    description: 'Mejoras generales de lógica del servidor y del mundo sin cambiar el comportamiento del juego.',
    thumbnailUrl: '',
    downloads: 154890210,
    updatedAt: '2026-06-18T00:00:00Z',
    mcVersion: '1.21.1',
    tags: ['performance', 'fabric', 'server'],
    loaders: ['fabric'],
    isInstalled: false
  },
  {
    id: 'sample-create',
    title: 'Create',
    author: 'simibubi',
    description: 'Automatización estética y mecánica redstone avanzada con engranajes, cintas transportadoras y mucho más.',
    thumbnailUrl: '',
    downloads: 98765432,
    updatedAt: '2025-11-09T00:00:00Z',
    mcVersion: '1.20.1',
    tags: ['create', 'tech', 'fabric'],
    loaders: ['fabric'],
    isInstalled: false
  },
  {
    id: 'sample-journeymap',
    title: 'JourneyMap',
    author: 'techbrew',
    description: 'Mapa en tiempo real con waypoints, mundos del servidor y soporte de minimapa.',
    thumbnailUrl: '',
    downloads: 241000000,
    updatedAt: '2026-05-30T00:00:00Z',
    mcVersion: '1.21.1',
    tags: ['map', 'utility'],
    loaders: ['forge', 'fabric', 'neoforge'],
    isInstalled: false
  }
];

window.onerror = (msg) => {
  const s = document.getElementById('status');
  if (s) s.textContent = 'Error de script: ' + msg;
};

window.addEventListener('DOMContentLoaded', () => {
  if (typeof window.api === 'undefined') {
    document.getElementById('status').textContent =
      'Error: la API no está disponible (revisa el preload / main process).';
    return;
  }

  const statusEl = document.getElementById('status');
  const versionSelect = document.getElementById('mods-version');
  const loaderFilterEl = document.getElementById('mods-loader-filter');
  const searchInput = document.getElementById('mods-search-input');
  const btnSearch = document.getElementById('btn-mods-search');
  const resultsEl = document.getElementById('mods-list');
  const installedEl = document.getElementById('mods-installed');
  const modsStatusEl = document.getElementById('mods-status');

  const LOADER_LABEL = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };

  const setStatus = (msg) => { statusEl.textContent = msg; };
  const setModsStatus = (msg) => { modsStatusEl.textContent = msg; };

  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Favoritos (estado local de la ventana).
  let favs = new Set();
  try { favs = new Set(JSON.parse(localStorage.getItem('tl-mod-favs') || '[]')); } catch { favs = new Set(); }

  // Resultados en bruto del último fetch (para poder filtrarlos por loader).
  let lastHits = [];
  let previewMode = false;

  // Versión base de Minecraft de la versión elegida (saca el sufijo del loader).
  const baseGameVersion = () => {
    const v = versionSelect.value || '';
    const i = v.search(/-(fabric|forge|neoforge)-\S+/);
    return i === -1 ? v : v.slice(0, i);
  };

  // ---- Formato de metadatos ----
  function formatDownloads(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' mill.';
    if (n >= 1e3) return (n / 1e3).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' k';
    return String(n);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Adapta hits del API de Modrinth al schema del catálogo.
  function searchHitsToCatalog(hits, mcVersion) {
    return hits.map((h) => ({
      id: h.id,
      title: h.title,
      author: h.author,
      description: h.description,
      thumbnailUrl: h.thumbnailUrl,
      downloads: h.downloads,
      updatedAt: h.updatedAt,
      mcVersion,
      tags: (h.tags || []).slice(0, 4),
      loaders: h.loaders || [],
      isInstalled: false
    }));
  }

  function toggleFav(star, id) {
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    star.classList.toggle('fav', favs.has(id));
    try { localStorage.setItem('tl-mod-favs', JSON.stringify([...favs])); } catch { /* sin storage */ }
  }

  // ---- Componente Item Card (estilo TLauncher) ----
  function catalogCard(item, handlers) {
    const card = document.createElement('div');
    card.className = 'icc' + (item.isInstalled ? ' installed' : '');

    const thumbOk = item.thumbnailUrl && /^https?:\/\//i.test(item.thumbnailUrl);
    const thumb = thumbOk
      ? '<img src="' + escapeHtml(item.thumbnailUrl) + '" alt="">'
      : '<span class="icc-ph">M</span>';

    card.innerHTML =
      '<div class="icc-side">' +
        '<div class="icc-thumb">' + thumb + '</div>' +
        '<button class="icc-install" data-id="' + escapeHtml(item.id) + '">' +
          (item.isInstalled ? 'Instalado' : 'Instalar') +
        '</button>' +
      '</div>' +
      '<div class="icc-body">' +
        '<div class="icc-head">' +
          '<h3 class="icc-title">' + escapeHtml(item.title) + '</h3>' +
          '<div class="icc-tags">' +
            (item.tags || []).map((t) => '<span class="icc-tag">' + escapeHtml(t) + '</span>').join('') +
          '</div>' +
        '</div>' +
        '<div class="icc-author">Autor: ' + escapeHtml(item.author || '—') + '</div>' +
        '<p class="icc-desc">' + escapeHtml(item.description || '') + '</p>' +
        '<div class="icc-foot">' +
          '<span class="icc-meta">Descargas <b>' + formatDownloads(item.downloads) + '</b></span>' +
          '<span class="icc-meta">Actualizado <b>' + formatDate(item.updatedAt) + '</b></span>' +
          '<span class="icc-meta">MC <b>' + escapeHtml(item.mcVersion) + '</b></span>' +
          (item.loaders && item.loaders.length
            ? '<span class="icc-meta">Loader <b>' + escapeHtml(item.loaders.map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join(' · ')) + '</b></span>'
            : '') +
          '<button class="icc-star' + (favs.has(item.id) ? ' fav' : '') + '" title="Favorito">★</button>' +
        '</div>' +
      '</div>';

    const installBtn = card.querySelector('.icc-install');
    installBtn.addEventListener('click', () => handlers.onInstall(item, installBtn));

    const star = card.querySelector('.icc-star');
    star.addEventListener('click', () => toggleFav(star, item.id));

    return card;
  }

  function renderCatalog(items, handlers) {
    resultsEl.innerHTML = '';
    for (const item of items) resultsEl.appendChild(catalogCard(item, handlers));
  }

  // ---- Controles de ventana (frame: false) ----
  document.getElementById('btn-min').addEventListener('click', () => window.api.win.minimize());
  document.getElementById('btn-max').addEventListener('click', () => window.api.win.toggleMaximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.win.close());

  async function populateVersions() {
    try {
      const versions = await window.api.getVersions(false);
      versionSelect.innerHTML = '';
      for (const v of versions) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.id;
        versionSelect.appendChild(opt);
      }
      setStatus(versions.length + ' versiones disponibles');
    } catch (e) {
      setStatus('Error al cargar versiones: ' + e.message);
    }
  }

  // El filtro por loader aplica sobre el último resultado (client-side).
  function visibleHits() {
    const f = loaderFilterEl.value;
    if (f === 'todos') return lastHits;
    return lastHits.filter((h) => (h.loaders || []).includes(f));
  }

  function renderResults() {
    const hits = visibleHits();
    if (!hits.length) {
      resultsEl.innerHTML = '<p class="mods-hint">Sin mods compatibles con el filtro actual. Cambiá el loader o probá otra búsqueda.</p>';
      if (previewMode) {
        const hint = document.createElement('p');
        hint.className = 'mods-hint sample-hint';
        hint.textContent = 'Vista previa con datos de ejemplo. Buscá un mod arriba para ver el catálogo real de Modrinth.';
        resultsEl.appendChild(hint);
      }
      return;
    }
    renderCatalog(searchHitsToCatalog(hits, baseGameVersion()), { onInstall: previewMode ? fakeOnInstall : realOnInstall });
    if (previewMode) {
      const hint = document.createElement('p');
      hint.className = 'mods-hint sample-hint';
      hint.textContent = 'Vista previa con datos de ejemplo. Buscá un mod arriba para ver el catálogo real de Modrinth.';
      resultsEl.appendChild(hint);
    }
  }

  async function refreshInstalled() {
    installedEl.innerHTML = '';
    try {
      const items = await window.api.mods.list();
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'mods-hint';
        li.textContent = 'Todavía no hay mods. Buscá en el catálogo e instalá alguno.';
        installedEl.appendChild(li);
        return;
      }
      for (const m of items) {
        const li = document.createElement('li');
        const size = m.size >= 1048576
          ? (m.size / 1048576).toFixed(1) + ' MB'
          : Math.max(1, Math.round(m.size / 1024)) + ' KB';
        const btn = document.createElement('button');
        btn.className = 'btn-ghost btn-mod-remove';
        btn.textContent = 'Quitar';
        btn.addEventListener('click', async () => {
          try {
            await window.api.mods.remove(m.filename);
            setModsStatus('Mod quitado: ' + m.filename);
            await refreshInstalled();
          } catch (e) {
            setModsStatus('No se pudo quitar: ' + e.message);
          }
        });
        const span = document.createElement('span');
        span.textContent = m.filename + ' · ' + size;
        li.appendChild(span);
        li.appendChild(btn);
        installedEl.appendChild(li);
      }
    } catch (e) {
      setModsStatus('No se pudo listar: ' + e.message);
    }
  }

  async function realOnInstall(item, btn) {
    const v = baseGameVersion();
    if (!v || v === 'Cargando…') { setModsStatus('Elegí una versión de juego'); return; }
    btn.disabled = true;
    btn.textContent = 'Descargando…';
    try {
      // Si el juego ya tiene un loader instalado, ese es el preferido; si no,
      // el proceso principal elige y auto-instala el requisito del mod.
      let prefLoader = '';
      try {
        const st = await window.api.mods.loaderState(v);
        prefLoader = (st && st[0] && st[0].type) || '';
      } catch { /* sin loader instalado */ }
      const r = await window.api.mods.install(item.id, v, prefLoader);
      item.isInstalled = true;
      btn.classList.add('inst');
      btn.textContent = 'Instalado';
      const loaderNote = r.loaderInstalled
        ? ' (requisito ' + (LOADER_LABEL[r.loader] || r.loader) + ' instalado automáticamente)'
        : (r.loader && r.loader !== 'vanilla' ? ' para ' + (LOADER_LABEL[r.loader] || r.loader) : '');
      const depNote = r.depsCount > 0 ? ' + ' + r.depsCount + ' dependencia(s)' : '';
      const missNote = (r.missingDeps && r.missingDeps.length)
        ? ' — ' + r.missingDeps.length + ' dependencia(s) sin versión para ' + v
        : '';
      setModsStatus('Mod instalado: ' + r.filename + ' (' + r.version + ')' + loaderNote + depNote + missNote);
      await refreshInstalled();
    } catch (e) {
      setModsStatus('No se pudo instalar: ' + e.message);
      btn.disabled = false;
      btn.textContent = 'Instalar';
      btn.classList.remove('inst');
    }
  }

  function fakeOnInstall() {
    setModsStatus('Ese es un dato de ejemplo — buscá un mod real para instalar');
  }

  async function runSearch() {
    const v = baseGameVersion();
    const q = searchInput.value.trim();
    if (!v || v === 'Cargando…') { setModsStatus('Elegí una versión de juego'); return; }
    if (!q) { setModsStatus('Escribí qué mod buscás'); return; }

    previewMode = false;
    setModsStatus('Buscando "' + q + '" en Modrinth…');
    try {
      const { hits } = await window.api.mods.search(q, v);
      lastHits = hits;
      if (!hits.length) {
        resultsEl.innerHTML = '<p class="mods-hint">Sin mods compatibles con ' + escapeHtml(v) + '. Probalo con otra versión.</p>';
        setModsStatus('Sin resultados');
        return;
      }
      renderResults();
      const shown = visibleHits().length;
      setModsStatus(
        shown + (shown !== hits.length ? ' de ' + hits.length : '') + ' mods para "' + q + '" en ' + v
      );
    } catch (e) {
      setModsStatus('Error de búsqueda: ' + e.message);
    }
  }

  btnSearch.addEventListener('click', runSearch);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  versionSelect.addEventListener('change', () => {
    resultsEl.innerHTML = '';
    lastHits = [];
    if (searchInput.value.trim()) runSearch(); else renderResults();
  });
  loaderFilterEl.addEventListener('change', () => {
    if (previewMode || lastHits.length) renderResults();
  });

  window.api.onProgress((p) => {
    const label = {
      'fabric': 'descargando Fabric',
      'fabric-libs': 'libs de Fabric',
      'loader-download': 'descargando instalador',
      'loader-install': 'instalando loader',
      'mods': 'descargando mod',
      'java': 'preparando Java'
    }[p.phase];
    if (label) {
      const pct = p.total ? Math.round((p.current / p.total) * 100) : null;
      setModsStatus(label + (pct !== null ? ': ' + pct + '%' : '…'));
    }
  });

  // Vista previa del catálogo con datos de ejemplo mientras no se buscó.
  populateVersions().then(() => {
    previewMode = true;
    lastHits = SAMPLE_CATALOG;
    renderResults();
    if (baseGameVersion()) refreshInstalled();
  });
});