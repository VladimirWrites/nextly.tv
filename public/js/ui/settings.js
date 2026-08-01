// You — the key, the account number, the export, and the two destructive buttons.
//
// This screen is also where the app makes its promise checkable: the export is a plain JSON
// file with show names spelled out, so you can read your own history without this app, this
// server, or any catalogue.
import { h, mount, toast, confirmWord, isStandalone, isIOS, canPromptInstall, promptInstall } from "./dom.js";
import { confirmDialog } from "./overlay.js";
import { state } from "../domain/store.js";
import { VERSION } from "../version.js";
import { totalWatched, totalEpisodes } from "../domain/model.js";
import { relTime } from "../domain/dates.js";
import { canonToken, copyText } from "../io/crypto.js";
import { exportJSON, importJSON, syncedAt, rememberedToken, forgetToken, deleteVault, scheduleSync, flushSync, storageUse } from "../io/storage.js";
import { clearAll as clearMetaCache } from "../io/cache.js";
import { refreshLibrary, retimeLibrary } from "./actions.js";
import * as meta from "../io/meta.js";
import * as discover from "../io/discover.js";

export function renderSettings(root, { go, repaint }) {
  const s = state.settings;

  mount(
    root,
    h("div.sect", [h("h2.t-label", { text: "You" })]),

    h("div.set-group", [
      row(
        "Episodes watched",
        totalWatched(state) !== totalEpisodes(state)
          ? `Across ${state.shows.length} shows — ${totalEpisodes(state)} distinct episodes, the rest rewatches.`
          : `Across ${state.shows.length} shows.`,
        h("div.stat-n", { text: String(totalWatched(state)) }),
      ),
      row("Your year", "Hours, streaks, the hour of the night you actually watch at. Worked out on this device from marks it already holds.",
        h("button.btn.btn-sm", { type: "button", text: "Open", onclick: () => go("stats") })),
      row("Last synced", syncedAt() ? relTime(syncedAt()) : "Not yet — this device is holding your only copy.",
        h("button.btn.btn-sm", { type: "button", text: "Sync now", onclick: async () => { await flushSync(); toast("Synced"); repaint(); } })),
    ]),

    h("div.sect", [h("h2.t-label", { text: "Catalogue" })]),
    h("div.set-group", [
      row(
        "Where new shows come from",
        "TVmaze needs no key and works out of the box. TMDB has better artwork, wider international coverage, and adds trending, popular and \u201cmore like this\u201d — but needs a key of your own. Shows you already track keep the catalogue they were added with, because episode numbering belongs to the catalogue.",
        // TMDB stays unselectable until there is a key to select it with. Picking it
        // without one used to leave the control saying TMDB while TVmaze did the work.
        segmented([["tvmaze", "TVmaze"], ["tmdb", "TMDB", !s.tmdbKey]], s.provider || "tvmaze", (v) => {
          s.provider = v;
          discover.forget();     // held rows came from the catalogue being switched away from
          scheduleSync();
          repaint();
        }),
      ),
      tmdbKeyRow(s, repaint),
      row(
        "Fix hand-entered watch dates",
        "A history typed in after the fact carries the days you typed it, because that is when the marks were made — an evening spent catching a library up looks like an evening spent watching four hundred episodes. This dates each watched episode to the evening it first aired instead, which is the closest thing to the truth anyone has. Nothing about what you watched changes, and a single show can be set differently on its own page, under This show \u2192 Watch dates.",
        h("button.btn.btn-sm", { type: "button", text: "Date as aired", onclick: async (e) => {
          const btn = e.currentTarget;      // nulled once this handler awaits
          const ok = await confirmDialog({
            title: "Date everything as it aired?",
            body: "Every watched episode in your library is dated to the evening it first went out. Marks with no air date on record are left as they are, and a show you actually watched some other way can be set differently on its own page.",
            confirm: "Date as aired",
          });
          if (!ok) return;
          btn.disabled = true;
          try { retimeLibrary(); } finally { btn.disabled = false; }
        } })),

      row("Refresh episode lists", "Pulls new episodes and air dates for every show you track.",
        h("button.btn.btn-sm", { type: "button", text: "Refresh now", onclick: async (e) => {
          const btn = e.currentTarget;      // nulled once this handler awaits
          btn.disabled = true;
          try {
            await refreshLibrary({ force: true });
            toast("Episode lists refreshed");
          } finally {
            btn.disabled = false;
          }
        } })),
      row("Count specials", "Specials and one-off episodes join your progress and can appear in Up next.",
        toggle(s.specials, (on) => { s.specials = on; scheduleSync(); repaint(); })),
    ]),

    installRow(repaint),

    h("div.sect", [h("h2.t-label", { text: "Appearance" })]),
    h("div.set-group", [
      row("Theme", "Follows your system unless you pick one.",
        segmented([["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]], s.theme, (v) => {
          s.theme = v;
          applyTheme(v);
          scheduleSync();
          repaint();
        })),
    ]),

    h("div.sect", [h("h2.t-label", { text: "Your data" })]),
    h("div.set-group", [
      storageRow(),
      row("Export", "A readable JSON file with every show name and episode you've marked. Keep one somewhere safe — it outlives this app.",
        h("button.btn.btn-sm", { type: "button", text: "Export JSON", onclick: doExport })),
      row("Import", "Merges a previous export into what's here. Nothing is overwritten — the newer mark wins per episode.",
        h("button.btn.btn-sm", { type: "button", text: "Import JSON", onclick: () => doImport(repaint) })),
      row("Account number", "The only key to your vault. Anyone with it can read your data.",
        h("div.row-gap", [
          h("button.btn.btn-sm", { type: "button", text: "Show", onclick: (e) => {
            const t = rememberedToken();
            if (!t) return toast("Not stored on this device");
            e.currentTarget.replaceWith(h("code.t-mono", { text: canonToken(t), style: { fontSize: "13px", wordBreak: "break-all" } }));
          } }),
          h("button.btn.btn-sm", { type: "button", text: "Copy", onclick: async () => {
            const t = rememberedToken();
            toast(t && (await copyText(canonToken(t))) ? "Copied" : "Copy failed");
          } }),
        ])),
    ]),

    h("div.sect", [h("h2.t-label", { text: "Danger" })]),
    h("div.set-group", [
      row("Sign out of this device", "Forgets your account number and the local copy here. The vault itself is untouched.",
        h("button.btn.btn-sm.btn-danger", { type: "button", text: "Sign out", onclick: async () => {
          // Recoverable with the account number, so it asks rather than examines. Deleting
          // the vault below is not recoverable, and still makes you type the word.
          const ok = await confirmDialog({
            title: "Sign out of this device?",
            body: "This forgets your account number and the local copy here. You'll need the number to get back in. The vault itself is untouched.",
            confirm: "Sign out",
            tone: "danger",
          });
          if (!ok) return;
          forgetToken();
          clearMetaCache();
          location.reload();
        } })),
      row("Delete the vault", "Erases the stored blob for good. There is no backup and no recovery.",
        h("button.btn.btn-sm.btn-danger", { type: "button", text: "Delete everything", onclick: async () => {
          if (!confirmWord("DELETE", `Delete your vault and all ${totalEpisodes(state)} watch marks? This cannot be undone. Export first if you want a copy.`)) return;
          const ok = await deleteVault();
          if (!ok) return toast("Delete failed — nothing was removed");
          forgetToken();
          clearMetaCache();
          location.reload();
        } })),
    ]),

    /* There is nothing to sell here — no tier, no account, nothing withheld — so the only
       honest way to ask is to say what it costs to run and leave it at that. Last thing on
       the last screen, phrased as an offer rather than a prompt, and it never appears twice
       or follows anyone around. */
    h("div.sect", [h("h2.t-label", { text: "Support" })]),
    h("div.set-group", [
      h("div.set-row", [
        h("div.set-text", [
          h("div.set-name", { text: "Buy me a coffee" }),
          h("div.set-hint", { text: "nextly is free and has no ads, no tracking and nothing "
            + "held back for a paid tier. If it saved your watch history, you can put something "
            + "towards the bills." }),
        ]),
        // A link out, so it costs nothing until it is pressed and contacts nobody before then.
        h("a.btn.btn-sm", {
          href: "https://buymeacoffee.com/vladimirj.dev",
          target: "_blank",
          rel: "noreferrer noopener",
          text: "Buy a coffee",
        }),
      ]),
    ]),

    /* The build this device is actually running. Android shows "Version 1" for an installed
       PWA — that is the wrapper Chrome mints around it, versioned by Chrome, with no manifest
       field to set — so this is the only place the real one can appear. Worth a line: two
       devices showing different histories turned out to be two devices on different builds,
       and neither of them could say so. */
    h("p.t-dim", { style: { marginTop: "24px", fontSize: "12.5px" } }, [
      `nextly ${VERSION} · `,
      h("span", { text: "Show data from TVmaze and TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB." }),
    ]),
  );
}

/* What is held on this device, and whether the browser has agreed to keep it.

   Worth saying because both halves matter: the size explains where the space went for anyone
   tracking a daily programme with twenty thousand episodes, and the promise explains what
   happens when the device runs short — storage that has not been made persistent is the first
   thing a browser discards. */
function storageRow() {
  const line = h("div.set-hint", { text: "Checking…" });

  storageUse().then((use) => {
    if (!use) {
      line.textContent = "This browser doesn't say how much it is holding.";
      return;
    }
    const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
    line.textContent = [
      `${mb(use.usage)} on this device`,
      use.persisted
        ? "kept even when storage runs short"
        : "may be cleared if storage runs short — your vault is still on the server",
    ].join(" · ");
  });

  return h("div.set-row", [
    h("div.set-text", [h("div.set-name", { text: "On this device" }), line]),
  ]);
}

/* The key field, with an answer to "is this thing working?".
   A key that is merely stored tells the user nothing: it might be mistyped, revoked, or the
   wrong one of TMDB's two kinds. So it is checked against TMDB on entry and on load, and the
   result is stated plainly underneath. */
function tmdbKeyRow(s, repaint) {
  const status = h("div.key-status");

  const setStatus = (kind, text) => {
    status.className = "key-status is-" + kind;
    status.replaceChildren(
      kind === "checking" ? h("i.spinner") : h("i.key-dot"),
      h("span", { text }),
    );
  };

  const verify = async () => {
    if (!s.tmdbKey) return setStatus("idle", "No key yet — add one to choose TMDB above.");
    setStatus("checking", "Checking the key…");
    const problem = await meta.verifyKey("tmdb");
    if (problem) return setStatus("bad", problem);
    setStatus("good", s.provider === "tmdb"
      ? "Key works. TMDB is being used for new shows and artwork."
      : "Key works. Choose TMDB above to start using it.");
  };

  verify();

  return row(
    "TMDB API key",
    "Stored in your encrypted vault and sent straight from this device to TMDB. Our server never sees the key, or which shows you look up.",
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", width: "100%" } }, [
      h("input.field", {
        type: "password",
        value: s.tmdbKey || "",
        placeholder: "v3 key or v4 read access token",
        "aria-label": "TMDB API key",
        autocomplete: "off",
        style: { flex: "1 1 240px" },
        onchange: async (e) => {
          const had = !!s.tmdbKey;
          s.tmdbKey = e.target.value.trim();
          // Clearing the key can't leave TMDB selected, or the setting would claim a
          // catalogue it has no way to reach.
          if (!s.tmdbKey && s.provider === "tmdb") s.provider = "tvmaze";
          discover.forget();
          scheduleSync();
          await verify();
          if (s.tmdbKey && !status.classList.contains("is-bad")) refreshLibrary();
          // Only when the segment's availability actually changed, so typing a correction
          // doesn't rip the field out from under the cursor.
          if (had !== !!s.tmdbKey) repaint();
        },
      }),
      h("a.btn.btn-sm", { href: "https://www.themoviedb.org/settings/api", target: "_blank", rel: "noreferrer noopener", text: "Get a key" }),
      status,
    ]),
  );
}

