# Bake the live page into the transition clip where the clip shows the real
# objects at rest - the keyboard before the wipe reaches it, the machine once
# it has settled - and colour-grade the generated footage in between, all in
# the pixels, so the player needs no CSS filter.
# usage: uv run --with numpy --with pillow --with scipy python composite.py <out_dir> [first last]
# (see README.md for the whole run)
import sys, os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_erosion

S = os.environ.get("BAKE_WORK", "node_modules/.cache/bake")  # frames.sh, capture.mjs and prepare.py write here
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
N0, N1 = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 270)
LAST = 270
SETTLE_FROM, SETTLED_AT = 226, 240   # the machine's last settling frames (identical to the last from 240)

def sat(s):
    return np.array([[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
                     [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
                     [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]], dtype=np.float32)

def grade(x, b, c, s):
    """CSS brightness(b) contrast(c) saturate(s), in that order"""
    x = np.clip(x * b, 0, 1)
    x = np.clip((x - 0.5) * c + 0.5, 0, 1)
    return np.clip(x @ sat(s).T, 0, 1)

# Fitted 2026-11-26 in TRUE sRGB (the decoded frames vs the live page), not
# as an untagged video happens to be shown: Chrome showed the old files
# through a BT.709 transfer guess, ~7% more contrast, and the first fits
# corrected that guess as much as the footage. encode.sh now tags the
# transfer as sRGB, so what is encoded is what is shown.
G_KB = (1.038, 1.002, 0.979)      # the dark keyboard world (barely off)
G_MA = (1.084, 0.882, 0.988)      # the cream world: its paper ~6 levels darker and warmer than the page
# the last 0.78 s of the master is the still of the machine (build-transition.sh),
# cross-faded in over these frames: it already IS the page, so the grade fades out
PLATE_FROM, PLATE_AT = 223, 235

def load(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) / 255.0

kb_live = load(f"{S}/ref-kb-clip.png")   # the live keyboard, in the clip's coordinates
ma_live = load(f"{S}/ref-machine.png")   # the live machine (the clip ends unshifted)
matte = np.asarray(Image.open(f"{S}/machine-matte.png"), dtype=np.float32)[..., None] / 255.0
f0 = load(f"{S}/src/f000.png")
fl = load(f"{S}/src/f{LAST:03d}.png")

def ramp(d, lo, hi):
    """1 where d <= lo, 0 where d >= hi"""
    return np.clip((hi - d) / (hi - lo), 0, 1)

def crisp(f, sigma=1.2, amount=0.6, thr=0.004):
    """the generated footage's soft ink lines, tightened: luminance-only
    unsharp mask (no colour fringes), skipping flat areas (no noise boost)"""
    Y = f @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    detail = Y - gaussian_filter(Y, sigma)
    detail = np.where(np.abs(detail) > thr, detail, 0)
    return np.clip(f + amount * detail[..., None], 0, 1)

for n in range(N0, N1 + 1):
    f = load(f"{S}/src/f{n:03d}.png")
    fc = crisp(f)

    # 1. the generated footage, tightened and graded by the world each pixel
    #    belongs to
    if n <= 64:
        d0 = gaussian_filter(np.abs(f - f0).max(2), 3.0)
        cream = gaussian_filter(1 - ramp(d0, 0.05, 0.14), 2.0)[..., None]
        out = cream * grade(fc, *G_MA) + (1 - cream) * grade(fc, *G_KB)
    else:
        out = grade(fc, *G_MA)
    if n > PLATE_FROM:
        k = min(1.0, (n - PLATE_FROM) / (PLATE_AT - PLATE_FROM))
        out = (1 - k) * out + k * f  # the still: untouched (already the page, already sharp)

    # 2. the keyboard the wipe has not reached yet: the live board and its
    #    void, plus the clip's own faint change on it (the wipe's glow)
    if n <= 64:
        d = gaussian_filter(np.abs(f - f0).max(2), 1.5)
        w = gaussian_filter(ramp(d, 0.035, 0.11), 2.0)[..., None]
        glow = (f - f0) * ((d >= 0.035) & (d < 0.11))[..., None]
        out = w * np.clip(kb_live + glow, 0, 1) + (1 - w) * out

    # 3. the machine, once it has settled: the live machine, inside its own
    #    matte only (the paper stays the clip's, graded). As ONE dissolve over
    #    its last settling frames, never pixel by pixel: swapping "already the
    #    same" pixels one at a time left a smudged patchwork along the chin of
    #    a bezel that was nearly, not quite, settled.
    if n >= SETTLE_FROM:
        t = np.clip((n - SETTLE_FROM) / (SETTLED_AT - SETTLE_FROM), 0, 1)
        w = (t * t * (3 - 2 * t)) * matte
        out = w * ma_live + (1 - w) * out

    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(f"{OUT}/f{n:03d}.png", compress_level=1)
    if n % 30 == 0:
        print("frame", n, flush=True)
print("done")
