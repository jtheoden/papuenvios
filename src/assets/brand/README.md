# Brand assets: wordmark

Wordmark "Pap [U con flecha] Envíos" (without the tagline), vectorised from the JPG supplied by the owner
(`scripts/brand/logo-source.jpg`, 2000x1600, white and orange on black).

## Files

| File | Use on | Colours |
|------|--------|---------|
| `papuenvios-wordmark-color.svg` | dark backgrounds | `#FFFFFF` + `#FFA800` |
| `papuenvios-wordmark-white.svg` | dark/photo backgrounds, single colour | `#FFFFFF` |
| `papuenvios-wordmark-onlight.svg` | light backgrounds (e.g. white header) | `#1F2937` + `#FFA800` |
| `papuenvios-wordmark-color.png` | raster needs (e.g. OG image, email), transparent, 2400 px wide | `#FFFFFF` + `#FFA800` |

All SVGs: transparent, `viewBox="0 0 1557 235"`, no raster, no `<text>`, no external fonts, `<title>PapuEnvíos</title>`, `role="img"`.

Do not use the `color` or `white` variants on light backgrounds: the white letters disappear.
Colours were sampled from the JPG (orange modal pixel `255,168,0`; white `255,255,255`); `#1F2937` is a design choice, not from the source.

## Regenerate

```bash
python3 -m venv /tmp/brand-venv
/tmp/brand-venv/bin/pip install potracer pillow numpy cairosvg scipy
/tmp/brand-venv/bin/python -I scripts/brand/build-wordmark.py
```

The script crops the wordmark band, unmixes orange/white coverage, traces each colour with potrace, writes the files
above and prints the per-colour IoU of the render against the source (last run: orange 0.994, white 0.988).
Tests: `src/tests/unit/brandWordmarkAssets.test.js`.
