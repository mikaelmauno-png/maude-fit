// ---------------------------------------------------------------------------
// Training recommendations: performance-drop detection (deload design v5.2).
//
// Watches each exercise's estimated one-rep max (e1RM) over time and spots a
// real drop in performance — the sign that fatigue has built up and a
// lighter week (a "deload") would help. The hard part is that one session's
// e1RM is noisy: a bad night's sleep moves it by a few percent. So the rules
// compare *averages* of several sessions, and set the bar for "a drop"
// from how noisy your own logged sessions actually are.
//
// Like progression.js, everything here only *reads* the database. Nothing
// is suggested to the user yet: this step exists so the rules can be
// watched on real data before they're allowed to suggest anything.
//
// Words used below:
// - slot:        one exercise in one workout template ("bench in Treeni 1").
//                The same lift is often trained differently in different
//                workouts, so each slot keeps its own history, the same
//                scope progression.js uses.
// - history key: a slot, narrowed further when needed: a gym swap gets its
//                own history inside the slot (a hack squat's numbers say
//                nothing about a leg press), and a gym-specific machine's
//                history is per gym.
// - window:      the 3 most recent usable sessions of a key.
// - baseline:    the 6 usable sessions before the window, to compare with.
// - noise pool:  "standard" or "highRep" keys, each with its own noise
//                estimate (see section "Noise" below).
// ---------------------------------------------------------------------------


// The rule's numbers, from the deload design (v5.2 section 11). Named here
// so a change is one edit, and so the readout can show which values are in
// use.
const DROP_RECENT_WINDOW_SESSIONS = 3;
const DROP_BASELINE_SESSIONS = 6;
const DROP_SESSIONS_NEEDED = DROP_BASELINE_SESSIONS + DROP_RECENT_WINDOW_SESSIONS;
const DROP_PERSISTENCE_SESSIONS = 2;
const DROP_THRESHOLD_K = 1.5;
// Sets with more reps + RIR than this give too unreliable an e1RM. 15 (not
// the usual 10) because each slot is only ever compared with itself at the
// same rep range, so the formula's error at high reps mostly cancels out.
const DROP_E1RM_MAX_REPS_PLUS_RIR = 15;
// Templates don't store a target RIR yet, so a slot's rep range is judged
// against the most cautious one in use (3 reps in reserve). Replace with the
// real target once goal settings exist.
const TARGET_RIR_ASSUMED = 3;
// Slots aimed at more than 10 reps (by the middle of their rep range) wobble
// more from session to session, so they get their own noise estimate.
const HIGH_REP_MIDPOINT_ABOVE = 10;
const DROP_MIN_NOISE_PAIRS = 30;
const DROP_MAX_PAIR_GAP_DAYS = 28;
// A change bigger than this between two sessions is far more likely a typo
// (80 kg logged as 800) than real, so it's capped before it can swamp the
// noise estimate.
const DROP_MAX_CHANGE = 0.15;
const DROP_BREAK_DAYS = 7;
const LOW_READINESS_MAX = 2;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;


// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function averageOf(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function daysBetween(earlierIsoString, laterIsoString) {
  return (new Date(laterIsoString) - new Date(earlierIsoString)) / MILLISECONDS_PER_DAY;
}

// The muscle an exercise mainly trains (weight 1.0), or null. Older data can
// have two muscles at 1.0; the first one counts, same as the muscle editor.
function findMainMuscle(exercise) {
  const mainEntry = Object.entries(exercise.muscles).find(([, weight]) => weight === 1.0);
  return mainEntry ? mainEntry[0] : null;
}

// Epley's formula, with reps in reserve added to the reps actually done:
// a set of 8 with 2 left in the tank is treated like a 10-rep max.
// `totalLoad` is everything moved: for a bodyweight exercise, the body plus
// what was added.
function estimatedOneRepMax(totalLoad, set) {
  return totalLoad * (1 + (set.reps + set.rir) / 30);
}

// Warmups and sets without a logged RIR can't give a usable e1RM, nor can
// one with nothing moved (a bodyweight set when no bodyweight is known).
function isUsableForEstimatedOneRepMax(set, totalLoad) {
  return !set.isWarmup
    && typeof set.rir === "number"
    && totalLoad > 0
    && set.reps + set.rir <= DROP_E1RM_MAX_REPS_PLUS_RIR;
}

