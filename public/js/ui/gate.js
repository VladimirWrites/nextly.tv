// The gate: create an account number, or enter an existing one.
//
// The account number is the only credential and the only key. Nothing here can be recovered
// later, so the create screen's whole job is to get the number somewhere safe before it is
// needed — into a password manager if the browser will take it, and otherwise onto the
// clipboard or into a file.
import {
  h, toast, svg, ICON,
  isStandalone, isIOS, IOS_STORAGE_WARNING, canPromptInstall, promptInstall, onInstallStateChange,
} from "./dom.js";
import { generateToken, validToken, canonToken, copyText } from "../io/crypto.js";

/* ---- credential fields ----
   What a browser needs before it will offer to save a password, per web.dev's sign-in form
   guidance: a stable name and id on each input, inside a <form> with a submit button. The
   account number IS the password, so it is marked as one, with "new-password" while it is
   being created and "current-password" while it is being entered.

   A username field goes alongside because most managers will not store a lone password. It
   is visually hidden rather than display:none, since a field that isn't rendered at all is
   ignored by some of them. */
const HIDDEN = { position: "absolute", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" };

/* The name the entry files under. A constant, never anything derived from the number: a
   username is shown in plain text in manager lists, syncs between devices and turns up in
   exports, so a piece of the key in there would be scattered across all of it. */
const VAULT_USER = "nextly user";

/* Fixed while creating, so the manager stores a name it can show. Empty and writable while
   signing in, so the manager fills it — a username it did not write is a reason for it to
   decline to fill either field. */
const usernameField = (fixed) =>
  h("input", {
    type: "text",
    id: "username",
    name: "username",
    autocomplete: "username",
    value: fixed ? VAULT_USER : "",
    readonly: fixed || null,
    tabindex: "-1",
    "aria-hidden": "true",
    style: HIDDEN,
  });

/* ---- the password manager ----
   Chrome and Edge implement the credential store; Firefox and Safari don't, and there the
   constructor can exist while the call throws. So nothing below is ever promised to the
   user: Copy and Download are the offer, and this is a shortcut for browsers that have one. */
const hasCredentialApi = () => typeof window.PasswordCredential === "function";

/* Asking twice for the same number is the commonest way to annoy someone who has just done as
   they were told. The offer is made when the screen appears, and again when they press the
   button that says they have saved it — and if the first one worked, the second is a second
   bubble for a credential the manager already holds.

   So: never for a number this device has already stored, and never twice inside a minute. The
   cooldown covers the case the check can't see — a manager that took the credential while the
   page was in the background, where the silent check is answered only after the browser has
   settled. Nothing is written down: the token lives in this variable for as long as the screen
   is up, and it is the same string the field is showing. */
let lastAsk = { token: null, at: 0 };
const ASK_COOLDOWN = 60_000;

// Raises the browser's save prompt. Built from the form where that works, which is the shape
// Chrome's documentation uses — the credential then carries what the browser would have read
// out of the form itself.
async function askManager(token, form) {
  if (!hasCredentialApi()) return;

  const now = Date.now();
  if (lastAsk.token === token && now - lastAsk.at < ASK_COOLDOWN) return;
  // Already in the manager: the prompt would ask for something it has.
  if (await savedToManager(token)) return;
  lastAsk = { token, at: now };

  try {
    let cred;
    try {
      cred = new window.PasswordCredential(form);
    } catch (e) {
      cred = new window.PasswordCredential({
        id: VAULT_USER,
        password: canonToken(token),
        name: "nextly account number",
      });
    }
    await navigator.credentials.store(cred);
  } catch (e) {
    // Unimplemented, dismissed, or blocked. The file and the clipboard remain.
  }
}

/* Whether it was actually saved. store() resolves the same way whether the prompt was
   accepted or dismissed, so it answers nothing; asking for the credential back does. Silent
   mediation shows no UI of its own and resolves to null when there is nothing stored.

   The password is compared rather than the name, because every vault files under the same
   name — an older number left in the manager would otherwise read as this one being safe. */
async function savedToManager(token) {
  if (!hasCredentialApi()) return false;
  try {
    const got = await navigator.credentials.get({ password: true, mediation: "silent" });
    return !!got && got.type === "password" && got.password === canonToken(token);
  } catch (e) {
    return false;
  }
}

/* The prompt belongs to the browser and fires no event, so the only way to notice an answer
   is to look again. A handful of times over the next twenty seconds, spacing out, stopping
   at the first yes. Returns its own canceller. */
const LOOK_AT = [700, 1500, 2500, 4000, 6000, 9000];

function watchForSave(token, onSaved) {
  let stopped = false;
  let next = 0;
  const look = async () => {
    if (stopped) return;
    if (await savedToManager(token)) { stopped = true; return onSaved(); }
    if (next < LOOK_AT.length) setTimeout(look, LOOK_AT[next++]);
  };
  /* Coming back to the tab is the likeliest moment for the answer to have changed: saving into
     a password manager often means leaving the browser for it. The ladder above has usually run
     out by then. */
  const onReturn = () => { if (document.visibilityState === "visible") look(); };
  addEventListener("visibilitychange", onReturn);

  setTimeout(look, LOOK_AT[next++]);
  return () => {
    stopped = true;
    removeEventListener("visibilitychange", onReturn);
  };
}

// Show/hide for a credential field. The number is 34 characters that have to be checked by
// eye, so hiding it by default without a way to look would be worse than useless.
function revealToggle(input, startVisible) {
  const set = (visible) => {
    input.type = visible ? "text" : "password";
    btn.setAttribute("aria-pressed", String(visible));
    btn.title = visible ? "Hide" : "Show";
    btn.replaceChildren(svg(visible ? ICON.eyeOff : ICON.eye));
  };
  const btn = h("button.reveal", { type: "button", onclick: () => set(input.type === "password") });
  set(startVisible);
  return btn;
}

/* ---- installing, offered before there is anything to lose ----

   The first screen is the right place to raise this and the only one where it costs nothing.
   It cannot go on the create screen: that screen's entire job is getting the account number
   somewhere safe, it already carries the warning that losing the number loses everything, and
   a second thing asking to be pressed there would be competing with the one thing that must
   not be missed.

   Before is also genuinely better than after, and not only for tidiness. On iOS a home-screen
   web app gets its own storage container, separate from Safari's — so an account created in
   the browser and then installed is an installed app that opens at this screen with no vault
   in it. Recoverable, since the number was saved, but a confusing first five minutes. Install
   first and the account is created where it will live.

   Nothing here is automatic, because nothing can be: a browser will only open the install
   dialog from a real gesture, so an app that appears to prompt by itself is showing its own
   card and using the tap on it. This is that card. */
function installOffer() {
  const box = h("div.gate-install");

  const fill = () => {
    box.replaceChildren();
    // Already installed: there is nothing to offer and this is the app doing the asking.
    if (isStandalone()) return;

    if (canPromptInstall()) {
      box.append(
        h("div.gate-install-text", { text: "Install nextly for offline access and its own window." }),
        h("button.btn.btn-sm", {
          type: "button",
          text: "Install",
          onclick: async () => {
            const result = await promptInstall();
            if (result === "installed") toast("Installed");
            // Dismissed, or a browser that gave us nothing to open: either way the offer goes.
            // Pressing it and being asked again is how an app says it was not listening.
            box.replaceChildren();
          },
        }),
      );
      return;
    }

    /* iOS never fires the event, so there is no dialog to open and no button worth drawing —
       only the two steps, said once. Every other browser without a prompt (Firefox, Brave)
       gets nothing at all here: a card whose only content is "look in your menu" is noise on
       the screen someone is deciding whether to use this app at all. Settings still has it. */
    if (isIOS()) {
      box.append(
        h("div.gate-install-text", {
          text: "Add nextly to your Home Screen: tap Share, then Add to Home Screen.",
        }),
        // The reason, not just the steps. On this platform it is the difference between the
        // app still being signed in next month and not, and nobody guesses that unprompted.
        h("div.warn", { style: { flexBasis: "100%" }, text: IOS_STORAGE_WARNING }),
      );
    }
  };

  fill();
  // beforeinstallprompt can arrive a moment after this screen paints, so the offer appears
  // when it does rather than only on the next visit.
  onInstallStateChange(fill);
  return box;
}

export function renderGate(root, { onSignIn }) {
  const view = h("div.gate");
  const card = h("div.gate-card");
  view.append(card);
  root.replaceChildren(view);

  // Dropped whenever the card is replaced, so no watcher is left looking at a screen nobody
  // is on.
  let stopWatch = null;
  const show = (build) => {
    if (stopWatch) stopWatch();
    stopWatch = null;
    build();
  };

  const showChoice = () => show(choice);
  const showCreate = () => show(create);
  const showEnter = () => show(enterExisting);

  /* Built once and kept, rather than per visit to the first screen: it carries a listener for
     the install event, and a new one on every back would stack them up. */
  const install = installOffer();

  showChoice();

  function choice() {
    card.replaceChildren(
      h("div.brand", [h("i.brand-lamp"), "nextly"]),
      h("h1.t-display", { style: { fontSize: "clamp(28px,7vw,44px)", marginTop: "18px" }, text: "Never lose your watch history again." }),
      h("p.gate-lede", {
        text: "Your episodes are encrypted on this device before they're stored. No email, no password, no tracking — and an export button that always works.",
      }),
      h("div.gate-form", [
        h("button.btn.btn-primary", { type: "button", text: "Create an account number", onclick: showCreate }),
        h("button.btn.btn-ghost", { type: "button", text: "I already have one", onclick: showEnter }),
      ]),
      // Under the two things this screen is for, never above them.
      install,
    );
  }

  function create() {
    const token = generateToken();

    /* Readable by default — this is the one moment the number has to be checked by eye — but
       a password field underneath, so a manager recognises it.

       Readonly, because the number on screen is the one someone may write down and nothing
       else reads this box: Copy and Download both use the token itself, so an edit here would
       leave the displayed number disagreeing with the real one. Checked that it costs nothing
       to keep — PasswordCredential built from a form reads a readonly field exactly as it
       reads an editable one. */
    const field = h("input.field.token-out", {
      type: "password",
      id: "new-password",
      name: "password",
      autocomplete: "new-password",
      value: token,
      readonly: true,
      spellcheck: "false",
      "aria-label": "Your new account number",
    });

    // Shown if the browser confirms it took the number. Feedback only — nothing waits on it,
    // because the check is silent and does not answer on every browser.
    const saved = h("p.gate-saved", { hidden: true });
    // Set once the browser confirms it took the number, and read on the way out: a second
    // prompt after that is a prompt for something already stored.
    let stored = false;
    const confirmSaved = () => {
      stored = true;
      saved.replaceChildren(svg(ICON.check, "gate-saved-tick"),
        h("span", { text: "Saved to your password manager." }));
      saved.hidden = false;
    };

    const form = h("form.gate-form", {
      onsubmit: async (e) => {
        e.preventDefault();
        // Managers read the field at submit time, so put it back into password state first.
        field.type = "password";
        // Only if it isn't already there. Someone who saved it from the first offer and then
        // pressed this button was being told they had done it wrong.
        if (!stored) await askManager(token, form);
        // Signing in re-renders the shell, which takes this form out of the document — the
        // signal a browser watches for after a submit it saw no navigation from.
        await onSignIn(token);
      },
    }, [
      usernameField(true),
      h("div.reveal-wrap", [field, revealToggle(field, true)]),
      h("div.warn", { text: "Nobody can look this up for you. What we store is scrambled, and this number is the only thing that unscrambles it. Lose the number and the data is gone for good." }),
      h("div.row-gap", [
        h("button.btn", {
          type: "button",
          text: "Copy",
          onclick: async () => toast((await copyText(token))
            ? "Copied"
            : "Copy failed — select the number and copy it by hand"),
        }),
        h("button.btn", { type: "button", text: "Download as a file", onclick: () => download(token) }),
      ]),
      saved,
      // Never disabled. It was gated on copying or downloading, which told anyone who had
      // just saved it in their browser that they hadn't. The warning above says what is lost
      // by walking past it, and the choice is theirs.
      h("button.btn.btn-primary", { type: "submit", text: "I've saved it — open my library" }),
      h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Back", onclick: showChoice }),
    ]);

    // Offered while the number is still on screen rather than at the end of the flow: this is
    // the moment it is worth saving, and there is nothing to lose by asking early.
    askManager(token, form);
    stopWatch = watchForSave(token, confirmSaved);

    card.replaceChildren(
      h("h1.t-display", { style: { fontSize: "clamp(24px,6vw,34px)" }, text: "This is your account number" }),
      h("p.gate-lede", { text: "It unlocks your data on any device. Your browser may offer to save it; if it doesn't, copy it into your password manager or download it. Do one of those before you go on." }),
      form,
    );
  }

  function enterExisting() {
    const input = h("input.field.token", {
      type: "password",
      id: "current-password",
      name: "password",
      autocomplete: "current-password",
      autocapitalize: "characters",
      spellcheck: "false",
      enterkeyhint: "go",
      placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX",
      "aria-label": "Account number",
    });
    const err = h("div.warn", { style: { display: "none" } });

    const form = h("form.gate-form", {
      onsubmit: (e) => {
        e.preventDefault();
        if (!validToken(input.value)) {
          err.textContent = "That isn't a valid account number. Check for a missing or extra character — the last two are a checksum.";
          err.style.display = "";
          input.focus();
          return;
        }
        onSignIn(canonToken(input.value));
      },
    }, [
      usernameField(false),
      h("div.reveal-wrap", [input, revealToggle(input, false)]),
      err,
      h("button.btn.btn-primary", { type: "submit", text: "Open my library" }),
      h("button.btn.btn-ghost.btn-sm", { type: "button", text: "Back", onclick: showChoice }),
    ]);

    card.replaceChildren(
      h("h1.t-display", { style: { fontSize: "clamp(24px,6vw,34px)" }, text: "Enter your account number" }),
      h("p.gate-lede", { text: "Dashes are optional. Your number stays on this device — we never receive it." }),
      form,
    );
    input.focus();
  }
}

// A plain text file, because a recovery key you can't open isn't a recovery key.
function download(token) {
  const body = [
    "nextly — account number",
    "",
    token,
    "",
    "This is the only way to open your data. It is also the encryption key:",
    "the server stores ciphertext and cannot recover it for you.",
    "Keep this file somewhere you would keep a password.",
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "nextly-account-number.txt";
  a.click();
  URL.revokeObjectURL(url);
}
