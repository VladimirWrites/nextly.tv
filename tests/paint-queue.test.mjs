// When the screen is allowed to redraw itself.
//
// The fault: a hydrate lands dozens of records and each one redrew the whole screen, so a button
// pressed a moment earlier no longer existed by the time the press became a click. Marking an
// episode on Up next was impossible for as long as the loading ran.
import test from "node:test";
import assert from "node:assert/strict";
import { makePaintQueue } from "../public/js/ui/paint-queue.js";

// A timer we drive by hand, so the tests are about the rules rather than about waiting.
const fake = () => {
  const due = [];
  const timer = (fn) => due.push(fn);
  return { timer, tick: () => due.splice(0).forEach((fn) => fn()) };
};

test("nothing is drawn until the wait is up", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  q.soon();
  assert.equal(painted, 0);
  tick();
  assert.equal(painted, 1);
});

/* Forty records landing in a burst is one screen worth drawing, not forty. */
test("a burst of records is one redraw", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  for (let i = 0; i < 40; i++) q.soon();
  tick();
  assert.equal(painted, 1);
});

/* The one that matters: whatever is under a finger has to still be there when it lifts. */
test("nothing is drawn while a pointer is down", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  q.press();
  q.soon();
  tick();
  assert.equal(painted, 0, "the button somebody is pressing must not be replaced");
});

test("the redraw arrives the moment they let go", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  q.press();
  q.soon();
  tick();
  q.release();
  assert.equal(painted, 1);
});

/* A press that is cancelled — a drag off the window, a gesture the browser takes over — still
   ends the hold, or the screen would stay frozen until the next press. */
test("a cancelled press still releases the hold", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  q.press();
  q.soon();
  tick();
  q.release();                       // pointercancel is wired to the same call
  assert.equal(painted, 1);
});

test("letting go with nothing waiting draws nothing", () => {
  let painted = 0;
  const { timer } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  q.press();
  q.release();
  assert.equal(painted, 0);
});

test("a redraw held through a press is still only one redraw", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  q.press();
  for (let i = 0; i < 12; i++) { q.soon(); tick(); }
  q.release();
  assert.equal(painted, 1);
});

test("it goes back to normal after a press", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer });
  q.press(); q.soon(); tick(); q.release();
  assert.equal(painted, 1);
  q.soon(); tick();
  assert.equal(painted, 2);
});

/* Typing is the other way somebody is in the middle of something. The search box does put focus
   and the caret back after a redraw, which is why one redraw was survivable — but a hydrate
   redraws every tenth of a second, so the field was destroyed and restored over and over, and
   keystrokes typed in the gap went nowhere. */
test("nothing is drawn while somebody is typing", () => {
  let painted = 0;
  let caret = true;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer, busy: () => caret });
  q.soon();
  tick();
  assert.equal(painted, 0);
});

test("the redraw arrives when the caret leaves", () => {
  let painted = 0;
  let caret = true;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer, busy: () => caret });
  q.soon();
  tick();
  caret = false;
  q.resume();                        // what focusout calls
  assert.equal(painted, 1);
});

test("a whole burst of records typed through is still one redraw", () => {
  let painted = 0;
  let caret = true;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer, busy: () => caret });
  for (let i = 0; i < 30; i++) { q.soon(); tick(); }
  caret = false;
  q.resume();
  assert.equal(painted, 1);
});

test("leaving a field with nothing owed draws nothing", () => {
  let painted = 0;
  const { timer } = fake();
  const q = makePaintQueue(() => painted++, { timer, busy: () => false });
  q.resume();
  assert.equal(painted, 0);
});

/* Both holds are real and independent: letting go of a button while still typing must not let
   the screen rebuild under the caret. */
test("a press ending does not override a caret still in a field", () => {
  let painted = 0;
  const { timer, tick } = fake();
  const q = makePaintQueue(() => painted++, { timer, busy: () => true });
  q.press();
  q.soon();
  tick();
  q.release();
  assert.equal(painted, 0);
});
