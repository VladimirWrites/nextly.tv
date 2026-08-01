# nextly icons. The mark is the barcode: three watched bars and the one you'd play next.
#
# Every icon here is FULL BLEED with square corners. Rounding is the platform's job and every
# platform does it: iOS applies a squircle, Android masks adaptive icons, macOS insets and
# rounds, and Windows draws the tile it is given. An icon that arrives already rounded gets
# rounded again — on Windows that is a rounded square sitting inside a square with four
# visible gaps at the corners, which is what this used to look like when installed.
#
# Two geometries, differing only in how much room the mark leaves around itself:
#   * "any"      — shown as-is or lightly inset. Bars at 66% of the canvas.
#   * "maskable" — Android crops adaptive icons to a circle of 80% diameter, so everything
#                  that matters must sit inside a radius of 0.40. Bars at 46% leave the
#                  farthest bar corner at 29.7%, a ~10% margin.
#   * "ios"      — the apple-touch-icon, which iOS uses instead of anything in the manifest.
#                  Bars at 58%, because its squircle takes less off the corners than
#                  Android's circle does.
import zlib, struct, math, os

INK = (0x12, 0x14, 0x1b, 0xff)
CLEAR = (0x12, 0x14, 0x1b, 0x00)   # ink with no alpha: the colour matches, so downsampling
                                   # the tile's edge fades opacity without a dark fringe
BARS = [(0xff, 0xb0, 0x20, 0xff), (0xff, 0xb0, 0x20, 0xff),
        (0x3f, 0xd3, 0xe6, 0xff), (0x3a, 0x40, 0x54, 0xff)]
SS = 4  # supersample, then box-downsample for clean edges

def rounded_rect(px, W, x0, y0, x1, y1, r, color):
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            cx = min(max(x, x0 + r), x1 - r - 1)
            cy = min(max(y, y0 + r), y1 - r - 1)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r or (x0 + r <= x < x1 - r) or (y0 + r <= y < y1 - r):
                px[y * W + x] = color

def downsample(px, W, size):
    out = bytearray()
    for oy in range(size):
        out.append(0)
        for ox in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    c = px[(oy * SS + dy) * W + ox * SS + dx]
                    r += c[0]; g += c[1]; b += c[2]; a += c[3]
            k = SS * SS
            out += bytes((r // k, g // k, b // k, a // k))
    return out

def png(raw, size):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))

# ---- shapes, for the shortcut glyphs ----

def disc(px, W, cx, cy, r, color):
    for y in range(max(0, int(cy - r)), min(W, int(cy + r) + 1)):
        for x in range(max(0, int(cx - r)), min(W, int(cx + r) + 1)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                px[y * W + x] = color

def ring(px, W, cx, cy, r, thick, color):
    outer, inner = r + thick / 2, r - thick / 2
    for y in range(max(0, int(cy - outer)), min(W, int(cy + outer) + 1)):
        for x in range(max(0, int(cx - outer)), min(W, int(cx + outer) + 1)):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if inner * inner <= d2 <= outer * outer:
                px[y * W + x] = color

def stroke(px, W, x0, y0, x1, y1, thick, color):
    # Distance from the pixel to the segment, so the ends are round like the app's icons.
    dx, dy = x1 - x0, y1 - y0
    span = dx * dx + dy * dy or 1
    half = thick / 2
    for y in range(max(0, int(min(y0, y1) - half)), min(W, int(max(y0, y1) + half) + 1)):
        for x in range(max(0, int(min(x0, x1) - half)), min(W, int(max(x0, x1) + half) + 1)):
            t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / span))
            px_, py_ = x0 + t * dx, y0 + t * dy
            if (x - px_) ** 2 + (y - py_) ** 2 <= half * half:
                px[y * W + x] = color

