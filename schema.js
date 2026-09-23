// ---------------------------------------------------------------------------
// Data model and storage for the workout logger.
//
// Everything the app saves goes through this file. Keeping storage in one
// place means that when the shape of the data changes later, there is exactly
// one file to update.
// ---------------------------------------------------------------------------


// Bump this whenever the shape of the saved data changes in a way that old
// saved data would not survive. The import function refuses to load data with
// a version it does not recognise, which is what stops a bad import from
// silently corrupting months of training history.
//
// Bumped to 2 for the addition of WorkoutTemplate and Session.templateId
// below — old saved data doesn't have those fields.
//
// Bumped to 3 for the addition of Gym, Session.gymId, and
// Exercise.isGymSpecific below.
//
// Bumped to 4 for the addition of BodyweightEntry below.
//
// Bumped to 5 for the addition of Exercise.minimumLoadIncrement below. This
// is the first bump with a migration (see migrateDatabase), so data saved
// under version 4 is upgraded in place instead of being refused.
const SCHEMA_VERSION = 5;

// Every piece of app data lives under this one localStorage key, as a single
// JSON string. One key is simpler to export, import, and reason about than
// a dozen scattered keys.
const STORAGE_KEY = "workoutLog";


// ---------------------------------------------------------------------------
// Shapes
//
// JavaScript has no built-in way to declare these, so they are written out as
// comments plus example objects. Treat them as the contract: if a function
// produces something that does not match, that is a bug.
// ---------------------------------------------------------------------------

// Exercise — an entry in the exercise library.
//
// {
//   id:      "barbell-bench-press",   // stable, lowercase, hyphenated, never changes
//   name:    "Barbell bench press",   // shown in the UI, safe to reword
//   muscles: { chest: 1.0, frontDelt: 0.5, triceps: 0.5 },
//   isArchived: false,                // hidden from pickers, kept for old history
//   isGymSpecific: false,             // true for machines/cable stacks whose
//                                     // load numbers aren't comparable between
//                                     // gyms; false for free weights, where a
//                                     // kilogram means the same thing anywhere
//   minimumLoadIncrement: 2.5         // kilograms: the smallest weight raise
//                                     // this exercise's equipment allows (e.g.
//                                     // 1 for small dumbbells, 5 for a machine
//                                     // stack). Progression suggestions step
//                                     // the load by exactly this much.
// }
//
// About `muscles`: a value of 1.0 means the muscle is the prime mover
// ("main muscle" in the UI), 0.5 means it is meaningfully involved but not
// the target ("secondary muscle"). An exercise can have at most one muscle
// at 1.0 and any number at 0.5. The training engine added later will
// depend on this data, so it exists even though nothing computes volume
// or landmarks from it yet.
const MUSCLE_GROUPS = [
  "chest", "upperBack", "lats", "lowerBack", "traps",
  "frontDelt", "sideDelt", "rearDelt",
  "biceps", "triceps", "forearms",
  "abs", "obliques",
  "glutes", "quads", "hamstrings", "adductors", "calves"
];

// Set — one working or warmup set actually performed.
//
// {
//   id:         "9f8c...",             // crypto.randomUUID()
//   sessionId:  "3a41...",             // which session this belongs to
//   exerciseId: "barbell-bench-press",
//   order:      2,                     // position within the session, 0-based
//   load:       80,                    // kilograms, always a number
//   reps:       8,
//   rir:        2,                     // reps in reserve; null only for warmups
//   isWarmup:   false,
//   performedAt: "2026-08-31T17:42:11.000Z"
// }
//
// Note that load, reps, and rir are three separate numeric fields. Storing
// "3x8 @ 80kg" as a string would be easier today and useless later.

// Session — one gym visit.
//
// {
//   id:         "3a41...",
//   startedAt:  "2026-08-31T17:05:00.000Z",
//   endedAt:    "2026-08-31T18:20:00.000Z",   // null while in progress
//   dayStatus:  "normal",                     // see DAY_STATUSES below
//   notes:      "",
//   templateId: "weekly-workout-1",           // which WorkoutTemplate this
//                                              // followed, or null for a
//                                              // free-form workout
//   gymId:      "gym-uuid..."                 // which Gym this was at, or
//                                              // null if not recorded
// }

