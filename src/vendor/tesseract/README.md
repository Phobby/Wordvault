# Tesseract.js (vendored, unmodified)

Text recognition for "Ekrandan metin tara". Everything here is copied byte for byte from the
official npm packages; nothing is loaded from the network at run time (MV3 does not allow remote
code, and the picture never leaves the browser).

| File | Package | Version | Licence |
| --- | --- | --- | --- |
| `tesseract.esm.min.js`, `worker.min.js` | `tesseract.js` (`dist/`) | 7.0.0 | Apache-2.0 (`LICENSE.md`; bundled dependencies: `*.LICENSE.txt`) |
| `core/tesseract-core-*-lstm.wasm.js` | `tesseract.js-core` | 7.0.0 | Apache-2.0 (`core/LICENSE`) |
| `lang/eng.traineddata.gz` | `@tesseract.js-data/eng` (`4.0.0_best_int/`) | 1.0.0 | Apache-2.0 (tessdata) |
| `lang/tur.traineddata.gz` | `@tesseract.js-data/tur` (`4.0.0_best_int/`) | 1.0.0 | Apache-2.0 (tessdata) |

**The Chrome build differs in one respect** (`build.js`, `TESSERACT_CDN`): the three jsDelivr addresses
Tesseract.js falls back to when no path is given are blanked to `""`, because the Chrome Web Store asks
for code that could load remote code to be removed even when it is unused. Wordvault always passes its
packaged paths, so behaviour is the same. The files in this folder, and the Firefox build, are the
unmodified release; the checksums below are of these files.

Only the LSTM builds of the core are included (the worker picks one of the three by what the
browser's WebAssembly supports: plain, SIMD, relaxed SIMD). The legacy engine is not shipped.

To update: `npm pack <package>@<version>`, copy the same files, and replace the checksums below.

## SHA-256

```
64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29  tesseract.esm.min.js
576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d  worker.min.js
eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680  core/tesseract-core-lstm.wasm.js
861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3  core/tesseract-core-relaxedsimd-lstm.wasm.js
c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38  core/tesseract-core-simd-lstm.wasm.js
45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91  lang/eng.traineddata.gz
384ba0dc28040451b7818d7d60e0a88df0d3003fa5a01d713a468779bc3d8c04  lang/tur.traineddata.gz
```
