# Decisions

Why this app is shaped the way it is.

Everything here was learned by building it, and most of it was learned by getting it wrong
first. It is written down because the reasoning is the expensive part: the code can be read
from the code, but "we tried the obvious thing and here is what broke" cannot.

Ordered roughly by how deep it sits, not by when it happened.

---

## Data and identity

### The vault is one opaque blob, and identity is denormalized into it

The server stores one row per account: a hash and a ciphertext. That forces every
relationship into the blob, which is the opposite of how you would model this in a database
— and it is the point. A raw export has to stay legible and re-resolvable without any
catalogue, so a show carries its own name, year, IMDb id and TheTVDB id rather than a
foreign key into something that might not exist in five years.

### Show keys are provider-scoped, and portable ids sit beside them

A show's key is `tvmaze:169` or `tmdb:1396`, never a bare number. TVmaze and TMDB number
some shows differently, and a mark recorded against one numbering cannot be trusted against
the other, so the numbering is part of the identity.

The consequence is that one series can arrive under two keys. `findSameShow` matches on the
portable ids as well — IMDb first, then TVDB, nulls never matching — and that check lives in
the data layer so it is enforced wherever a show is added rather than re-checked by each
caller.

A vault can still hold two records for one series, from before that check or from a device
that has not run it. Loading folds them together, and keeps folding while any device still
syncs an unfolded copy back. Nothing is discarded: both catalogues' ids are kept, marks are
unioned at the higher pass and newer mtime, and the copy holding more history keeps the
identity, because its numbering is what most of the history was recorded against.

When a match is discovered it is written to the record as an alias. Otherwise the same
question gets asked, and the same request paid for, on every reload — and a link shared into
the app carries no portable id of its own.

### A show can outlive the catalogue that numbered it

A show numbered by TMDB, with the key then deleted, used to be unfetchable: cached data
carried it until the cache was cleared, and a cold device showed nothing at all. That is the
exact failure this app exists to not have.

Metadata now comes from the show's own catalogue where possible and another where not — by
learned alias first, then by IMDb id — and what comes back is filed under the key that was
asked for so the marks still line up. Where two catalogues disagree on numbering, some marks
will sit on the wrong episode. Worth saying plainly, and still better than a show that shows
nothing.

### `m` is when the box was ticked; `w` is when it was watched

A library typed in by hand arrives with every mark stamped today. True about the record,
useless about the watching.

`m` stays exactly what it was, because sync resolves conflicts with it — a backdated mtime
would make this device's copy look older than every other device's, and older than a deletion
tombstone. `w` is optional, is what the statistics read, and is absent on marks made while
watching, where the two are the same thing. Correcting a date moves `m` forward: the edit is
the newest thing about the record even when the date it sets is two years old.

Dates land at 20:00 local. An episode watched on the fourth was watched during the fourth,
and midnight puts half a library into the small hours of the fifth.

### Rewatches are levels, not a counter

`show.rw` is the pass in progress; `entry.n` is the pass an episode was last watched in.
Marking assigns `n = rw` rather than incrementing, which is what makes it idempotent — two
devices marking the same episode of the same pass agree instead of racing to 3. Both fields
are omitted at 1, so a library nobody has rewatched costs nothing.

---

## Sync

### Merge must be symmetric, or two devices never converge

A mark whose mtime *ties* with the other side's cannot be resolved by whichever arrived
first. Every device merges its own copy first, so "first" means "mine" on both machines: each
keeps its own version and neither ever catches up. Nothing reports it — the sync succeeds,
and the two libraries simply stay different.

So ties are broken deterministically: higher level, earlier watch date, and for anything else
the lexicographically smaller JSON. Arbitrary, but *the same arbitrary answer on both
machines*, which is what makes `merge(a, b)` and `merge(b, a)` agree.

The tie is not exotic. Dating a library "as it aired" stamps every mark in the same
millisecond.

### A reader must carry fields it does not understand

Rebuilding a mark from the fields the reading build knows about turns an old device into a
data-destroying one: it loads a newer device's mark, silently drops the field it has never
heard of, and pushes the stripped copy back as the newest version.

So unknown fields are carried through untouched. A few unread bytes cost less than the data
they would otherwise erase, and any schema that syncs between versions of itself needs this
rule.

### Writes carry the `updated_at` they last saw

