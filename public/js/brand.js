// The name, in one place.
//
// It was scattered across fifteen files until the sibling app needed renaming and this one had
// to be told apart from it. A product name spread through the source is how an app ends up
// half-renamed, saying two different things about itself on two screens.
//
// "nextly.tv" rather than "Nextly TV": the .tv is not decoration, it is the second half of the
// word. The app next door is nextly.page — the same question, what is next, asked of an episode
// here and of a page there — and writing both as domains keeps the meaning that a title-case
// product name would throw away. It also matches the lowercase mark this app has always used.
//
// What deliberately does NOT live here, and must never be changed:
//
//   io/crypto.js   "nextly|id|v1|" and "nextly|key|v1|"
//
// Those are what an account number turns into — the row key and the encryption key. They are
// not the product's name; they are the shape of a promise made to everyone who already has a
// vault. Renaming the product must never lock somebody out of their own watch history.
//
// Nor these, for smaller reasons:
//
//   io/cache.js    DB_NAME, which would orphan the episode cache
//   ui/gate.js     VAULT_USER, which is a password manager's key for a saved credential
//   the export and account-number filenames, which are read by the importer and by people
//
export const APP_NAME = "nextly.tv";

// Used in an export file and nowhere a person reads. Stable across a rename for the same reason
// the crypto namespace is: a file exported today has to import tomorrow.
export const APP_ID = "nextly";
