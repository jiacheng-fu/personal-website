# The references, made ready for composite.py:
#  - the live keyboard warped into the CLIP's own coordinates: the clip is
#    shown with seamTransform, which maps clip pixel p to S p + T on screen,
#    so the clip pixel p must hold live pixel S p + T (TransitionPlayer's
#    SEAM_SCALE_X/Y and SEAM_DY_PCT - keep these in step with it)
#  - the machine's matte: where the live machine differs from the page
#    without it, the body filled solid (its light parts are near paper
#    colour) and its soft shadow kept
# usage: uv run --with numpy --with pillow --with scipy python prepare.py
import os
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_fill_holes, binary_closing, binary_erosion

W, H = 2560, 1440
SX, SY, DY_PCT = 1.0162, 1.0360, -1.54
S = os.environ.get("BAKE_WORK", "node_modules/.cache/bake")

kb = Image.open(f"{S}/ref-kb.png").convert("RGB")
kb.transform((W, H), Image.AFFINE, (SX, 0, 0, 0, SY, DY_PCT / 100 * H), resample=Image.BICUBIC).save(f"{S}/ref-kb-clip.png")

m = np.asarray(Image.open(f"{S}/ref-machine.png").convert("RGB"), float) / 255
p = np.asarray(Image.open(f"{S}/ref-paper.png").convert("RGB"), float) / 255
d = np.abs(m - p).max(2)
soft = np.clip((d - 0.004) / 0.03, 0, 1)
body = binary_erosion(binary_fill_holes(binary_closing(d > 0.06, iterations=6)), iterations=1)
matte = np.maximum(gaussian_filter(body.astype(float), 1.2), gaussian_filter(soft, 1.0))
Image.fromarray((np.clip(matte, 0, 1) * 255).astype(np.uint8)).save(f"{S}/machine-matte.png")
print("references ready in", S)
