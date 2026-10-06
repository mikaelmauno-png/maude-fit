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
//
// Bumped to 6 for the addition of targetLoadSetAt on each planned exercise
// in a WorkoutTemplate below.
//
// Bumped to 7 for the addition of Session.addedExercises and
// Session.removedExerciseIds below.
//
// Bumped to 8 for the addition of lastBackedUpAt on the database itself
// (see createEmptyDatabase).
//
// Bumped to 9 because Session.dayStatus may now be null ("not set yet").
//
// Bumped to 10 for the addition of WeeklyCheckIn below.
//
// Bumped to 11 for the addition of preferences on the database itself
// (see createEmptyDatabase).
const SCHEMA_VERSION = 11;

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
//   dayStatus:  "normal",                     // see DAY_STATUSES below;
//                                              // null until it's set
//   notes:      "",
//   templateId: "weekly-workout-1",           // which WorkoutTemplate this
//                                              // followed, or null for a
//                                              // free-form workout
//   gymId:      "gym-uuid...",                // which Gym this was at, or
//                                              // null if not recorded
//   addedExercises: [],                        // planned exercises added
//                                              // to this workout only, same
//                                              // shape as a WorkoutTemplate's
//                                              // plannedExercises entries
//   removedExerciseIds: []                     // exercise ids from the
//                                              // template skipped in this
//                                              // workout only
// }
//
// A template workout's exercise list for the day is the template's
// plannedExercises, minus removedExerciseIds, plus addedExercises. Changes
// made "for this workout only" live here rather than in the template, so
// the template stays as it was for next time, and the record of how this
// workout differed from its plan is kept. Both stay empty for a free-form
// workout, which has no plan to differ from.

// dayStatus records the context that would otherwise be lost. The engine will
// later use it to avoid mistaking a bad night's sleep for a training problem,
// so it is collected from day one even though nothing reads it yet.
//
// A new session starts with null, meaning "not set yet", so the app can tell
// "felt normal" apart from "never answered". Sessions saved before version 9
// started at "normal" instead, so for those "normal" can mean either.
const DAY_STATUSES = ["normal", "poorSleep", "ill", "stressed"];

// WorkoutTemplate — a reusable weekly workout template, e.g. "Weekly workout 1". Meant
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
//       targetLoad:    60,         // kilograms
//       targetLoadSetAt: "2026-09-23T18:10:00.000Z"
//                                   // when targetLoad was last set by hand
//                                   // via "Set goal for next time", or null
//                                   // if never. A goal set after the session
//                                   // a progression suggestion is based on
//                                   // overrides that suggestion; once a newer
//                                   // session is logged, suggestions take
//                                   // over again (see isGoalOverride in
//                                   // app.js). So a goal lasts one session.
//     }
//     // ...one entry per exercise in this workout template, in the order they're done
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

// WeeklyCheckIn — how the week felt overall, answered once a week. The
// engine will later read it next to the training data, so a hard week of
// sleep or stress isn't mistaken for a training problem, same reasoning as
// Session.dayStatus but on a weekly scale. At most one per week: answering
// again in the same week replaces it, same idea as BodyweightEntry.
//
// {
//   id:         "9f8c...",                  // crypto.randomUUID()
//   weekStart:  "2026-09-21",               // that week's Monday, as a
//                                           // local calendar date — which
//                                           // week it's about, not when it
//                                           // was answered
//   loggedAt:   "2026-09-27T18:02:00.000Z", // when it was answered
//   fatigue:    3,                          // each a whole number from
//   stress:     2,                          // CHECK_IN_SCALE_MIN to
//   motivation: 4,                          // CHECK_IN_SCALE_MAX, where
//   recovery:   3,                          // 1 = low and 5 = high
//   notes:      ""
// }
//
// For fatigue and stress high is bad; for motivation and recovery high is
// good. Each is stored exactly as answered rather than flipped into one
// "higher is better" direction, so the raw answers survive and any
// combining is left to whatever reads them later.
const CHECK_IN_RATINGS = ["fatigue", "stress", "motivation", "recovery"];
const CHECK_IN_SCALE_MIN = 1;
const CHECK_IN_SCALE_MAX = 5;


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
    bodyweightEntries: [],     // BodyweightEntry objects
    weeklyCheckIns: [],        // WeeklyCheckIn objects
    preferences: {             // choices made in the app's screens, kept so
                               // they survive closing the app
      chartRangeWeeks: 12      // how many weeks back the trend charts show
                               // (6, 12 or 24), or null for all-time
    },
    lastBackedUpAt: null       // ISO timestamp of the last backup file that
                               // was actually saved or shared; null if never.
                               // Drives the home screen's backup reminder.
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

