import { MODEL_URL, LABELS_URL, MODEL_CACHE_KEY, IMAGE_SIZE, parseTagCsv, decodePredictions, chooseRating, selectTags, buildPrompt, formatTag, normalizeTag, percentile, rasterToTensorData } from './core.js';

const $ = id => document.getElementById(id);
const el = {
  imageInput: $('imageInput'), dropzone: $('dropzone'), dropEmpty: $('dropEmpty'), previewImage: $('previewImage'), replaceOverlay: $('replaceOverlay'),
  imageMeta: $('imageMeta'), clearImageBtn: $('clearImageBtn'), sourceSelect: $('sourceSelect'), localModelRow: $('localModelRow'), localModelInput: $('localModelInput'), localModelName: $('localModelName'), localLabelsInput: $('localLabelsInput'), localLabelsName: $('localLabelsName'), backendSelect: $('backendSelect'), cacheModelInput: $('cacheModelInput'),
  progressWrap: $('progressWrap'), progressFill: $('progressFill'), progressStage: $('progressStage'), progressPercent: $('progressPercent'),
  analyzeBtn: $('analyzeBtn'), analyzeLabel: $('analyzeLabel'), engineDot: $('engineDot'), engineLabel: $('engineLabel'), statusMessage: $('statusMessage'),
  generalThreshold: $('generalThreshold'), generalThresholdVal: $('generalThresholdVal'), characterThreshold: $('characterThreshold'), characterThresholdVal: $('characterThresholdVal'),
  tagList: $('tagList'), resultCount: $('resultCount'), resetHiddenBtn: $('resetHiddenBtn'), ratingLine: $('ratingLine'), searchTags: $('searchTags'),
  manualTagInput: $('manualTagInput'), addTagBtn: $('addTagBtn'), tagSuggestions: $('tagSuggestions'),
  formatSelect: $('formatSelect'), weightSelect: $('weightSelect'), includeQualityInput: $('includeQualityInput'), includeCharactersInput: $('includeCharactersInput'),
  prefixInput: $('prefixInput'), promptOutput: $('promptOutput'), tokenCount: $('tokenCount'), negativeOutput: $('negativeOutput'),
  copyPromptBtn: $('copyPromptBtn'), copyNegativeBtn: $('copyNegativeBtn'), downloadTxtBtn: $('downloadTxtBtn'), exportJsonBtn: $('exportJsonBtn'), toast: $('toast')
};
const state = {
  imageUrl: null, imageFile: null, modelFile: null, labelsFile: null, session: null,
  labels: null, labelMap: new Map(), predictions: [], excluded: new Set(), manual: new Map(), busy: false,
  tagFilter: 'all', cacheEnabled: true, currentModelSource: null, currentBackend: null,
  lastStatus: 'idle', toastTimer: null
};

