// src/renderer/js/app.js
// Lógica de la interfaz: login, perfiles, versiones, avatar y lanzamiento.
// Toda la inicialización ocurre en DOMContentLoaded para garantizar que el
// DOM y window.api (del preload) ya estén listos.

// Muestra errores de script en la barra de estado (en lugar de callarlos).
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
  const heroStatus = document.getElementById('hero-status');
  const heroDot = document.getElementById('hero-dot');
  const versionSelect = document.getElementById('version-select');
  const btnPlay = document.getElementById('btn-play');
  const btnLatest = document.getElementById('btn-latest');
  const btnRemoveVersion = document.getElementById('btn-remove-version');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  // Perfiles
  const profileSelect = document.getElementById('profile-select');
  const profileName = document.getElementById('profile-name');
  const profileSkin = document.getElementById('profile-skin');
  const profileMemMin = document.getElementById('profile-mem-min');
  const profileMemMax = document.getElementById('profile-mem-max');
  const btnNewProfile = document.getElementById('btn-new-profile');
  const btnSaveProfile = document.getElementById('btn-save-profile');
  const btnDelProfile = document.getElementById('btn-del-profile');

  let latestRelease = null;
  let currentProfiles = [];
  let installedIds = new Set();

  const setStatus = (msg) => { statusEl.textContent = msg; };

  // Llena el select de skins con las opciones predefinidas.
  function populateSkinSelect() {
    if (!profileSkin) return;
    const skins = window.SKINS || [];
    profileSkin.innerHTML = '';
    for (const s of skins) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      profileSkin.appendChild(opt);
    }
  }

  // Sincroniza el sub-título del botón JUGAR con la versión elegida.
  function syncPlaySub() {
    const sub = document.getElementById('btn-play-sub');
    if (sub) sub.textContent = versionSelect.value || 'Seleccioná una versión';
  }

  function populateVersionSelect(el, versions, installed) {
    const prev = el.value;
    el.innerHTML = '';
    for (const v of versions) {
      const opt = document.createElement('option');
      const isInst = installed && installed.has(v.id);
      opt.value = v.id;
      opt.textContent = isInst
        ? `${v.id} (${v.type}) · instalada`
        : `${v.id} (${v.type})`;
      el.appendChild(opt);
    }
    if (prev && versions.some((v) => v.id === prev)) {
      el.value = prev;
    } else {
      // Preselecciona la última release estable si no había selección previa.
      const release = versions.find((v) => v.type === 'release');
      if (release) el.value = release.id;
    }
    syncPlaySub();
  }

  async function loadVersions(quiet = false) {
    try {
      const versions = await window.api.getVersions(false);
      try {
        const installed = await window.api.installedVersions();
        installedIds = new Set((installed || []).map((v) => v.id));
        const countEl = document.getElementById('installed-count');
        if (countEl) countEl.textContent = installedIds.size;
      } catch { /* sin datos de instaladas */ }
      populateVersionSelect(versionSelect, versions, installedIds);
      const latest = await window.api.getLatest();
      latestRelease = latest.release;
      if (!quiet) setStatus(`${versions.length} versiones · última: ${latestRelease}`);
      return versions;
    } catch (e) {
      if (!quiet) setStatus('Error al cargar versiones: ' + e.message);
      return [];
    }
  }

  // Al volver de la ventana de mods quizá se instaló Fabric: refrescá la lista
  // de versiones en silencio para que la versión fabric aparezca en JUGAR.
  window.addEventListener('focus', () => loadVersions(true));

  async function loadProfiles() {
    try {
      const { profiles, selected } = await window.api.profiles.list();
      currentProfiles = profiles;
      profileSelect.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '(nuevo perfil…)';
      profileSelect.appendChild(none);
      for (const p of profiles) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name || p.versionId || p.id}`;
        profileSelect.appendChild(opt);
      }
      if (selected) profileSelect.value = selected;
      return profiles;
    } catch (e) {
      setStatus('Error al cargar perfiles: ' + e.message);
      return [];
    }
  }

  // Al elegir un perfil guardado, carga sus datos en el formulario.
  // La skin NO se carga del perfil: el selector de skins es independiente.
  function applyProfileToForm(profiles) {
    const id = profileSelect.value;
    if (!id) {
      profileName.value = '';
      profileMemMin.value = 1024;
      profileMemMax.value = 4096;
      return;
    }
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    profileName.value = p.name || '';
    profileMemMin.value = (p.memory && p.memory.min) || 1024;
    profileMemMax.value = (p.memory && p.memory.max) || 4096;
  }

  // ---- Galería visual de skins (previz de la skin antes de jugar) ----
// Dibuja la figura de la skin en vista frontal clásica: cada parte se extrae
// de su región "front" de la textura 64x64 y se compone de frente como en el
// juego (cabeza/torso/brazos/piernas). image-rendering pixelado = aspecto MC.
// Cada parte: { tex:[sx,sy,sw,sh], x, y } (posición en texels, fig. 16x32).
const FRONT_PART = [
  { tex: [36, 52, 4, 12], x: 0,  y: 8,  lab: 'brazo' },  // Left Arm front
  { tex: [44, 20, 4, 12], x: 12, y: 8,  lab: 'brazo' },  // Right Arm front
  { tex: [20, 52, 4, 12], x: 4,  y: 20, lab: 'pierna' }, // Left Leg front
  { tex: [4, 20, 4, 12],  x: 8,  y: 20, lab: 'pierna' },  // Right Leg front
  { tex: [20, 20, 8, 12], x: 4,  y: 8,  lab: 'torso' },   // Body front
  { tex: [8, 8, 8, 8],    x: 4,  y: 0,  lab: 'cabeza' }   // Head front
];
const FRONT_W = 16;
const FRONT_H = 32;

function drawFigure(ctx, img, s) {
  const W = FRONT_W * s + s * 2;
  const H = FRONT_H * s + s * 2;
  if (ctx.canvas.width !== W) ctx.canvas.width = W;
  if (ctx.canvas.height !== H) ctx.canvas.height = H;
  ctx.canvas.style.width = W + 'px';
  ctx.canvas.style.height = H + 'px';
  ctx.clearRect(0, 0, W, H);
  const ox = s;
  const oy = s;

  // Sombra suave bajo los pies.
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(ox + (FRONT_W / 2) * s, oy + FRONT_H * s - s, (FRONT_W / 2) * s * 0.8, s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.imageSmoothingEnabled = false;
  for (const { tex, x, y } of FRONT_PART) {
    const [tx, ty, tw, th] = tex;
    if (img) {
      ctx.drawImage(img, tx, ty, tw, th, ox + x * s, oy + y * s, tw * s, th * s);
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fillRect(ox + x * s, oy + y * s, tw * s, th * s);
    }
  }
}

  // Regiones del skin → URL/textura (backend Yggdrasil, misma fuente que el juego).
  let skinsApiBase = '';
  const skinImgCache = new Map(); // id de skin -> { url, img }

  async function fetchSkinTexture(name) {
    if (!skinsApiBase || !name) return null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(skinsApiBase + '/api/skin/' + encodeURIComponent(name), { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = await res.json();
      return data.ok ? data.url : null;
    } catch {
      return null;
    }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function getSkinImg(id) {
    const s = window.SKINS.find((x) => x.id === id);
    if (!s || !s.name) return null;
    let ent = skinImgCache.get(id);
    if (!ent) {
      const url = await fetchSkinTexture(s.name);
      if (!url) return null;
      try {
        const img = await loadImage(url);
        ent = { url, img };
        skinImgCache.set(id, ent);
      } catch {
        return null;
      }
    }
    return ent.img;
  }

  const skinGrid = document.getElementById('skin-grid');
  const skinBig = document.getElementById('skin-big');
  const skinBigName = document.getElementById('skin-big-name');
  const skinBigSub = document.getElementById('skin-big-sub');
  const btnUseSkin = document.getElementById('btn-use-skin');
  const skinUseStatus = document.getElementById('skin-use-status');
  const btnRandomSkin = document.getElementById('btn-random-skin');
  const skinFieldThumb = document.getElementById('skin-field-thumb');
  const skinFieldName = document.getElementById('skin-field-name');
  let selectedSkinId = profileSkin.value || '';

  async function drawSkinBig(id) {
    const ctx = skinBig.getContext('2d');
    const sel = window.SKINS.find((x) => x.id === id);
    const img = id && sel && sel.name ? await getSkinImg(id) : null;
    drawFigure(ctx, img, 6);
    if (img) {
      skinBigName.textContent = sel.label;
      skinBigSub.textContent = 'Skin de ' + sel.name;
    } else if (sel && sel.name) {
      skinBigName.textContent = sel.label;
      skinBigSub.textContent = 'Sin red / sin skin — se usa la por defecto';
    } else {
      skinBigName.textContent = 'Por defecto';
      skinBigSub.textContent = 'La skin que te pone el servidor';
    }
  }

  // Mini figura de la skin del perfil (chip, sidebar).
  async function syncSkinField(id) {
    if (!skinFieldThumb) return;
    const sel = window.SKINS.find((x) => x.id === id);
    const img = sel && sel.name ? await getSkinImg(id) : null;
    drawFigure(skinFieldThumb.getContext('2d'), img, 2);
    if (skinFieldName) {
      skinFieldName.textContent = sel && sel.label ? sel.label : 'Por defecto';
    }
  }

  // Estado del botón "Usar en el perfil" y texto de ayuda.
  function updateUseButton(id) {
    const sel = window.SKINS.find((x) => x.id === id);
    btnUseSkin.disabled = !(sel && sel.name);
    skinUseStatus.textContent = btnUseSkin.disabled
      ? 'Elegí una skin de la galería'
      : (sel ? sel.label : '') + ' — presioná "Usar en el perfil"';
  }

  async function useSkin() {
    const id = profileSkin.value || '';
    const sel = window.SKINS.find((x) => x.id === id);
    if (!sel || !sel.name) {
      skinUseStatus.textContent = 'Elegí una skin de la galería primero';
      return;
    }
    try {
      // Aplicar = elegirla como skin global (independiente del perfil).
      await window.api.setSkin(id);
      profileSkin.value = id;
      selectedSkinId = id;
      for (const tile of skinGrid.querySelectorAll('.skin-tile')) {
        tile.classList.toggle('selected', tile.dataset.id === id);
      }
      drawSkinBig(id);
      syncSkinField(id);
      skinUseStatus.textContent = sel.label + ' aplicada como skin actual';
      setStatus(skinUseStatus.textContent);
    } catch (e) {
      skinUseStatus.textContent = 'No se pudo usar: ' + e.message;
    }
  }

  function randomSkin() {
    const byName = window.SKINS.filter((s) => s.name);
    if (!byName.length) return;
    const pick = byName[Math.floor(Math.random() * byName.length)];
    selectSkin(pick.id);
    skinUseStatus.textContent = 'Sorpresa: ' + pick.label + ' — presioná "Usar en el perfil"';
  }

  function buildSkinGallery() {
    if (!skinGrid) return;
    skinGrid.innerHTML = '';
    const current = selectedSkinId || profileSkin.value || '';
    for (const s of window.SKINS) {
      const tile = document.createElement('div');
      tile.className = 'skin-tile' + ((s.id === current) ? ' selected' : '');
      tile.dataset.id = s.id;
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 128;
      cv.className = 'skin-thumb';
      const span = document.createElement('span');
      span.textContent = s.label;
      const ctx = cv.getContext('2d');
      tile.appendChild(cv);
      tile.appendChild(span);
      tile.addEventListener('click', () => selectSkin(s.id));

      (async () => {
        if (s.name) {
          const img = await getSkinImg(s.id);
          if (img) drawFigure(ctx, img, 3);
          else {
            tile.classList.add('no-img');
            drawFigure(ctx, null, 3);
            span.classList.add('op');
          }
        } else {
          drawFigure(ctx, null, 3);
        }
      })();

      skinGrid.appendChild(tile);
    }
    drawSkinBig(current);
    updateUseButton(current);
    syncSkinField(current);
  }

  function selectSkin(id) {
    selectedSkinId = id;
    if (profileSkin) profileSkin.value = id;
    for (const tile of skinGrid.querySelectorAll('.skin-tile')) {
      tile.classList.toggle('selected', tile.dataset.id === id);
    }
    drawSkinBig(id);
    updateUseButton(id);
    syncSkinField(id);
    setStatus(id ? 'Skin elegida: ' + id : 'Skin por defecto');
  }

  function syncSkinFromSelect() {
    const id = profileSkin.value || '';
    selectedSkinId = id;
    for (const tile of skinGrid.querySelectorAll('.skin-tile')) {
      tile.classList.toggle('selected', tile.dataset.id === id);
    }
    drawSkinBig(id);
    updateUseButton(id);
    syncSkinField(id);
  }

// ---- Creador de skins: editor por vistas (frente / lados / atrás) ----
  // Editás sobre la figura del personaje; cada pixel se mapea a la región de
  // la textura 64x64 correspondiente. Guías muestran cada parte y su tamaño.
  const editorModal = document.getElementById('skin-editor');
  const editorCanvas = document.getElementById('editor-canvas');
  const editorPreview = document.getElementById('editor-preview');
  const editorName = document.getElementById('editor-name');
  const editorColor = document.getElementById('editor-color');
  const editorPalette = document.getElementById('editor-palette');
  const editorStatus = document.getElementById('editor-status');
  const editorViewsEl = document.getElementById('editor-views');
  const btnOpenEditor = document.getElementById('btn-open-editor');
  const btnEditorClose = document.getElementById('btn-editor-close');
  const btnEditorUpload = document.getElementById('btn-editor-upload');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnLoadSkin = document.getElementById('btn-load-skin');
  const btnClear = document.getElementById('btn-clear');
  const toolBrush = document.getElementById('tool-brush');
  const toolEraser = document.getElementById('tool-eraser');
  const toolFill = document.getElementById('tool-fill');

  const ED_SIZE = 64;
  const ED_PALETTE = [
    '#ffffff', '#1c1c1e', '#803d20', '#8a5a35', '#c94c1e',
    '#f2c7a8', '#e0ac82', '#b57d4a', '#7a4a2b', '#dce1e8',
    '#c70039', '#f5820d', '#ffdb00', '#a0d62f', '#2a9d6f',
    '#4ad6c4', '#3b91f5', '#8b5cf6', '#f26ba3', '#ffd84a'
  ];
  // Vistas: cada parte = { tex:[sx,sy,sw,sh] (región en la textura 64x64),
  // x,y (posición en la figura 16x32), name }. Basado en el layout estándar 1.8+.
  const ED_VIEWS = {
    front: { label: 'Frente', parts: [
      { tex: [8, 8, 8, 8],    x: 4,  y: 0,  name: 'Cabeza' },      // Head front
      { tex: [36, 52, 4, 12], x: 0,  y: 8,  name: 'Brazo izq' },    // Left Arm front
      { tex: [44, 20, 4, 12], x: 12, y: 8,  name: 'Brazo der' },    // Right Arm front
      { tex: [20, 20, 8, 12], x: 4,  y: 8,  name: 'Cuerpo' },      // Body front
      { tex: [20, 52, 4, 12], x: 4,  y: 20, name: 'Pierna izq' },   // Left Leg front
      { tex: [4, 20, 4, 12],  x: 8,  y: 20, name: 'Pierna der' }    // Right Leg front
    ]},
    sideL: { label: 'Lado izq', parts: [
      { tex: [16, 8, 8, 8],   x: 4, y: 0,  name: 'Cabeza' },       // Head left
      { tex: [40, 52, 4, 12], x: 2, y: 8,  name: 'Brazo izq' },     // Left Arm left
      { tex: [28, 20, 4, 12], x: 6, y: 8,  name: 'Cuerpo' },        // Body left
      { tex: [24, 52, 4, 12], x: 6, y: 20, name: 'Pierna izq' }     // Left Leg left
    ]},
    sideR: { label: 'Lado der', parts: [
      { tex: [0, 8, 8, 8],    x: 4, y: 0,  name: 'Cabeza' },       // Head right
      { tex: [40, 20, 4, 12], x: 2, y: 8,  name: 'Brazo der' },     // Right Arm right
      { tex: [16, 20, 4, 12], x: 6, y: 8,  name: 'Cuerpo' },        // Body right
      { tex: [0, 20, 4, 12],  x: 6, y: 20, name: 'Pierna der' }     // Right Leg right
    ]},
    back: { label: 'Atrás', parts: [
      { tex: [24, 8, 8, 8],   x: 4,  y: 0,  name: 'Cabeza' },       // Head back
      { tex: [44, 52, 4, 12], x: 0,  y: 8,  name: 'Brazo izq' },     // Left Arm back
      { tex: [52, 20, 4, 12], x: 12, y: 8,  name: 'Brazo der' },    // Right Arm back
      { tex: [32, 20, 8, 12], x: 4,  y: 8,  name: 'Cuerpo' },        // Body back
      { tex: [28, 52, 4, 12], x: 4,  y: 20, name: 'Pierna izq' },    // Left Leg back
      { tex: [12, 20, 4, 12], x: 8,  y: 20, name: 'Pierna der' }     // Right Leg back
    ]}
  };
  const hexToRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
  let edPixels = new Uint8ClampedArray(ED_SIZE * ED_SIZE * 4);
  let edColor = '#f2c7a8';
  let edTool = 'brush';
  let edView = 'front';
  let edUndo = [];
  let edRedo = [];
  let edLast = null;
  let edDrawing = false;

  const edClone = () => Uint8ClampedArray.from(edPixels);
  const edPushHistory = () => {
    if (edUndo.length >= 60) edUndo.shift();
    edUndo.push(edClone());
    edRedo.length = 0;
    btnUndo.disabled = !edUndo.length;
    btnRedo.disabled = true;
  };

  // Parte de la vista actual que contiene la celda de la figura (fx,fy).
  const edPartAt = (fx, fy) => {
    const v = ED_VIEWS[edView];
    for (const p of v.parts) {
      if (fx >= p.x && fx < p.x + p.tex[2] && fy >= p.y && fy < p.y + p.tex[3]) return p;
    }
    return null;
  };
  const edSetTexel = (tx, ty, color) => {
    const [r, g, b] = hexToRgb(color);
    const i = (ty * ED_SIZE + tx) * 4;
    edPixels[i] = r; edPixels[i + 1] = g; edPixels[i + 2] = b; edPixels[i + 3] = 255;
  };
  // Pincel/borrador: escribe el texel de la textura que corresponde a la celda.
  const edPaintAt = (fx, fy) => {
    const p = edPartAt(fx, fy);
    if (!p) return;
    const tx = p.tex[0] + (fx - p.x);
    const ty = p.tex[1] + (fy - p.y);
    if (edTool === 'eraser') {
      edPixels[(ty * ED_SIZE + tx) * 4 + 3] = 0;
    } else if (edTool === 'fill') {
      edFloodAt(tx, ty, p);
    } else {
      edSetTexel(tx, ty, edColor);
    }
  };
  // Relleno: flood sobre la región de textura de la parte (nunca invade otra).
  const edFloodAt = (tx0, ty0, part) => {
    const [sx, sy, sw, sh] = part.tex;
    const ti = (ty0 * ED_SIZE + tx0) * 4;
    const tr = edPixels[ti], tg = edPixels[ti + 1], tb = edPixels[ti + 2], ta = edPixels[ti + 3];
    const [cr, cg, cb] = hexToRgb(edColor);
    if (tr === cr && tg === cg && tb === cb && ta === 255) return;
    const stack = [[tx0, ty0]];
    const seen = new Set();
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < sx || cx >= sx + sw || cy < sy || cy >= sy + sh) continue;
      const key = cy * ED_SIZE + cx;
      if (seen.has(key)) continue;
      const i = key * 4;
      if (edPixels[i] !== tr || edPixels[i + 1] !== tg || edPixels[i + 2] !== tb || edPixels[i + 3] !== ta) continue;
      seen.add(key);
      edSetTexel(cx, cy, edColor);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  };
  // Trazo de línea entre dos celdas de la figura.
  const edLine = (fx0, fy0, fx1, fy1) => {
    const dx = Math.abs(fx1 - fx0), dy = Math.abs(fy1 - fy0);
    const sxf = fx0 < fx1 ? 1 : -1, syf = fy0 < fy1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      edPaintAt(fx0, fy0);
      if (fx0 === fx1 && fy0 === fy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; fx0 += sxf; }
      if (e2 < dx) { err += dx; fy0 += syf; }
    }
  };
  const edTextureCanvas = () => {
    const t = document.createElement('canvas');
    t.width = ED_SIZE; t.height = ED_SIZE;
    t.getContext('2d').putImageData(new ImageData(edPixels, ED_SIZE, ED_SIZE), 0, 0);
    return t;
  };
  // Dibuja cualquier vista (front/sideR/sideL/back) en un canvas auxiliar.
  function renderView(ctx, img, viewKey, s) {
    const v = ED_VIEWS[viewKey];
    if (!v) return;
    const W = 16 * s + s * 2;
    const H = 32 * s + s * 2;
    if (ctx.canvas.width !== W) ctx.canvas.width = W;
    if (ctx.canvas.height !== H) ctx.canvas.height = H;
    ctx.canvas.style.width = W + 'px';
    ctx.canvas.style.height = H + 'px';
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    for (const p of v.parts) {
      const [tx, ty, tw, th] = p.tex;
      ctx.drawImage(img, tx, ty, tw, th, s + p.x * s, s + p.y * s, tw * s, th * s);
    }
  }

  function edRenderView() {
    const ctx = editorCanvas.getContext('2d');
    const CW = editorCanvas.width, CH = editorCanvas.height;
    const cell = CW / 16;
    ctx.clearRect(0, 0, CW, CH);
    ctx.imageSmoothingEnabled = false;
    // fondo tablero (transparencia visible)
    ctx.fillStyle = '#17130e';
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
    for (let yy = 0; yy < 32; yy++) {
      for (let xx = 0; xx < 16; xx++) {
        if ((xx + yy) % 2 === 0) ctx.fillRect(xx * cell, yy * cell, cell, cell);
      }
    }
    // figura compuesta desde la textura
    const tex = edTextureCanvas();
    for (const p of ED_VIEWS[edView].parts) {
      const [sx, sy, sw, sh] = p.tex;
      ctx.drawImage(tex, sx, sy, sw, sh, p.x * cell, p.y * cell, sw * cell, sh * cell);
    }
    // guía: borde + nombre y dimensiones de cada parte
    const fs = Math.max(10, Math.floor(cell / 3.4));
    ctx.font = '700 ' + fs + 'px system-ui, sans-serif';
    for (const p of ED_VIEWS[edView].parts) {
      const [sx, sy, sw, sh] = p.tex;
      const px = p.x * cell, py = p.y * cell, pw = sw * cell, ph = sh * cell;
      ctx.strokeStyle = 'rgba(255, 216, 74, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
      ctx.setLineDash([]);
      const label = p.name + '  ' + sw + 'x' + sh;
      const tw = ctx.measureText(label).width;
      const bx = px + (pw - tw) / 2;
      ctx.fillStyle = 'rgba(8, 10, 14, 0.75)';
      ctx.fillRect(bx - 4, py + 3, tw + 8, fs + 5);
      ctx.fillStyle = '#ffd84a';
      ctx.fillText(label, bx, py + fs + 6);
    }
    // badge de vista actual (esquina superior derecha del lienzo)
    const viewLabel = ED_VIEWS[edView].label;
    ctx.font = '900 12px system-ui, sans-serif';
    const tl = ctx.measureText(viewLabel).width;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.8)';
    ctx.fillRect(CW - tl - 18, 6, tl + 12, 20);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText(viewLabel, CW - tl - 12, 20);
    // previa: muestra la MISMA vista que se está editando (no solo frente)
    renderView(editorPreview.getContext('2d'), tex, edView, 3);
  }
  function edCellFromEvent(e) {
    const rect = editorCanvas.getBoundingClientRect();
    return [
      Math.floor(((e.clientX - rect.left) / rect.width) * 16),
      Math.floor(((e.clientY - rect.top) / rect.height) * 32)
    ];
  }
  function edSetView(v) {
    if (!ED_VIEWS[v]) return;
    edView = v;
    if (editorViewsEl) {
      for (const b of editorViewsEl.children) b.classList.toggle('active', b.dataset.view === v);
    }
    edRenderView();
  }
  function edSetTool(t) {
    edTool = t;
    for (const [btn, id] of [[toolBrush, 'brush'], [toolEraser, 'eraser'], [toolFill, 'fill']]) {
      if (btn) btn.classList.toggle('active', id === t);
    }
  }
  function edOpen() {
    editorModal.hidden = false;
    editorName.value = '';
    editorStatus.textContent = '';
    edPixels = new Uint8ClampedArray(ED_SIZE * ED_SIZE * 4);
    edUndo.length = 0;
    edRedo.length = 0;
    btnUndo.disabled = true;
    btnRedo.disabled = true;
    edSetView('front');
    edRenderView();
  }
  function edClose() {
    editorModal.hidden = true;
  }
  // Carga de skin con CORS (para poder leerla al canvas sin taint).
  function edLoadImageCors(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagen no disponible (CORS/red)'));
      img.src = url;
    });
  }
  async function edLoadFromGallery() {
    const id = selectedSkinId || profileSkin.value || '';
    const sel = window.SKINS.find((x) => x.id === id);
    let url = '';
    if (sel && sel.name && skinsApiBase) {
      try {
        const res = await fetch(skinsApiBase + '/api/skin/' + encodeURIComponent(sel.name));
        const d = await res.json();
        if (d.ok && d.url) url = d.url;
      } catch {}
    }
    let img = null;
    if (url) {
      try { img = await edLoadImageCors(url); } catch { img = null; }
    }
    if (!img) {
      editorStatus.textContent = 'Elegí una skin de la galería (con red) para usarla como base';
      return;
    }
    edPushHistory();
    const tmp = document.createElement('canvas');
    tmp.width = ED_SIZE; tmp.height = ED_SIZE;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(img, 0, 0);
    edPixels = Uint8ClampedArray.from(tctx.getImageData(0, 0, ED_SIZE, ED_SIZE).data);
    edRenderView();
    editorStatus.textContent = 'Base cargada: ' + sel.label + ' — editá y subí tu skin';
  }
    // Nombre con el que jugás en el server (el perfil manda). Las skins propias
  // se registran bajo este nombre en el backend para que te aparezcan en el
  // juego; el "nombre de la skin" del creador es solo la etiqueta de la galería.
  function currentPlayName() {
    const selP = currentProfiles.find((x) => x.id === profileSelect.value);
    if (selP && selP.name) return selP.name;
    const n = (profileName.value || '').trim();
    return n || 'Player';
  }

  async function edUpload() {
    const label = (editorName.value || '').trim() || 'Mi skin';
    const player = currentPlayName();
    if (!skinsApiBase) { editorStatus.textContent = 'No hay backend de skins configurado'; return; }
    let token = '';
    try { token = (await window.api.config()).skinApi.token || ''; } catch {}
    if (!token) { editorStatus.textContent = 'Sin token para subir la skin'; return; }

    const tmp = edTextureCanvas();
    const dataUrl = tmp.toDataURL('image/png');

    btnEditorUpload.disabled = true;
    editorStatus.textContent = 'Subiendo…';
    setStatus('Subiendo skin…');
    try {
      const res = await fetch(skinsApiBase + '/skin/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ player, image: dataUrl })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        editorStatus.textContent = 'No se pudo subir: ' + (j.error || res.status);
        return;
      }
      const id = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = window.SKINS.find((s) => s.id === id);
      if (existing) { existing.label = label + ' (propia)'; existing.name = player; }
      else window.SKINS.push({ id, label: label + ' (propia)', name: player });
      profileSkin.value = id;
      selectedSkinId = id;
      skinImgCache.delete(id); // fuerza recarga fresca de la textura
      if (skinGrid) buildSkinGallery();
      else syncSkinFromSelect();
      // La skin queda seleccionada en "Elegí tu skin"; jugás con el nombre del
      // perfil, que es justamente donde quedó registrada.
      await window.api.setSkin(id);
      editorStatus.textContent = '"' + label + '" creada — elegila en "Elegí tu skin"';
      setStatus('Skin "' + label + '" creada y seleccionada');
      edClose();
    } catch (e) {
      editorStatus.textContent = 'Error de red: ' + e.message;
    } finally {
      btnEditorUpload.disabled = false;
    }
  }

  if (btnOpenEditor) btnOpenEditor.addEventListener('click', () => {
    if (editorModal) { edOpen(); }
    else setStatus('Editor no disponible');
  });
  if (btnEditorClose) btnEditorClose.addEventListener('click', edClose);
  if (editorModal) editorModal.addEventListener('click', (e) => { if (e.target === editorModal) edClose(); });

  if (editorCanvas) {
    editorCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      edPushHistory();
      edDrawing = true;
      edLast = edCellFromEvent(e);
      edPaintAt(edLast[0], edLast[1]);
      editorCanvas.setPointerCapture(e.pointerId);
      edRenderView();
    });
    editorCanvas.addEventListener('pointermove', (e) => {
      if (!edDrawing) return;
      const [fx, fy] = edCellFromEvent(e);
      if (fx < 0 || fy < 0 || fx >= 16 || fy >= 32) return;
      if (edTool === 'fill') {
        edPaintAt(fx, fy);
      } else {
        edLine(edLast[0], edLast[1], fx, fy);
      }
      edLast = [fx, fy];
      edRenderView();
    });
    const edRaise = () => { edDrawing = false; edLast = null; };
    editorCanvas.addEventListener('pointerup', edRaise);
    editorCanvas.addEventListener('pointercancel', edRaise);
  }
  document.addEventListener('keydown', (e) => {
    if (editorModal && editorModal.hidden) return;
    if (e.key === 'Escape') edClose();
  });

  if (editorViewsEl) {
    for (const b of editorViewsEl.children) {
      b.addEventListener('click', () => edSetView(b.dataset.view));
    }
  }
  if (toolBrush) toolBrush.addEventListener('click', () => edSetTool('brush'));
  if (toolEraser) toolEraser.addEventListener('click', () => edSetTool('eraser'));
  if (toolFill) toolFill.addEventListener('click', () => edSetTool('fill'));

  (function buildPalette() {
    if (!editorPalette) return;
    for (const c of ED_PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.title = c;
      b.classList.toggle('active', c === edColor);
      b.addEventListener('click', () => {
        edColor = c;
        editorColor.value = c;
        for (const bt of editorPalette.children) bt.classList.toggle('active', bt === b);
      });
      editorPalette.appendChild(b);
    }
  })();
  if (editorColor) editorColor.addEventListener('input', () => {
    edColor = editorColor.value;
    for (const bt of editorPalette.children) bt.classList.toggle('active', bt.title === edColor);
  });

  if (btnUndo) btnUndo.addEventListener('click', () => {
    if (!edUndo.length) return;
    edRedo.push(edClone());
    edPixels = edUndo.pop();
    btnUndo.disabled = !edUndo.length;
    btnRedo.disabled = false;
    edRenderView();
  });
  if (btnRedo) btnRedo.addEventListener('click', () => {
    if (!edRedo.length) return;
    edUndo.push(edClone());
    edPixels = edRedo.pop();
    btnUndo.disabled = false;
    btnRedo.disabled = !edRedo.length;
    edRenderView();
  });
  if (btnClear) btnClear.addEventListener('click', () => {
    edPushHistory();
    edPixels = new Uint8ClampedArray(ED_SIZE * ED_SIZE * 4);
    edRenderView();
  });
  if (btnLoadSkin) btnLoadSkin.addEventListener('click', edLoadFromGallery);
  if (btnEditorUpload) btnEditorUpload.addEventListener('click', edUpload);

  // ---- Controles de ventana ----
  document.getElementById('btn-min').addEventListener('click', () => window.api.win.minimize());
  document.getElementById('btn-max').addEventListener('click', () => window.api.win.toggleMaximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.win.close());

  // ---- Selector de skins (galería) ----
  if (btnRandomSkin) btnRandomSkin.addEventListener('click', randomSkin);
  if (btnUseSkin) btnUseSkin.addEventListener('click', useSkin);

  // ---- Perfiles ----
  btnNewProfile.addEventListener('click', () => {
    profileSelect.value = '';
    profileName.value = '';
    profileMemMin.value = 1024;
    profileMemMax.value = 4096;
    if (skinGrid) syncSkinFromSelect();
    setStatus('Listo para crear un perfil nuevo (la skin queda elegida)');
  });

  btnSaveProfile.addEventListener('click', async () => {
    const name = (profileName.value || '').trim();
    if (!name) { setStatus('Escribí un nombre para el perfil'); return; }
    const memory = {
      min: parseInt(profileMemMin.value, 10) || 1024,
      max: parseInt(profileMemMax.value, 10) || 4096
    };
    if (memory.max < memory.min) memory.max = memory.min;

    try {
      const id = profileSelect.value;
      let saved;
      if (id) {
        saved = await window.api.profiles.update(id, { name, memory });
        setStatus(`Perfil "${name}" actualizado`);
      } else {
        saved = await window.api.profiles.add({ name, memory });
        setStatus(`Perfil "${name}" guardado`);
      }
      const profiles = await loadProfiles();
      profileSelect.value = saved.id;
      applyProfileToForm(profiles);
      if (skinGrid) syncSkinFromSelect();
    } catch (e) {
      setStatus('No se pudo guardar el perfil: ' + e.message);
    }
  });

  btnDelProfile.addEventListener('click', async () => {
    const id = profileSelect.value;
    if (!id) { setStatus('No hay perfil seleccionado para eliminar'); return; }
    try {
      await window.api.profiles.remove(id);
      currentProfiles = await loadProfiles();
      profileSelect.value = '';
      if (skinGrid) syncSkinFromSelect();
      setStatus('Perfil eliminado');
    } catch (e) {
      setStatus('No se pudo eliminar: ' + e.message);
    }
  });

  profileSelect.addEventListener('change', async () => {
    const profiles = await window.api.profiles.list();
    applyProfileToForm(profiles);
    syncSkinFromSelect();
  });

  profileSkin.addEventListener('change', syncSkinFromSelect);

  // ---- Cuenta ----
  // ---- Jugar ----
btnLatest.addEventListener('click', () => {
    if (latestRelease) {
      versionSelect.value = latestRelease;
      syncPlaySub();
    }
  });

  versionSelect.addEventListener('change', syncPlaySub);

  btnRemoveVersion.addEventListener('click', () => openVersionsModal());

  function fmtSize(bytes) {
    if (!bytes || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
  }

  function loaderBadge(type) {
    const labels = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', release: 'Vanilla', snapshot: 'Snapshot' };
    return '<span class="v-badge">' + (labels[type] || type) + '</span>';
  }

  let versionsModal = null;
  const versionsListEl = () => document.getElementById('versions-list');
  const versionsHintEl = () => document.getElementById('versions-hint');

  // Confirma desinstalar una versión con un modal propio (en vez del diálogo
  // nativo). Recibe la versión y la acción a ejecutar si se confirma.
  let pendingRemove = null;
  let confirmModal = null;
  function openConfirmRemove(version, onConfirm) {
    if (!confirmModal) confirmModal = document.getElementById('confirm-version-modal');
    const detail = document.getElementById('confirm-detail');
    detail.innerHTML =
      '<div class="v-name"><span class="v-id">' + version.id + '</span> ' + loaderBadge(version.type) + '</div>' +
      '<div class="v-sub">' + fmtSize(version.sizeBytes) +
      (version.releaseTime ? ' · ' + new Date(version.releaseTime).toLocaleDateString() : '') + '</div>';
    const usedBy = currentProfiles.filter((p) => p.versionId === version.id);
    const text = document.getElementById('confirm-text');
    text.textContent = 'Se borrará "' + version.id + '" del disco.' +
      (usedBy.length
        ? ' Además, eliminará ' + usedBy.length + ' perfil(es) que la usan.'
        : ' Los perfiles que la usen se eliminarán.') +
      ' Esta acción no se puede deshacer.';
    pendingRemove = { onConfirm };
    confirmModal.hidden = false;
  }

  async function renderVersionsList() {
    const listEl = versionsListEl();
    const hintEl = versionsHintEl();
    listEl.innerHTML = '';
    let installed = [];
    try { installed = await window.api.installedVersions(); }
    catch (e) { hintEl.textContent = 'No se pudo leer las versiones instaladas: ' + e.message; return; }

    const total = installed.reduce((acc, v) => acc + (v.sizeBytes || 0), 0);
    hintEl.textContent = installed.length
      ? installed.length + ' versión(es) instalada(s) · ' + fmtSize(total)
      : 'No hay versiones instaladas todavía.';
    if (!installed.length) return;

    for (const v of installed) {
      const row = document.createElement('div');
      row.className = 'v-row';
      const meta = document.createElement('div');
      meta.className = 'v-meta';
      const name = document.createElement('div');
      name.className = 'v-name';
      name.innerHTML = '<span class="v-id">' + v.id + '</span> ' + loaderBadge(v.type);
      const sub = document.createElement('div');
      sub.className = 'v-sub';
      sub.textContent = fmtSize(v.sizeBytes) + (v.releaseTime ? ' · ' + new Date(v.releaseTime).toLocaleDateString() : '');
      meta.appendChild(name);
      meta.appendChild(sub);
      const del = document.createElement('button');
      del.className = 'btn-ghost v-del';
      del.textContent = 'Desinstalar';
      del.addEventListener('click', () => {
        openConfirmRemove(v, async () => {
          del.disabled = true;
          del.textContent = 'Borrando…';
          try {
            await window.api.removeVersion(v.id);
            installedIds.delete(v.id);
            await loadVersions(true);
            await renderVersionsList();
            hintEl.textContent = '"' + v.id + '" desinstalada';
          } catch (e) {
            del.disabled = false;
            del.textContent = 'Desinstalar';
            hintEl.textContent = 'No se pudo desinstalar: ' + e.message;
          }
        });
      });
      row.appendChild(meta);
      row.appendChild(del);
      listEl.appendChild(row);
    }
  }

  async function openVersionsModal() {
    if (!versionsModal) versionsModal = document.getElementById('versions-modal');
    versionsModal.hidden = false;
    const btn = document.getElementById('btn-versions-close');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => { versionsModal.hidden = true; });
      versionsModal.addEventListener('click', (e) => { if (e.target === versionsModal) versionsModal.hidden = true; });
    }
    await renderVersionsList();
  }

  function initConfirmRemove() {
    if (!confirmModal) confirmModal = document.getElementById('confirm-version-modal');
    const close = () => { confirmModal.hidden = true; pendingRemove = null; };
    const btnClose = document.getElementById('btn-confirm-close');
    const btnCancel = document.getElementById('btn-confirm-cancel');
    const btnYes = document.getElementById('btn-confirm-yes');
    if (btnClose && !btnClose.dataset.bound) {
      btnClose.dataset.bound = '1';
      btnClose.addEventListener('click', close);
      btnCancel.addEventListener('click', close);
      confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) close(); });
      btnYes.addEventListener('click', async () => {
        const action = pendingRemove && pendingRemove.onConfirm;
        confirmModal.hidden = true;
        pendingRemove = null;
        if (action) await action();
      });
    }
  }
  initConfirmRemove();

  btnPlay.addEventListener('click', async () => {
    // Manda la versión elegida en el panel "Jugar"; el perfil aporta el
    // nombre (si no hay sesión) y la memoria.
    const selId = profileSelect.value;
    const versionId = versionSelect.value;
    let memory = null;
    if (selId) {
      const p = currentProfiles.find((x) => x.id === selId);
      if (p && p.memory) memory = p.memory;
    }

    if (!versionId || versionId === 'Cargando…') {
      setStatus('Elegí una versión para jugar');
      progress.hidden = true;
      return;
    }

    setStatus(`Preparando ${versionId}…`);
    progress.hidden = false;
    try {
      // Modo offline: el nombre que se usa en el juego es el del perfil
      // seleccionado (o el que se esté escribiendo en un perfil nuevo).
      let name = 'Player';
      let skin = '';
      const selP = currentProfiles.find((x) => x.id === selId);
      if (selP && selP.name) name = selP.name;
      else if (profileName.value && profileName.value.trim()) name = profileName.value.trim();
      // La skin a aplicar por nombre solo aplica para las de la galería;
      // las subidas (propias, id custom-) van servidas por Yggdrasil client-side
      // y no se re-aplican (re-aplicarlas por nombre las pisaría con la cuenta
      // Mojang real del mismo nombre).
      const skId = profileSkin.value || ''; // skin global, independiente del perfil
      const skSel = window.SKINS.find((x) => x.id === skId);
      if (skSel && skSel.name && !skId.startsWith('custom-')) skin = skSel.name;
      const account = {
        username: name,
        uuid: '', // el proceso principal deriva el UUID offline determinístico
        accessToken: 'offline',
        userType: 'mojang'
      };
      setStatus(`Jugando offline como "${name}"…`);
      await window.api.launch({ versionId, account, memory, skin });
      setStatus('Minecraft en marcha');
      progress.hidden = true;
    } catch (e) {
      setStatus('No se pudo lanzar: ' + e.message);
      progress.hidden = true;
    }
  });

  window.api.onProgress((p) => {
    const pct = p.total ? Math.round((p.current / p.total) * 100) : 0;
    progressBar.style.width = pct + '%';
    progressText.textContent = `${p.phase}: ${pct}%`;
  });

  // ---- Mods (ventana dedicada) ----
  document.getElementById('btn-mods').addEventListener('click', () => {
    window.api.win.openMods();
  });

  // ---- Estado del servidor en el hero ----
  async function refreshHeroStatus() {
    if (!heroStatus) return;
    try {
      const data = await window.api.serverStatus();
      if (data && data.online) {
        heroStatus.textContent = 'Java · En línea';
        heroDot.classList.remove('offline');
      } else {
        heroStatus.textContent = 'Java · katherine-awakenings.tun.ply.gg';
        heroDot.classList.add('offline');
      }
    } catch {
      heroStatus.textContent = 'Java · katherine-awakenings.tun.ply.gg';
      heroDot.classList.add('offline');
    }
  }

  // ---- Estado del servidor Bedrock en el hero ----
  async function refreshBedrockStatus() {
    const el = document.getElementById('hero-status-bedrock');
    const dot = document.getElementById('hero-dot-bedrock');
    if (!el) return;
    try {
      const data = await window.api.serverStatusBedrock();
      if (data && data.online) {
        el.textContent = 'Bedrock · En línea';
        dot.classList.remove('offline');
        dot.classList.remove('unknown');
      } else {
        el.textContent = 'Bedrock · katherine-roof.tun.ply.gg:56601';
        dot.classList.add('offline');
        dot.classList.remove('unknown');
      }
    } catch {
      el.textContent = 'Bedrock · katherine-roof.tun.ply.gg:56601';
      dot.classList.add('unknown');
      dot.classList.remove('offline');
    }
  }

  // ---- Actualizador del launcher (releases de GitHub) ----
  const updateBanner = document.getElementById('update-banner');
  const updateTitle = document.getElementById('update-title');
  const updateSub = document.getElementById('update-sub');
  const updateProgress = document.getElementById('update-progress');
  const updateProgressBar = document.getElementById('update-progress-bar');
  const updateProgressText = document.getElementById('update-progress-text');
  let updateData = null;
  let currentAppVersion = '0.0.0';

  async function loadAppVersion() {
    try {
      const info = await window.api.appVersion();
      if (!info || !info.version) return;
      currentAppVersion = String(info.version).replace(/^v/i, '');
      const el = document.getElementById('app-version');
      if (el) el.textContent = currentAppVersion;
    } catch { /* sin datos, el badge queda vacío */ }
  }

  function showUpdateBanner(result) {
    if (!updateBanner) return;
    updateData = result;

    const showButtons = (show) => {
      for (const id of ['btn-update-now', 'btn-update-later']) {
        const b = document.getElementById(id);
        if (b) b.style.display = show ? '' : 'none';
      }
    };

    if (result.updateAvailable && result.asset) {
      updateBanner.dataset.state = 'update';
      updateTitle.textContent = 'Nueva versión ' + result.version + ' disponible';
      updateSub.textContent = 'Estás en v' + currentAppVersion + ' → v' + result.version +
        ' · ' + (result.asset.name || '') +
        (result.notes ? ' · ' + String(result.notes).split('\n')[0] : '');
      updateProgress.hidden = true;
      showButtons(true);
      updateBanner.hidden = false;
      return;
    }

    // Sin update listo: banner informativo con la versión actual. Si el check
    // falló por red (transitorio) se oculta; "sin repo configurado" es un
    // estado informativo que igual conviene mostrar junto a la versión.
    const err = result.error || '';
    if (err && !/no configurado|sin repo/i.test(err)) {
      updateBanner.hidden = true;
      return;
    }
    updateBanner.dataset.state = 'current';
    updateTitle.textContent = '¡Estás al día!';
    updateSub.textContent = 'Family Launcher v' + currentAppVersion +
      ' — si publicamos una versión nueva, te avisamos acá';
    updateProgress.hidden = true;
    showButtons(false);
    updateBanner.hidden = false;
  }

  async function checkForUpdates() {
    try {
      const result = await window.api.updater.check();
      showUpdateBanner(result);
    } catch (e) {
      console.warn('[updater]', e.message);
    }
  }

  document.getElementById('btn-update-later').addEventListener('click', async () => {
    if (updateData && updateData.version) {
      try { await window.api.updater.dismiss(updateData.version); } catch { /* best effort */ }
    }
    if (updateBanner) updateBanner.hidden = true;
  });

  document.getElementById('btn-update-now').addEventListener('click', async () => {
    if (!updateData || !updateData.asset) return;
    const btn = document.getElementById('btn-update-now');
    const laterBtn = document.getElementById('btn-update-later');
    btn.disabled = true;
    laterBtn.disabled = true;
    updateProgress.hidden = false;
    updateProgressBar.style.width = '0%';
    updateProgressText.textContent = 'Descargando…';
    try {
      const res = await window.api.updater.download(updateData.asset);
      if (res && res.status === 'installing') {
        updateProgressText.textContent = 'Instalando… la app se va a cerrar sola';
      } else {
        updateProgressText.textContent = 'Instalador descargado: ' + (res.file || 'revisá la carpeta de descargas');
        btn.textContent = 'Listo';
      }
    } catch (e) {
      updateProgressText.textContent = 'No se pudo actualizar: ' + e.message;
      btn.disabled = false;
      laterBtn.disabled = false;
      btn.textContent = 'Reintentar';
    }
  });

  window.api.updater.onProgress((p) => {
    if (!updateProgress || updateProgress.hidden) return;
    const pct = p.total ? Math.round((p.current / p.total) * 100) : 0;
    updateProgressBar.style.width = pct + '%';
    updateProgressText.textContent = 'Descargando… ' + pct + '%';
  });

  // ---- Carga inicial ----
  (async () => {
    populateSkinSelect();
    await loadVersions();
    const profiles = await loadProfiles();
    applyProfileToForm(profiles);

    let cfg = null;
    try { cfg = await window.api.config(); } catch { cfg = null; }

    // Skin global (independiente del perfil), persistida entre sesiones.
    const savedSkin = (cfg && cfg.selectedSkinId) || '';
    if (savedSkin) {
      selectedSkinId = savedSkin;
      if (profileSkin) profileSkin.value = savedSkin;
    }

    // Reincorpora skins propias (subidas con el creador) si quedó guardada.
    // La skin quedó registrada bajo el nombre del perfil: la etiqueta es el
    // nombre que le dimos en el creador y el player name se toma del perfil.
    if (savedSkin.startsWith('custom-') && !window.SKINS.some((s) => s.id === savedSkin)) {
      const nm = savedSkin.replace('custom-', '');
      window.SKINS.push({ id: savedSkin, label: nm + ' (propia)', name: currentPlayName() });
    }

    // Base de la API de skins (usa yggdrasil.api, o skinApi.url sin el /skin).
    if (cfg) {
      skinsApiBase = (cfg.yggdrasil && cfg.yggdrasil.api && String(cfg.yggdrasil.api).replace(/\/+$/, ''))
        || (cfg.skinApi && cfg.skinApi.url ? cfg.skinApi.url.replace(/\/?skin\/?$/, '').replace(/\/+$/, '') : '');
    }
    if (skinGrid) buildSkinGallery();

    refreshHeroStatus();
    refreshBedrockStatus();
    await loadAppVersion();
    checkForUpdates();
  })();
});
