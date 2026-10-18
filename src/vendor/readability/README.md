# Readability (vendored, unmodified)

Finds the main text of a page for "Sayfayı özetle" (`features/summary/content/extract.js`). The
file is copied byte for byte from Mozilla's official npm package; nothing is loaded from the
network at run time (MV3 does not allow remote code). It is not part of every page: it is put
into a tab only when its user asks for a summary of it.

| File | Package | Version | Licence |
| --- | --- | --- | --- |
| `Readability.js` | `@mozilla/readability` (github.com/mozilla/readability) | 0.6.0 | Apache-2.0 (`LICENSE.md`) |

`tests/vendor/readability/JSDOMParser.js` is from the same package and version, also unmodified.
It is the small HTML parser Readability's own tests use; here it lets `tests/page-text.test.js`
run the extraction without a browser. It is not shipped.

To update: `npm pack @mozilla/readability@<version>`, copy the same files, and replace the
checksums below.

## SHA-256

```
34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174  Readability.js
6b8eae46939f187ef4565c67f452a9098211daea80e50c9aea74d72015b73680  JSDOMParser.js (tests/vendor/readability)
```