function announce(message, kind = '') {
  el.statusMessage.textContent = message;
  el.statusMessage.className = `status-message ${kind}`;
  state.lastStatus = kind;
}
function badge(label, mode = '') {
  el.engineLabel.textContent = label;
  el.engineDot.className = `pill-dot ${mode}`;
}
function progress(stage, fraction = null) {
  el.progressWrap.hidden = false; el.progressStage.textContent = stage;
  if (fraction === null) { el.progressPercent.textContent = '…'; el.progressFill.style.width = '10%'; return; }
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  el.progressPercent.textContent = `${percent}%`; el.progressFill.style.width = `${percent}%`;
}
function toast(message) {
  el.toast.textContent = message; el.toast.classList.add('shown');
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.toast.classList.remove('shown'), 2500);
}
function updateAction() {
  el.analyzeBtn.disabled = state.busy || !state.imageFile;
  el.analyzeLabel.textContent = state.busy ? 'Analyzing…' : state.predictions.length ? 'Analyze again' : 'Analyze image';
  el.clearImageBtn.disabled = state.busy || !state.imageFile;
}
function resetAnalysis() {
  state.predictions = []; state.excluded.clear(); state.manual.clear();
  el.searchTags.value = ''; el.ratingLine.hidden = true;
  renderTags(); renderPrompt(); updateAction();
}
function setImage(file) {
  if (state.busy) { toast('Analysis is running.'); return; }
  if (!file) return;
  if (!(/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name))) { announce('Choose a PNG, JPG, WEBP, GIF or BMP image.', 'error'); return; }
  if (file.size > 30 * 1024 * 1024) { announce('Images must be 30 MB or smaller.', 'error'); return; }
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageFile = file; state.imageUrl = URL.createObjectURL(file);
  el.previewImage.onload = () => {
    el.imageMeta.innerHTML = '';
    const a = document.createElement('span'); a.textContent = `${file.name} · ${el.previewImage.naturalWidth} × ${el.previewImage.naturalHeight}`;
    const b = document.createElement('span'); b.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · LOCAL IMAGE`;
    el.imageMeta.append(a, b);
  };
  el.previewImage.onerror = () => announce('This image could not be decoded by the browser.', 'error');
  el.previewImage.src = state.imageUrl; el.previewImage.hidden = false; el.dropEmpty.hidden = true; el.replaceOverlay.hidden = false;
  resetAnalysis(); announce('Image ready. Press Analyze image to start.', 'success');
}
function clearImage() {
  if (state.busy) return;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = null; state.imageFile = null; el.imageInput.value = '';
  el.previewImage.removeAttribute('src'); el.previewImage.hidden = true;
  el.dropEmpty.hidden = false; el.replaceOverlay.hidden = true;
  el.imageMeta.innerHTML = '<span>NO IMAGE SELECTED</span><span>YOUR IMAGES STAY IN YOUR BROWSER</span>';
  resetAnalysis(); announce('Choose an image to start.');
}

function openModelDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open('GavenTagModelCache', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('models');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Unable to open IndexedDB'));
  });
}
async function cacheGet(key) {
  let db;
  try {
    db = await openModelDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readonly');
      const req = tx.objectStore('models').get(key);
      req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => reject(req.error);
    });
  } catch (e) { console.warn('Model cache read not available:', e); return null; }
  finally { db?.close(); }
}
async function cachePut(key, data) {
  let db;
  try {
    if ('storage' in navigator && navigator.storage.estimate) {
      const { quota, usage } = await navigator.storage.estimate();
      if (quota && usage != null && quota - usage < data.byteLength * 1.2) throw new Error('Not enough storage quota');
    }
    db = await openModelDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite');
      tx.objectStore('models').put(new Blob([data]), key);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } catch (e) { console.warn('Model cache skipped:', e); toast('Model cache unavailable; inference can still work.'); }
  finally { db?.close(); }
}

async function fetchArrayBuffer(url, updateProgress) {
  let response;
  try { response = await fetch(url, {mode: 'cors'}); }
  catch (error) { throw new Error(`Unable to download the model (${error.message}). Check your network or switch to a local ONNX file.`); }
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}. Try selecting a local ONNX file.`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !response.body.getReader) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = []; let loaded = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      chunks.push(value); loaded += value.length;
      if (total) updateProgress(Math.min(.99, loaded / total));
      else updateProgress(null, `${(loaded / 1024 / 1024).toFixed(1)} MB`);
    }
  } catch (e) { throw new Error(`Interrupted model download: ${e.message}`); }
  const bytes = new Uint8Array(loaded); let off = 0;
  for (const chunk of chunks) { bytes.set(chunk, off); off += chunk.length; }
  return bytes.buffer;
}
async function loadLabels() {
  if (state.labels && !state.labelsFile) return;
  progress('Loading Danbooru vocabulary', .02);
  let csv;
  if (state.labelsFile) csv = await state.labelsFile.text();
  else {
    try { const r = await fetch(LABELS_URL, {mode:'cors'}); if (!r.ok) throw new Error(`HTTP ${r.status}`); csv = await r.text(); }
    catch(e) { throw new Error(`Cannot load selected_tags.csv (${e.message}). Choose a local CSV via “Optional local tags CSV”.`); }
  }
  state.labels = parseTagCsv(csv);
  state.labelMap = new Map(state.labels.map((l) => [l.name, l]));
  if (state.labels.length !== 10861) throw new Error(`This model expects 10,861 labels; loaded ${state.labels.length}. Use the matching v3 selected_tags.csv.`);
  buildSuggestions('');
}
async function getModelBytes() {
  if (el.sourceSelect.value === 'local') {
    if (!state.modelFile) throw new Error('Choose a local model.onnx file first.');
    progress('Reading your local ONNX file', null);
    return state.modelFile.arrayBuffer();
  }
  if (el.cacheModelInput.checked) {
    progress('Checking browser model cache', null);
    const cached = await cacheGet(MODEL_CACHE_KEY);
    if (cached) { progress('Loading model from browser cache', .99); return cached.arrayBuffer(); }
  }
  progress('Downloading WD ViT model (379 MB)', 0);
  const bytes = await fetchArrayBuffer(MODEL_URL, (fraction, note) => {
    if (fraction === null) progress(`Downloading model · ${note}`, null);
    else progress('Downloading WD ViT model (379 MB)', fraction);
  });
  if (bytes.byteLength < 100_000_000) throw new Error('Downloaded ONNX file is unexpectedly small.');
  if (el.cacheModelInput.checked) { progress('Caching model (optional)', .99); await cachePut(MODEL_CACHE_KEY, bytes); }
  return bytes;
}
async function loadSession() {
  const desiredSource = el.sourceSelect.value === 'local' ? state.modelFile : MODEL_CACHE_KEY;
  const desiredBackend = el.backendSelect.value;
  if (state.session && state.currentModelSource === desiredSource && state.currentBackend === desiredBackend) return state.session;
  if (!window.ort) throw new Error('ONNX Runtime did not load. Check your internet connection and refresh.');
  const ort = window.ort;
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
  ort.env.wasm.numThreads = 1; // Works on ordinary static hosting; no COOP/COEP headers required.
  await loadLabels();
  const bytes = await getModelBytes();
  progress('Initializing inference runtime', .99);
  // Explicit fallback is critical: WebGPU support varies by browser, GPU, and individual ONNX operator.
  let session;
  if (desiredBackend === 'auto' && navigator.gpu) {
    try {
      session = await ort.InferenceSession.create(bytes, {executionProviders:['webgpu','wasm'], graphOptimizationLevel:'all'});
      announce('WebGPU session initialized.', 'success');
    } catch (error) {
      console.warn('WebGPU initialization failed. Retrying with CPU WebAssembly.', error);
      announce('WebGPU unavailable for this model; retrying with CPU.');
    }
  }
  if (!session) session = await ort.InferenceSession.create(bytes, {executionProviders:['wasm'], graphOptimizationLevel:'all'});
  if (state.session) try { await state.session.release(); } catch (_) { /* older runtimes */ }
  state.session = session;
  state.currentModelSource = desiredSource; state.currentBackend = desiredBackend;
  badge('MODEL LOADED', 'ready');
  return session;
}
async function analyze() {
  if (state.busy || !state.imageFile) return;
  if (!el.previewImage.complete || !el.previewImage.naturalWidth) { announce('The image has not finished loading.', 'error'); return; }
  state.busy = true; updateAction(); badge('ENGINE WORKING', 'busy'); el.progressWrap.hidden = false;
  announce('Preparing local inference. Images are never uploaded.');
  try {
    const session = await loadSession();
    progress('Preparing square 448px BGR image', 1);
    // Yield one frame so progress is painted before synchronous tensor preparation.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    const tensorData = await rasterToTensorData(el.previewImage, IMAGE_SIZE);
    progress('Running neural network · local device', null);
    announce('Analyzing image on your device…');
    const tensor = new window.ort.Tensor('float32', tensorData, [1, IMAGE_SIZE, IMAGE_SIZE, 3]);
    const output = await session.run({[session.inputNames[0]]:tensor});
    const values = output[session.outputNames[0]]?.data;
    state.predictions = decodePredictions(values, state.labels);
    state.excluded.clear(); state.manual.clear();
    renderTags(); renderPrompt();
    const count = selectTags(state.predictions, {generalThreshold:+el.generalThreshold.value/100,characterThreshold:+el.characterThreshold.value/100}).length;
    announce(`Analysis complete. ${count} tags above your confidence thresholds.`, 'success');
    badge('MODEL READY', 'ready');
    progress('Analysis complete', 1);
  } catch (error) {
    console.error(error);
    announce(error?.message || String(error), 'error');
    badge(state.session ? 'MODEL READY' : 'ENGINE ERROR', state.session ? 'ready' : 'error');
    el.progressWrap.hidden = true;
  } finally { state.busy = false; updateAction(); }
}