// Version 5 planned exercises have no targetLoadSetAt. null means "never
// set by hand", which is true enough: before version 6 there was no way to
// tell a hand-set goal apart from the workout template's original starting weight.
function migrateFrom5To6(database) {
  for (const template of database.workoutTemplates) {
    for (const planned of template.plannedExercises) {
      planned.targetLoadSetAt = null;
    }
  }
  database.schemaVersion = 6;
}

// Version 6 sessions have no per-workout exercise changes. Empty lists are
// exactly right: before version 7 there was no way to make any.
function migrateFrom6To7(database) {
  for (const session of database.sessions) {
    session.addedExercises = [];
    session.removedExerciseIds = [];
  }
  database.schemaVersion = 7;
}

// Version 7 data has no lastBackedUpAt. Any export made earlier left no
// record of when it happened, so null ("never") is the honest value: the
// reminder then asks for a fresh backup, which is harmless.
function migrateFrom7To8(database) {
  database.lastBackedUpAt = null;
  database.schemaVersion = 8;
}

// Version 8 data needs no rewriting: every stored dayStatus is still a valid
// value. The bump only exists so an older copy of the app refuses a
// version 9 export, whose sessions may hold a null status it doesn't expect.
function migrateFrom8To9(database) {
  database.schemaVersion = 9;
}

// Version 9 data has no weekly check-ins; an empty list is exactly right.
function migrateFrom9To10(database) {
  database.weeklyCheckIns = [];
  database.schemaVersion = 10;
}

// Version 10 data has no preferences. 12 weeks is what the charts showed
// by default before the setting was remembered.
function migrateFrom10To11(database) {
  database.preferences = { chartRangeWeeks: 12 };
  database.schemaVersion = 11;
}

// Keyed by the version each migration upgrades *from*. Versions with no
// entry here (1-3) are too old to migrate and are still refused.
const MIGRATIONS = {
  4: migrateFrom4To5,
  5: migrateFrom5To6,
  6: migrateFrom6To7,
  7: migrateFrom7To8,
  8: migrateFrom8To9,
  9: migrateFrom9To10,
  10: migrateFrom10To11
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

// Turn the whole database into a backup file, ready to be shared or
// downloaded.
//
// The copy inside the file has lastBackedUpAt set to the moment it was made,
// so a phone that later imports it knows everything in it is already backed
// up. The live database is deliberately left untouched here: app.js only
// records the backup once the file has actually been saved somewhere, since
// closing the share sheet without choosing a place isn't a backup.
function buildBackupFile(database, backedUpAt) {
  const databaseForFile = { ...database, lastBackedUpAt: backedUpAt };
  const json = JSON.stringify(databaseForFile, null, 2);
  const backupDate = backedUpAt.slice(0, 10); // "2026-08-31"
  return new File([json], `workout-log-${backupDate}.json`, { type: "application/json" });
}

// Trigger a download of a file, for browsers that can't share files.
function downloadFile(file) {
  // createObjectURL gives the in-memory file a temporary URL, which a
  // hidden link can then "download".
  const url = URL.createObjectURL(file);

  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
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
      !Array.isArray(parsed.bodyweightEntries) ||
      !Array.isArray(parsed.weeklyCheckIns) ||
      typeof parsed.preferences !== "object" || parsed.preferences === null) {
    throw new Error("That file is not a workout log export.");
  }

  saveDatabase(parsed);
  return parsed;
}


// ---------------------------------------------------------------------------
// Automatic copy
//
// One extra copy of the whole database, kept on the phone and replaced each
// time a new one is taken (see app.js for when). It's there for when the
// app itself damages the data (a bug, or importing the wrong file), and can
// be restored from the Export / Import screen.
//
// It lives under its own key, the one deliberate exception to "everything
// under one key": a copy stored *inside* the main data would be damaged
// along with it. It also lives in the same browser storage, so it does
// nothing if that storage is cleared or the phone is lost. Only a backup
// file saved elsewhere covers that.
// ---------------------------------------------------------------------------

