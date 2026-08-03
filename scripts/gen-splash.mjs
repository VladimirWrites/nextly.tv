/* iOS launch images, in both colour schemes.
 *
 * A home-screen web app with no apple-touch-startup-image gets no launch screen, so iOS fills
 * the gap by scaling whatever it last had into the standalone viewport. A snapshot taken in
 * Safari, whose viewport is shorter, stretched into a taller window is why the app opened
 * zoomed with its right edge missing and then corrected itself once the real render arrived.
 *
 * One image per device resolution, because iOS matches them exactly and an image that does not
 * match its device is scaled, which is the same bug again. Portrait only: a phone is not
 * launched from a home screen in landscape often enough to double the count for.
 *
 * Two sets, because a dark plate in front of a light app is a flash of the wrong colour at the
 * one moment there is nothing else on screen. The light set carries no prefers-color-scheme in
 * its media query and is declared first, so a browser that does not understand the feature
 * still matches something — which matters more than the shade, since matching nothing is how
 * the original bug comes back.
 *
 * What this cannot follow is the app's own theme setting. iOS chooses the image before any of
 * our code exists, so all it can read is the system preference; someone who has set light or
 * dark inside the app against their system will see the system's answer for a third of a
 * second.
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
// The two themes' own tokens, so the plate is the colour the app is about to paint.
export const SCHEMES = {
  light: { bg: "#f1f2f6", ink: "#171a22", lamp: "#9a5b00", halo: "#9a5b0014" },
  dark: { bg: "#12141b", ink: "#e9ebf2", lamp: "#ffb020", halo: "#ffb0201f" },
};

const page = (pw, ph, dpr, c) => `data:text/html,${encodeURIComponent(`
<html><body style="margin:0"><div style="
  width:${pw}px;height:${ph}px;background:${c.bg};
  display:flex;align-items:center;justify-content:center;gap:${11 * dpr}px;
  font-family:system-ui,-apple-system,'Helvetica Neue',sans-serif;
  font-weight:800;letter-spacing:-0.03em;font-size:${26 * dpr}px;color:${c.ink};">
  <i style="width:${12 * dpr}px;height:${12 * dpr}px;border-radius:50%;background:${c.lamp};
            box-shadow:0 0 0 ${4 * dpr}px ${c.halo};"></i>nextly
</div></body></html>`)}`;

const OUT = "public/assets/splash";
mkdirSync(OUT, { recursive: true });

const chrome = launch(9260, "/tmp/splash-profile");
try {
  const cdp = await connect(9260);
  await cdp.send("Page.enable");
  for (const [name, c] of Object.entries(SCHEMES)) {
    for (const [w, h, dpr] of DEVICES) {
      const pw = w * dpr, ph = h * dpr;
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: pw, height: ph, deviceScaleFactor: 1, mobile: true });
      await cdp.send("Page.navigate", { url: page(pw, ph, dpr, c) });
      await sleep(260);
      const { data } = await cdp.send("Page.captureScreenshot",
        { format: "png", clip: { x: 0, y: 0, width: pw, height: ph, scale: 1 } });
      // Light carries no suffix: it is the set declared without a colour-scheme query, so it
      // is also the one a browser that does not understand the feature falls back to.
      const file = name === "light" ? `${pw}x${ph}.png` : `${pw}x${ph}-dark.png`;
      writeFileSync(`${OUT}/${file}`, Buffer.from(data, "base64"));
      console.log(file);
    }
  }
} finally { chrome.kill(); }