// The bodyweight that applied to a workout: the latest weigh-in logged
// before the workout ended, or the earliest one there is if the workout is
// older than every weigh-in. Using the weight of that day (not today's)
// matters: losing 3 kg mustn't make every past pull-up look 3 kg weaker.
// null when no bodyweight has ever been logged. `entriesOldestFirst` must be
// sorted by loggedAt.
function findBodyweightForSession(entriesOldestFirst, session) {
  if (entriesOldestFirst.length === 0) {
    return null;
  }
  const loggedBefore = entriesOldestFirst.filter((entry) => entry.loggedAt <= session.endedAt);
  const chosen = loggedBefore.length > 0 ? loggedBefore[loggedBefore.length - 1] : entriesOldestFirst[0];
  return chosen.weightKg;
}


// ---------------------------------------------------------------------------
// Session categories (design section 2)
//
// How a workout's readiness answer and reason decide whether it's used:
// - "ill":    left out everywhere; being ill isn't training fatigue.
// - "low":    readiness 1-2. Kept in the recent window (feeling bad may BE
//             the fatigue being looked for) but not in the baseline, so one
//             bad day can't drag the comparison point down.
// - "offday": no readiness answer, but a reason (poor sleep, stressed) was
//             given. Treated like "low".
// - "normal": everything else.
// ---------------------------------------------------------------------------

// Anything other than a whole number 1-5 counts as "not answered". The
// stored value is left as it is, never repaired.
function findValidReadiness(session) {
  const readiness = session.readiness;
  return Number.isInteger(readiness) && readiness >= CHECK_IN_SCALE_MIN && readiness <= CHECK_IN_SCALE_MAX
    ? readiness
    : null;
}

function categorizeSession(session) {
  if (session.dayStatus === "ill") {
    return "ill";
  }
  const readiness = findValidReadiness(session);
  if (readiness !== null) {
    return readiness <= LOW_READINESS_MAX ? "low" : "normal";
  }
  if (session.dayStatus === "poorSleep" || session.dayStatus === "stressed") {
    return "offday";
  }
  return "normal";
}


// ---------------------------------------------------------------------------
// History keys and slots (design section 1)
// ---------------------------------------------------------------------------

// The template exercise a performed exercise stood in for: itself, unless
// a gym swap was done in its place.
function findOriginalExerciseId(session, performedExerciseId) {
  const replacement = session.replacedExercises.find(
    (candidate) => candidate.replacementExerciseId === performedExerciseId
  );
  return replacement ? replacement.exerciseId : performedExerciseId;
}

function buildSlotId(templateId, originalExerciseId) {
  return `${templateId}|${originalExerciseId}`;
}

// Where one exercise in one finished workout belongs, or null for a
// free-form workout (no template, so no slot and no drop test).
// findWorkoutTemplateIdOf (progression.js) also sends a catch-up workout's
// exercises to the template each one came from.
function describeHistoryKey(session, performedExercise) {
  const templateId = findWorkoutTemplateIdOf(session, performedExercise.id);
  if (templateId === null) {
    return null;
  }
  const originalExerciseId = findOriginalExerciseId(session, performedExercise.id);
  const swapPart = performedExercise.id === originalExerciseId ? "" : performedExercise.id;
  const gymPart = performedExercise.isGymSpecific ? (session.gymId || "noGym") : "";
  return {
    key: [templateId, originalExerciseId, swapPart, gymPart].join("|"),
    slotId: buildSlotId(templateId, originalExerciseId),
    templateId,
    originalExerciseId,
    performedExerciseId: performedExercise.id,
    gymId: performedExercise.isGymSpecific ? session.gymId : null
  };
}

// Whether a slot can ever produce a usable e1RM: its rep range has to fit
// under the cap (judged at the assumed target RIR), and a bodyweight
// exercise needs a bodyweight to add its load to.
function canSlotGiveEstimatedOneRepMax(planned, exercise, hasBodyweightLog) {
  const fitsUnderCap = planned.targetRepsMin + TARGET_RIR_ASSUMED <= DROP_E1RM_MAX_REPS_PLUS_RIR;
  const hasLoad = !exercise.isBodyweight || hasBodyweightLog;
  return fitsUnderCap && hasLoad;
}

