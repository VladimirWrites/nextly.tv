# Contributing

Thanks for looking. This is a small personal project, so the process is short.

## Running it

```bash
npm install
```

```bash
npm run dev
```

That serves the app at `http://localhost:8787/app` and the landing page at `/site`. The
service worker deliberately stays out of the way on localhost, so edits show up on one reload
instead of two.

You do not need a TMDB key. TVmaze is the default catalogue and needs no credentials; the
TMDB paths are optional and are entered in Settings by whoever runs the app.

## Tests

```bash
npm test
```

Everything must pass before a pull request. There is no linter and no formatter — match the
style of the file you are in.

## The one structural rule

**Logic that decides something lives in `public/js/domain/` and has tests. Views draw; they
do not decide.**

This is the shape of the whole codebase and the thing most worth preserving. `domain/` is
pure: no DOM, no network, no clock it did not receive as an argument. That is what lets it be
tested with `node --test` and no browser.

If you find yourself writing a rule inside a view — how long is too long to draw, which badge
a card wears, what counts as watchable — move it down a layer and test it there. Several of
those had been sitting in view files for months precisely because nobody could check them.

The layers, briefly:

| Directory | May depend on | Tested |
| --- | --- | --- |
| `public/js/domain/` | nothing | yes, heavily |
| `public/js/io/` | `domain/` | partly |
| `public/js/ui/` | `domain/`, `io/` | only the pure parts |
| `src/` (the Worker) | `public/lib/` | yes |

## Comments

The comments in this codebase explain *why*, not what. If a line needs a comment saying what
it does, the line is usually the problem. If a decision would look arbitrary to someone
reading it cold — a magic number, an ordering, a workaround for a platform — that is worth a
sentence, and worth the reader's time.

[docs/DECISIONS.md](docs/DECISIONS.md) holds the larger ones.

## Pull requests

- One change per pull request.
- Say what broke, or what it improves. A commit message here is expected to be readable prose
  rather than a label; look at `git log` for the register.
- If it changes behaviour anyone would notice, say how you checked.

## What is unlikely to be merged

- A build step, a bundler, or a framework. No-bundler native ES modules is a deliberate
  constraint and the app is small enough for it to keep paying.
- A dependency, unless it does something genuinely hard. The runtime currently has zero.
- Anything that sends data anywhere. The app talks to its own vault and to the catalogues,
  and that list is the product.
- Analytics, of any kind, for any reason.

## Security

Do not open a public issue for anything that would let someone read another person's vault.
See [SECURITY.md](SECURITY.md).
