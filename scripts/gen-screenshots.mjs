// Screenshots for the manifest, taken from the real app rather than mocked up.
//
// Chrome's install dialog on Android is the good one — the tall, app-store-shaped card rather
// than a one-line bar — only when the manifest offers it a description and screenshots. We had
// the description. This makes the rest.
//
// The library in them is invented, which is the honest way round: these are published to
// everyone who installs, and nobody's actual watch history belongs in that. The shows and all
// their artwork are real, fetched from TVmaze exactly as the app does; only the marks are made
// up, and they are made up deterministically so re-running this produces the same pictures.
//
// Needs a dev server on 8788 and Chrome on the machine. Drives it over the DevTools protocol
// rather than through a browser-automation dependency, because the whole app has none and one
// script is not a reason to start.
//
//   npm run dev            (in another terminal)
//   npm run gen-shots
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const ORIGIN = process.env.SHOT_ORIGIN || "http://127.0.0.1:8788";
const PORT = 9223;
const OUT = new URL("../public/assets/screenshots/", import.meta.url);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* The library the screenshots show. Chosen to look like somebody's actual list rather than a
   top-ten: a couple of things finished, a couple mid-season, something old, something still
   running. `seen` is how far in, as a fraction of what has aired. */
const LIBRARY = [
  { q: "Severance", seen: 0.7 },
  { q: "The Bear", seen: 1 },
  { q: "Breaking Bad", seen: 1 },
  { q: "Silo", seen: 0.55 },
  { q: "Shogun", seen: 1 },
  { q: "Andor", seen: 0.4 },
  { q: "The Last of Us", seen: 0.8 },
  { q: "Slow Horses", seen: 0.65 },
  { q: "Succession", seen: 1 },
  { q: "Fleabag", seen: 1 },
  { q: "Poker Face", seen: 0.3 },
  { q: "Dark", seen: 1 },
  { q: "The Expanse", seen: 0.45 },
  { q: "Chernobyl", seen: 1 },
];

const SHOTS = [
  { name: "up-next", label: "What to watch tonight", route: "/app", form: "narrow" },
  { name: "library", label: "Your whole library, with progress you can read at a glance", route: "/library", form: "narrow" },
  { name: "stats", label: "What your year actually looked like", route: "/stats", form: "narrow" },
  { name: "library-wide", label: "Your library", route: "/library", form: "wide" },
  { name: "up-next-wide", label: "What to watch tonight", route: "/app", form: "wide" },
];

/* Narrow at 2x, which is what a phone actually is. Wide at 1x: the desktop shot is decoration
   beside the phone ones in Chrome's dialog, and 2560px of it was 2.4MB for no gain. */
const SIZE = {
  narrow: { width: 412, height: 915, scale: 2 },
  wide: { width: 1280, height: 800, scale: 1 },
};

// ---- the DevTools protocol, by hand ----

let ws, next = 1;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = next++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

async function connect(url) {
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
  };
}

