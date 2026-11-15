# Editor and presentation redesign

Product-level design, 2026-11-14. Status: proposal, nothing built yet.

## Summary

Keep YAML as the source of truth, add an inspector that follows the cursor, flatten the format, and make the deck the game's script with the scoring view as the only thing the host drives.

Four changes, each useful on its own:

1. A flatter deck format with no ids, no `type:` lines, and settings that cascade from deck to category to question.
2. Paste or drop an image in the editor to upload and attach it. Retires `paste.sh`.
3. An inspector panel beside the YAML that shows the live slide and every effective setting, with where each one came from.
4. A linked game night: the scoring view steps through the deck, settings and answer keys arrive pre-set, and the slides window follows.

## Problems this solves

- **Settings housekeeping mid-game.** Question type, timer, points and type-specific options all get changed by hand in the scoring view today, for nearly every non-standard question.
- **Images are awkward.** Screenshot, start `paste.sh`, pick the right question id, then declare the image on the question. Web URLs mean a lot of copy-pasting around the editor.
- **Defaults are invisible.** It is hard to look at a question and know what will happen, so fields get declared everywhere just in case.
- **Everything is indented a level** because all editing happens under `slides:`.

## What the interview established

| Topic | Answer |
| --- | --- |
| Rhythm per question | Show, timer, score, then reveal the answer, then move on |
| Setup | One laptop, two windows: slides on the projector display, scoring on the laptop screen |
| Settings changed mid-game | All of them: type, timer, points and bonuses, type-specific options |
| Authoring | Typed straight into the editor |
| Editor shape | YAML plus an inspector |
| Who drives when linked | The scoring view; slides follow |
| Wanted from the deck at game time | Answer beside submissions, auto-scoring from the answer key, timer on the slide |
| Not wanted | Real choice text on team phones |
| Mid-game deck edits | Flexible; depends on how much it complicates things |

## What the current code established

- **Linking is greenfield.** The schema has `questionKind`, `timerDuration`, `config` and so on, but nothing reads them. The host page sends the event `uuid` on `createGame` (`frontend/src/features/host/HostLanding.tsx`) and the backend's `CreateGame` only has `game_code` (`backend/src/model/client_message.rs`). Questions are created from game defaults in `next_question`.
- **The image default is documented wrong.** The schema hover says `reveal` defaults to `answer` (`trivia-schema.json`); the renderer defaults to `question` (`presentation/build.ts`).
- **Hand-typed ids collide.** In `full-pres.yaml`, `IDC`, `ENT` and `OVK` are each used by two different questions, which gives them the same question number.
- **The game code is typed into the join slide by hand.**
- **The renderer is already a pure function** (`renderSlides`), so an in-editor preview can reuse it.
- **Hosts already have S3 write access** to `events/*` and `cdn/*` from the browser, so in-editor upload needs no new backend.

## 1. Deck format

```yaml
title: Trivia Night!
subtitle: July 25, 2026
defaults:
  timer: 60
  points: 50
slides:
- join                          # live game code + QR

- category: Date Your 2010s Meme
  subtitle: Full points if exact, half for ±1 year.
  kind: numeric                 # applies until the next category
  within: 1

- q: "'The Dress' was a viral phenomenon in which year?"
  a: 2015
  image: img-7f3a               # shown with the question
  timer: 45                     # one-off override

- q: Which vehicle is the most popular in Massachusetts?
  a: Toyota Rav4
  choices: [Toyota Rav4, Ford F-150, Chevrolet Silverado 1500, Honda CR-V]
  answer-image: img-22c1        # shown with the answer

- q: Rank the following states by total GDP
  choices: [Vermont, Wyoming, Utah, Alabama]
  a:                            # a list answer replaces the choices on reveal
  - Alabama ($341B)
  - Utah ($316B)
  - Wyoming ($80B)
  - Vermont ($46B)

- q: Nie oceniłam pierwszego tomu…
- then: I didn't rate the first volume…   # extra slide, same question
  a: New Moon (Twilight)
```

