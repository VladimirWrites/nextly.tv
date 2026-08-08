# Movies

A plan, not a decision. Written 5 August 2026, against measurements taken the same day.

## The one fact that shapes everything

**TVmaze has no movies.** `/search/movies` returns 404; it is a television database and says so in
its name. TMDB has them in full.

TVmaze is the default provider and the only one that needs no key. So:

> Movies work only for somebody who has entered a TMDB key.

That is not a detail to handle later — it decides what the switch in **You** can even be. A plain
"Enable movies" toggle promises something the app cannot deliver to most of its users, who are on
TVmaze because it needs nothing of them.

**What the row should do instead:** show the toggle always, and when there is no TMDB key, disable
it with the reason underneath — "Needs a TMDB key, which is above" — linking to the row that sets
one. Turning the toggle on with a key present is then a promise the app keeps. Silently doing
nothing, or offering movies that never load, is the version to avoid.

A second consequence: if somebody removes their TMDB key later, movies in the library stop
resolving. Same as any TMDB-numbered show today, and handled the same way — the record keeps its
name and year from the vault, and the page says the catalogue cannot be reached.

## The data model

A movie is a show with one episode, and pretending otherwise costs more than it saves.

Look at what a movie record actually needs: a name, a year, portable ids, whether it has been
seen, when, and how many times. That is the show record, exactly, minus seasons:

```js
{ id: "tmdb:m76600", src: "tmdb", ref: 76600, kind: "movie",
  name: "Avatar: The Way of Water", year: 2022, imdb: "tt1630029",
  st: "planned", added, m, entries: [] }
```

**One collection, not two.** `state.shows` keeps everything, with `kind: "movie"` on the ones that
are. The reason is not tidiness — it is that every hard thing in this app is already written once
against that array and would have to be written a second time against a parallel one: the merge
that reconciles two devices, the dedupe that folds the same title found in two catalogues, the
export, the import, the vault schema, the sync. A `movies: []` array beside `shows: []` doubles
all of it, and the second copy is the one that gets the bug.

**Marks.** A movie has one thing to mark, so `entries` holds at most one, keyed `"m"` rather than
a fake `"1x1"`:

```js
entries: [{ id: "m", w: 1721580000000, n: 2 }]     // seen twice, last in July 2026
```

`epKey` is `${s}x${e}` and never produces `"m"`, so the two cannot collide. Rewatches come free:
`n` is already the pass level, and "watched twice" is what a movie rewatch is. Trakt's export
gives `plays` per movie, which maps straight onto it.

**Status.** `active` is meaningless for a film — there is no "in progress". The honest set is
`planned` and nothing else: a movie is watched (has a mark) or not. Keep `st` for the watchlist,
ignore it otherwise, and do not invent a fourth status.

**The key prefix.** `tmdb:m76600` rather than `tmdb:76600`, because TMDB numbers films and series
separately and `76600` means a different thing in each. `parseShowKey` needs one line for it.

## What comes free, and what does not

**Free**, because it is written against the record and not against episodes:

- the vault, sync, and merge
- export and import of nextly's own JSON
- dedupe across catalogues on the portable ids
- the Trakt import — that export already carries `watched-movies-*.json` and 593 movie plays sat
  in the history of the one measured, ignored by a single `type === "episode"` check

**Not free**, because it is written against episodes:

- **Up next.** A film has no next episode. It should not appear there at all — the screen answers
  "what do I watch next in something I have started", and a film is never partly watched. Planned
  films belong in the Library, not on the front page.
- **The barcode.** One tick is not a barcode. A movie row wants a different treatment: watched or
  not, and a rewatch count if it is more than one.
- **Progress and season pages.** Do not apply; a movie page is a poster, a year, a runtime, a
  synopsis, a cast, and one button.
- **Stats.** Hours watched should include films, and that is the strongest argument for having
  them at all — a year's viewing that omits every film is not a year's viewing.

## Staging

Each stage is worth shipping on its own, which is the test of whether the staging is honest.

**1 — the model and one screen.** `kind`, the `m` mark, the key prefix, TMDB movie fetch and
search, a movie page, and the Library showing films alongside shows behind the toggle. No Up next,
no stats. This is the stage that proves the model; if `kind` is wrong, it is wrong here and cheap.

**2 — import.** Drop the `type === "episode"` filter and read `watched-movies-*.json`. Given
stage 1, this is small, and it is the stage that fills a library with 593 films rather than
leaving somebody to add them by hand.

**3 — the rest of the app.** Stats including runtime, search across both, discovery, watchlist.

## What I would not do

- **Ship it on by default.** Most users are on TVmaze and would get a switch that does nothing.
- **Put films on Up next.** The one screen the app is named after should keep meaning one thing.
- **Give movies their own tab.** The Library already filters; a film is a thing you have or have
  not seen, the same as a show, and a fifth tab for a subset of the same list is a heavier promise
  than the feature makes good on.
- **Model a movie as a one-episode show without saying so.** `"1x1"` for a film would work and
  would quietly leak into the export, where somebody reading their own JSON finds Avatar has an
  episode one of season one.

## Open questions, worth settling before code

1. **The toggle when there is no key.** Disabled with a reason, as above — or hidden entirely?
   Disabled is more honest and more discoverable; hidden is quieter. My preference is disabled.
2. **Turning it off with films already tracked.** Hide them and keep them, or refuse to turn off
   until they are gone? Hiding is kinder and reversible; it also means the library count stops
   matching what is on screen, which needs a line of copy.
3. **Does a film count in the statistics before stage 3?** If stage 1 ships and the stats page
   ignores films, somebody will report it. Better to say so in the toggle's hint than to be asked.
