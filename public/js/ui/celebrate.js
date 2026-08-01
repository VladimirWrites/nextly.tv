// Finishing something.
//
// The rest of this app is deliberately quiet — counts, ticks, a barcode. That restraint is
// what makes one loud moment worth having: closing a season, and finishing a show for good,
// are the only two things it ever makes a fuss about, and the fuss is over in two seconds.
//
// The confetti is drawn in the app's own colours rather than party colours, and it is drawn
// at all only if the person hasn't asked for less motion. The words work without it.
import { h } from "./dom.js";

const REDUCED = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Pixels per frame², at the 60fps the animation assumes.
const GRAVITY = 0.42;

// What is left of the sideways throw each frame. Its reach is the sum of the series, so this
// number and the width together decide how far a piece travels across, exactly.
const THROW_KEEP = 0.97;

/* Palette taken from the barcode: amber for watched, cyan for the episode you'd play next,
   and the muted tick colour so the burst has something quiet in it. Read off the stylesheet
   so it follows the theme rather than hardcoding a second copy of it. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
  return [
    pick("--signal", "#ffb020"),
    pick("--signal", "#ffb020"),
    pick("--phosphor", "#3fd3e6"),
    pick("--tick", "#3a4054"),
    pick("--text", "#e8eaf0"),
  ];
}

/* One canvas, thrown away when it stops. Two bursts from the lower corners rather than a
   sprinkle from the top: it reads as something being set off, and it clears the middle of
   the screen where the words are. */
function confetti(pieces = 90, ms = 1900) {
  const canvas = h("canvas.confetti", { "aria-hidden": "true" });
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  document.body.append(canvas);

  const colours = palette();

  /* Both directions come from the screen, and neither from a fixed angle.

     Up: under constant gravity a piece rises v²/2g, so the speed that carries it two thirds of
     the way up follows from the height.

     Across: it should drift towards the middle over that same flight rather than shoot past
     it. Time to the top of the arc is lift/g, so the sideways speed covering a set share of
     the width follows from that too.

     A fixed angle got this wrong on a phone. The speed was set by an 800px height and then
     applied sideways across 390px, so both bursts crossed the whole screen and left by the
     opposite edge inside half a second — which is why only one of them was ever in frame. */
  const lift = Math.sqrt(2 * GRAVITY * innerHeight * 0.66);

  /* The throw dies away rather than being eased into something else, so its whole reach is
     known in advance: a speed decaying by a fixed share each frame covers v/(1 - keep) in
     total, so the speed that carries a piece a set share of the width across is that share
     divided by the sum. Nothing here depends on how long the animation happens to run. */
  const throwReach = 1 / (1 - THROW_KEEP);
  const throwFrom = (innerWidth * 0.40) / throwReach;

  /* Coming down is not the throw in reverse. Paper reaches a terminal speed almost at once and
     then takes its time, so the fall is capped rather than left to accelerate — scaled to the
     height, so it takes about the same second and a half on any screen instead of dropping
     like a stone on a tall one.

     Each piece also carries a little sideways drift of its own and a flutter across it. Without
     them the horizontal speed decays to nothing and every piece finishes falling straight down
     the middle in one column, which is what the two bursts were doing. */
  const fall = (innerHeight * 0.66) / 78;

  const bits = Array.from({ length: pieces }, (_, i) => {
    // From just inside each lower corner, aimed up and inwards.
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? 12 : innerWidth - 12,
      y: innerHeight - 4,
      vx: throwFrom * (0.55 + Math.random() * 0.75) * (fromLeft ? 1 : -1),
      vy: -lift * (0.8 + Math.random() * 0.4),
      /* A steady drift of its own, on top of the throw, so the column fans out instead of
         coming down in one line. A share of the width per frame — measured against the width
         rather than the fall speed, which on a phone was worth 400px of travel across a
         390px screen and threw most of the confetti out of the window. */
      aim: (Math.random() - 0.5) * innerWidth * 0.0011,
      sway: 0.5 + Math.random() * 1.4,
      swayRate: 0.05 + Math.random() * 0.06,
      phase: Math.random() * Math.PI * 2,
      // A different terminal speed each, so they don't come down in step.
      fall: fall * (0.75 + Math.random() * 0.5),
      w: 5 + Math.random() * 5,
      h: 2 + Math.random() * 4,
      spin: (Math.random() - 0.5) * 0.35,
      turn: Math.random() * Math.PI,
      colour: colours[(Math.random() * colours.length) | 0],
    };
  });

  const started = performance.now();
  let raf = 0;
  let tick = 0;
  const frame = (now) => {
    const age = now - started;
    if (age > ms) return stop();
    tick++;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    // Fades over the last third, so nothing blinks out mid-flight.
    ctx.globalAlpha = age > ms * 0.66 ? 1 - (age - ms * 0.66) / (ms * 0.34) : 1;
    for (const b of bits) {
      b.vy = Math.min(b.vy + GRAVITY, b.fall);      // gravity going up, terminal speed coming down
      b.vx *= THROW_KEEP;                           // the throw wears off; the drift does not
      b.x += b.vx + b.aim + Math.sin(tick * b.swayRate + b.phase) * b.sway;
      b.y += b.vy;
      b.turn += b.spin;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.turn);
      ctx.fillStyle = b.colour;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    removeEventListener("resize", size);
    canvas.remove();
  };
  addEventListener("resize", size);
  raf = requestAnimationFrame(frame);
  return stop;
}

/* The note itself. Not a dialog: there is nothing to answer, and being made to dismiss a
   compliment is worse than not getting one. It leaves on its own, or on a tap. */
let showing = null;

export function celebrate({ title, line, big = false }) {
  if (showing) showing();

  const note = h("div.party", { class: big ? "is-big" : null, role: "status" }, [
    h("div.party-title.t-display", { text: title }),
    line ? h("div.party-line", { text: line }) : null,
  ]);
  document.body.append(note);
  requestAnimationFrame(() => note.classList.add("is-on"));

  // Long enough for a piece to go up and come down: the arc peaks around a second in and
  // reaches the bottom at about two, and the last third of this is a fade, so nothing is cut
  // off mid-air.
  const stopConfetti = REDUCED() ? null : confetti(big ? 150 : 90, big ? 3600 : 2800);

  const end = () => {
    if (showing !== end) return;
    showing = null;
    clearTimeout(timer);
    note.removeEventListener("click", end);
    note.classList.remove("is-on");
    setTimeout(() => note.remove(), 260);
    if (stopConfetti) stopConfetti();
  };
  const timer = setTimeout(end, big ? 4600 : 3400);
  note.addEventListener("click", end);
  showing = end;
  return end;
}