Optimistic concurrency, not locking. A stale write is refused with 409 and the current blob,
and the client merges and retries. Two devices editing at once converge instead of
overwriting.

### Foregrounding must not repaint when nothing changed

Returning to the app merged the server's copy and repainted unconditionally — and a repaint
takes the horizontal rows down to placeholders and refills them. That flinch was the data
never changing, only the DOM holding it.

The merge now reports whether it actually brought anything, by fingerprinting the library
before and after: counts of shows and marks, newest mtime, settings. Cheap, where comparing
the states themselves would mean megabytes of JSON on every return.

---

## Catalogues

### TVmaze is the default because it needs no key

A feature only key-holders can see is a feature most people do not have. Everything essential
works on the keyless catalogue; TMDB adds trending, recommendations, biographies and trailers
when someone supplies their own key.

### TVmaze has no trending endpoint, but every show carries a weight

Ranking what is actually airing by that weight gives real discovery with no key at all. A
fortnight of dated schedule days costs about 36 KB gzipped each, which is why it fetches days
rather than the 9.8 MB `/schedule/full`.

### TVmaze search matches whole words

Its fuzziness is one character for a word over one, two for a word over five — generous for a
typo, fatal for a fragment. `breaking bad` finds the show; `breaking ba` finds nothing; `game
of thr` finds *The Name of the Game*. Every keystroke of a two-word title passes through that
state and `q` is the only parameter the endpoint takes.

So a query whose last word is a stub is not sent while there is already an answer on screen,
and one sent anyway is retried without the stub when it comes back empty. A single word is
never a stub, however short — TVmaze matches those on their own. TMDB is untouched; it
handles fragments perfectly well, and the provider simply does not export the predicate.

### Cached records carry the shape they were written with

Adding a field to a normalizer does not make existing records stale — they are fresh by every
measure the cache has, and an ended show is only refetched after 30 days. So a page built to
show a new field would show nothing for a month wherever a record was already cached.

Records now carry a `SHAPE` number and anything below the current one is stale on sight.
Adding a field means raising it.

### TMDB's `append_to_response` has a 20-item ceiling

Which is why the season budget in that call is 18 and not 20: `videos` and `aggregate_credits`
take the other two. For a series, `credits` answers with one season's billing, while
`aggregate_credits` collects a person's roles across the whole run and counts their episodes —
same single request.

### Cast and people are never stored

A person is a cache key and nothing more. There is no identity to reconcile across
catalogues, no schema, no merge, no sync. Switching catalogue leaves a cold cache rather than
a wrong record. This is the whole reason cast was an afternoon and not a week.

It follows that the catalogue *in use* answers for cast, not the one the show is numbered by —
nothing is stored, so the numbering is beside the point, and what matters is which profile the
link goes to.

---

## Interface

### The barcode is the signature, and it is the same idiom everywhere

One tick per episode, grouped by season. It makes a show's whole history legible at a glance —
where you stopped, what you skipped, how much is left — in the space a progress bar uses to
say a single number.

The same idiom is reused deliberately: as the dividing rule on the landing page, as the strip
of days on the statistics page, and as the punch card. When the statistics page had a
circular dial it was the one thing on the app drawn in a different language, and it went.

### Past a certain length there is no shape left to draw

Tagesschau is 21,349 episodes across 75 seasons. Drawn honestly that is a solid smear, or 75
identical blocks stacked eleven rows deep on a library card — measured at 164px tall against
12px for every other card, which wrecks the grid.

A second rendering was built for it — one bar per season, filled to the share watched — and it
worked, and it was deleted. It was a whole extra mode to carry for a case almost nobody meets.
Above the limit the strip is simply omitted and the counts beside it carry the answer. Two
limits, because the two strips have different room: 320 episodes for a card, 900 for the show
page.

### A season whose episodes are all in one state collapses to a block

On the small strips only. Most of a watched show's bars carry no information: six watched
seasons are six identical runs of amber. Mixed seasons keep their ticks, because a season
you are partway through has a shape worth drawing.

The season holding next-up never collapses, whatever state it is in. It is the one being
worked through, and its single cyan tick is what the strip exists to show.

### Long shows build their rows on being opened

Every season's episodes used to be constructed and then hidden with CSS. Fine at sixty
episodes, ruinous at twenty thousand: around 190,000 elements built synchronously before
anything appeared. Seasons build on opening, long seasons arrive 80 rows at a time, and the
measured result is 1,908 elements where the arithmetic said 190,000.