def triangle(px, W, pts, color):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    def side(a, b, p):
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    for y in range(max(0, int(min(ys))), min(W, int(max(ys)) + 1)):
        for x in range(max(0, int(min(xs))), min(W, int(max(xs)) + 1)):
            p = (x, y)
            d = [side(pts[0], pts[1], p), side(pts[1], pts[2], p), side(pts[2], pts[0], p)]
            if all(v >= 0 for v in d) or all(v <= 0 for v in d):
                px[y * W + x] = color

SIGNAL = (0xff, 0xb0, 0x20, 0xff)

# Icons for the long-press shortcuts. Without them Android draws a grey placeholder, which is
# exactly what a shortcut with no icon looks like on every launcher.
#
# A filled disc rather than a tile: launchers mask these to a circle, so drawing the circle
# here means the result is the same shape wherever it lands. The glyphs are the app's own
# navigation icons, because a shortcut should look like the thing it takes you to.
def make_shortcut(kind, size=96):
    W = size * SS
    px = [CLEAR] * (W * W)
    c = W / 2
    disc(px, W, c, c, c, INK)

    if kind == "next":
        # The play triangle, nudged right so it reads as centred rather than measuring so.
        triangle(px, W, [(W * 0.40, W * 0.31), (W * 0.40, W * 0.69), (W * 0.71, W * 0.50)], SIGNAL)
    elif kind == "library":
        # The barcode again, at the size a launcher will show it: three bars, no more.
        bw, gap, h = W * 0.085, W * 0.055, W * 0.34
        left = c - (bw * 3 + gap * 2) / 2
        for i in range(3):
            x = left + i * (bw + gap)
            rounded_rect(px, W, x, c - h / 2, x + bw, c + h / 2, bw * 0.3, SIGNAL)
    elif kind == "search":
        ring(px, W, W * 0.455, W * 0.44, W * 0.155, W * 0.055, SIGNAL)
        stroke(px, W, W * 0.565, W * 0.55, W * 0.68, W * 0.665, W * 0.06, SIGNAL)

    return png(downsample(px, W, size), size)



def make(size, shape="any"):
    W = size * SS
    # Full bleed, corner to corner. The platform supplies the corners — see the note above.
    px = [INK] * (W * W)
    scale = {"any": 0.66, "maskable": 0.46, "ios": 0.58}[shape]
    span = W * scale
    n = len(BARS)
    gap = span * 0.13
    bw = (span - gap * (n - 1)) / n
    x = (W - span) / 2
    h = span * 0.82
    y = (W - h) / 2
    for i, c in enumerate(BARS):
        bx = x + i * (bw + gap)
        rounded_rect(px, W, bx, y, bx + bw, y + h, bw * 0.28, c)

    return png(downsample(px, W, size), size)

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for kind in ("next", "library", "search"):
    open(os.path.join(here, "public/assets", f"shortcut-{kind}.png"), "wb").write(make_shortcut(kind))
    print("  wrote", f"shortcut-{kind}.png")

for size, name, shape in [(192, "icon-192.png", "any"), (512, "icon-512.png", "any"),
                          (512, "icon-maskable-512.png", "maskable"),
                          (180, "apple-touch-icon.png", "ios")]:
    open(os.path.join(here, "public/assets", name), "wb").write(make(size, shape))
    print("  wrote", name)

span = 512 * 0.66
n = len(BARS); gap = span * 0.13; bw = (span - gap * (n - 1)) / n
x = (512 - span) / 2; h = span * 0.82; y = (512 - h) / 2
bars = "".join(
    f'\n  <rect x="{x + i * (bw + gap):.1f}" y="{y:.1f}" width="{bw:.1f}" height="{h:.1f}" '
    f'rx="{bw * 0.28:.1f}" fill="{c}"/>'
    for i, c in enumerate(["#ffb020", "#ffb020", "#3fd3e6", "#3a4054"]))
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="nextly">\n'
       f'  <rect width="512" height="512" fill="#12141b"/>{bars}\n</svg>\n')
for p in ("public/assets/favicon.svg", "design/icon.source.svg"):
    open(os.path.join(here, p), "w").write(svg)
    print("  wrote", os.path.basename(p))
