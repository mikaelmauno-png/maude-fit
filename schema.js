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
//
// Bumped to 12 for the addition of CardioActivity and CardioSession below.
//
// Bumped to 13 for the addition of Gym.exerciseReplacements,
// Gym.machineMaxLoads, Session.replacedExercises and
// Session.catchUpExercises below.
const SCHEMA_VERSION = 13;

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
//                                              // plannedExercises entries,
//                                              // plus an optional listPosition
//                                              // (see below)
//   removedExerciseIds: [],                    // exercise ids from the
//                                              // template skipped in this
//                                              // workout only
//   replacedExercises: [                       // template exercises swapped
//     {                                        // for another one in this
//       exerciseId:            "leg-press",    // workout, because this gym
//       replacementExerciseId: "hack-squat"    // can't do them (see Gym)
//     }
//   ],
//   catchUpExercises: null                     // null for any other
//                                              // workout; for a catch-up
//                                              // workout, its list (see
//                                              // below)
// }
//
// A template workout's exercise list for the day is the template's
// plannedExercises, minus removedExerciseIds, plus addedExercises.
//
// An addedExercises entry may carry `listPosition`, a 0-based place in that
// day's list. It's only set on an exercise taken out of the template
// mid-workout after sets were logged on it: its card stays in today's list,
// and listPosition keeps it where it was instead of moving it to the end.
// Older app versions ignore the field, which only changes the card order,
// so it didn't need a schema version bump. Changes
// made "for this workout only" live here rather than in the template, so
// the template stays as it was for next time, and the record of how this
// workout differed from its plan is kept. All three stay empty for a
// free-form workout, which has no plan to differ from.
//
// A replaced exercise takes the original's place in the day's list, with
// the original's sets and rep range, but its own load and its own
// history: 100 kg on a leg press says nothing about a hack squat. The
// swap is copied onto the session rather than only read from the gym,
// so the record of what this workout was stays true even after the gym's
// replacements change later.
//
// A catch-up workout makes up this week's sets that weren't done: every
// planned set missing from the week's finished template workouts. It has
// no template (templateId is null); its plan is catchUpExercises, the
// same shape as a template's plannedExercises, with targetSets being how
// many sets of that exercise were still missing when it was started, plus
// fromTemplateId: the template it was missed from, so its suggestions
// follow that workout's history. (An exercise missed in two templates
// keeps the first one's.) Catch-ups saved before fromTemplateId was added
// don't have it; older app versions ignore it, so it needed no version
// bump, same as listPosition.
// That plan is saved rather than worked out again later, since the
// missing sets change as soon as any are done. addedExercises,
// removedExerciseIds and replacedExercises work on it as on a template.

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
//   isArchived: false,
//   exerciseReplacements: [            // exercises this gym can't do, and
//     {                                // what to do there instead. Put
//       exerciseId:            "leg-press",   // into each workout started
//       replacementExerciseId: "hack-squat"   // here automatically (see
//     }                                       // Session.replacedExercises)
//   ],
//   machineMaxLoads: { "leg-press": 120 }     // kilograms: the heaviest a
//                                             // machine here goes, keyed by
//                                             // exercise id. Only for
//                                             // gym-specific exercises;
//                                             // one with no entry has no
//                                             // known limit
// }
//
// At a machine's max, progression suggestions add reps instead of weight
// (see progression.js). The max only steers suggestions: a heavier set can
// still be logged, since a gym can get a bigger stack.

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
// CardioActivity — a kind of cardio, like an Exercise is a kind of lift:
// "Run", "Rower", or one added by hand. A CardioSession points at one by id,
// never by typed name, for the same reason as exercises: free-text names
// would split one activity's history into several spellings. Archived
// rather than deleted once used, same as Exercise and Gym.
//
// {
//   id:         "rower",     // stable, lowercase, hyphenated, never changes
//   name:       "Rower",     // shown in the UI, safe to reword
//   isArchived: false
// }

// CardioSession — one bout of cardio, logged on its own (not as part of a
// strength workout) once it's done.
//
// {
//   id:               "9f8c...",                  // crypto.randomUUID()
//   activityId:       "rower",
//   performedAt:      "2026-10-06T17:40:00.000Z",
//   durationMinutes:  30,         // whole minutes, always given
//   effort:           6,          // 1-10, how hard it felt overall (RPE),
//                                 // always given; effort × minutes is the
//                                 // usual way to compare cardio load
//   distanceKm:       6.2,        // or null when not recorded
//   averageHeartRate: 148,        // beats per minute, or null when not
//                                 // recorded
//   notes:            ""
// }
//
// Distance and heart rate are null rather than 0 when missing: 0 km would
// claim the distance was measured and was nothing.
const CARDIO_EFFORT_MIN = 1;
const CARDIO_EFFORT_MAX = 10;

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
    cardioActivities: createStarterCardioActivities(), // CardioActivity objects
    cardioSessions: [],        // CardioSession objects
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

// Version 11 data has no cardio. The starter activities go in so there's
// something to pick from the first time, same as on a new install.
function migrateFrom11To12(database) {
  database.cardioActivities = createStarterCardioActivities();
  database.cardioSessions = [];
  database.schemaVersion = 12;
}

// Version 12 data has no replacements: no gym has an exercise it can't
// do yet, and no past workout swapped one. Nor were any catch-up workouts
// or machine maximums.
function migrateFrom12To13(database) {
  for (const gym of database.gyms) {
    gym.exerciseReplacements = [];
    gym.machineMaxLoads = {};
  }
  for (const session of database.sessions) {
    session.replacedExercises = [];
    session.catchUpExercises = null;
  }
  database.schemaVersion = 13;
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
  10: migrateFrom10To11,
  11: migrateFrom11To12,
  12: migrateFrom12To13
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
      !Array.isArray(parsed.cardioActivities) ||
      !Array.isArray(parsed.cardioSessions) ||
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
// Starter cardio activities
// ---------------------------------------------------------------------------

// The cardio activities a new install (or an upgrade from version 11)
// starts with. A function rather than a plain list, so each database gets
// its own fresh objects instead of sharing one list that renaming an
// activity in one place would quietly change everywhere.
function createStarterCardioActivities() {
  const starterNames = ["Run", "Bike", "Rower", "Walk", "Elliptical", "Swim", "Stairs"];
  return starterNames.map((name) => ({ id: name.toLowerCase(), name, isArchived: false }));
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