const AUTO_COPY_KEY = `${STORAGE_KEY}-autoCopy`;

// Shape stored under AUTO_COPY_KEY:
//
// {
//   takenAt:  "2026-09-27T16:40:00.000Z",
//   database: { schemaVersion: 7, exercises: [...], ... }   // whole database
// }

function saveAutoCopy(database) {
  const autoCopy = { takenAt: new Date().toISOString(), database: database };
  try {
    localStorage.setItem(AUTO_COPY_KEY, JSON.stringify(autoCopy));
  } catch (error) {
    // Usually a full storage quota: the copy doubles how much is stored.
    // Unlike a failed save, nothing is lost here (the real data is
    // untouched, and a failed write leaves the previous copy as it was),
    // so the app carries on rather than stopping.
    console.error("Could not save the automatic copy.", error);
  }
}

// Returns the stored copy in the shape above, or null if there isn't a
// usable one.
function loadAutoCopy() {
  const raw = localStorage.getItem(AUTO_COPY_KEY);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("The automatic copy could not be read.", error);
    return null;
  }
}


// ---------------------------------------------------------------------------
// Starter exercise library
//
// A new install starts with all of these. An existing install can pull in
// any it's missing with the "Add built-in exercises" button in the exercise
// library, so adding an entry here reaches both.
//
// Keep the ids stable once sets have been logged against them — changing an
// id orphans history. Muscle weights and minimum raises are sensible
// defaults, meant to be adjusted in the exercise library.
//
// Minimum raise conventions: 2.5 kg for barbells and loaded bodyweight
// moves, 2 kg for dumbbells, 5 kg for machine and cable stacks.
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
    muscles: { hamstrings: 1.0, glutes: 0.5, lowerBack: 0.5 },
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
  },
  {
    id: "machine-lateral-raise",
    name: "Machine lateral raise",
    muscles: { sideDelt: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "neutral-grip-pull-up",
    name: "Neutral-grip pull-up",
    muscles: { lats: 1.0, biceps: 0.5, upperBack: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2.5
  },
  {
    id: "seated-cable-row-wide-grip",
    name: "Seated cable row (wide overhand grip)",
    muscles: { upperBack: 1.0, lats: 0.5, rearDelt: 0.5, biceps: 0.5 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "seated-cable-row-close-neutral-grip",
    name: "Seated cable row (close neutral grip)",
    muscles: { lats: 1.0, upperBack: 0.5, biceps: 0.5 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "seated-cable-row-underhand-grip",
    name: "Seated cable row (underhand grip)",
    muscles: { lats: 1.0, upperBack: 0.5, biceps: 0.5 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "seated-dumbbell-curl",
    name: "Seated dumbbell curl",
    muscles: { biceps: 1.0, forearms: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2
  },
  {
    id: "incline-dumbbell-curl",
    name: "Incline dumbbell curl",
    muscles: { biceps: 1.0, forearms: 0.5 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2
  },
  {
    id: "triceps-pushdown-rope",
    name: "Triceps pushdown (rope)",
    muscles: { triceps: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "triceps-pushdown-straight-bar",
    name: "Triceps pushdown (straight bar)",
    muscles: { triceps: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "triceps-pushdown-v-bar",
    name: "Triceps pushdown (V-bar)",
    muscles: { triceps: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "overhead-triceps-extension-rope",
    name: "Overhead triceps extension (cable, rope)",
    muscles: { triceps: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "overhead-triceps-extension-bar",
    name: "Overhead triceps extension (cable, straight bar)",
    muscles: { triceps: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "overhead-triceps-extension-dumbbell",
    name: "Overhead triceps extension (dumbbell)",
    muscles: { triceps: 1.0 },
    isArchived: false,
    isGymSpecific: false,
    minimumLoadIncrement: 2
  },
  {
    id: "hip-abductor-machine",
    name: "Hip abductor machine",
    muscles: { glutes: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "leg-press-calf-raise",
    name: "Calf raise in leg press",
    muscles: { calves: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "machine-oblique-rotation",
    name: "Oblique rotation machine",
    muscles: { obliques: 1.0, abs: 0.5 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  },
  {
    id: "machine-crunch",
    name: "Machine crunch",
    muscles: { abs: 1.0 },
    isArchived: false,
    isGymSpecific: true,
    minimumLoadIncrement: 5
  }
];