### Nothing is written until Track is pressed

Deciding whether you want something comes before adding it. Search results and discovery
cards open a read-only view of the whole show — including its cast, because who is in it is
part of that decision.

### The card you tapped becomes the page you land on

A search result already holds the poster, name, year and summary. Opening it used to throw
all of that away and draw an empty page while the same picture was fetched again. Card lists
register what they drew as a hint, and the show page draws its hero from that until the full
record replaces it. A hint carries no episodes, so nothing that counts progress can read one
by mistake, and it lives in memory only.

### Waiting states are the real page with holes in it

Not two grey lines. Everything the vault knows is filled in immediately — name, pass, watched
count, status, links, the untrack button — and only what the catalogue owns is a placeholder,
sized to what will replace it. The arrival fills holes instead of rebuilding the screen.

Only the render that lands on a page that *was* waiting fades in. Every later one — a mark, a
status change — is instant, or the app feels behind the tap that caused it.

---

## Navigation

### The same screen visited twice is two places

A trail can hold show → actor → the same show → the same actor. Those are different places,
not one place seen twice.

Scroll positions were keyed by history entry for that reason. What a screen had *open* was
not: which seasons, how many pages of episodes, whether a biography was expanded were keyed
by show, so collapsing a season on the second copy shortened the first, and coming back to it
landed at the wrong height. **The height a screen stands at is a function of what it has
open**, so both must be keyed the same way.

This is the shape Android's `NavBackStackEntry` and React Navigation's `route.key` have, for
the same reason. Nobody keys it by route.

### A visit is forgotten the moment the history stops holding it

Nothing announces that a history entry has been thrown away — but the moment is knowable
exactly: **a push destroys every entry ahead of the one it is pushed from.** So on push, every
visit at that depth or deeper is unreachable and its scroll position and open seasons go with
it, including visits from a branch abandoned earlier that happen to sit at the same depths.

On push, and not on going back: going back leaves the entry ahead intact and forward still
reaches it. A 400-visit cap remains as a backstop, but it is no longer the mechanism.

### Tabs replace, screens push

Every tap on the bottom navigation used to push an entry, so four taps meant four presses of
back to get out. Tabs are places you switch between; a show, an actor, a season and an
episode are places you go into — the ones with a back arrow, which are what a stack is for.

### Back goes back one screen, not to where the trail started

The show page used to decide its own destination: library if tracked, search if not. So
search → show → actor → show sent that last step three screens over. It goes through history
now, and the old guess survives only as the fallback for a page opened cold from a link.

### A screen that names something keeps the name in the fragment

`/show/tmdb:67070` is a path, and a path is sent to the server on every navigation that
reaches the network: a refresh, a cold start, a restored tab, a link someone opened. So the
address bar was quietly telling whoever runs the server which programme an IP address was
watching — the exact fact the rest of the app goes to considerable lengths not to hold, in
the one place nobody thought to look.

The fragment is the only part of a URL a browser never transmits: not to the origin, not to a
proxy, not to the CDN in front of it. So `/show#tmdb:67070`, and the server sees `/show`.

Only the four screens that name something: show, person, season, episode. The tab routes name
no content and keep ordinary paths, because they cost nothing.

Worth being clear about what this is and is not. Nothing was ever logged — the Worker has no
`console` call in it. But "nothing logs it" is a promise, and it is one dashboard toggle from
being false. The fragment means there is nothing to promise about, which is the standard the
rest of the app is held to.

The old form was kept working for a day and then removed, once it was clear nobody was relying
on it. That matters more than the compatibility would have: while the Worker still matched
`/show/` as a prefix, there was a shape of address that named a show to the server, and "we
rewrite it on boot" is a mitigation rather than an absence. Now the route table is exact paths
only and the client does not read the path at all, so no URL anyone could construct — by hand,
by accident, or on purpose — carries a subject to the server. It is a property of the shapes
rather than of the code remembering to be careful.

### A share is a navigation, so the service worker is where it stops

The Web Share Target API has no delivery primitive. There is no `onshare` event and no message
channel: the manifest names a URL, and picking the app from the system share sheet *navigates*
it there with the payload attached. Android dispatches a share to an activity; for a PWA the
browser is the activity, and the only address it has for the app is a URL. The URL is the IPC.