// dayStatus records the context that would otherwise be lost. The engine will
// later use it to avoid mistaking a bad night's sleep for a training problem,
// so it is collected from day one even though nothing reads it yet.
const DAY_STATUSES = ["normal", "poorSleep", "ill", "stressed"];

// WorkoutTemplate — a reusable weekly scheme, e.g. "Weekly workout 1". Meant
// to be replaced every 1-3 months as training needs change, which is why old
// ones are archived rather than deleted: a past Session still points at the
// template it followed, so that history should stay resolvable.
//
// {
//   id:         "weekly-workout-1",
//   name:       "Weekly workout 1",
//   isArchived: false,
//   plannedExercises: [
//     {
//       exerciseId:    "barbell-bench-press",
//       targetSets:    3,
//       targetRepsMin: 8,
//       targetRepsMax: 10,
//       targetLoad:    60          // kilograms
//     }
//     // ...one entry per exercise in this scheme, in the order they're done
//   ]
// }

// Gym — a physical gym the user trains at. Exists because machine and cable
// weight stacks aren't standardised between locations, so a logged number
// for a gym-specific exercise only means the same thing when compared within
// the same gym. Archived rather than deleted, same reasoning as Exercise and
// WorkoutTemplate: a past Session still points at the gym it was logged at.
//
// {
//   id:         "gym-uuid...",
//   name:       "PureGym Jyvaskyla",
//   isArchived: false
// }

// BodyweightEntry — one weigh-in. At most one per calendar day: logging
// again on the same day replaces this entry's weightKg rather than adding a
// second one, which keeps the trend graph readable and matches how most
// people actually track bodyweight.
//
// {
//   id:        "9f8c...",                     // crypto.randomUUID()
//   loggedAt:  "2026-08-31T07:15:00.000Z",     // full timestamp, not just a
//                                              // date — a date-only string
//                                              // like "2026-08-31" parses as
//                                              // UTC midnight, which can
//                                              // display as the *previous*
//                                              // local day depending on the
//                                              // browser's timezone
//   weightKg:  78.4
// }


// The complete saved payload. This is the object that gets serialised into
// localStorage and written out by the export button.
function createEmptyDatabase() {
  return {
    schemaVersion: SCHEMA_VERSION,
    exercises: [],        // Exercise objects
    sessions: [],          // Session objects
    sets: [],               // Set objects, stored flat rather than nested
                            // inside sessions — a flat list is far easier to
                            // filter when asking questions like "every bench
                            // press I have done"
    workoutTemplates: [],  // WorkoutTemplate objects
    gyms: [],                // Gym objects
    bodyweightEntries: []      // BodyweightEntry objects
  };
}


// ---------------------------------------------------------------------------
// Migrations
//
// When SCHEMA_VERSION goes up, data saved by the older version still sits in
// localStorage (and in old export files). A migration rewrites that old data
// into the new shape, one version step at a time, so months of history
// survive an app update.
// ---------------------------------------------------------------------------

// Version 4 exercises have no minimumLoadIncrement. 2.5 kg is the smallest
// raise on a standard barbell (a 1.25 kg plate per side), so it's the
// safest guess; machines and small dumbbells can be corrected afterwards in
// the exercise library.
function migrateFrom4To5(database) {
  for (const exercise of database.exercises) {
    exercise.minimumLoadIncrement = 2.5;
  }
  database.schemaVersion = 5;
}

// Keyed by the version each migration upgrades *from*. Versions with no
// entry here (1-3) are too old to migrate and are still refused.
const MIGRATIONS = {
  4: migrateFrom4To5
};

// Applies migrations one step at a time until the data reaches
// SCHEMA_VERSION, or stops at a version with no migration. The caller still
// checks the final version, so unmigratable data is refused loudly rather
// than half-upgraded silently.
function migrateDatabase(database) {
  while (database.schemaVersion !== SCHEMA_VERSION && MIGRATIONS[database.schemaVersion]) {
    MIGRATIONS[database.schemaVersion](database);
  }
}


// ---------------------------------------------------------------------------
// Loading and saving
// ---------------------------------------------------------------------------

