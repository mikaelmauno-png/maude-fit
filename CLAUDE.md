# Project: workout logger

A personal workout logging web app. Single user, used on a phone in a gym.
A training autoregulation engine will be added later — the data model must not
block it.

## Who is working on this

The owner is new to programming. He wants to understand the code, not just run
it. Write for a reader who is learning, and explain rather than assume.

## Working style

- Explain the plan before writing code. Wait for approval on anything that
  touches more than one file.
- Make one change at a time. Small, reviewable diffs.
- Commit to Git before starting each feature, so there is always a working
  state to return to.
- After a change, say plainly what was changed and why, in a couple of
  sentences. No summaries of summaries.
- If a request is ambiguous, ask instead of guessing.
- If you think the requested approach is wrong, say so before implementing it.

## Code rules

- Plain HTML, CSS, and JavaScript. No frameworks, no build step, no npm, no
  TypeScript, no bundlers.
- No external dependencies. Nothing loaded from a CDN.
- Comment anything a beginner would not immediately follow. Explain *why*, not
  what the syntax does. Do not comment obvious lines.
- Prefer clear and slightly verbose over clever and short.
- Use `const` and `let`, never `var`.
- Descriptive names. `estimatedOneRepMax`, not `e1rm` or `x`.
- Functions do one thing. If a function needs a comment explaining its three
  phases, it should be three functions.
- No global mutable state beyond a single clearly named app-state object.

## Data rules

These exist because a training engine will read this data later. Violating them
loses information that cannot be recovered afterwards.

- **One record per set.** Never store `"3x8 @ 80kg"` as text. Load, reps, and
  RIR are separate numeric fields.
- **RIR is recorded on every working set**, even though nothing currently uses
  it. It cannot be reconstructed from memory later.
- **Exercises are referenced by ID, never by typed name.** Free-text names
  fragment the history.
- **Every saved payload carries a `schemaVersion`.** Migrations depend on it.
- Dates and times are ISO 8601 strings.
- Loads are numbers in kilograms. Never strings, never mixed units.
- Do not delete data on write. Editing a set replaces it; deleting is explicit
  and confirmed.

## Storage

- `localStorage` only. No backend, no accounts, no login, no cloud sync.
- All app data lives under a single key.
- JSON export must work before any feature that creates data worth losing.
- Import must validate `schemaVersion` and refuse mismatches loudly.

## UI rules

The app is used mid-set, one-handed, with chalky hands, sometimes in poor light.

- Large tap targets. Assume an inaccurate thumb.
- Minimise typing. Steppers and preset buttons over keyboards where possible.
- The previous performance on the current exercise must be visible while
  logging.
- No confirmation dialogs on the common path.
- Must work offline once loaded.
- Dark background. Gyms are bright and phones are held at arm's length.

## Out of scope for now

Do not build, and do not add hooks or placeholders for:

- The autoregulation engine, volume landmarks, deload logic
- Charts and analytics
- Social features, sharing, accounts
- Anything involving a server

The muscle-weight fields in the exercise library exist in the schema on
purpose, but nothing reads them yet. Leave them alone.
