// Redrawing behind somebody's back, without taking the screen out from under them.
//
// A record landing from the catalogue redraws the screen, and a hydrate lands dozens of them.
// Every redraw replaces the whole tree, so a button pressed a moment ago is gone by the time the
// press becomes a click — and the click dies with the node it was aimed at. Marking an episode on
// Up next was impossible for as long as the loading ran, not because anything refused it but
// because the target kept being taken away.
//
// Kept apart from the actions that use it so the rules can be tested without a browser: what is
// worth being sure about here is when a redraw happens, not what it draws.

/* Two rules, and they are both about somebody else's hands.
 *
 * Coalesced: forty records landing in a burst is one screen worth drawing, not forty.
 *
 * And never while a finger or a mouse button is down. Whatever is under it is the thing somebody
 * is in the middle of using, and it has to still be there when they let go. The redraw happens on
 * release, a moment later and nobody's loss.
 *
 * Anything somebody just did is not routed through here: that redraw is the answer to their own
 * action and has to be immediate. */
export function makePaintQueue(paint, { wait = 120, timer = setTimeout } = {}) {
  let queued = false;
  let holding = false;

  const flush = () => {
    if (holding || !queued) return;
    queued = false;
    paint();
  };

  return {
    // A redraw the reader did not ask for, and will not miss by a tenth of a second.
    soon() {
      if (queued) return;
      queued = true;
      timer(flush, wait);
    },

    // A pointer went down: hold everything until it comes back up.
    press() {
      holding = true;
    },

    /* Up again, or cancelled — a cancelled press still ends the hold, or a drag that leaves the
       window would freeze the screen until the next one. */
    release() {
      holding = false;
      flush();
    },

    pending: () => queued,
    holding: () => holding,
  };
}