// Install. Hidden once the app is running standalone, because then there is nothing to do.
function installRow(repaint) {
  if (isStandalone()) return null;

  const steps = h("div.set-hint", { style: { display: "none", marginTop: "10px" } });
  const show = (text) => { steps.textContent = text; steps.style.display = ""; };

  const button = h("button.btn.btn-sm.btn-primary", {
    type: "button",
    text: "Install",
    onclick: async () => {
      const result = await promptInstall();
      if (result === "installed") return toast("Installed");
      if (result === "dismissed") return;
      // No programmatic prompt: iOS never offers one, and Firefox and Brave do not either.
      show(isIOS()
        ? "In Safari, tap the Share button, then choose Add to Home Screen."
        : "In your browser menu, look for Install app or Add to Home screen. In Chrome on a computer there is also an install icon at the right of the address bar.");
    },
  });

  return h("div", [
    h("div.sect", [h("h2.t-label", { text: "Install" })]),
    h("div.set-group", [
      h("div.set-row", [
        h("div.set-text", [
          h("div.set-name", { text: "Add nextly to your home screen" }),
          h("div.set-hint", {
            text: canPromptInstall()
              ? "Runs in its own window, works offline, and opens straight to Up next."
              : "Runs in its own window and works offline. Your browser handles the install itself — tap for the steps.",
          }),
          steps,
        ]),
        button,
      ]),
    ]),
  ]);
}

