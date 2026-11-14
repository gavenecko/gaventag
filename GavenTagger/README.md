# GavenTag — Image Tagger & Prompt Studio

A static, privacy-first web application for tagging anime and illustrations with **real WD ViT Tagger v3 predictions**, editing Danbooru tags, and exporting prompts. No paid API, no backend, no secret keys and no account required.

## What works in v1.0

- Drag/drop, paste, or choose PNG, JPG, WEBP, GIF, or BMP images (max 30 MB; first GIF frame).
- In-browser ONNX inference using [SmilingWolf/wd-vit-tagger-v3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3). Model and CSV row order are pinned to the matching source revision.
- Correct preprocessing: square white letterboxing, 448×448 resize, RGB→BGR, float32 NHWC in 0–255 scale.
- WebGPU with CPU WebAssembly fallback (or manual CPU selection).
- Optional model caching with IndexedDB; optionally load a local model.onnx and selected_tags.csv for offline use after the JS runtime is loaded.
- Adjustable confidence thresholds, general and character categories, inferred rating displayed separately, manual tag additions with vocabulary matching, tag exclusions and restore, filtering, search, two tag display formats, optional confidence-derived prompt weights, editable quality prefix and negative prompt.
- Copy/export positive and negative prompts; export chosen tag data as JSON. Preferences stored in localStorage. Uploaded images stay on the device.
- Responsive mobile and desktop interface; no build step.

**Important:** The app contains no mock inference or preset predictions. Tags appear only after successful model execution or if manually added. Model scores are not guarantees of correctness. Manual strings not present in the tag vocabulary are described as custom phrases.

## Start locally

For browser security and module loading, use a local web server (do **not** open `index.html` from a file:// URL):

```sh
cd GavenTagger
python -m http.server 8000
```

Open <http://localhost:8000>.

Install nothing except Python 3 (already present on many systems). The ONNX runtime is loaded from a pinned CDN; the ~379 MB WD ViT ONNX model and its 308 KB vocabulary are loaded from Hugging Face the first time you analyze an image. Network access and CORS support are required for these third-party resources unless you supply local model and CSV files. If local ONNX loading is used, the ONNX runtime script still needs connectivity unless you vendor it yourself.

**Recommended:** desktop Chrome / Edge with plenty of free RAM. WebGPU support varies. Inference can be slow or fail on low-memory phones. If GPU initialization fails, the app retries with CPU WebAssembly. If model downloads fail due to CORS/network, download [`model.onnx`](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f/model.onnx) and [`selected_tags.csv`](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f/selected_tags.csv), then select them in the UI. Large files need sufficient memory.

## Deploy to GitHub Pages

1. Create a **new public repository** (suggested name: `gaventag`). Keep it separate from other projects.
2. Upload all files from this folder to the repository root, including the `.github/workflows/pages.yml` workflow (hidden `.github` folder).
3. In the repository, go to **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Push to `main`. The included workflow publishes the static site automatically.
5. The usual project Pages URL is `https://YOUR_USERNAME.github.io/gaventag/` once deployment succeeds.

You may also deploy these same files (except `.github`) to **Cloudflare Pages**, using no build command and `/` as the root. Do not commit a 379 MB `model.onnx` to GitHub; the browser downloads it from Hugging Face or you select it locally.

## Privacy and dependency transparency

- Uploaded images are decoded and inferred entirely in-browser and are never sent to GavenTag or a backend. The app does not make remote inference requests.
- When using online mode, browser network requests fetch **ONNX Runtime Web** from jsDelivr and the **model and CSV** from Hugging Face. Network hosts can see normal resource requests but not your input images.
- If caching is checked, the large model may be stored in browser IndexedDB, subject to available quota. The app doesn't store images.
- Local settings (not images) are stored in localStorage.

## Model attribution

WD ViT Tagger v3 by SmilingWolf is licensed **Apache-2.0**. ONNX Runtime Web is **MIT** licensed. Google Fonts may be fetched for UI typography with system font fallback. See the model repository for its training data, limitations and license details. This application is an independently authored interface, not an official SmilingWolf release.

## Testing

`npm test` (Node.js 18+). Tests exercise CSV parsing, output alignment, tag thresholding, prompt formatting and BGR channel conversion.

## Known limitations

- Real inference requires a ~379 MB ONNX download and compatible browser memory/runtime. **End-to-end inference should be checked in your target browser**; code and unit tests are not a substitute.
- Fetching a large model into memory may be expensive even if cached; mobile devices may be unable to run it.
- The browser's canvas resampling is not guaranteed to be pixel-identical with PIL's `Image.BICUBIC` resizing from the official demo, so scores can differ slightly.
- AI ratings and tags can be wrong or incomplete; inspect before using.
- Tagger vocabulary contains a mix of Danbooru labels and is not guaranteed to match live tag aliases/current site entries.
