// The single in-memory app state. A live ES-module binding: readers `import { state }`
// and see both mutations and whole-document replacements (via setState, used by sign-in,
// import, and the merge result).
import { emptyState } from "./schema.js";

export let state = emptyState();

// Replace the whole state document.
export function setState(s) {
  state = s;
}