That part cannot be changed. What can is whether the navigation reaches the network — and it
is a `fetch`, so the service worker sees it first and can answer it locally. For `POST` share
targets that is not even a trick: the worker is the only thing that can read `formData()`, so
intercepting is how they work at all.

Without a case for `/share`, a worker falls into its generic network-first navigation branch
and hands the request straight to `fetch` — which posts whatever was shared, usually a URL
naming the show, to the server.

Now: `POST` with `multipart/form-data` so the payload is a body rather than a query string,
the worker catches it, stashes it in a cache the page reads once, and redirects to a clean
`/share` that is itself served from cache. Nothing leaves the device.

Ordering matters here and I got it backwards at first. `POST` alone is the smaller half — it
keeps the payload out of URLs, which is what gets logged, but the bytes still reach the edge
where TLS terminates. The interception is the fix; `POST` is hardening on top of it.

Where the worker isn't controlling, the Worker answers `303` **without reading the body**. Not
reading it un-sends nothing, but it means no code on the server is able to look at what
somebody shared, which is a stronger claim than a promise not to.

### A sheet is not a place

Giving a sheet a history entry taught Android's back gesture to close it — and taught the edge
swipe to drag it sideways like a page, because from the browser's side that is what it had
become. `CloseWatcher` exists for exactly this: it answers a close request before it reaches
the history stack. The history entry stays as the fallback where there is no `CloseWatcher`.

---

## Platform

### Installed apps and tabs are different products

A long press offering to download, selectable text under a drag, pinch zoom, double-tap zoom:
these are how the web works in a tab, and an app that takes them away there reads as one with
something to hide. Installed, they give a PWA away. So they are dropped only when
`display-mode: standalone`.

Pinch zoom needs two mechanisms because no single one covers the platforms: `touch-action`
names the two pan axes, and handlers cover Safari's gesture events, a second finger arriving
mid-scroll, and a trackpad pinch arriving as a ctrl-wheel. None passive — a listener that
cannot `preventDefault` cannot stop anything.

Worth saying plainly: removing pinch zoom removes a real accessibility affordance. What is
left is the platform's own display and font scaling.

### Let each platform round its own icon corners

Every platform rounds an icon itself. Baking a radius in means it happens twice — on iOS that
reads as clipping, on Windows as a rounded square inside another with gaps at the corners.
Every icon is full bleed and square; only the mark's own bars are rounded.

Android crops adaptive icons to a circle of 80% diameter, so the maskable variant draws the
mark at 46% of the canvas, putting the farthest bar corner at 29.7%.

### iOS zooms any input under 16px and never zooms back

Which is why every input and select in this app is 16px. It is a threshold, not a taste.

### A stale service worker cache name is how a deploy fails to reach anyone

`scripts/sync-version.mjs` ties the cache name to `package.json`, so bumping the version is
the whole release ritual. It also generates the precache module list from disk, because a
list kept by hand falls behind silently and a missing module is a blank screen offline rather
than a missing feature; and it generates the CSP's inline-script hashes, for the same reason — a hash written by hand
stops matching the moment someone edits the script, and the symptom is a page that boots
wrong in production and nowhere else.

### The account number is a password, so tell password managers that

The field originally carried `autocomplete="off"`, which is an instruction to stay away — so
the one credential this app has was the one thing a manager would not store. It is a real
form with a submit button, `type="password"`, the right autocomplete tokens, and a hidden
username field, because most managers will not store a lone password.

It also needs a show/hide control, because 28 characters have to be checked by eye when
copying them.

---

## Method

Some habits that earned their place.

**Measure before believing.** An early attempt blamed a layout overflow on a headless render
that was silently 500px wide, because macOS enforces a minimum window width. Anything narrow
gets simulated rather than rendered.

**Prove the fix can fail.** New tests get the mutation treatment: break the code on purpose,
confirm the right test fails, put it back. A test that passes against a broken implementation
is worse than no test.

**Pure logic lives in `domain/` and is tested; views are not tested.** The rule is not
aesthetic. Anything that *decides* something — which badge, how long is too long, what a tick
means, which visits are reachable — can be checked directly, and things that could only be
checked by driving a browser never were.

**Say which kind of nothing happened.** Four silent outcomes sharing one message meant "as
they aired", run twice, reported that the catalogue had no air dates when it had just used
them. Distinct outcomes get distinct messages.

**Never truncate silently.** If a horizon hid something, say how many.