// The "main slots" of each muscle in the given templates: slots whose
// exercise mainly trains it and that can give a usable e1RM. A Map from
// muscle to a list of { slotId, templateId, exerciseId }. Takes the
// templates as a parameter so the template editor can ask "what if this
// draft were saved?".
function findMainSlotsByMuscle(templates, exercises, hasBodyweightLog) {
  const slotsByMuscle = new Map();
  for (const template of templates) {
    for (const planned of template.plannedExercises) {
      const exercise = exercises.find((candidate) => candidate.id === planned.exerciseId);
      const muscle = exercise ? findMainMuscle(exercise) : null;
      if (muscle === null || !canSlotGiveEstimatedOneRepMax(planned, exercise, hasBodyweightLog)) {
        continue;
      }
      if (!slotsByMuscle.has(muscle)) {
        slotsByMuscle.set(muscle, []);
      }
      slotsByMuscle.get(muscle).push({
        slotId: buildSlotId(template.id, planned.exerciseId),
        templateId: template.id,
        exerciseId: planned.exerciseId
      });
    }
  }
  return slotsByMuscle;
}

// A muscle needs at least two main slots to be drop-tested: with one, a
// drop shows up so late that the 8-week backstop would arrive first (see
// the design's simulation results).
function isMuscleDropTested(mainSlots) {
  return mainSlots.length >= 2;
}

// Muscles with exactly one main slot, for the template editor's note.
function findSingleSlotMuscles(templates, exercises, hasBodyweightLog) {
  const singleSlotMuscles = [];
  for (const [muscle, mainSlots] of findMainSlotsByMuscle(templates, exercises, hasBodyweightLog)) {
    if (mainSlots.length === 1) {
      singleSlotMuscles.push(muscle);
    }
  }
  return singleSlotMuscles;
}


// ---------------------------------------------------------------------------
// Timelines: each history key's sessions, oldest first
// ---------------------------------------------------------------------------

// Start times of workouts that came after 7+ days with no workout at all.
// The first session of each key after such a gap is left out of the drop
// test: some strength is lost over a break, and that isn't fatigue.
function findBreakEndTimes(finishedSessions) {
  const breakEndTimes = [];
  for (let index = 1; index < finishedSessions.length; index++) {
    const gapInDays = daysBetween(finishedSessions[index - 1].startedAt, finishedSessions[index].startedAt);
    if (gapInDays >= DROP_BREAK_DAYS) {
      breakEndTimes.push(finishedSessions[index].startedAt);
    }
  }
  return breakEndTimes;
}

function wasBreakBetween(breakEndTimes, earlierIsoString, laterIsoString) {
  return breakEndTimes.some((breakEnd) => breakEnd > earlierIsoString && breakEnd <= laterIsoString);
}

function wasDoneAsDeload(session, exerciseId) {
  return session.deload !== null && session.deload !== undefined
    && session.deload.exerciseIds.includes(exerciseId);
}

// The best usable e1RM among one exercise's sets in one session, or null
// when none of them qualify. `bodyweightKg` is only used (and only needed)
// for a bodyweight exercise.
function findBestEstimatedOneRepMax(sets, exercise, bodyweightKg) {
  const extraLoad = exercise.isBodyweight ? bodyweightKg : 0;
  if (extraLoad === null) {
    return null;
  }
  const estimates = sets
    .filter((set) => isUsableForEstimatedOneRepMax(set, set.load + extraLoad))
    .map((set) => estimatedOneRepMax(set.load + extraLoad, set));
  return estimates.length > 0 ? Math.max(...estimates) : null;
}

// Which noise pool a slot belongs to, from the middle of its template rep
// range. The template's planned entry is still there for archived
// templates; for a slot since taken out of its template, the middle of the
// reps actually logged stands in.
function findNoisePool(database, templateId, originalExerciseId, loggedReps) {
  const template = database.workoutTemplates.find((candidate) => candidate.id === templateId);
  const planned = template
    ? template.plannedExercises.find((candidate) => candidate.exerciseId === originalExerciseId)
    : null;
  const midpoint = planned
    ? (planned.targetRepsMin + planned.targetRepsMax) / 2
    : medianOf(loggedReps);
  return midpoint > HIGH_REP_MIDPOINT_ABOVE ? "highRep" : "standard";
}