// Runs an async expression in the page and gives back its value, throwing what the page threw.
async function run(expression) {
  const r = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

// ---- what the page is told to do ----

/* Signing in through the real gate rather than by writing to storage: it is the path that
   derives the keys, creates the vault and boots the app, and reproducing it by hand would be
   reproducing the one part most worth not getting subtly wrong. */
const SIGN_IN = `
  document.querySelector(".gate-card .btn-primary").click();
  await new Promise((r) => setTimeout(r, 50));
  document.querySelector("form.gate-form").requestSubmit();
  await new Promise((r) => setTimeout(r, 1200));
  return !!document.querySelector(".nav") || !document.querySelector(".gate");
`;

const seed = (library) => `
  const { trackShow } = await import("/js/ui/actions.js");
  const { state } = await import("/js/domain/store.js");
  const { markEpisode, setStatus } = await import("/js/domain/model.js");
  const cache = await import("/js/io/cache.js");
  const wanted = ${JSON.stringify(library)};

  const DAY = 86400000;
  const now = Date.now();
  const added = [];

  /* Deterministic noise, so re-running produces the same pictures. A real library is not a
     grid: shows are watched in bursts months apart, at somewhat different hours, and the
     first pass at this put every mark inside eight weeks and three clock columns, which read
     as generated rather than lived-in. */
  const rand = (a, b) => {
    let h = (a * 73856093) ^ (b * 19349663);
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  for (const want of wanted) {
    let hit;
    try {
      hit = await fetch("https://api.tvmaze.com/singlesearch/shows?q=" + encodeURIComponent(want.q))
        .then((r) => (r.ok ? r.json() : null));
    } catch (e) { hit = null; }
    if (!hit) continue;
    const key = "tvmaze:" + hit.id;
    try { await trackShow(key); } catch (e) { continue; }

    const show = state.shows.find((s) => s.id === key);
    const meta = cache.getMeta(key);
    if (!show || !meta) continue;

    // Everything that has aired, in order, so "seen" can take a prefix of it.
    const aired = (meta.seasons || [])
      .flatMap((se) => (se.episodes || []).map((ep) => ({ s: se.n, e: ep.e, air: ep.air, special: ep.special })))
      .filter((ep) => !ep.special && ep.air && new Date(ep.air).getTime() <= now);

    const upto = Math.floor(aired.length * want.seen);
    const k = added.length;

    /* Each show gets its own stretch: a start somewhere in the last ten months and a pace of
       roughly one to three episodes a week, so two shows overlap the way they actually do
       rather than tiling the year end to end. Episodes stay in order within a show — you do
       not watch the finale first. */
    const start = 20 + rand(k, 0) * 300;                 // days ago the run began
    const pace = 0.4 + rand(k, 1) * 2.2;                 // days between episodes

    for (let i = 0; i < upto; i++) {
      const ep = aired[i];
      markEpisode(state, key, ep.s + "x" + ep.e, true, now);
      const entry = (show.entries || []).find((x) => x.id === ep.s + "x" + ep.e);
      if (!entry) continue;

      const back = Math.max(0.2, start - i * pace);
      const d = new Date(now - back * DAY);

      /* Mostly evenings, because that is when television happens, but not all of them: a
         weekend afternoon and the occasional very late episode are what make the crossed
         chart worth drawing at all. */
      const r = rand(k, i + 7);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const hour = r < 0.62 ? 20 + Math.floor(rand(k, i + 11) * 3)
        : weekend && r < 0.88 ? 14 + Math.floor(rand(k, i + 13) * 5)
        : r < 0.94 ? 23
        : Math.floor(rand(k, i + 17) * 2);               // the one-more-episode hours
      d.setHours(hour, Math.floor(rand(k, i + 19) * 60), 0, 0);
      entry.w = d.getTime();
    }
    if (want.seen < 0.35) setStatus(state, key, "planned", now);
    added.push(show.name);
  }
  return added;
`;

// ---- go ----

const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + (process.env.TMPDIR || "/tmp") + "nextly-shots",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  "--hide-scrollbars", "--force-device-scale-factor=2",
  "about:blank",
], { stdio: "ignore" });

const die = async (msg, code = 1) => {
  console.error("gen-screenshots: " + msg);
  chrome.kill();
  process.exit(code);
};

try {
  // Chrome takes a moment to open its debugging port.
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === "page");
    } catch (e) { /* not up yet */ }
  }
  if (!target) await die("Chrome never opened its debugging port");

  await connect(target.webSocketDebuggerUrl);
  await send("Page.enable");
  await send("Runtime.enable");

  const goto = async (url) => {
    await send("Page.navigate", { url });
    await sleep(900);
  };

  mkdirSync(OUT, { recursive: true });

  console.log("gen-screenshots: signing in");
  await send("Emulation.setDeviceMetricsOverride", { ...SIZE.narrow, deviceScaleFactor: SIZE.narrow.scale, mobile: true });
  await goto(ORIGIN + "/app");
  const signedIn = await run(SIGN_IN);
  if (!signedIn) await die("could not get past the gate — is the dev server running?");

  console.log("gen-screenshots: building a library from TVmaze");
  const added = await run(seed(LIBRARY));
  if (!added.length) await die("no shows could be added — TVmaze unreachable?");
  console.log(`gen-screenshots: ${added.length} shows — ${added.join(", ")}`);
  // Artwork is fetched per card; give it time to land or the shots are full of initials.
  await sleep(4000);

  const written = [];
  for (const shot of SHOTS) {
    const size = SIZE[shot.form];
    await send("Emulation.setDeviceMetricsOverride", {
      ...size, deviceScaleFactor: size.scale, mobile: shot.form === "narrow",
    });
    await goto(ORIGIN + shot.route);
    await sleep(1800);   // posters, and the stats page's own arithmetic

    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = `${shot.name}.png`;
    writeFileSync(new URL(file, OUT), Buffer.from(data, "base64"));
    written.push({ ...shot, file, size: { width: size.width * size.scale, height: size.height * size.scale } });
    console.log(`  wrote ${file}  ${size.width * size.scale}x${size.height * size.scale}  ${shot.form}`);
  }

  // The manifest entries, ready to paste — sizes have to match the files exactly or Chrome
  // ignores the lot, so they are reported rather than remembered.
  writeFileSync(new URL("manifest-entries.json", OUT), JSON.stringify(
    written.map((w) => ({
      src: `/assets/screenshots/${w.file}`,
      sizes: `${w.size.width}x${w.size.height}`,
      type: "image/png",
      form_factor: w.form,
      label: w.label,
    })), null, 2) + "\n");

  console.log("gen-screenshots: manifest entries in public/assets/screenshots/manifest-entries.json");
  chrome.kill();
  process.exit(0);
} catch (e) {
  await die(e.message);
}