// Read the whole database out of localStorage.
// Returns an empty database on a first run, or if the stored data is
// unreadable. It deliberately does not try to repair damaged data — silently
// guessing at broken records is how history gets quietly mangled.
function loadDatabase() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (raw === null) {
    return createEmptyDatabase();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("Saved data could not be parsed. Not overwriting it.", error);
    throw new Error("Saved data is corrupt. Export a backup before continuing.");
  }

  // Upgrade older saved data, and write the upgraded version straight back
  // so the migration only ever runs once per phone.
  if (parsed.schemaVersion !== SCHEMA_VERSION && MIGRATIONS[parsed.schemaVersion]) {
    migrateDatabase(parsed);
    saveDatabase(parsed);
  }

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Saved data uses schema version ${parsed.schemaVersion}, but this app ` +
      `expects version ${SCHEMA_VERSION}. A migration is needed.`
    );
  }

  return parsed;
}


// Write the whole database back to localStorage.
//
// Rewriting everything on each save is wasteful in principle and completely
// fine in practice: a few years of training is well under a megabyte, and
// localStorage allows several. Simplicity wins here.
function saveDatabase(database) {
  database.schemaVersion = SCHEMA_VERSION;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  } catch (error) {
    // The usual cause is a full storage quota, or private browsing mode where
    // localStorage silently refuses writes. Failing loudly matters: a save
    // that quietly does nothing loses a whole session.
    console.error("Could not save.", error);
    throw new Error("Could not save your data. Export a backup now.");
  }
}


// ---------------------------------------------------------------------------
// Export and import
//
// Build these before logging anything real. Browsers clear localStorage when
// site data is cleared, and there is no way to get it back.
// ---------------------------------------------------------------------------

// Trigger a download of the whole database as a JSON file.
function exportDatabase() {
  const database = loadDatabase();
  const json = JSON.stringify(database, null, 2);

  // A Blob is an in-memory file. createObjectURL gives it a temporary URL,
  // which a hidden link can then "download".
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const today = new Date().toISOString().slice(0, 10); // "2026-08-31"
  const link = document.createElement("a");
  link.href = url;
  link.download = `workout-log-${today}.json`;
  link.click();

  // Release the temporary URL so the browser can reclaim the memory.
  URL.revokeObjectURL(url);
}


// Replace the entire database with the contents of an exported file.
//
// This overwrites everything. The caller is responsible for confirming with
// the user first.
function importDatabase(jsonText) {
  const parsed = JSON.parse(jsonText);

  // An export made before an app update is still a valid backup, so known
  // older versions are upgraded. Unknown versions still fail loudly below.
  migrateDatabase(parsed);

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `That file uses schema version ${parsed.schemaVersion}, but this app ` +
      `expects version ${SCHEMA_VERSION}.`
    );
  }

  // Minimal structural check. Not full validation, but enough to catch
  // importing an unrelated JSON file by mistake.
  if (!Array.isArray(parsed.exercises) ||
      !Array.isArray(parsed.sessions) ||
      !Array.isArray(parsed.sets) ||
      !Array.isArray(parsed.workoutTemplates) ||
      !Array.isArray(parsed.gyms) ||
      !Array.isArray(parsed.bodyweightEntries)) {
    throw new Error("That file is not a workout log export.");
  }

  saveDatabase(parsed);
  return parsed;
}


// ---------------------------------------------------------------------------
// Starter exercise library
//
// Replace these with the exercises actually trained. Keep the ids stable once
// sets have been logged against them — changing an id orphans history.
// The muscle weights are placeholders and nothing reads them yet.
// ---------------------------------------------------------------------------

const STARTER_EXERCISES = [
  {
    id: "barbell-bench-press",
    name: "Barbell bench press",
    muscles: { chest: 1.0, frontDelt: 0.5, triceps: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2.5
  },
  {
    id: "barbell-squat",
    name: "Barbell back squat",
    muscles: { quads: 1.0, glutes: 0.5, adductors: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2.5
  },
  {
    id: "romanian-deadlift",
    name: "Romanian deadlift",
    muscles: { hamstrings: 1.0, glutes: 1.0, lowerBack: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2.5
  },
  {
    id: "pull-up",
    name: "Pull-up",
    muscles: { lats: 1.0, biceps: 0.5, upperBack: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2.5
  },
  {
    id: "overhead-press",
    name: "Overhead press",
    muscles: { frontDelt: 1.0, triceps: 0.5, sideDelt: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2.5
  }
];