/* ---- building blocks ---- */

function row(name, hint, control) {
  return h("div.set-row", [
    h("div.set-text", [h("div.set-name", { text: name }), h("div.set-hint", { text: hint })]),
    control,
  ]);
}

function segmented(options, value, onPick) {
  return h("div.seg", options.map(([v, label, disabled]) =>
    h("button.seg-btn", {
      type: "button",
      class: v === value ? "is-on" : null,
      text: label,
      disabled: disabled || null,
      onclick: () => onPick(v),
    })
  ));
}

function toggle(on, onChange) {
  return h("div.seg", [
    h("button.seg-btn", { type: "button", class: !on ? "is-on" : null, text: "Off", onclick: () => onChange(false) }),
    h("button.seg-btn", { type: "button", class: on ? "is-on" : null, text: "On", onclick: () => onChange(true) }),
  ]);
}

export function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === "light" || pref === "dark") root.setAttribute("data-theme", pref);
  else root.removeAttribute("data-theme");
  // Mirrored into localStorage purely so the inline script in index.html can apply it before
  // first paint — a reload must never flash the wrong theme.
  try {
    if (pref === "light" || pref === "dark") localStorage.setItem("nx_theme", pref);
    else localStorage.removeItem("nx_theme");
  } catch (e) {}
  // Keep the browser chrome in step with the page, in both directions.
  const dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  document.head.append(h("meta", { name: "theme-color", content: dark ? "#12141b" : "#f1f2f6" }));
}

function doExport() {
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([exportJSON()], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `nextly-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported");
}

function doImport(repaint) {
  const input = h("input", { type: "file", accept: "application/json,.json" });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const n = importJSON(await file.text());
      toast(`Imported — ${n} shows in your library`);
      repaint();
      refreshLibrary();
    } catch (e) {
      toast(e.message);
    }
  });
  input.click();
}