function options() { return {generalThreshold:+el.generalThreshold.value/100, characterThreshold:+el.characterThreshold.value/100, includeCharacters:el.includeCharactersInput.checked, maxTags:250, excluded:state.excluded}; }
function predictedVisible() { return selectTags(state.predictions, {...options(),includeCharacters:true, excluded: new Set()}); }
function allActiveTags() {
  const selected = selectTags(state.predictions, options());
  const entries = selected.map(p => ({...p, origin:'model'}));
  for (const item of state.manual.values()) if (!state.excluded.has(item.name) && (el.includeCharactersInput.checked || item.category !== 4)) {
    if (!entries.find(e => e.name === item.name)) entries.push({...item,origin:'manual'});
  }
  return entries;
}
function renderTags() {
  el.generalThresholdVal.textContent = `${el.generalThreshold.value}%`; el.characterThresholdVal.textContent = `${el.characterThreshold.value}%`;
  const base = predictedVisible();
  const manual = [...state.manual.values()].filter(m => !base.some(p=>p.name===m.name));
  let items = [...base.map(p=>({...p,origin:'model'})),...manual.map(p=>({...p,origin:'manual'}))];
  const filter = state.tagFilter;
  if (filter === 'general') items = items.filter(x => x.category === 0);
  if (filter === 'character') items = items.filter(x => x.category === 4);
  if (filter === 'manual') items = items.filter(x => x.origin === 'manual');
  const search = el.searchTags.value.toLowerCase().trim().replaceAll(' ','_');
  if (search) items = items.filter(x => x.name.toLowerCase().includes(search));
  const active = allActiveTags();
  el.resultCount.textContent = String(active.length);
  el.resetHiddenBtn.disabled = !state.excluded.size;
  const rating = chooseRating(state.predictions);
  if (rating) { el.ratingLine.hidden = false; el.ratingLine.textContent = `Model-estimated content rating: ${rating.name} (${percentile(rating.score)}). This is a classifier prediction, not a verified assessment; ratings are not added to your prompt.`; }
  else el.ratingLine.hidden = true;
  el.tagList.innerHTML = '';
  if (!items.length) {
    const holder = document.createElement('div'); holder.className = 'results-empty';
    const glyph = document.createElement('span'); glyph.className='empty-glyph'; glyph.textContent = state.predictions.length ? '⌕' : '✦';
    const title = document.createElement('strong'); title.textContent = state.predictions.length ? 'No matching tags' : 'Waiting for your image';
    const desc = document.createElement('p'); desc.textContent = state.predictions.length ? 'Try lowering the confidence thresholds, changing the filter, or adding a tag.' : 'Detected tags and confidence scores will appear here once the model finishes analyzing.';
    holder.append(glyph,title,desc); el.tagList.append(holder); return;
  }
  const inner = document.createElement('div'); inner.className = 'tag-list-inner';
  for (const tag of items) {
    const excluded = state.excluded.has(tag.name);
    const chip = document.createElement('span'); chip.className = `tag-chip ${tag.origin === 'manual' ? 'manual' : tag.category === 4 ? 'char' : ''} ${excluded ? 'inactive' : ''}`;
    const name = document.createElement('span'); name.className = 'tag-name'; name.textContent = formatTag(tag.name, el.formatSelect.value);
    const score = document.createElement('span'); score.className = 'tag-score'; score.textContent = tag.origin === 'manual' ? (tag.validated ? 'VALIDATED' : 'CUSTOM') : percentile(tag.score);
    const toggle = document.createElement('button'); toggle.type='button'; toggle.title = excluded ? `Include ${tag.name}` : `Exclude ${tag.name}`; toggle.setAttribute('aria-label', toggle.title); toggle.textContent = excluded ? '+' : '×';
    toggle.addEventListener('click', () => {
      if (excluded) state.excluded.delete(tag.name); else state.excluded.add(tag.name);
      renderTags();renderPrompt();
    });
    chip.append(name,score,toggle); inner.append(chip);
  }
  el.tagList.append(inner);
}
function renderPrompt() {
  const active = allActiveTags();
  el.promptOutput.value = active.length ? buildPrompt(active, {format:el.formatSelect.value,weighted:el.weightSelect.value==='confidence',includeQuality:el.includeQualityInput.checked,prefix:el.prefixInput.value}) : '';
  el.tokenCount.textContent = `${active.length} tags`;
}
function buildSuggestions(term) {
  el.tagSuggestions.innerHTML = '';
  if (!state.labels) return;
  const prefix = normalizeTag(term);
  if (!prefix || prefix.length < 2) return;
  let matches = 0;
  for (const label of state.labels) {
    if (label.name.includes(prefix) && matches++ < 20) { const option = document.createElement('option'); option.value = label.name; el.tagSuggestions.append(option); }
    if (matches >= 20) break;
  }
}
function addManualTag() {
  const name = normalizeTag(el.manualTagInput.value);
  if (!name) { toast('Enter a tag first.'); return; }
  if (name.length > 100) { toast('Tag is too long.'); return; }
  const found = state.labelMap.get(name);
  if (state.predictions.some(p => p.name === name)) {
    state.excluded.delete(name); toast('Existing prediction restored.');
  } else {
    state.manual.set(name,{name,category: found?.category === 4 ? 4 : 0,score:1,validated:!!found});
    state.excluded.delete(name);
    toast(found ? 'Verified vocabulary tag added.' : 'Custom prompt phrase added (not a verified Danbooru tag).');
  }
  el.manualTagInput.value = ''; renderTags(); renderPrompt();
}
async function copyText(text) {
  if (!text) { toast('Nothing to copy yet.'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.');
  } catch (_) {
    const temp = document.createElement('textarea'); temp.value = text;
    temp.style.position = 'fixed'; temp.style.opacity = '0'; document.body.append(temp);
    temp.select(); const ok = document.execCommand('copy'); temp.remove();
    toast(ok ? 'Copied to clipboard.' : 'Copy failed; please select the text manually.');
  }
}
function downloadText(name, text, type) {
  const blob = new Blob([text], {type}); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.style.display = 'none'; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function saveSettings() {
  try { localStorage.setItem('gavtag-settings-v1', JSON.stringify({general:el.generalThreshold.value,character:el.characterThreshold.value,format:el.formatSelect.value,weighted:el.weightSelect.value,quality:el.includeQualityInput.checked,characters:el.includeCharactersInput.checked,prefix:el.prefixInput.value,backend:el.backendSelect.value,cache:el.cacheModelInput.checked,negative:el.negativeOutput.value})); }
  catch (_) { /* private browsing may block */ }
}
function restoreSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('gavtag-settings-v1') || '{}');
    if (/^(5|[1-8][05]|9[05])$/.test(String(s.general))) el.generalThreshold.value = s.general;
    if (/^(5|[1-8][05]|9[05])$/.test(String(s.character))) el.characterThreshold.value = s.character;
    if (['natural','danbooru'].includes(s.format)) el.formatSelect.value=s.format;
    if (['none','confidence'].includes(s.weighted)) el.weightSelect.value=s.weighted;
    if (typeof s.quality === 'boolean') el.includeQualityInput.checked=s.quality;
    if (typeof s.characters === 'boolean') el.includeCharactersInput.checked=s.characters;
    if (typeof s.prefix === 'string') el.prefixInput.value=s.prefix;
    if (['auto','wasm'].includes(s.backend)) el.backendSelect.value=s.backend;
    if (typeof s.cache === 'boolean') el.cacheModelInput.checked=s.cache;
    if (typeof s.negative === 'string') el.negativeOutput.value=s.negative;
  } catch(e) { console.warn(e); }
}

