"""Assemble /tmp/demo-frames/*.png into docs/images/demo.gif."""

import glob

from PIL import Image

frames = sorted(glob.glob("/tmp/demo-frames/*.png"))
print(f"{len(frames)} frames")

images = []
for f in frames:
    im = Image.open(f).convert("RGB")
    if im.size != (960, 600):
        im = im.resize((960, 600), Image.LANCZOS)
    images.append(im.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG))

out = "/home/user/frigate_test/docs/images/demo.gif"
images[0].save(
    out,
    save_all=True,
    append_images=images[1:],
    duration=100,
    loop=0,
    optimize=True,
)
import os

print(f"wrote {out}: {os.path.getsize(out) / 1024:.0f} KB")
