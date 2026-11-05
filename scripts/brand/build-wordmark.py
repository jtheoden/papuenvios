"""Rebuild the PapuEnvios wordmark SVG/PNG variants from the owner's JPG.

Setup (no global installs):
    python3 -m venv /tmp/brand-venv
    /tmp/brand-venv/bin/pip install potracer pillow numpy cairosvg scipy
Run (from the repo root):
    /tmp/brand-venv/bin/python -I scripts/brand/build-wordmark.py \
        [--src scripts/brand/logo-source.jpg] [--out src/assets/brand] [--report DIR]

Method: the JPG is orange (#FFA800) and white on pure black. Each pixel is
linearly unmixed into orange / white coverage (R = 255(a+w), B = 255w), the
coverage maps are upsampled 4x, thresholded at 0.5 and traced with potrace.
Only the first text band (the wordmark) is kept; the tagline is discarded.
"""
import argparse
import io
import sys
from pathlib import Path

import cairosvg
import numpy as np
import potrace
from PIL import Image
from scipy import ndimage

ORANGE = "#FFA800"  # measured: modal colour of the arrow/U pixels in the source JPG
WHITE = "#FFFFFF"   # measured: modal colour of the "Pap"/"Envíos" pixels
CHARCOAL = "#1F2937"
UP = 4              # supersampling factor before tracing
TITLE = "PapuEnvíos"


def coverage(rgb):
    """Return (orange, white) soft coverage maps in [0, 1] for an RGB uint8 array."""
    rgb = rgb.astype(float)
    w = rgb[..., 2] / 255.0
    a = rgb[..., 0] / 255.0 - w
    return np.clip(a, 0, 1), np.clip(w, 0, 1)


def wordmark_band(rgb):
    """Row range (inclusive) of the first text band, i.e. the wordmark."""
    rows = np.where(rgb.max(2).max(1) > 100)[0]
    end = rows[0]
    for r in rows[1:]:
        if r - end > 5:
            break
        end = r
    return rows[0], end


def num(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def trace(mask, origin):
    """Trace a boolean mask (UP x resolution) into an SVG path string in source px."""
    ox, oy = origin

    def pt(p):
        return num(p.x / UP - ox) + "," + num(p.y / UP - oy)

    out = []
    # potracer treats False as foreground, so the mask is inverted.
    for curve in potrace.Bitmap(~mask).trace(turdsize=8, alphamax=1.0, opttolerance=1.5):
        out.append("M" + pt(curve.start_point))
        for s in curve.segments:
            if s.is_corner:
                out.append("L" + pt(s.c) + "L" + pt(s.end_point))
            else:
                out.append("C" + pt(s.c1) + " " + pt(s.c2) + " " + pt(s.end_point))
        out.append("Z")
    return "".join(out)


def svg(width, height, layers, view=None):
    paths = "".join(f'<path fill="{c}" fill-rule="evenodd" d="{d}"/>' for c, d in layers)
    vb = view or f"0 0 {width} {height}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
        f'width="{width}" height="{height}" role="img"><title>{TITLE}</title>{paths}</svg>\n'
    )


def upsample_mask(cov):
    return ndimage.zoom(cov, UP, order=3) > 0.5


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(here / "logo-source.jpg"))
    ap.add_argument("--out", default=str(here.parent.parent / "src/assets/brand"))
    ap.add_argument("--report", default=None, help="dir for IoU report images")
    args = ap.parse_args()

    rgb = np.array(Image.open(args.src).convert("RGB"))
    y0, y1 = wordmark_band(rgb)
    pad = 6
    cx = np.where(rgb[y0:y1 + 1].max(2).max(0) > 100)[0]
    x0, x1 = max(cx.min() - pad, 0), cx.max() + pad + 1
    y0, y1 = y0 - pad, y1 + pad + 1
    crop = rgb[y0:y1, x0:x1]
    orange, white = coverage(crop)

    m_o, m_w = upsample_mask(orange), upsample_mask(white)
    ys, xs = np.where(m_o | m_w)
    ox, oy = xs.min() / UP, ys.min() / UP
    width = int(np.ceil((xs.max() + 1) / UP - ox))
    height = int(np.ceil((ys.max() + 1) / UP - oy))
    d_o, d_w = trace(m_o, (ox, oy)), trace(m_w, (ox, oy))

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    variants = {
        "papuenvios-wordmark-color.svg": [(WHITE, d_w), (ORANGE, d_o)],
        "papuenvios-wordmark-white.svg": [(WHITE, d_w + d_o)],
        "papuenvios-wordmark-onlight.svg": [(CHARCOAL, d_w), (ORANGE, d_o)],
    }
    for name, layers in variants.items():
        (out / name).write_text(svg(width, height, layers), encoding="utf-8")
    cairosvg.svg2png(
        bytestring=(out / "papuenvios-wordmark-color.svg").read_bytes(),
        write_to=str(out / "papuenvios-wordmark-color.png"),
        output_width=2400,
    )

    # Verification: render 1:1 over the original crop frame and compare per colour.
    h, w = crop.shape[:2]
    check = svg(w, h, variants["papuenvios-wordmark-color.svg"], view=f"{-ox} {-oy} {w} {h}")
    rend = np.array(Image.open(io.BytesIO(cairosvg.svg2png(bytestring=check.encode(), background_color="black"))).convert("RGB"))
    r_o, r_w = coverage(rend)
    for label, a, b in (("orange", orange > 0.5, r_o > 0.5), ("white", white > 0.5, r_w > 0.5)):
        print(f"IoU {label}: {(a & b).sum() / (a | b).sum():.4f}")
    if args.report:
        rep = Path(args.report)
        rep.mkdir(parents=True, exist_ok=True)
        Image.fromarray(crop).save(rep / "crop.png")
        Image.fromarray(rend).save(rep / "render.png")
    print(f"viewBox 0 0 {width} {height}; orange {ORANGE}; white {WHITE}")


if __name__ == "__main__":
    sys.exit(main())