function medianOf(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Groups sets by session, then by exercise, in one pass over the sets list:
// Map(sessionId -> Map(exerciseId -> sets)).
function groupSetsBySessionAndExercise(sets) {
  const groups = new Map();
  for (const set of sets) {
    if (!groups.has(set.sessionId)) {
      groups.set(set.sessionId, new Map());
    }
    const byExercise = groups.get(set.sessionId);
    if (!byExercise.has(set.exerciseId)) {
      byExercise.set(set.exerciseId, []);
    }
    byExercise.get(set.exerciseId).push(set);
  }
  return groups;
}

// One timeline per history key: { ...key description, pool, entries },
// each entry being one finished session in which that exercise was done.
// Entries without a usable e1RM are kept (with estimatedOneRepMax null),
// because they still mark "the first session after a deload or a break".
function buildHistoryTimelines(database) {
  const finishedSessions = database.sessions
    .filter((session) => session.endedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const breakEndTimes = findBreakEndTimes(finishedSessions);
  const setGroups = groupSetsBySessionAndExercise(database.sets);
  const bodyweightEntries = database.bodyweightEntries
    .slice()
    .sort((a, b) => (a.loggedAt < b.loggedAt ? -1 : 1));
  const timelinesByKey = new Map();

  for (const session of finishedSessions) {
    const setsByExercise = setGroups.get(session.id) || new Map();
    for (const [exerciseId, sets] of setsByExercise) {
      const exercise = database.exercises.find((candidate) => candidate.id === exerciseId);
      const keyDescription = exercise ? describeHistoryKey(session, exercise) : null;
      if (keyDescription === null) {
        continue;
      }
      if (!timelinesByKey.has(keyDescription.key)) {
        timelinesByKey.set(keyDescription.key, { ...keyDescription, loggedReps: [], entries: [] });
      }
      const timeline = timelinesByKey.get(keyDescription.key);
      const entries = timeline.entries;
      const previousEntry = entries.length > 0 ? entries[entries.length - 1] : null;
      timeline.loggedReps.push(...sets.filter((set) => !set.isWarmup).map((set) => set.reps));
      entries.push({
        session,
        startedAt: session.startedAt,
        estimatedOneRepMax: findBestEstimatedOneRepMax(sets, exercise, findBodyweightForSession(bodyweightEntries, session)),
        category: categorizeSession(session),
        isDeload: wasDoneAsDeload(session, exerciseId),
        isFirstAfterDeload: previousEntry !== null && previousEntry.isDeload,
        isFirstAfterBreak: previousEntry !== null
          && wasBreakBetween(breakEndTimes, previousEntry.startedAt, session.startedAt)
      });
    }
  }
  const timelines = Array.from(timelinesByKey.values());
  for (const timeline of timelines) {
    timeline.pool = findNoisePool(database, timeline.templateId, timeline.originalExerciseId, timeline.loggedReps);
  }
  return timelines;
}


// ---------------------------------------------------------------------------
// Which sessions each part of the rule may use (design sections 2 and 6)
// ---------------------------------------------------------------------------

function isWindowEligible(entry) {
  return entry.estimatedOneRepMax !== null
    && entry.category !== "ill"
    && !entry.isDeload
    && !entry.isFirstAfterDeload
    && !entry.isFirstAfterBreak;
}

function isBaselineEligible(entry) {
  return isWindowEligible(entry) && entry.category === "normal";
}


// ---------------------------------------------------------------------------
// Noise (design section 4)
//
// How much one session's e1RM wobbles from the next when nothing real has
// changed. Measured from pairs of consecutive sessions of the same key: the
// spread of their changes, on a log scale so 2% means 2% for a light and a
// heavy lift alike. Dividing by √2 is because each change carries two
// sessions' worth of wobble.
// ---------------------------------------------------------------------------

function collectNoiseChanges(timelines) {
  const changes = [];
  for (const timeline of timelines) {
    const usableEntries = timeline.entries.filter(isWindowEligible);
    for (let index = 1; index < usableEntries.length; index++) {
      const earlier = usableEntries[index - 1];
      const later = usableEntries[index];
      if (daysBetween(earlier.startedAt, later.startedAt) > DROP_MAX_PAIR_GAP_DAYS) {
        continue;
      }
      const change = Math.log(later.estimatedOneRepMax / earlier.estimatedOneRepMax);
      changes.push(Math.max(-DROP_MAX_CHANGE, Math.min(DROP_MAX_CHANGE, change)));
    }
  }
  return changes;
}

function standardDeviationOf(values) {
  const average = averageOf(values);
  const sumOfSquares = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(sumOfSquares / (values.length - 1));
}

// Returns { pairCount, sigmaHat } for one pool's keys; sigmaHat is null
// until there are enough pairs to trust it. There's deliberately no default
// to fall back on: a guessed noise level would make the test look precise
// when it isn't.
function estimateNoise(timelines) {
  const changes = collectNoiseChanges(timelines);
  if (changes.length < DROP_MIN_NOISE_PAIRS) {
    return { pairCount: changes.length, sigmaHat: null };
  }
  return { pairCount: changes.length, sigmaHat: standardDeviationOf(changes) / Math.SQRT2 };
}

// One estimate per pool: high-rep slots are measured separately, so their
// extra wobble doesn't make the standard slots' test less sensitive.
function estimateNoiseByPool(timelines) {
  return {
    standard: estimateNoise(timelines.filter((timeline) => timeline.pool === "standard")),
    highRep: estimateNoise(timelines.filter((timeline) => timeline.pool === "highRep"))
  };
}


// ---------------------------------------------------------------------------
// Drop detection for one history key (design section 5)
// ---------------------------------------------------------------------------

// How far below the comparison point an average must fall to count. The
// square root is the standard error of the difference between two averages
// (one of `recentCount` sessions, one of 6), in units of sigmaHat.
function dropThresholdFactor(sigmaHat, recentCount) {
  return 1 - DROP_THRESHOLD_K * sigmaHat * Math.sqrt(1 / recentCount + 1 / DROP_BASELINE_SESSIONS);
}

// The baseline for a window: the 6 baseline-eligible entries just before
// the window's first entry, or null when there aren't 6 yet.
function findBaselineBefore(entries, windowStartEntry) {
  const earlierEntries = entries.filter(
    (entry) => entry.startedAt < windowStartEntry.startedAt && isBaselineEligible(entry)
  );
  if (earlierEntries.length < DROP_BASELINE_SESSIONS) {
    return null;
  }
  return earlierEntries.slice(-DROP_BASELINE_SESSIONS);
}

// Whether the window ending at `windowEntries[endIndex]` is low enough to
// flag, as { isFlagged, baselineAverage, windowAverage }, or null when
// there isn't enough history to judge yet.
function evaluateWindow(timeline, windowEntries, endIndex, sigmaHat) {
  if (endIndex < DROP_RECENT_WINDOW_SESSIONS - 1) {
    return null;
  }
  const window = windowEntries.slice(endIndex - DROP_RECENT_WINDOW_SESSIONS + 1, endIndex + 1);
  const baseline = findBaselineBefore(timeline.entries, window[0]);
  if (baseline === null) {
    return null;
  }
  const baselineAverage = averageOf(baseline.map((entry) => entry.estimatedOneRepMax));
  const windowAverage = averageOf(window.map((entry) => entry.estimatedOneRepMax));
  const limit = baselineAverage * dropThresholdFactor(sigmaHat, DROP_RECENT_WINDOW_SESSIONS);
  return { isFlagged: windowAverage < limit, baselineAverage, windowAverage };
}

// Whether the sessions after a flag confirm it, measured against the
// baseline frozen at the flag (so a falling baseline can't hide the drop).
function isDropPersisting(persistenceEntries, frozenBaseline, sigmaHat) {
  const persistenceAverage = averageOf(persistenceEntries.map((entry) => entry.estimatedOneRepMax));
  return persistenceAverage < frozenBaseline * dropThresholdFactor(sigmaHat, persistenceEntries.length);
}

// Walks one key's history from oldest to newest, the way the rule would
// have run session by session. Returns:
// - flaggedSessionIds: every session at which the window was low enough
//   to flag (the cross-slot route needs these)
// - events:            { type: "flagged" | "cleared" | "confirmed", at,
//                        frozenBaseline } in order
// - pendingFlag:       { at, frozenBaseline } if a flag is still waiting
//                      for its persistence sessions, otherwise null
// - isReady:           whether the newest window could be judged at all
function scanTimelineForDrops(timeline, sigmaHat) {
  const windowEntries = timeline.entries.filter(isWindowEligible);
  const flaggedSessionIds = new Set();
  const events = [];
  let pendingFlag = null;
  let isReady = false;

  windowEntries.forEach((entry, index) => {
    const evaluation = evaluateWindow(timeline, windowEntries, index, sigmaHat);
    isReady = evaluation !== null;
    if (evaluation !== null && evaluation.isFlagged) {
      flaggedSessionIds.add(entry.session.id);
    }

    if (pendingFlag !== null) {
      pendingFlag.persistenceEntries.push(entry);
      if (pendingFlag.persistenceEntries.length === DROP_PERSISTENCE_SESSIONS) {
        const isConfirmed = isDropPersisting(pendingFlag.persistenceEntries, pendingFlag.frozenBaseline, sigmaHat);
        events.push({ type: isConfirmed ? "confirmed" : "cleared", at: entry.startedAt, frozenBaseline: pendingFlag.frozenBaseline });
        pendingFlag = null;
      }
    }

    // Checked even on the session that just settled an earlier flag: that
    // session can start a new flag straight away, as in the design's
    // simulation, rather than being skipped.
    if (pendingFlag === null && evaluation !== null && evaluation.isFlagged) {
      pendingFlag = { at: entry.startedAt, frozenBaseline: evaluation.baselineAverage, persistenceEntries: [] };
      events.push({ type: "flagged", at: entry.startedAt, frozenBaseline: evaluation.baselineAverage });
    }
  });

  return {
    flaggedSessionIds,
    events,
    pendingFlag: pendingFlag === null ? null : { at: pendingFlag.at, frozenBaseline: pendingFlag.frozenBaseline },
    isReady
  };
}


// ---------------------------------------------------------------------------
// From keys to muscles (design sections 1 and 5)
// ---------------------------------------------------------------------------

// The cross-slot route: two different main slots of a muscle flagging
// within the muscle's last two sessions confirms a drop at once, without
// waiting for persistence. Returns the start times at which it happened.
function findCrossSlotConfirmations(scannedTimelines) {
  const flaggedSlotsBySessionId = new Map();
  const sessionsById = new Map();
  for (const { timeline, scan } of scannedTimelines) {
    for (const entry of timeline.entries) {
      sessionsById.set(entry.session.id, entry.session);
      if (!scan.flaggedSessionIds.has(entry.session.id)) {
        continue;
      }
      if (!flaggedSlotsBySessionId.has(entry.session.id)) {
        flaggedSlotsBySessionId.set(entry.session.id, new Set());
      }
      flaggedSlotsBySessionId.get(entry.session.id).add(timeline.slotId);
    }
  }

  const muscleSessions = Array.from(sessionsById.values())
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const confirmationTimes = [];
  for (let index = 1; index < muscleSessions.length; index++) {
    const flaggedSlots = new Set([
      ...(flaggedSlotsBySessionId.get(muscleSessions[index - 1].id) || []),
      ...(flaggedSlotsBySessionId.get(muscleSessions[index].id) || [])
    ]);
    if (flaggedSlots.size >= 2) {
      confirmationTimes.push(muscleSessions[index].startedAt);
    }
  }
  return confirmationTimes;
}

// What one history key is doing right now, for the status lines. Each
// case is spelled out so a muscle is never shown as watched when it isn't:
// - "noRecentData":    none of its last 3 sessions gave a usable e1RM
// - "collecting":      fewer usable sessions than the rule needs so far
// - "waitingForNoise": enough sessions, but its noise pool can't be
//                      measured yet
// - "watching":        the rule is running on it
function describeKeyStatus(timeline, scan, sigmaHat) {
  const usableSessions = timeline.entries.filter(isWindowEligible).length;
  const lastEntries = timeline.entries.slice(-DROP_RECENT_WINDOW_SESSIONS);
  if (lastEntries.every((entry) => entry.estimatedOneRepMax === null)) {
    return { status: "noRecentData", usableSessions };
  }
  if (sigmaHat === null) {
    const hasEnough = usableSessions >= DROP_SESSIONS_NEEDED;
    return { status: hasEnough ? "waitingForNoise" : "collecting", usableSessions };
  }
  return { status: scan.isReady ? "watching" : "collecting", usableSessions };
}

// Everything known about one muscle, for the readout. `timelines` are the
// muscle's own keys (those whose performed exercise mainly trains it, in
// one of its main slots). Each key is judged with its own pool's noise.
function analyzeMuscle(muscle, mainSlots, timelines, noiseByPool) {
  const result = {
    muscle,
    mainSlotCount: mainSlots.length,
    isDropTested: isMuscleDropTested(mainSlots),
    keys: [],
    pendingFlags: [],
    confirmations: []
  };
  if (!result.isDropTested) {
    return result;
  }

  const scannedTimelines = [];
  for (const timeline of timelines) {
    const sigmaHat = noiseByPool[timeline.pool].sigmaHat;
    const scan = sigmaHat === null ? null : scanTimelineForDrops(timeline, sigmaHat);
    result.keys.push({ timeline, ...describeKeyStatus(timeline, scan, sigmaHat) });
    if (scan === null) {
      continue;
    }
    scannedTimelines.push({ timeline, scan });
    if (scan.pendingFlag !== null) {
      result.pendingFlags.push({ timeline, ...scan.pendingFlag });
    }
    for (const event of scan.events.filter((candidate) => candidate.type === "confirmed")) {
      result.confirmations.push({ at: event.at, route: "persistence", timeline });
    }
  }
  // A main slot not trained yet has no timeline, but still belongs in the
  // status: it's collecting data from zero.
  for (const slot of mainSlots) {
    if (!timelines.some((timeline) => timeline.slotId === slot.slotId)) {
      result.keys.push({ timeline: null, slot, status: "collecting", usableSessions: 0 });
    }
  }
  for (const at of findCrossSlotConfirmations(scannedTimelines)) {
    result.confirmations.push({ at, route: "cross-slot", timeline: null });
  }
  result.confirmations.sort((a, b) => (a.at < b.at ? -1 : 1));
  return result;
}

// Muscles that some active workout mainly trains, but with no slot able to
// give a usable e1RM (e.g. only bodyweight pull-ups and no bodyweight
// logged). Listed so they aren't silently missing from the status.
function findMusclesWithoutMainSlots(activeTemplates, exercises, mainSlotsByMuscle) {
  const muscles = new Set();
  for (const template of activeTemplates) {
    for (const planned of template.plannedExercises) {
      const exercise = exercises.find((candidate) => candidate.id === planned.exerciseId);
      const muscle = exercise ? findMainMuscle(exercise) : null;
      if (muscle !== null && !mainSlotsByMuscle.has(muscle)) {
        muscles.add(muscle);
      }
    }
  }
  return Array.from(muscles);
}

// The whole picture: the noise estimate per pool, plus one analysis per
// muscle that an active workout template mainly trains.
function analyzeDropDetection(database) {
  const activeTemplates = database.workoutTemplates.filter((template) => !template.isArchived);
  const hasBodyweightLog = database.bodyweightEntries.length > 0;
  const mainSlotsByMuscle = findMainSlotsByMuscle(activeTemplates, database.exercises, hasBodyweightLog);
  const timelines = buildHistoryTimelines(database);
  const noiseByPool = estimateNoiseByPool(timelines);

  const muscles = [];
  for (const [muscle, mainSlots] of mainSlotsByMuscle) {
    const mainSlotIds = new Set(mainSlots.map((slot) => slot.slotId));
    const muscleTimelines = timelines.filter((timeline) => {
      const performedExercise = database.exercises.find((candidate) => candidate.id === timeline.performedExerciseId);
      return mainSlotIds.has(timeline.slotId) && findMainMuscle(performedExercise) === muscle;
    });
    muscles.push(analyzeMuscle(muscle, mainSlots, muscleTimelines, noiseByPool));
  }
  for (const muscle of findMusclesWithoutMainSlots(activeTemplates, database.exercises, mainSlotsByMuscle)) {
    muscles.push(analyzeMuscle(muscle, [], [], noiseByPool));
  }
  return { noiseByPool, muscles };
}
