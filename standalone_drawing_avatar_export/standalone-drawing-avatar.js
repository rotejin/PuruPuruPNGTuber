// SPDX-License-Identifier: Apache-2.0
(() => {
  "use strict";

  const W = 1024;
  const H = 1536;
  const MAX_ITEMS = 8;
  const MAX_IMPORTED_IMAGES_PER_LAYER = 16;
  const MAX_HISTORY = 30;
  const MAX_HISTORY_BYTES = 96 * 1024 * 1024;
  const ONION = 0.35;
  const TOL = 12;
  const MAX_PNG_FILE_SIZE = 3 * 1024 * 1024;
  const MAX_PROJECT_FILE_SIZE = 16 * 1024 * 1024;
  const MAX_PROJECT_DATA_URL_SIZE = 32 * 1024 * 1024;
  const MAX_IMAGE_EDGE = 4096;
  const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
  const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
  const PNG_BASE64_SIGNATURE = "iVBORw0KGgo";
  const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const MAX_PROJECT_JSON_DEPTH = 16;
  const MAX_PROJECT_KEYS_PER_OBJECT = 2000;
  const MAX_PROJECT_ARRAY_LENGTH = 2000;
  const MAX_PROJECT_STRING_LENGTH = 4 * 1024 * 1024;
  const MAX_PROJECT_NODE_COUNT = 50000;
  const DEFAULT_MUTED = new Set(["eyesClosed", "mouthHalf", "mouthOpen"]);
  const FIXED = [
    ["faceBase", "顔ベース"],
    ["eyesOpen", "目・開け"],
    ["eyesClosed", "目・閉じ"],
    ["mouthClosed", "口・閉じ"],
    ["mouthHalf", "口・中間"],
    ["mouthOpen", "口・開け"],
    ["frontHair", "前髪"],
    ["backHair", "後ろ髪"],
  ];
  const MAX_PROJECT_LAYERS = FIXED.length + MAX_ITEMS;
  const EYE_KEYS = ["eyesOpen", "eyesClosed"];
  const MOUTH_KEYS = ["mouthClosed", "mouthHalf", "mouthOpen"];
  const LAYER_GROUPS = [
    ["ベース", ["faceBase"]],
    ["目（差分）", EYE_KEYS],
    ["口（差分）", MOUTH_KEYS],
    ["髪", ["frontHair", "backHair"]],
  ];
  const EXPRESSIONS = [
    { eyes: "eyesOpen", mouth: "mouthClosed", label: "目開・口閉" },
    { eyes: "eyesOpen", mouth: "mouthHalf", label: "目開・口中" },
    { eyes: "eyesOpen", mouth: "mouthOpen", label: "目開・口開" },
    { eyes: "eyesClosed", mouth: "mouthClosed", label: "目閉・口閉" },
    { eyes: "eyesClosed", mouth: "mouthHalf", label: "目閉・口中" },
    { eyes: "eyesClosed", mouth: "mouthOpen", label: "目閉・口開" },
  ];
  const COMBOS = [
    ["eyes-open-mouth-closed", ["eyesOpen", "eyesClosed"], ["mouthClosed", "mouthHalf", "mouthOpen"]],
    ["eyes-open-mouth-half", ["eyesOpen", "eyesClosed"], ["mouthHalf", "mouthOpen", "mouthClosed"]],
    ["eyes-open-mouth-open", ["eyesOpen", "eyesClosed"], ["mouthOpen", "mouthHalf", "mouthClosed"]],
    ["eyes-closed-mouth-closed", ["eyesClosed", "eyesOpen"], ["mouthClosed", "mouthHalf", "mouthOpen"]],
    ["eyes-closed-mouth-half", ["eyesClosed", "eyesOpen"], ["mouthHalf", "mouthOpen", "mouthClosed"]],
    ["eyes-closed-mouth-open", ["eyesClosed", "eyesOpen"], ["mouthOpen", "mouthHalf", "mouthClosed"]],
  ];

  const $ = (id) => document.getElementById(id);
  const ui = {
    status: $("status"), canvas: $("canvas"), overlay: $("overlay"), canvasWrap: $("canvasWrap"),
    layers: $("layers"), activeName: $("activeName"),
    addItem: $("addItem"), importPng: $("importPng"), pngFile: $("pngFile"), removePng: $("removePng"),
    pngList: $("pngList"), pngReadout: $("pngReadout"),
    pngControls: $("pngControls"), imgX: $("imgX"), imgY: $("imgY"), imgScale: $("imgScale"), centerPng: $("centerPng"),
    brush: $("brush"), fill: $("fill"), eraser: $("eraser"), brushSize: $("brushSize"),
    softness: $("softness"), stab: $("stab"), pressure: $("pressure"), color: $("color"), swatches: $("swatches"),
    undo: $("undo"), redo: $("redo"), clear: $("clear"), onion: $("onion"),
    zoomIn: $("zoomIn"), zoomOut: $("zoomOut"), zoomLabel: $("zoomLabel"), zoomFit: $("zoomFit"),
    expressions: $("expressions"),
    finish: $("finish"), saveProject: $("saveProject"), loadProject: $("loadProject"),
    projectFile: $("projectFile"), outputs: $("outputs"),
  };

  let app = createSession();
  let stroke = null;
  let pan = null;
  let spaceDown = false;
  let renderPending = false;
  let transformLayerId = null;
  let dirty = false;
  let outputObjectUrls = [];
  let projectObjectUrls = [];

  // ---- viewport ----
  const view = { scale: 1, x: 0, y: 0 };
  let viewW = 0, viewH = 0, dpr = 1, autoFit = true;
  let cursorPos = null;
  const octx = requireCanvasContext(ui.overlay);
  const checker = (() => {
    const c = document.createElement("canvas");
    c.width = 24; c.height = 24;
    const cx = requireCanvasContext(c);
    cx.fillStyle = "#fffdf8"; cx.fillRect(0, 0, 24, 24);
    cx.fillStyle = "rgba(0,0,0,.045)"; cx.fillRect(0, 0, 12, 12); cx.fillRect(12, 12, 12, 12);
    return c;
  })();
  let checkerPattern = null;

  function clamp(v, min, max) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }
  function hex(v) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v || "").trim());
    return m ? `#${m[1].toLowerCase()}` : null;
  }
  function validatePngDataUrl(src, name = "PNG", maxLength = MAX_PROJECT_DATA_URL_SIZE) {
    const raw = String(src || "").trim();
    if (raw.length > maxLength) throw new Error(`${name} の画像データが大きすぎます。`);
    const match = raw.match(/^data:image\/png(?:;[^,]*)?;base64,(.*)$/i);
    if (!match) throw new Error(`${name} はPNG画像データではありません。`);
    const normalized = `${PNG_DATA_URL_PREFIX}${match[1].replace(/\s/g, "")}`;
    if (normalized.length > maxLength || !normalized.slice(PNG_DATA_URL_PREFIX.length).startsWith(PNG_BASE64_SIGNATURE)) {
      throw new Error(`${name} はPNG画像データではありません。`);
    }
    return normalized;
  }
  function requireCanvasContext(canvas, options) {
    const cx = canvas?.getContext?.("2d", options);
    if (!cx) throw new Error("Canvasを初期化できませんでした。");
    return cx;
  }
  function safeFilenamePart(value, fallback = "layer") {
    return String(value || "").slice(0, 32).replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim() || fallback;
  }
  function assertImageSize(im, name = "PNG") {
    const w = im?.naturalWidth || im?.width || 0;
    const h = im?.naturalHeight || im?.height || 0;
    if (w <= 0 || h <= 0 || w > MAX_IMAGE_EDGE || h > MAX_IMAGE_EDGE || w * h > MAX_IMAGE_PIXELS) {
      throw new Error(`${name} の画像サイズが大きすぎます。`);
    }
  }
  function rgb(color) {
    const c = hex(color) || "#3c3026";
    return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) };
  }
  function say(text) { ui.status.textContent = text; }
  function makeCanvas() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const cx = requireCanvasContext(c, { willReadFrequently: true });
    return { canvas: c, ctx: cx };
  }
  function makeLayer({ id, key, label, kind, muted = false }) {
    return { id, key, label, kind, muted, importedImages: [], activeImportedId: null, nextImportedId: 1, ...makeCanvas() };
  }
  function createSession() {
    const layers = FIXED.map(([key, label], i) => makeLayer({
      id: i + 1, key, label, kind: "fixed", muted: DEFAULT_MUTED.has(key),
    }));
    return {
      layers, nextId: layers.length + 1, itemCount: 0, activeId: layers[0].id,
      undo: [], redo: [], tool: "brush", size: 14, softness: 0, stab: 30, pressure: true,
      color: "#3c3026", swatchIndex: 0, onion: true,
    };
  }
  function byId(id) { return app.layers.find((l) => l.id === Number(id)) || null; }
  function active() { return byId(app.activeId); }
  function fixed(key) { return app.layers.find((l) => l.kind === "fixed" && l.key === key) || null; }
  function order() {
    const map = Object.create(null), items = [];
    for (const l of app.layers) l.kind === "fixed" ? map[l.key] = l : items.push(l);
    return [map.backHair, map.faceBase, map.eyesOpen, map.eyesClosed, map.mouthClosed, map.mouthHalf, map.mouthOpen, ...items, map.frontHair].filter(Boolean);
  }

  function cloneImported(im) {
    return im ? { id: Math.max(1, Math.round(im.id || 1)), el: im.el, src: im.src, name: im.name, x: im.x, y: im.y, scale: im.scale } : null;
  }
  function cloneImportedList(list) { return (Array.isArray(list) ? list : []).map(cloneImported).filter(Boolean); }
  function ensureImportedList(layer) {
    if (!layer) return [];
    if (!Array.isArray(layer.importedImages)) layer.importedImages = [];
    if (layer.imported) {
      const legacy = cloneImported(layer.imported);
      if (legacy) {
        legacy.id = Math.max(0, ...layer.importedImages.map((im) => Math.round(im?.id || 0))) + 1;
        layer.importedImages.push(legacy);
        layer.activeImportedId = legacy.id;
      }
      layer.imported = null;
    }
    const used = new Set();
    let next = Math.max(1, Math.round(layer.nextImportedId || 1));
    for (const im of layer.importedImages) {
      let id = Math.max(1, Math.round(im?.id || 0));
      if (!id || used.has(id)) { id = next; next += 1; }
      im.id = id; used.add(id); next = Math.max(next, id + 1);
    }
    layer.nextImportedId = next;
    if (!layer.importedImages.some((im) => im.id === layer.activeImportedId)) {
      layer.activeImportedId = layer.importedImages.length ? layer.importedImages[layer.importedImages.length - 1].id : null;
    }
    return layer.importedImages;
  }
  function activeImported(layer = active()) {
    const list = ensureImportedList(layer);
    return list.find((im) => im.id === layer?.activeImportedId) || list[list.length - 1] || null;
  }
  function setActiveImported(layer, id) {
    const list = ensureImportedList(layer), n = Math.max(1, Math.round(id || 0));
    if (!list.some((im) => im.id === n)) return false;
    layer.activeImportedId = n;
    return true;
  }
  function imageMetrics(im) {
    const el = im?.el;
    const iw = el?.naturalWidth || el?.width || 0;
    const ih = el?.naturalHeight || el?.height || 0;
    if (!im || !el || iw <= 0 || ih <= 0) return null;
    const s = Math.max(0.01, (Number(im.scale) || 100) / 100);
    const dw = iw * s, dh = ih * s;
    return { el, x: W / 2 + (Number(im.x) || 0) - dw / 2, y: H / 2 + (Number(im.y) || 0) - dh / 2, w: dw, h: dh };
  }
  function drawImported(cx, im) {
    const m = imageMetrics(im);
    if (m) cx.drawImage(m.el, m.x, m.y, m.w, m.h);
  }
  function drawLayer(cx, layer) {
    for (const im of ensureImportedList(layer)) drawImported(cx, im);
    cx.drawImage(layer.canvas, 0, 0);
  }
  function flatten(layer) {
    const { canvas, ctx } = makeCanvas();
    drawLayer(ctx, layer);
    return canvas;
  }

  // ---- viewport & rendering ----
  function resizeDisplay() {
    dpr = window.devicePixelRatio || 1;
    const r = ui.canvasWrap.getBoundingClientRect();
    viewW = Math.max(1, r.width);
    viewH = Math.max(1, r.height);
    for (const c of [ui.canvas, ui.overlay]) {
      c.width = Math.round(viewW * dpr);
      c.height = Math.round(viewH * dpr);
    }
    if (autoFit) fitView(); else clampView();
    render();
    drawOverlay();
    syncZoomLabel();
  }
  function fitView() {
    const pad = 26;
    view.scale = Math.max(0.02, Math.min((viewW - pad * 2) / W, (viewH - pad * 2) / H));
    view.x = (viewW - W * view.scale) / 2;
    view.y = (viewH - H * view.scale) / 2;
    autoFit = true;
    syncZoomLabel();
  }
  function clampView() {
    const m = 60, dw = W * view.scale, dh = H * view.scale;
    view.x = clamp(view.x, m - dw, viewW - m);
    view.y = clamp(view.y, m - dh, viewH - m);
  }
  function zoomAt(px, py, factor) {
    const s = clamp(view.scale * factor, 0.05, 16);
    const f = s / view.scale;
    if (f === 1) return;
    view.x = px - (px - view.x) * f;
    view.y = py - (py - view.y) * f;
    view.scale = s;
    autoFit = false;
    clampView();
    syncZoomLabel();
    scheduleRender();
    drawOverlay();
  }
  function setZoom(s) { zoomAt(viewW / 2, viewH / 2, clamp(s, 0.05, 16) / view.scale); }
  function syncZoomLabel() { ui.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`; }

  function render() {
    const cx = requireCanvasContext(ui.canvas);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, viewW, viewH);
    const dx = view.x, dy = view.y, dw = W * view.scale, dh = H * view.scale;
    if (!checkerPattern) checkerPattern = cx.createPattern(checker, "repeat");
    cx.save();
    cx.shadowColor = "rgba(44,33,23,.18)";
    cx.shadowBlur = 22;
    cx.shadowOffsetY = 8;
    cx.fillStyle = "#fffdf8";
    cx.fillRect(dx, dy, dw, dh);
    cx.restore();
    cx.save();
    cx.beginPath();
    cx.rect(dx, dy, dw, dh);
    cx.clip();
    cx.fillStyle = checkerPattern;
    cx.fillRect(dx, dy, dw, dh);
    cx.restore();
    cx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    for (const l of order()) {
      if (l.muted) continue;
      cx.globalAlpha = app.onion && l.id !== app.activeId ? ONION : 1;
      drawLayer(cx, l);
    }
    cx.globalAlpha = 1;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.strokeStyle = "rgba(63,48,35,.28)";
    cx.lineWidth = 1;
    cx.strokeRect(dx - .5, dy - .5, dw + 1, dh + 1);
    throttleExpressions();
  }
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => { renderPending = false; render(); });
  }
  function drawOverlay() {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, viewW, viewH);
    if (!cursorPos || pan || spaceDown) return;
    if (app.tool !== "brush" && app.tool !== "eraser") return;
    const r = Math.max(1.5, (app.size / 2) * view.scale);
    octx.beginPath();
    octx.arc(cursorPos.x, cursorPos.y, r, 0, Math.PI * 2);
    octx.strokeStyle = "rgba(255,255,255,.95)";
    octx.lineWidth = 2.6;
    octx.stroke();
    octx.beginPath();
    octx.arc(cursorPos.x, cursorPos.y, r, 0, Math.PI * 2);
    octx.strokeStyle = app.tool === "eraser" ? "rgba(207,61,61,.85)" : "rgba(40,30,20,.85)";
    octx.lineWidth = 1.2;
    octx.stroke();
  }
  function syncCursorMode() {
    ui.canvasWrap.dataset.mode = pan ? "panning" : spaceDown ? "pan" : app.tool;
  }

  // ---- expression previews ----
  const expThumbs = [];
  let expDirty = false, expLast = 0;
  function buildExpressions() {
    ui.expressions.textContent = "";
    for (const def of EXPRESSIONS) {
      const b = document.createElement("button");
      b.className = "exp";
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.title = `${def.label} をキャンバスに表示`;
      const c = document.createElement("canvas");
      c.width = 216; c.height = 324;
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", `${def.label} のプレビュー`);
      const span = document.createElement("span");
      span.textContent = def.label;
      b.append(c, span);
      b.onclick = () => setExpression(def.eyes, def.mouth);
      ui.expressions.append(b);
      expThumbs.push({ ...def, button: b, canvas: c, ctx: requireCanvasContext(c) });
    }
  }
  function currentEyes() { return EYE_KEYS.find((k) => !fixed(k)?.muted) || "eyesOpen"; }
  function currentMouth() { return MOUTH_KEYS.find((k) => !fixed(k)?.muted) || "mouthClosed"; }
  function setExpression(eyes, mouth) {
    for (const k of EYE_KEYS) { const l = fixed(k); if (l) l.muted = k !== eyes; }
    for (const k of MOUTH_KEYS) { const l = fixed(k); if (l) l.muted = k !== mouth; }
    const label = EXPRESSIONS.find((e) => e.eyes === eyes && e.mouth === mouth)?.label || "";
    if (label) say(`${label} を表示中です。`);
    update();
  }
  function renderExpressions() {
    expLast = performance.now();
    expDirty = false;
    const items = app.layers.filter((l) => l.kind === "item" && !l.muted);
    const back = fixed("backHair"), front = fixed("frontHair");
    for (const t of expThumbs) {
      const cx = t.ctx;
      const stack = [
        back && !back.muted ? back : null,
        fixed("faceBase"), fixed(t.eyes), fixed(t.mouth),
        ...items,
        front && !front.muted ? front : null,
      ].filter(Boolean);
      cx.setTransform(t.canvas.width / W, 0, 0, t.canvas.height / H, 0, 0);
      cx.clearRect(0, 0, W, H);
      for (const l of stack) drawLayer(cx, l);
    }
    const ce = currentEyes(), cm = currentMouth();
    for (const t of expThumbs) t.button.setAttribute("aria-pressed", String(t.eyes === ce && t.mouth === cm));
  }
  function throttleExpressions() {
    expDirty = true;
    if (performance.now() - expLast > 220) renderExpressions();
    else setTimeout(() => { if (expDirty && performance.now() - expLast > 200) renderExpressions(); }, 240);
  }

  // ---- UI sync ----
  function swatchButtons() { return Array.from(ui.swatches.querySelectorAll("[data-color]")); }
  function setOutput(input, text) { const o = input?.parentElement?.querySelector("output"); if (o) o.textContent = text; }
  function syncSwatches() {
    swatchButtons().forEach((b, i) => {
      const c = hex(b.dataset.color) || "#3c3026";
      b.dataset.color = c;
      b.style.setProperty("--swatch-color", c);
      b.setAttribute("aria-pressed", String(i === app.swatchIndex));
      b.setAttribute("aria-label", `色スウォッチ ${i + 1}: ${c}`);
    });
  }
  function syncPngControls() {
    const l = active();
    const list = ensureImportedList(l);
    const im = activeImported(l);
    ui.pngList.textContent = "";
    for (const [index, entry] of list.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${index + 1}. ${entry.name || "読み込みPNG"}`;
      button.title = `${entry.name || "読み込みPNG"} を選択`;
      button.setAttribute("aria-pressed", String(entry.id === l.activeImportedId));
      button.onclick = () => {
        if (!setActiveImported(l, entry.id)) return;
        say(`${l.label} のPNG「${entry.name || "読み込みPNG"}」を選択しました。`);
        update({ list: false });
      };
      ui.pngList.append(button);
    }
    ui.removePng.disabled = !im;
    ui.pngControls.hidden = !im;
    if (!im) return;
    const index = Math.max(0, list.findIndex((entry) => entry.id === im.id));
    ui.pngReadout.textContent = `選択中: ${index + 1}/${list.length} ${im.name || "読み込みPNG"}`;
    ui.imgX.value = String(Math.round(im.x || 0)); setOutput(ui.imgX, `${Math.round(im.x || 0)}px`);
    ui.imgY.value = String(Math.round(im.y || 0)); setOutput(ui.imgY, `${Math.round(im.y || 0)}px`);
    ui.imgScale.value = String(Math.round(im.scale || 100)); setOutput(ui.imgScale, `${Math.round(im.scale || 100)}%`);
  }
  function syncTools() {
    const states = [["brush", ui.brush], ["fill", ui.fill], ["eraser", ui.eraser]];
    for (const [key, btn] of states) {
      const on = app.tool === key;
      btn.setAttribute("aria-pressed", String(on));
      btn.classList.toggle("muted", !on);
    }
    ui.brushSize.value = String(app.size); setOutput(ui.brushSize, `${app.size}px`);
    ui.softness.value = String(app.softness); setOutput(ui.softness, `${app.softness}%`);
    ui.stab.value = String(app.stab); setOutput(ui.stab, `${app.stab}%`);
    ui.pressure.checked = app.pressure;
    ui.color.value = app.color;
    ui.onion.checked = app.onion;
    syncCursorMode();
    syncSwatches();
    syncPngControls();
    drawOverlay();
  }
  function renderLayers() {
    ui.layers.textContent = "";
    const rendered = new Set();
    const addRow = (l) => {
      rendered.add(l.id);
      const row = document.createElement("div");
      row.className = "layer";
      row.dataset.id = String(l.id);
      row.setAttribute("aria-selected", String(l.id === app.activeId));
      row.classList.toggle("is-muted", l.muted);
      const name = document.createElement("button");
      name.className = "layer-name"; name.type = "button"; name.dataset.act = "select"; name.textContent = l.label;
      row.append(name);
      const pngCount = ensureImportedList(l).length;
      if (pngCount) row.append(badge(pngCount > 1 ? `PNG×${pngCount}` : "PNG"));
      const mute = document.createElement("button");
      mute.className = "button icon"; mute.type = "button"; mute.dataset.act = "mute";
      mute.textContent = l.muted ? "−" : "👁";
      mute.title = l.muted ? "表示する" : "一時的に隠す（書き出しには含まれます）";
      row.append(mute);
      if (l.kind === "item") {
        const del = document.createElement("button");
        del.className = "button icon danger"; del.type = "button"; del.dataset.act = "delete"; del.textContent = "×";
        del.title = "このアイテムを削除";
        row.append(del);
      }
      ui.layers.append(row);
    };
    const addLabel = (text) => {
      const g = document.createElement("p");
      g.className = "group-label";
      g.textContent = text;
      ui.layers.append(g);
    };
    for (const [label, keys] of LAYER_GROUPS) {
      addLabel(label);
      for (const k of keys) { const l = fixed(k); if (l) addRow(l); }
    }
    const items = app.layers.filter((l) => l.kind === "item");
    if (items.length) {
      addLabel("アイテム");
      for (const l of items) addRow(l);
    }
  }
  function badge(text) { const b = document.createElement("span"); b.className = "badge"; b.textContent = text; return b; }
  function update({ list = true } = {}) {
    const l = active();
    ui.activeName.textContent = l?.label || "未選択";
    ui.undo.disabled = !app.undo.length;
    ui.redo.disabled = !app.redo.length;
    ui.addItem.disabled = app.layers.filter((x) => x.kind === "item").length >= MAX_ITEMS;
    syncTools();
    if (list) renderLayers();
    scheduleRender();
    renderExpressions();
  }

  // ---- history ----
  function snapshot(l) {
    return {
      data: l.ctx.getImageData(0, 0, W, H),
      importedImages: cloneImportedList(ensureImportedList(l)),
      activeImportedId: l.activeImportedId,
      nextImportedId: l.nextImportedId,
    };
  }
  function historyEntryBytes(entry) {
    const image = entry?.image || {};
    let bytes = image.data?.data?.byteLength || image.data?.byteLength || 0;
    const importedImages = Array.isArray(image.importedImages)
      ? image.importedImages
      : (image.imported ? [image.imported] : []);
    for (const imported of importedImages) bytes += String(imported?.src || "").length;
    return bytes;
  }
  function enforceHistoryBudget() {
    const totalBytes = () =>
      app.undo.reduce((sum, entry) => sum + historyEntryBytes(entry), 0) +
      app.redo.reduce((sum, entry) => sum + historyEntryBytes(entry), 0);
    while (totalBytes() > MAX_HISTORY_BYTES && app.undo.length > 1) app.undo.shift();
    while (totalBytes() > MAX_HISTORY_BYTES && app.redo.length > 0) app.redo.shift();
  }
  function pushUndo(l) {
    app.undo.push({ id: l.id, image: snapshot(l) });
    if (app.undo.length > MAX_HISTORY) app.undo.shift();
    app.redo.length = 0;
    enforceHistoryBudget();
    dirty = true;
  }
  function applyHistory(from, to) {
    while (from.length) {
      const e = from.pop(), l = byId(e.id);
      if (!l) continue;
      to.push({ id: l.id, image: snapshot(l) });
      if (to.length > MAX_HISTORY) to.shift();
      enforceHistoryBudget();
      l.ctx.putImageData(e.image.data, 0, 0);
      l.importedImages = cloneImportedList(e.image.importedImages || (e.image.imported ? [e.image.imported] : []));
      l.activeImportedId = e.image.activeImportedId || l.importedImages[l.importedImages.length - 1]?.id || null;
      l.nextImportedId = Math.max(e.image.nextImportedId || 1, 1, ...l.importedImages.map((im) => Math.round(im.id || 0) + 1));
      l.imported = null;
      app.activeId = l.id;
      ensureVisible(l);
      update();
      return true;
    }
    return false;
  }
  function undoStep() { if (applyHistory(app.undo, app.redo)) say("1手戻しました。"); }
  function redoStep() { if (applyHistory(app.redo, app.undo)) say("やり直しました。"); }

  // ---- pointer mapping & drawing ----
  function point(e) {
    const r = ui.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - view.x) / view.scale,
      y: (e.clientY - r.top - view.y) / view.scale,
    };
  }
  function screenPoint(e) {
    const r = ui.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function wheelDeltaPixels(e) {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(400, viewH || 0) : 1;
    return e.deltaY * unit;
  }
  function replacement() { const c = rgb(app.color); return [c.r, c.g, c.b, 255]; }
  function sameRgba(data, off, rgba) {
    return data[off] === rgba[0] && data[off + 1] === rgba[1] &&
      data[off + 2] === rgba[2] && data[off + 3] === rgba[3];
  }
  function alphaAwareRgbMatch(data, off, color, tolerance = TOL) {
    const a = data[off + 3];
    const colorTol = Math.min(48, tolerance + Math.round((255 - a) * .12));
    return Math.abs(data[off] - color[0]) <= colorTol &&
      Math.abs(data[off + 1] - color[1]) <= colorTol &&
      Math.abs(data[off + 2] - color[2]) <= colorTol;
  }
  function replacementEdgeMatch(data, off, rep, tolerance = TOL) {
    const a = data[off + 3];
    if (a <= 0 || a >= 255 - tolerance) return false;
    const colorTol = Math.min(48, tolerance + Math.round((255 - a) * .12));
    return Math.abs(data[off] - rep[0]) <= colorTol &&
      Math.abs(data[off + 1] - rep[1]) <= colorTol &&
      Math.abs(data[off + 2] - rep[2]) <= colorTol;
  }
  function targetMatch(data, off, target) {
    if (target[3] <= TOL) return data[off + 3] <= TOL;
    return Math.abs(data[off + 3] - target[3]) <= TOL && alphaAwareRgbMatch(data, off, target);
  }
  function flood(l, p) {
    const x0 = Math.floor(clamp(p.x, 0, W - 1)), y0 = Math.floor(clamp(p.y, 0, H - 1));
    const img = l.ctx.getImageData(0, 0, W, H), data = img.data;
    const start = y0 * W + x0, off = start * 4;
    const target = [data[off], data[off + 1], data[off + 2], data[off + 3]], rep = replacement();
    const q = new Int32Array(W * H), visited = new Uint8Array(W * H);
    let h = 0, t = 0, changed = 0;
    const put = (idx) => {
      if (visited[idx]) return;
      visited[idx] = 1;
      const o = idx * 4;
      const hitTarget = targetMatch(data, o, target);
      if (!hitTarget && !replacementEdgeMatch(data, o, rep)) return;
      if (!sameRgba(data, o, rep)) {
        data[o] = rep[0]; data[o + 1] = rep[1]; data[o + 2] = rep[2]; data[o + 3] = rep[3];
        changed += 1;
      }
      q[t++] = idx;
    };
    put(start);
    while (h < t) {
      const idx = q[h++], x = idx % W;
      if (x > 0) put(idx - 1);
      if (x < W - 1) put(idx + 1);
      if (idx >= W) put(idx - W);
      if (idx < W * (H - 1)) put(idx + W);
    }
    if (changed > 0) l.ctx.putImageData(img, 0, 0);
    return changed > 0;
  }
  function softColor(a) {
    if (app.tool === "eraser") return `rgba(0,0,0,${a})`;
    const c = rgb(app.color);
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  }
  function stamp(l, p, w) {
    const cx = l.ctx;
    const radius = Math.max(.35, w / 2);
    cx.save();
    cx.globalCompositeOperation = app.tool === "eraser" ? "destination-out" : "source-over";
    if (app.softness > 1) {
      const soft = clamp(app.softness, 0, 100) / 100;
      const inner = radius * clamp(1 - soft * .92, .06, 1);
      const g = cx.createRadialGradient(p.x, p.y, inner, p.x, p.y, radius);
      g.addColorStop(0, softColor(1));
      g.addColorStop(1, softColor(0));
      cx.fillStyle = g;
    } else {
      cx.fillStyle = app.tool === "eraser" ? "rgba(0,0,0,1)" : app.color;
    }
    cx.beginPath();
    cx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    cx.fill();
    cx.restore();
  }
  function stampSegment(l, a, b, w0, w1) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < .01) { stamp(l, b, w1); return; }
    const soft = app.softness > 1;
    const minR = Math.max(.35, Math.min(w0, w1) / 2);
    const spacing = Math.max(soft ? .75 : .55, minR * (soft ? .42 - (app.softness / 100) * .24 : .45));
    const n = Math.min(900, Math.max(1, Math.ceil(dist / spacing)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      stamp(l, { x: a.x + dx * t, y: a.y + dy * t }, w0 + (w1 - w0) * t);
    }
  }
  function strokeWidth(e) {
    if (!(app.pressure && e.pointerType === "pen")) return app.size;
    const pr = clamp(e.pressure ?? .5, .02, 1);
    return Math.max(1, app.size * (.12 + .88 * Math.pow(pr, 1.35)));
  }
  function ensureVisible(l) {
    if (!l) return;
    if (l.key && EYE_KEYS.includes(l.key)) { for (const k of EYE_KEYS) { const s = fixed(k); if (s) s.muted = k !== l.key; } return; }
    if (l.key && MOUTH_KEYS.includes(l.key)) { for (const k of MOUTH_KEYS) { const s = fixed(k); if (s) s.muted = k !== l.key; } return; }
    l.muted = false;
  }

  function down(e) {
    if (e.button === 1 || spaceDown) {
      pan = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
      try { ui.canvas.setPointerCapture?.(e.pointerId); } catch {}
      syncCursorMode();
      drawOverlay();
      e.preventDefault();
      return;
    }
    const l = active();
    if (!l || (e.button != null && e.button !== 0)) return;
    const p = point(e);
    e.preventDefault();
    if (p.x < -app.size || p.x > W + app.size || p.y < -app.size || p.y > H + app.size) return;
    if (l.muted) ensureVisible(l);
    if (app.tool === "fill") {
      if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) return;
      // 変化を確定させてから undo に積む。先に push すると redo がクリアされ、
      // 「同じ色で無変化」だった場合にやり直し履歴が失われてしまう。
      const before = snapshot(l);
      if (!flood(l, p)) {
        say("同じ色のため塗りつぶしませんでした。");
      } else {
        app.undo.push({ id: l.id, image: before });
        if (app.undo.length > MAX_HISTORY) app.undo.shift();
        app.redo.length = 0;
        enforceHistoryBudget();
        dirty = true;
        say(`${l.label} を塗りつぶしました。`);
      }
      update({ list: false });
      return;
    }
    pushUndo(l);
    const w = strokeWidth(e);
    stroke = { id: l.id, pointerId: e.pointerId, last: p, raw: p, w };
    try { ui.canvas.setPointerCapture?.(e.pointerId); } catch {}
    stamp(l, p, w);
    update();
  }
  function preventMiddleButtonDefault(e) {
    if (e.button === 1) e.preventDefault();
  }
  function move(e) {
    cursorPos = screenPoint(e);
    if (pan && e.pointerId === pan.pointerId) {
      view.x = pan.ox + (e.clientX - pan.sx);
      view.y = pan.oy + (e.clientY - pan.sy);
      autoFit = false;
      clampView();
      scheduleRender();
      return;
    }
    drawOverlay();
    if (!stroke || e.pointerId !== stroke.pointerId) return;
    const l = byId(stroke.id);
    if (!l) return;
    e.preventDefault();
    const alpha = 1 - .9 * clamp(app.stab, 0, 100) / 100;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
    for (const sample of events.length ? events : [e]) {
      const raw = point(sample);
      const sm = { x: stroke.last.x + (raw.x - stroke.last.x) * alpha, y: stroke.last.y + (raw.y - stroke.last.y) * alpha };
      const w = stroke.w + (strokeWidth(sample) - stroke.w) * .35;
      stampSegment(l, stroke.last, sm, stroke.w, w);
      stroke.last = sm;
      stroke.raw = raw;
      stroke.w = w;
    }
    scheduleRender();
  }
  function up(e) {
    if (pan && (!e || e.pointerId === pan.pointerId)) { pan = null; syncCursorMode(); drawOverlay(); return; }
    if (!stroke || (e && e.pointerId !== stroke.pointerId)) return;
    const l = byId(stroke.id);
    if (l && app.stab > 0) stampSegment(l, stroke.last, stroke.raw, stroke.w, stroke.w);
    stroke = null;
    update({ list: false });
  }

  // ---- export ----
  function bounds(l, flat = flatten(l)) {
    const cx = requireCanvasContext(flat, { willReadFrequently: true }), data = cx.getImageData(0, 0, W, H).data;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] <= 0) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return maxX < minX ? null : { minX, minY, maxX, maxY };
  }
  function hasInk(l) { return Boolean(bounds(l)); }
  function pick(ink, list) { return list.find((k) => ink[k]) || list[0]; }
  function faceCanvas(eyes, mouth) {
    const { canvas, ctx } = makeCanvas();
    for (const key of ["faceBase", eyes, mouth]) { const l = fixed(key); if (l) drawLayer(ctx, l); }
    return canvas;
  }
  function toBlob(c) { return new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("PNG変換に失敗しました。")), "image/png")); }
  async function output(c, name) { const blob = await toBlob(c); return { name, url: URL.createObjectURL(blob) }; }
  function revokeOutputObjectUrls() {
    for (const url of outputObjectUrls) URL.revokeObjectURL(url);
    outputObjectUrls = [];
  }
  function revokeProjectObjectUrl(url) {
    URL.revokeObjectURL(url);
    projectObjectUrls = projectObjectUrls.filter((item) => item !== url);
  }
  function revokeProjectObjectUrls() {
    for (const url of projectObjectUrls) URL.revokeObjectURL(url);
    projectObjectUrls = [];
  }
  async function buildOutputs() {
    const ink = Object.create(null);
    app.layers.filter((l) => l.kind === "fixed").forEach((l) => { ink[l.key] = hasInk(l); });
    if (!ink.faceBase) throw new Error("顔ベースが未完成です。顔ベースに描くかPNGを読み込んでください。");
    const outs = [];
    for (const [name, eyesList, mouthList] of COMBOS) outs.push(await output(faceCanvas(pick(ink, eyesList), pick(ink, mouthList)), `${name}.png`));
    outs.push(await output(flatten(fixed("frontHair")), "front-hair.png"));
    outs.push(await output(flatten(fixed("backHair")), "back-hair.png"));
    let idx = 1;
    for (const l of app.layers.filter((x) => x.kind === "item")) {
      const flat = flatten(l), b = bounds(l, flat); if (!b) continue;
      const cw = b.maxX - b.minX + 1, ch = b.maxY - b.minY + 1;
      const crop = document.createElement("canvas"); crop.width = cw; crop.height = ch;
      requireCanvasContext(crop).drawImage(flat, b.minX, b.minY, cw, ch, 0, 0, cw, ch);
      outs.push(await output(crop, `item-${idx++}-${safeFilenamePart(l.label, "item")}.png`));
    }
    return outs;
  }
  function download(url, name) { const a = document.createElement("a"); a.href = url; a.download = name; a.style.display = "none"; document.body.append(a); a.click(); a.remove(); }
  function showOutputs(outs) {
    revokeOutputObjectUrls();
    outputObjectUrls = outs.map((o) => o.url);
    ui.outputs.textContent = "";
    const all = document.createElement("button"); all.className = "primary wide"; all.textContent = "生成PNGをすべて保存";
    all.onclick = () => outs.forEach((o, i) => setTimeout(() => download(o.url, o.name), i * 180));
    ui.outputs.append(all);
    for (const o of outs) {
      const row = document.createElement("div"); row.className = "output";
      const img = document.createElement("img"); img.src = o.url;
      const name = document.createElement("span"); name.textContent = o.name;
      const link = document.createElement("a"); link.href = o.url; link.download = o.name; link.textContent = "保存";
      row.append(img, name, link); ui.outputs.append(row);
    }
  }
  async function finish() {
    try { say("PNGを生成しています…"); const outs = await buildOutputs(); showOutputs(outs); say(`${outs.length}個のPNGを生成しました。`); }
    catch (e) { console.warn(e); say(e instanceof Error ? e.message : "PNG生成に失敗しました。"); }
  }

  // ---- import / project ----
  function dataUrl(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = () => rej(new Error("ファイルを読み込めませんでした。")); r.readAsDataURL(file); });
  }
  function loadImage(src, name = "PNG") {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        if (!im.decode) {
          res(im);
          return;
        }
        im.decode().catch(() => {}).then(() => res(im));
      };
      im.onerror = () => rej(new Error(`${name}を読み込めませんでした。`));
      im.src = src;
    });
  }
  function initialScale(im) {
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    return Math.round(clamp(Math.min(W / iw, H / ih, 1) * 100, 5, 300));
  }
  async function loadPng(file) {
    if (!file) return null;
    if (!/\.png$/i.test(file.name || "") && file.type !== "image/png") throw new Error("PNG画像を選んでください。");
    if (file.size > MAX_PNG_FILE_SIZE) throw new Error("PNG画像が大きすぎます。3MB以下のPNGを選んでください。");
    const src = validatePngDataUrl(await dataUrl(file), file.name || "PNG画像");
    const im = await loadImage(src, file.name);
    assertImageSize(im, file.name || "PNG画像");
    return { el: im, src, name: file.name || "読み込みPNG", x: 0, y: 0, scale: initialScale(im) };
  }
  async function importPng(files) {
    const l = active();
    const fileList = Array.from(files || []).filter(Boolean);
    if (!l || !fileList.length) return;
    try {
      const loaded = [];
      for (const file of fileList) loaded.push(await loadPng(file));
      pushUndo(l);
      const list = ensureImportedList(l);
      for (const im of loaded.filter(Boolean)) {
        im.id = Math.max(1, Math.round(l.nextImportedId || 1));
        l.nextImportedId = im.id + 1;
        list.push(im);
        l.activeImportedId = im.id;
      }
      say(`${l.label} に${loaded.length === 1 ? "PNGを1枚" : `${loaded.length}枚のPNGを`}追加しました。`);
      update();
    } catch (e) { console.warn(e); say(e instanceof Error ? e.message : "PNG読み込みに失敗しました。"); }
    finally { ui.pngFile.value = ""; }
  }
  function removeImported() {
    const l = active(), list = ensureImportedList(l), im = activeImported(l);
    if (!l || !im) return;
    pushUndo(l);
    const index = list.findIndex((entry) => entry.id === im.id);
    if (index >= 0) list.splice(index, 1);
    l.activeImportedId = (list[Math.min(index, list.length - 1)] || list[list.length - 1])?.id || null;
    transformLayerId = null;
    update();
  }
  function beginTransform() {
    const l = active(), im = activeImported(l);
    const key = l && im ? `${l.id}:${im.id}` : null;
    if (!l || !im || transformLayerId === key) return;
    pushUndo(l); transformLayerId = key;
  }
  function endTransform() { transformLayerId = null; }
  function setTransform(prop, val) {
    const im = activeImported(); if (!im) return;
    if (prop === "x") im.x = Math.round(clamp(val, -W, W));
    if (prop === "y") im.y = Math.round(clamp(val, -H, H));
    if (prop === "scale") im.scale = Math.round(clamp(val, 5, 300));
    update({ list: false });
  }
  function centerImported() {
    const l = active(), im = activeImported(l);
    if (!l || !im) return;
    pushUndo(l); im.x = 0; im.y = 0; update({ list: false });
  }

  function serialize() {
    return {
      format: "standalone-drawing-avatar-project", version: 2, nextId: app.nextId, itemCount: app.itemCount,
      activeId: app.activeId, tool: app.tool, size: app.size, softness: app.softness, stab: app.stab,
      pressure: app.pressure, color: app.color,
      swatchIndex: app.swatchIndex, swatches: swatchButtons().map((b) => hex(b.dataset.color) || "#3c3026"), onion: app.onion,
      layers: app.layers.map((l) => ({ id: l.id, key: l.key, label: l.label, kind: l.kind, muted: l.muted,
        canvas: l.canvas.toDataURL("image/png"),
        activeImportedId: l.activeImportedId || null,
        nextImportedId: Math.max(1, Math.round(l.nextImportedId || 1)),
        importedImages: ensureImportedList(l).map((im) => ({
          id: Math.max(1, Math.round(im.id || 1)), src: im.src, name: im.name, x: im.x, y: im.y, scale: im.scale,
        })),
      })),
    };
  }
  async function restore(project) {
    if (!project || project.format !== "standalone-drawing-avatar-project" || !Array.isArray(project.layers)) throw new Error("プロジェクトJSON形式が違います。");
    if (project.layers.length > MAX_PROJECT_LAYERS) throw new Error(`プロジェクトのレイヤー数が多すぎます。最大${MAX_PROJECT_LAYERS}レイヤーまでです。`);
    const restored = [];
    for (const s of project.layers) {
      const def = s.kind === "fixed" ? FIXED.find(([key]) => key === s.key) : null;
      const itemLabel = safeFilenamePart(s.label, `アイテム${restored.length + 1}`);
      const l = makeLayer({ id: Math.max(1, Math.round(s.id || restored.length + 1)), key: s.kind === "fixed" ? def?.[0] || s.key : null, label: s.kind === "fixed" ? def?.[1] || s.label : itemLabel, kind: s.kind === "fixed" ? "fixed" : "item", muted: Boolean(s.muted) });
      if (s.canvas) {
        const canvasSrc = validatePngDataUrl(s.canvas, l.label);
        const im = await loadImage(canvasSrc, l.label);
        assertImageSize(im, l.label);
        l.ctx.drawImage(im, 0, 0, W, H);
      }
      const rawImages = Array.isArray(s.importedImages) ? s.importedImages : (s.imported?.src ? [s.imported] : []);
      if (rawImages.length > MAX_IMPORTED_IMAGES_PER_LAYER) throw new Error(`1レイヤー内の読み込みPNGが多すぎます。最大${MAX_IMPORTED_IMAGES_PER_LAYER}枚までです。`);
      const usedImageIds = new Set();
      let nextImportedId = 1;
      for (const raw of rawImages) {
        if (!raw?.src) continue;
        const imageName = raw.name || "読み込みPNG";
        const src = validatePngDataUrl(raw.src, imageName);
        const im = await loadImage(src, imageName);
        assertImageSize(im, imageName);
        let id = Math.max(1, Math.round(raw.id || nextImportedId));
        if (usedImageIds.has(id)) id = nextImportedId;
        usedImageIds.add(id);
        nextImportedId = Math.max(nextImportedId, id + 1);
        l.importedImages.push({ id, el: im, src, name: imageName, x: raw.x || 0, y: raw.y || 0, scale: raw.scale || 100 });
      }
      l.nextImportedId = Math.max(nextImportedId, Math.round(s.nextImportedId || 0));
      l.activeImportedId = l.importedImages.some((im) => im.id === s.activeImportedId)
        ? s.activeImportedId
        : (l.importedImages[l.importedImages.length - 1]?.id || null);
      restored.push(l);
    }
    const map = new Map(restored.filter((l) => l.kind === "fixed").map((l) => [l.key, l])), items = restored.filter((l) => l.kind === "item"), ordered = [];
    for (const [key, label] of FIXED) {
      const maxId = [...restored, ...ordered].reduce((max, x) => Math.max(max, Math.round(x.id) || 0), 0);
      let l = map.get(key) || makeLayer({ id: 1 + maxId, key, label, kind: "fixed", muted: DEFAULT_MUTED.has(key) });
      l.label = label; if (key === "frontHair") ordered.push(...items); ordered.push(l);
    }
    const used = new Set(); let next = 1;
    for (const l of ordered) { if (used.has(l.id)) l.id = next; used.add(l.id); next = Math.max(next, l.id + 1); }
    app = { layers: ordered, nextId: Math.max(next, project.nextId || 0), itemCount: Math.max(project.itemCount || 0, items.length),
      activeId: ordered.some((l) => l.id === project.activeId) ? project.activeId : ordered[0].id, undo: [], redo: [],
      tool: ["brush", "fill", "eraser"].includes(project.tool) ? project.tool : "brush",
      size: Math.round(clamp(project.size || 14, 1, 400)), softness: Math.round(clamp(project.softness || 0, 0, 100)),
      stab: Math.round(clamp(project.stab ?? 30, 0, 100)), pressure: project.pressure !== false,
      color: hex(project.color) || "#3c3026", swatchIndex: Math.round(clamp(project.swatchIndex || 0, 0, 99)), onion: project.onion !== false };
    if (Array.isArray(project.swatches)) swatchButtons().forEach((b, i) => { const c = hex(project.swatches[i]); if (c) b.dataset.color = c; });
    revokeOutputObjectUrls();
    ui.outputs.textContent = ""; say("プロジェクトを読み込みました。"); update();
  }
  function saveProject() {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); download(url, `drawing-avatar-project-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
    projectObjectUrls.push(url);
    requestAnimationFrame(() => revokeProjectObjectUrl(url));
    dirty = false; say("プロジェクトJSONを書き出しました。");
  }
  function sanitizeProjectJson(value, depth = 0, budget = null) {
    // 本体アプリの sanitizeImportedJsonValue と同様に、外部 JSON の危険キーを除去し
    // プロトタイプ汚染を無効化する。null プロトタイプのオブジェクトへ own-property のみ移し替える。
    const counter = budget || { nodes: 0 };
    counter.nodes += 1;
    if (counter.nodes > MAX_PROJECT_NODE_COUNT) throw new Error("プロジェクトJSONの要素数が多すぎます。");
    if (depth > MAX_PROJECT_JSON_DEPTH) throw new Error("プロジェクトJSONの階層が深すぎます。");
    if (typeof value === "string" && value.length > MAX_PROJECT_STRING_LENGTH) {
      throw new Error("プロジェクトJSON内の文字列が大きすぎます。");
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_PROJECT_ARRAY_LENGTH) throw new Error("プロジェクトJSONの配列が大きすぎます。");
      return value.map((item) => sanitizeProjectJson(item, depth + 1, counter));
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length > MAX_PROJECT_KEYS_PER_OBJECT) throw new Error("プロジェクトJSONの項目数が多すぎます。");
      const clean = Object.create(null);
      for (const key of keys) {
        if (FORBIDDEN_JSON_KEYS.has(key)) continue;
        clean[key] = sanitizeProjectJson(value[key], depth + 1, counter);
      }
      return clean;
    }
    return value;
  }

  async function loadProject(file) {
    if (!file) return;
    try {
      if (file.size > MAX_PROJECT_FILE_SIZE) throw new Error("プロジェクトJSONが大きすぎます。");
      await restore(sanitizeProjectJson(JSON.parse(await file.text())));
      dirty = false;
    }
    catch (e) { console.warn(e); say(e instanceof Error ? e.message : "プロジェクト読込に失敗しました。"); }
    finally { ui.projectFile.value = ""; }
  }

  // ---- item layers ----
  function addItem() {
    if (app.layers.filter((l) => l.kind === "item").length >= MAX_ITEMS) { say(`アイテムは最大${MAX_ITEMS}個です。`); return; }
    app.itemCount += 1;
    const l = makeLayer({ id: app.nextId++, key: null, label: `アイテム${app.itemCount}`, kind: "item" });
    const i = app.layers.findIndex((x) => x.kind === "fixed" && x.key === "frontHair");
    i >= 0 ? app.layers.splice(i, 0, l) : app.layers.push(l);
    app.activeId = l.id; update();
  }
  function deleteItem(id) {
    const l = byId(id); if (!l || l.kind !== "item") return;
    app.layers = app.layers.filter((x) => x.id !== l.id); app.undo = app.undo.filter((x) => x.id !== l.id); app.redo = app.redo.filter((x) => x.id !== l.id);
    if (app.activeId === l.id) app.activeId = fixed("faceBase")?.id || app.layers[0].id;
    update();
  }

  // ---- bindings ----
  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }
  function bind() {
    ui.brush.onclick = () => { app.tool = "brush"; update({ list: false }); };
    ui.fill.onclick = () => { app.tool = "fill"; update({ list: false }); };
    ui.eraser.onclick = () => { app.tool = "eraser"; update({ list: false }); };
    ui.brushSize.oninput = (e) => { app.size = Math.round(clamp(e.target.value, 1, 400)); syncTools(); };
    ui.softness.oninput = (e) => { app.softness = Math.round(clamp(e.target.value, 0, 100)); syncTools(); };
    ui.stab.oninput = (e) => { app.stab = Math.round(clamp(e.target.value, 0, 100)); syncTools(); };
    ui.pressure.onchange = (e) => { app.pressure = Boolean(e.target.checked); };
    ui.color.oninput = (e) => {
      app.color = hex(e.target.value) || app.color;
      const buttons = swatchButtons(); if (buttons[app.swatchIndex]) buttons[app.swatchIndex].dataset.color = app.color;
      if (app.tool === "eraser") app.tool = "brush";
      update({ list: false });
    };
    ui.swatches.onclick = (e) => {
      const b = e.target.closest("[data-color]"); if (!b) return;
      app.swatchIndex = Math.max(0, swatchButtons().indexOf(b)); app.color = hex(b.dataset.color) || app.color;
      if (app.tool === "eraser") app.tool = "brush";
      update({ list: false });
    };
    ui.undo.onclick = undoStep; ui.redo.onclick = redoStep;
    ui.clear.onclick = () => {
      const l = active();
      if (!l) return;
      pushUndo(l);
      l.ctx.clearRect(0, 0, W, H);
      l.importedImages = [];
      l.activeImportedId = null;
      l.imported = null;
      transformLayerId = null;
      update();
    };
    ui.onion.onchange = (e) => { app.onion = Boolean(e.target.checked); scheduleRender(); };
    ui.addItem.onclick = addItem;
    ui.layers.onclick = (e) => {
      const row = e.target.closest(".layer"), b = e.target.closest("button"); if (!row || !b) return;
      const id = Number(row.dataset.id);
      const l = byId(id);
      if (b.dataset.act === "select") { app.activeId = id; ensureVisible(l); }
      if (b.dataset.act === "mute" && l) l.muted = !l.muted;
      if (b.dataset.act === "delete") { deleteItem(id); return; }
      update();
    };
    ui.importPng.onclick = () => ui.pngFile.click();
    ui.pngFile.onchange = (e) => importPng(e.target.files);
    ui.removePng.onclick = removeImported;
    for (const [input, prop] of [[ui.imgX, "x"], [ui.imgY, "y"], [ui.imgScale, "scale"]]) {
      input.onpointerdown = beginTransform; input.onkeydown = beginTransform;
      input.oninput = (e) => { beginTransform(); setTransform(prop, e.target.value); };
      input.onchange = input.onpointerup = input.onblur = endTransform;
    }
    ui.centerPng.onclick = centerImported;
    ui.finish.onclick = finish;
    ui.saveProject.onclick = saveProject;
    ui.loadProject.onclick = () => ui.projectFile.click();
    ui.projectFile.onchange = (e) => loadProject(e.target.files?.[0]);

    ui.zoomIn.onclick = () => zoomAt(viewW / 2, viewH / 2, 1.25);
    ui.zoomOut.onclick = () => zoomAt(viewW / 2, viewH / 2, .8);
    ui.zoomFit.onclick = () => { fitView(); scheduleRender(); drawOverlay(); };
    ui.zoomLabel.onclick = () => setZoom(1);
    ui.canvasWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = screenPoint(e);
      zoomAt(p.x, p.y, Math.exp(-wheelDeltaPixels(e) * .0016));
    }, { passive: false });
    ui.canvasWrap.addEventListener("mousedown", preventMiddleButtonDefault);
    ui.canvasWrap.addEventListener("auxclick", preventMiddleButtonDefault);

    ui.canvas.onpointerdown = down;
    ui.canvas.onpointermove = move;
    ui.canvas.onpointerup = up;
    ui.canvas.onpointercancel = up;
    ui.canvas.onpointerleave = () => { cursorPos = null; drawOverlay(); };

    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey) {
        const k = String(e.key || "").toLowerCase();
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undoStep(); }
        if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redoStep(); }
        return;
      }
      if (isTyping(e)) return;
      if (e.code === "Space") {
        if (e.target && e.target.tagName === "BUTTON") e.target.blur();
        if (!spaceDown) { spaceDown = true; syncCursorMode(); drawOverlay(); }
        e.preventDefault();
        return;
      }
      const k = String(e.key || "").toLowerCase();
      if (k === "b") { app.tool = "brush"; update({ list: false }); }
      else if (k === "g") { app.tool = "fill"; update({ list: false }); }
      else if (k === "e") { app.tool = "eraser"; update({ list: false }); }
      else if (k === "[") { app.size = Math.max(1, Math.round(app.size * .85) - 1); syncTools(); }
      else if (k === "]") { app.size = Math.min(400, Math.round(app.size * 1.18) + 1); syncTools(); }
      else if (k === "+" || k === "=") zoomAt(viewW / 2, viewH / 2, 1.25);
      else if (k === "-") zoomAt(viewW / 2, viewH / 2, .8);
      else if (k === "0") { fitView(); scheduleRender(); drawOverlay(); }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") { spaceDown = false; syncCursorMode(); drawOverlay(); }
    });
    window.addEventListener("blur", () => { spaceDown = false; pan = null; syncCursorMode(); });
    window.addEventListener("pagehide", () => {
      revokeOutputObjectUrls();
      revokeProjectObjectUrls();
    });
    window.addEventListener("beforeunload", (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });

    new ResizeObserver(resizeDisplay).observe(ui.canvasWrap);
  }

  buildExpressions();
  bind();
  resizeDisplay();
  update();
  say("①顔ベース → ②目・口の差分 → ③髪の順に描くのがおすすめです。");
})();
