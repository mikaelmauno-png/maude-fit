# Project: workout logger

A personal workout logging web app. Single user, used on a phone in a gym.
A training autoregulation engine is being added incrementally — the data model must keep supporting it

## Who is working on this

The owner is new to programming. He wants to understand the code, not just run
it. Write for a reader who is learning, and explain rather than assume.

## Working style

- Until a rough alpha is working end-to-end, build ahead without pausing for
  approval on each file — commit as you go so there's always a working state
  to return to, and ask only when something is genuinely ambiguous. Once the
  alpha exists, go back to explaining a plan and waiting for approval before
  changes that touch more than one file.
- Make one change at a time where reasonable. Small, reviewable diffs.
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

## Training recommendations (autoregulation)
Now in scope, built in small steps. First step: per-exercise double
progression for template workouts (not free-form). Suggestions are hints:
they may pre-fill steppers but never change logged data or workout templates.
Volume landmarks and deload logic come later, each as its own step.
## Out of scope for now

Do not build, and do not add hooks or placeholders for:
- Social features, sharing, accounts
- Anything involving a server

Charts are allowed now (weekly workout-template completion summary, per-exercise
weight/rep-range history), but stay hand-drawn inline SVG — no charting
library, since nothing can be loaded from a CDN per the Code rules above.

The muscle-weight fields in the exercise library may now be set and shown in
the UI — a main muscle (weight 1.0) and secondary muscles (weight 0.5), per
the existing `Exercise.muscles` shape. The volume-landmarks step of the
autoregulation work may use these weights to count weekly sets per muscle.
Double progression (progression.js) does not use them; it works from RIR and
rep-range outcomes.
