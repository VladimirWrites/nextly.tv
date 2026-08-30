// Two rules about refreshing the library in the background.
//
// Both exist because opening the app had become a wait: five callers each started their own
// hydrate, and every show the catalogue had touched was refetched in full whether or not anything
// on screen was waiting for it.
import test from "node:test";
import assert from "node:assert/strict";
import { oneAtATime } from "../public/js/ui/one-at-a-time.js";
import { upNextNeeds } from "../public/js/domain/progress.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- one at a time ----

test("two callers do not both run it", async () => {
  let runs = 0;
  const run = oneAtATime(async () => { runs++; await tick(); });
  await Promise.all([run(), run()]);
  assert.equal(runs, 2, "the second call is honoured, but after the first rather than beside it");
});

/* A call arriving mid-run is not dropped: the usual reason for one is new shows arriving from a
   sync, and those do need fetching. */
test("a request that arrives mid-run is honoured afterwards", async () => {
  const order = [];
  let inFlight = 0;
  const run = oneAtATime(async () => {
    inFlight++;
    assert.equal(inFlight, 1, "never two at once");
    order.push("start");
    await tick();
    order.push("end");
    inFlight--;
  });
  const first = run();
  run();                                  // arrives while the first is still going, not after it
  await first;
  assert.deepEqual(order, ["start", "end", "start", "end"]);
});

/* However many arrive during a run, exactly one more pass follows. Five callers must not mean
   five passes. */
test("a crowd of callers costs one extra pass, not one each", async () => {
  let runs = 0;
  const run = oneAtATime(async () => { runs++; await tick(); });
  const first = run();
  for (let i = 0; i < 20; i++) run();
  await first;
  assert.equal(runs, 2);
});

test("a run that throws still lets the next one start", async () => {
  let runs = 0;
  const run = oneAtATime(async () => { runs++; throw new Error("catalogue down"); });
  await assert.rejects(run());
  await assert.rejects(run());
  assert.equal(runs, 2, "the guard is released even when the work fails");
});

// ---- what a background refresh is for ----

test("Up next waits on shows being watched", () => {
  assert.equal(upNextNeeds({ st: "active" }), true);
});

test("and on nothing else", () => {
  for (const st of ["planned", "paused", "dropped", "finished"]) {
    assert.equal(upNextNeeds({ st }), false, `${st} is not on Up next`);
  }
});

/* A movie has no next episode, so Up next never draws one however it is shelved. */
test("a movie is never what Up next is waiting for", () => {
  assert.equal(upNextNeeds({ st: "active", kind: "movie" }), false);
});

test("nothing is not waited on", () => {
  assert.equal(upNextNeeds(null), false);
  assert.equal(upNextNeeds(undefined), false);
});
