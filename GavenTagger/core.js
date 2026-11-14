/** Pure functions shared by browser app and Node tests. No network or DOM side effects. */
export const MODEL_REVISION = '7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f';
export const HF_ROOT = `https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/${MODEL_REVISION}`;
export const MODEL_URL = `${HF_ROOT}/model.onnx`;
export const LABELS_URL = `${HF_ROOT}/selected_tags.csv`;
export const MODEL_CACHE_KEY = 'gaven-tag-wd-vit-v3-790b0e9';
export const IMAGE_SIZE = 448;

/** The WD V3 CSV has columns tag_id,name,category,count. The same row order = model output index. */
export function parseTagCsv(csv) {
  const rows = csv.replace(/^\ufeff/, '').replace(/\r/g, '').trim().split('\n');
  if (!/^tag_id,name,category,count$/.test(rows[0])) throw new Error('Unsupported selected_tags.csv format. Expected tag_id,name,category,count.');
  const tags = rows.slice(1).map((line, index) => {
    const parts = line.split(',');
    if (parts.length !== 4) throw new Error(`Malformed tag label at row ${index + 2}`);
    return { name: parts[1], category: Number(parts[2]), count: Number(parts[3]) };
  });
  if (tags.length < 1000) throw new Error('The selected_tags.csv file appears incomplete.');
  return tags;
}

export function decodePredictions(values, labels) {
  if (!values || values.length !== labels.length) throw new Error(`Prediction / tag vocabulary mismatch (${values?.length ?? 0} outputs, ${labels.length} labels).`);
  const predictions = [];
  for (let i = 0; i < values.length; i++) {
    const entry = labels[i];
    const score = Number(values[i]);
    if (Number.isFinite(score)) predictions.push({ name: entry.name, category: entry.category, score });
  }
  return predictions;
}

export function chooseRating(predictions) {
  return predictions.filter(p => p.category === 9).sort((a, b) => b.score - a.score)[0] ?? null;
}

export function selectTags(predictions, options = {}) {
  const generalThreshold = options.generalThreshold ?? .35;
  const characterThreshold = options.characterThreshold ?? .85;
  const includeCharacters = options.includeCharacters ?? true;
  const maxTags = options.maxTags ?? 100;
  const excluded = options.excluded ?? new Set();
  return predictions.filter(p => (p.category === 0 && p.score >= generalThreshold) || (includeCharacters && p.category === 4 && p.score >= characterThreshold))
    .filter(p => !excluded.has(p.name)).sort((a, b) => b.score - a.score).slice(0, maxTags);
}

export function formatTag(name, format = 'danbooru') {
  const clean = String(name).trim();
  return format === 'natural' ? clean.replaceAll('_', ' ') : clean.replaceAll(' ', '_');
}

export function escapePromptTag(tag) {
  // Parentheses delimit weight syntax in many Stable Diffusion implementations.
  return tag.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

export function buildPrompt(tags, options = {}) {
  const format = options.format ?? 'danbooru';
  const weighted = options.weighted ?? false;
  const prefix = options.includeQuality ? (options.prefix ?? '').trim() : '';
  const components = prefix ? prefix.split(',').map(x => x.trim()).filter(Boolean) : [];
  const unique = new Set(components.map(x => x.toLowerCase()));
  for (const entry of tags) {
    const name = formatTag(entry.name, format);
    if (!name || unique.has(name.toLowerCase())) continue;
    unique.add(name.toLowerCase());
    const weight = Number.isFinite(entry.weight) ? entry.weight : (Number.isFinite(entry.score) ? Math.min(1.4, Math.max(1.0, 1 + (entry.score - .5) * .45)) : 1.1);
    components.push(weighted && weight > 1.015 ? `(${escapePromptTag(name)}:${weight.toFixed(2)})` : escapePromptTag(name));
  }
  return components.join(', ');
}

export function normalizeTag(name) { return String(name).trim().replace(/\s+/g, '_').replace(/,+/g, '').toLowerCase(); }
export function percentile(score) { return `${Math.round(score * 100)}%`; }

/** Browser preprocessing reproduces the reference model's white square padding, float32 BGR NHWC 0..255. */
export function imageDataToBgr(imageData) {
  const rgba = imageData.data;
  const out = new Float32Array(imageData.width * imageData.height * 3);
  for (let pixel = 0, i = 0; pixel < rgba.length; pixel += 4, i += 3) {
    out[i] = rgba[pixel + 2];
    out[i + 1] = rgba[pixel + 1];
    out[i + 2] = rgba[pixel];
  }
  return out;
}

export async function rasterToTensorData(image, size = IMAGE_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Unable to create image canvas.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('Selected image has invalid dimensions.');
  const scale = size / Math.max(width, height);
  const dstW = width * scale, dstH = height * scale;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, (size - dstW) / 2, (size - dstH) / 2, dstW, dstH);
  return imageDataToBgr(ctx.getImageData(0, 0, size, size));
}