### Principles

- **No indent.** The slide list sits flush left under `slides:`. This is already valid YAML.
- **A key names the slide type.** An item with `q:` is a question, `category:` a category, `then:` a follow-up slide, and an item with only `image:` (plus optional `title:`) is an image slide. `join` is the built-in join slide. No `type:` or `title:` lines.
- **No ids.** Ids existed for three reasons: naming images for `paste.sh`, grouping multi-slide questions under one number, and keeping shared image names unique across events. Upload removes the first and third; `then:` replaces the second. Numbering is by order.
- **No image default to remember.** `image` shows with the question and `answer-image` with the answer. The key says when, so there is nothing to recall. Either accepts one name or a list.
- **Settings cascade.** Built-in, then `defaults`, then category, then question. The same names work at every level. A category's settings apply to every question until the next category.
- **One answer.** `a:` feeds both the slide and scoring, and accepts numbers. A list answer replaces the choices on reveal, which covers ranking questions without a duplicate slide.
- **Comments stay.** `#` notes are part of how decks get planned, and a text source of truth keeps them.

### Draft mapping from the current format

Field names are a draft; the principles above matter more than the spellings.

| Today | Proposed |
| --- | --- |
| `type: category` + `title:` | `category: <title>` |
| `type: question` + `question:` | `q:` |
| `answer:` | `a:` |
| `id:` | removed |
| second slide with the same `id` | `then:` |
| `images: [{url, reveal: question}]` | `image:` |
| `images: [{url, reveal: answer}]` | `answer-image:` |
| `position: center` / `side` | `layout: hero` / `side` (a cascading setting) |
| `type: image` + `image:` | `image:` with optional `title:` |
| hand-typed join slide | `join` |
| `questionKind` | `kind` (still implied by `choices`) |
| `timerDuration`, `questionPoints`, `bonusIncrement`, `speedBonusEnabled` | `timer`, `points`, `bonus`, `speed-bonus` |
| `config: {...}` | flat keys beside the others, validated against `kind` |

Image names resolve against the event's own folder first, then the shared `cdn/images/`, so no `./` prefix is needed. Shared images remain for globals such as the background.

Existing decks get a one-time converter.

## 2. Editor

```
┌─ deck ───────────────────────────┬─ Question 14 ─────────────────┐
│ - category: Date Your Meme       │ ┌────── slide preview ──────┐ │
│   kind: numeric                  │ │ Q: 'The Dress' was viral  │ │
│   within: 1                      │ │    in which year?  [img]  │ │
│                                  │ └───────────────────────────┘ │
│ - q: "'The Dress' was viral in   │ Type     Numeric   ← category │
│     which year?"  numeric ±1·45s │ Scoring  Within ±1 ← category │
│   a: 2015                        │ Timer    45s       ← this Q   │
│   timer: 45                      │ Points   50        ← deck     │
│   image: img-7f3a                │ Image    [img-7f3a] with Q ▾  │
│ ▌                                │          + paste / drop image │
└──────────────────────────────────┴───────────────────────────────┘
```

### Inspector

- **Follows the cursor.** On a question it shows the real slide, with a toggle between the question and answer states, and every effective setting with its source: this question, the category, the deck, or built-in. On a category it shows what the questions below inherit and how many there are. On the header it shows deck defaults.
- **Every row is editable.** Changing one writes or removes exactly one YAML line and leaves comments and formatting alone. The panel doubles as the reference for field names.
- **Pickers for what is painful in text.** Map location, and the correct choice for multiple choice.

### Images

- **Paste or drop** with the cursor in a question. The browser compresses the image to the same limits `paste.sh` uses (at most 1 MB, longest edge 2560 px), uploads it to the event's folder, updates the manifest, and inserts the `image:` line.
- **Image rows** in the inspector show a thumbnail, with controls for "with question" or "with answer" and for removal.
- **Web URLs** still work as links and are marked external. Copying the image itself rather than its address gets it into the bucket. Importing from a URL needs a server-side fetch because of cross-origin rules, so it is left for later.

