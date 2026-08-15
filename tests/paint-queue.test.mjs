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
