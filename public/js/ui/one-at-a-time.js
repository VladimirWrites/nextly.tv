// Work that must not overlap with itself.
//
// hydrateLibrary is called from five places: boot, the sync that follows it, the listener for
// remote data landing, coming back to the tab, and the Trakt import. Nothing stopped them
// overlapping, so a single app open commonly ran two or three at once — each with its own pool of
// four requests, so twelve went out where four were intended. That is enough to be refused by the
// catalogue, which backs everything off, which is why it took as long as it did: the burst caused
// the slowness it then suffered from.
//
// It also broke the progress bar. There is one bar with one done/total, and whichever run
// finished first reported "done" and switched it off while the others were still fetching, so it
// vanished mid-load.

/* Runs one at a time, and does not lose a request that arrives while it is busy.
 *
 * A call during a run is not dropped, because the reason for it is usually new shows arriving
 * from a sync and those do need fetching. It is not stacked either: however many arrive, exactly
 * one more pass follows. Anything that turns up during *that* pass is somebody's library changing
 * faster than it can be fetched, and the next open will catch it. */
export function oneAtATime(work) {
  let running = false;
  let again = false;

  return async function run(...args) {
    if (running) {
      again = true;
      return undefined;
    }
    running = true;
    try {
      await work(...args);
      if (again) {
        again = false;
        await work(...args);
      }
    } finally {
      running = false;
      again = false;
    }
    return undefined;
  };
}