el.dropzone.addEventListener('click',()=>el.imageInput.click());
el.dropzone.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.imageInput.click();}});
el.imageInput.addEventListener('change',e=>setImage(e.target.files?.[0]));
el.clearImageBtn.addEventListener('click',clearImage);
for (const ev of ['dragenter','dragover']) el.dropzone.addEventListener(ev,e=>{e.preventDefault();el.dropzone.classList.add('dragging');});
for (const ev of ['dragleave','drop']) el.dropzone.addEventListener(ev,e=>{e.preventDefault();el.dropzone.classList.remove('dragging');});
el.dropzone.addEventListener('drop',e=>setImage([...e.dataTransfer.files].find(f=>f.type.startsWith('image/'))));
window.addEventListener('paste',e=>{
  if (e.target.matches?.('input,textarea,[contenteditable="true"]')) return;
  const item = [...(e.clipboardData?.items || [])].find(i=>i.kind==='file'&&i.type.startsWith('image/'));
  if (item) { e.preventDefault(); setImage(item.getAsFile()); }
});
el.sourceSelect.addEventListener('change',()=>{el.localModelRow.hidden=el.sourceSelect.value!=='local';});
el.localModelInput.addEventListener('change',()=>{state.modelFile=el.localModelInput.files[0]??null;el.localModelName.textContent=state.modelFile?.name??'No model chosen';});
el.localLabelsInput.addEventListener('change',()=>{state.labelsFile=el.localLabelsInput.files[0]??null;state.labels=null;el.localLabelsName.textContent=state.labelsFile?.name??'Uses matching online vocabulary';});
el.analyzeBtn.addEventListener('click',analyze);
for (const id of ['generalThreshold','characterThreshold','searchTags']) el[id].addEventListener('input',()=>{renderTags();renderPrompt();if(id!=='searchTags')saveSettings();});
for (const button of document.querySelectorAll('.tab')) button.addEventListener('click',()=>{
  for (const t of document.querySelectorAll('.tab')) {const yes=t===button;t.classList.toggle('active',yes);t.setAttribute('aria-selected',String(yes));}
  state.tagFilter=button.dataset.filter;renderTags();
});
el.resetHiddenBtn.addEventListener('click',()=>{state.excluded.clear();renderTags();renderPrompt();});
el.manualTagInput.addEventListener('input',()=>buildSuggestions(el.manualTagInput.value));
el.manualTagInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addManualTag();}});
el.addTagBtn.addEventListener('click',addManualTag);
for (const id of ['formatSelect','weightSelect','includeQualityInput','includeCharactersInput','prefixInput']) el[id].addEventListener('input',()=>{renderTags();renderPrompt();saveSettings();});
for (const id of ['backendSelect','cacheModelInput','negativeOutput']) el[id].addEventListener('input',saveSettings);
el.copyPromptBtn.addEventListener('click',()=>copyText(el.promptOutput.value));
el.copyNegativeBtn.addEventListener('click',()=>copyText(el.negativeOutput.value));
el.downloadTxtBtn.addEventListener('click',()=>{
  if (!el.promptOutput.value) {toast('Analyze an image or add tags first.');return;}
  downloadText('GavenTag_prompt.txt',`POSITIVE\n${el.promptOutput.value}\n\nNEGATIVE\n${el.negativeOutput.value}\n`,'text/plain;charset=utf-8');
});
el.exportJsonBtn.addEventListener('click',()=>downloadText('GavenTag_tags.json',JSON.stringify({version:1,model:'SmilingWolf/wd-vit-tagger-v3',image:state.imageFile?.name??null,generatedAt:new Date().toISOString(),tags:allActiveTags().map(t=>({name:t.name,category:t.category,confidence:t.origin==='model'?t.score:null,source:t.origin,verified:!!state.labelMap.has(t.name)})),rating:chooseRating(state.predictions),positivePrompt:el.promptOutput.value,negativePrompt:el.negativeOutput.value},null,2),'application/json;charset=utf-8'));
restoreSettings();renderTags();renderPrompt();updateAction();
