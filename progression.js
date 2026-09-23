// ---------------------------------------------------------------------------
// Training recommendations: double progression.
//
// "Double progression" means progressing two things in turn. First the reps
// go up at a fixed weight, until every set reaches the top of the scheme's
// rep range. Then the weight goes up by the exercise's minimum raise, which
// drops the reps back towards the bottom of the range, and the cycle
// repeats.
//
// Everything here only *reads* the database and returns a suggestion. It
// never changes logged sets or schemes; the app decides what to do with the
// suggestion (show it, pre-fill a stepper).
//
// Only scheme-based workouts get suggestions, because the rules need a
// target rep range and free-form workouts don't have one.
// ---------------------------------------------------------------------------


// Adding decimals in JavaScript can leave tiny errors (0.1 + 0.2 gives
// 0.30000000000000004), which would show up on screen as "80.30000001 kg".
// Rounding to two decimals removes them without affecting any real weight.
function roundLoad(load) {
  return Math.round(load * 100) / 100;
}


// Returns the working sets of one exercise from the most recent past
// sessions, newest session first, as a list of lists (one inner list per
// session). At most `sessionCount` sessions are returned.
//
// Today's session is left out: the suggestion is about how to approach
// today, so it has to be based on what happened *before* today.
//
// For a gym-specific exercise (a machine or cable stack), only sessions at
// the same gym count, for the same reason as findPreviousWorkingSet in
// app.js: 50 kg on one gym's machine isn't 50 kg on another's.
function findRecentSessionSets(database, exercise, activeSession, sessionCount) {
  const scopeToGymId = exercise.isGymSpecific && activeSession && activeSession.gymId
    ? activeSession.gymId
    : null;

  // Grouping the sets by session first means the sets list is scanned only
  // once, rather than once per session. That matters after a few years of
  // logging, since this runs every time the workout cards are redrawn.
  const workingSetsBySessionId = new Map();
  for (const set of database.sets) {
    if (set.exerciseId !== exercise.id || set.isWarmup) {
      continue;
    }
    if (!workingSetsBySessionId.has(set.sessionId)) {
      workingSetsBySessionId.set(set.sessionId, []);
    }
    workingSetsBySessionId.get(set.sessionId).push(set);
  }

  const eligibleSessions = database.sessions.filter((session) => {
    if (!workingSetsBySessionId.has(session.id)) {
      return false;
    }
    if (activeSession && session.id === activeSession.id) {
      return false;
    }
    if (scopeToGymId !== null && session.gymId !== scopeToGymId) {
      return false;
    }
    return true;
  });

  // ISO 8601 date strings sort correctly as plain text, so comparing them
  // directly puts the newest session first.
  eligibleSessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

  return eligibleSessions
    .slice(0, sessionCount)
    .map((session) => workingSetsBySessionId.get(session.id));
}


// Returns only the sets done at the heaviest load in one session.
//
// A session can mix loads, for example a heavy top set followed by lighter
// back-off sets. Judging progress on the heaviest sets avoids an easy
// back-off set making a hard session look like it went better than it did.
function findTopLoadSets(workingSets) {
  const topLoad = Math.max(...workingSets.map((set) => set.load));
  return workingSets.filter((set) => set.load === topLoad);
}


// Sorts one session's top-load sets into one of four outcomes:
//
// - "missedRange":         at least one set fell short of the minimum reps
// - "readyToProgress":     every set reached the maximum reps, with at least
//                          1 rep in reserve
// - "topOfRangeAtFailure": every set reached the maximum reps, but at least
//                          one needed everything (RIR 0), so the weight isn't
//                          mastered yet
// - "withinRange":         everything else: inside the range, room to add reps
function classifySessionOutcome(topLoadSets, repsMin, repsMax) {
  if (topLoadSets.some((set) => set.reps < repsMin)) {
    return "missedRange";
  }

  const everySetReachedTop = topLoadSets.every((set) => set.reps >= repsMax);
  if (everySetReachedTop) {
    // `set.rir >= 1` is false for a missing (null) RIR too, so a set with
    // no RIR recorded is treated cautiously rather than as easy.
    const everySetHadRepsInReserve = topLoadSets.every((set) => set.rir >= 1);
    return everySetHadRepsInReserve ? "readyToProgress" : "topOfRangeAtFailure";
  }

  return "withinRange";
}


// True when the session before the last one was *also* a miss at the same
// weight. One bad day happens (poor sleep, a rushed session); two in a row
// at the same load suggests the weight really is too heavy for now.
function missedTwiceAtSameLoad(recentSessionSets, repsMin, repsMax) {
  if (recentSessionSets.length < 2) {
    return false;
  }
  const latestTopSets = findTopLoadSets(recentSessionSets[0]);
  const earlierTopSets = findTopLoadSets(recentSessionSets[1]);

  const sameLoad = latestTopSets[0].load === earlierTopSets[0].load;
  const earlierAlsoMissed = classifySessionOutcome(earlierTopSets, repsMin, repsMax) === "missedRange";
  return sameLoad && earlierAlsoMissed;
}


// Works out today's suggested load and reps for one planned exercise.
//
// Returns `{ load, reps, reason }`, where `reason` is one short sentence
// for the screen, or null when there's no past data to base it on.
function suggestNextTarget(database, exerciseId, repsMin, repsMax, activeSession) {
  const exercise = database.exercises.find((candidate) => candidate.id === exerciseId);

  // Two sessions are needed at most: the latest, plus the one before it to
  // tell a single bad day apart from a real stall (missedTwiceAtSameLoad).
  const recentSessionSets = findRecentSessionSets(database, exercise, activeSession, 2);
  if (recentSessionSets.length === 0) {
    return null;
  }

  const topLoadSets = findTopLoadSets(recentSessionSets[0]);
  const lastLoad = topLoadSets[0].load;
  const increment = exercise.minimumLoadIncrement;
  const outcome = classifySessionOutcome(topLoadSets, repsMin, repsMax);

  if (outcome === "readyToProgress") {
    return {
      load: roundLoad(lastLoad + increment),
      reps: repsMin,
      reason: `All sets reached ${repsMax} reps last time, so add ${increment} kg.`
    };
  }

  if (outcome === "topOfRangeAtFailure") {
    return {
      load: lastLoad,
      reps: repsMax,
      reason: `Reached ${repsMax} reps but at RIR 0. Repeat ${lastLoad} kg before adding weight.`
    };
  }

  if (outcome === "missedRange") {
    if (missedTwiceAtSameLoad(recentSessionSets, repsMin, repsMax)) {
      return {
        load: Math.max(roundLoad(lastLoad - increment), 0),
        reps: repsMin,
        reason: `Fell short of ${repsMin} reps twice in a row, so drop ${increment} kg.`
      };
    }
    return {
      load: lastLoad,
      reps: repsMin,
      reason: `Fell short of ${repsMin} reps last time. Stay at ${lastLoad} kg.`
    };
  }

  // "withinRange": keep the weight and aim for one more rep than the
  // weakest set managed, so every set creeps towards the top of the range.
  const fewestReps = Math.min(...topLoadSets.map((set) => set.reps));
  const targetReps = Math.min(fewestReps + 1, repsMax);
  return {
    load: lastLoad,
    reps: targetReps,
    reason: `Stay at ${lastLoad} kg and aim for ${targetReps} reps on every set.`
  };
}
