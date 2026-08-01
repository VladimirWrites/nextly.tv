/* iOS launch images.
 *
 * A home-screen web app with no apple-touch-startup-image gets no launch screen, so iOS fills
 * the gap by scaling whatever it last had to the standalone viewport. A snapshot taken in
 * Safari, whose viewport is shorter, stretched into a taller window is why the app opened
 * zoomed with its right edge missing and then corrected itself once the real render arrived.
 *
 * One image per device resolution, because iOS matches them exactly and an image that does not
 * match its device is scaled, which is the same bug again. Portrait only: a phone is not
 * launched from a home screen in landscape often enough to double the count for.
 *
 * Dark only, matching the manifest's background_color. A light-scheme variant would need
 * prefers-color-scheme inside the media attribute, and a device that matched no link at all
 * would be back to the snapshot — a brief dark launch is the cheaper failure.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { launch, connect } from "./promo-lib.mjs";

// CSS width, CSS height, device pixel ratio.
export const DEVICES = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3],
  [375, 812, 3], [414, 896, 2], [414, 896, 3],
  [390, 844, 3], [428, 926, 3], [393, 852, 3],
  [430, 932, 3], [402, 874, 3], [440, 956, 3],
];

/* Laid out at the device's real pixel count with no scale factor, rather than at CSS size with
   deviceScaleFactor doing the multiplying. The latter produced a file with the right dimensions
   in its header and the artwork sitting in one corner of it, which passes a size check and
   fails an eye. Everything is multiplied by the ratio by hand instead. */
const page = (pw, ph, dpr) => `data:text/html,${encodeURIComponent(`
<html><body style="margin:0"><div style="
  width:${pw}px;height:${ph}px;background:#12141b;
  display:flex;align-items:center;justify-content:center;gap:${11 * dpr}px;
  font-family:system-ui,-apple-system,'Helvetica Neue',sans-serif;
  font-weight:800;letter-spacing:-0.03em;font-size:${26 * dpr}px;color:#e9ebf2;">
  <i style="width:${12 * dpr}px;height:${12 * dpr}px;border-radius:50%;background:#ffb020;
            box-shadow:0 0 0 ${4 * dpr}px #ffb0201f;"></i>nextly
</div></body></html>`)}`;

const OUT = "public/assets/splash";
mkdirSync(OUT, { recursive: true });

const chrome = launch(9260, "/tmp/splash-profile");
try {
  const cdp = await connect(9260);
  await cdp.send("Page.enable");
  for (const [w, h, dpr] of DEVICES) {
    const pw = w * dpr, ph = h * dpr;
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: pw, height: ph, deviceScaleFactor: 1, mobile: true });
    await cdp.send("Page.navigate", { url: page(pw, ph, dpr) });
    await sleep(260);
    const { data } = await cdp.send("Page.captureScreenshot",
      { format: "png", clip: { x: 0, y: 0, width: pw, height: ph, scale: 1 } });
    writeFileSync(`${OUT}/${pw}x${ph}.png`, Buffer.from(data, "base64"));
    console.log(`${pw}x${ph}.png`);
  }
} finally { chrome.kill(); }