### Scanning and validation

- **End-of-line badge.** A dim summary appears only on questions whose effective settings differ from the deck defaults, so exceptions stand out when scrolling.
- **Problems in plain words.** Missing answer, placeholder text left in, image not found, answer not among the choices, numeric question with a non-numeric answer.
- **Save failures block editing** and say what went wrong, instead of a quiet "error" in the header.

Smaller items from `docs/editor.md` that ride along: remove the "editing live data" callout, and give the tab a friendly title.

## 3. Game night

The deck becomes a run sheet: an ordered list of steps, where each question contributes "show" and "reveal". The server stays the source of truth for live state.

- **One key walks the question.** The scoring view's primary button always names the next step: `Show Q14`, `Start timer`, `Reveal answer`, `Next: Q15`. The slides window follows and never needs focus.
- **Opening a question applies its settings.** Type, timer, points, type options and the answer key arrive pre-set. Deck values are starting points: anything changed live still wins and is never reverted.
- **Question and expected answer** appear above the submissions in the scoring view.
- **Auto-scoring.** Multiple choice, numeric, map and multi-answer score from the key. Standard questions pre-mark exact matches, ignoring case and punctuation, and leave the rest to the host. The host can always override.
- **Reveal** warns if answers are still unscored, since scoring comes first, and closes submissions.
- **The slide shows** the countdown and how many teams have answered.
- **Category, image and join slides do not advance the game question**, so scoring Q14 can continue while the next category title is up.
- **Going back** steps back through slides, and moves the game to the previous question when it crosses into that question's slides.
- **Mid-game edits.** The deck is read at game start, and a "Reload deck" button in the scoring view re-reads it. Questions not yet opened pick up changes; opened ones keep their live state and only refresh their text. Inserting or removing questions before the current one is not supported, because numbering is positional.
- **Team phones are unchanged.**
- **`/present/:uuid` without a game** still works with arrow keys, for rehearsal.

### Games without a deck

Selecting an event stays opt-in, and a game created without one behaves exactly as it does today: the same scoring view controls, questions created from game defaults, no primary step button, no run sheet. Everything in this section is additive and only switches on when a deck is attached.

The existing Playwright suite is the regression check for this. All 13 specs in `frontend/tests/` create games with no event selected and none touch the editor or `/present`, so they exercise exactly the no-deck path. Confirm the suite is green before starting slice 4, then keep it green unchanged through slices 4 and 5. The backend tests and the `Game` property tests cover the same path on the server.

The suite says nothing about the linked path. Slices 4 and 5 need new specs for it: settings and answer keys applied when a question opens, live edits winning over deck values, slides following the scoring view, and "Reload deck".

## 4. Build order

1. New format, converter, renderer and schema. Generate the schema's descriptions from the same defaults the renderer uses so they cannot drift again.
2. Paste and drop image upload.
3. Inspector.
4. Deck-driven settings, answer beside submissions, answer keys.
5. Scoring view as remote: slides follow, timer on slide, join slide.

Slices 3 and 4 can swap if game-night housekeeping hurts more than editor legibility.

## Open decisions

- **When teams see auto-scored points.** Proposed: hold them until submissions close. Publishing as answers arrive leaks correctness through the scoreboard while the timer is running.
- **`q` / `a` or `question` / `answer`.** Proposed: the short keys. They are typed about 60 times a deck and match the slide's "Q:" and "A:".
- **Uploaded image names.** Proposed: opaque auto names such as `img-7f3a`, with thumbnails in the gutter and inspector. Prompting for a name on each paste would read better but is slower.
- **Timer auto-start.** Assumed: showing a question does not start the timer, so it can be read aloud first.

## Later

- A `scoreboard` slide that shows live standings on the projector.
- Importing a web URL into the bucket.
- A phone upload page for photos taken away from the laptop.
