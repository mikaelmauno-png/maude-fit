// ---------------------------------------------------------------------------
// Training recommendations: double progression.
//
// "Double progression" means progressing two things in turn. First the reps
// go up at a fixed weight, until every set reaches the top of the workout template's
// rep range. Then the weight goes up by the exercise's minimum raise, which
// drops the reps back towards the bottom of the range, and the cycle
// repeats.
//
// Everything here only *reads* the database and returns a suggestion. It
// never changes logged sets or workout templates; the app decides what to do with the
// suggestion (show it, pre-fill a stepper).
//
// Only template-based workouts get suggestions, because the rules need a
// target rep range and free-form workouts don't have one.
// ---------------------------------------------------------------------------


// Adding decimals in JavaScript can leave tiny errors (0.1 + 0.2 gives
// 0.30000000000000004), which would show up on screen as "80.30000001 kg".
// Rounding to two decimals removes them without affecting any real weight.
function roundLoad(load) {
  return Math.round(load * 100) / 100;
}


// Returns the most recent past sessions of one exercise, newest first, as
// a list of `{ session, workingSets }`. At most `sessionCount` are
// returned. The session itself comes along (not just its sets) so the app
// can tell *when* a suggestion's evidence is from; see isGoalOverride in
// app.js.
//
// Today's session is left out: the suggestion is about how to approach
// today, so it has to be based on what happened *before* today.
//
// For a gym-specific exercise (a machine or cable stack), only sessions at
// the same gym count, for the same reason as findMostRecentWorkingSet in
// app.js: 50 kg on one gym's machine isn't 50 kg on another's.
function findRecentSessions(database, exercise, activeSession, sessionCount) {
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
    .map((session) => ({ session, workingSets: workingSetsBySessionId.get(session.id) }));
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
function missedTwiceAtSameLoad(recentSessions, repsMin, repsMax) {
  if (recentSessions.length < 2) {
    return false;
  }
  const latestTopSets = findTopLoadSets(recentSessions[0].workingSets);
  const earlierTopSets = findTopLoadSets(recentSessions[1].workingSets);

  const sameLoad = latestTopSets[0].load === earlierTopSets[0].load;
  const earlierAlsoMissed = classifySessionOutcome(earlierTopSets, repsMin, repsMax) === "missedRange";
  return sameLoad && earlierAlsoMissed;
}


// Works out today's suggested load and reps for one planned exercise.
//
// Returns `{ load, reps, repsPerSet, reason, basedOnSessionStartedAt }`:
// - `repsPerSet` is a target for each set, in order (see targetRepsForSet
//   for sets beyond the end of the list), and `reps` is the lowest of them
// - `reason` is one short sentence for the screen
// - `basedOnSessionStartedAt` is the start time of the session the
//   suggestion was worked out from
// Returns null when there's no past data to base it on.
function suggestNextTarget(database, exerciseId, repsMin, repsMax, activeSession) {
  const exercise = database.exercises.find((candidate) => candidate.id === exerciseId);

  // Two sessions are needed at most: the latest, plus the one before it to
  // tell a single bad day apart from a real stall (missedTwiceAtSameLoad).
  const recentSessions = findRecentSessions(database, exercise, activeSession, 2);
  if (recentSessions.length === 0) {
    return null;
  }

  const suggestion = chooseSuggestion(recentSessions, exercise.minimumLoadIncrement, repsMin, repsMax);
  suggestion.basedOnSessionStartedAt = recentSessions[0].session.startedAt;
  return suggestion;
}


// Applies the double-progression rules to the latest session's results.
// Returns `{ load, reps, repsPerSet, reason }`.
function chooseSuggestion(recentSessions, increment, repsMin, repsMax) {
  // In the order they were done, so "set 3" in the targets means the
  // third set, same as on the workout card.
  const topLoadSets = findTopLoadSets(recentSessions[0].workingSets).sort((a, b) => a.order - b.order);
  const lastLoad = topLoadSets[0].load;
  const setCount = topLoadSets.length;
  const outcome = classifySessionOutcome(topLoadSets, repsMin, repsMax);

  if (outcome === "readyToProgress") {
    return buildUniformSuggestion(
      roundLoad(lastLoad + increment), repsMin, setCount,
      `All sets reached ${repsMax} reps last time, so add ${increment} kg.`
    );
  }

  if (outcome === "topOfRangeAtFailure") {
    return buildUniformSuggestion(
      lastLoad, repsMax, setCount,
      `Reached ${repsMax} reps but at RIR 0. Repeat ${lastLoad} kg before adding weight.`
    );
  }

  if (outcome === "missedRange") {
    if (missedTwiceAtSameLoad(recentSessions, repsMin, repsMax)) {
      return buildUniformSuggestion(
        Math.max(roundLoad(lastLoad - increment), 0), repsMin, setCount,
        `Fell short of ${repsMin} reps twice in a row, so drop ${increment} kg.`
      );
    }
    return buildUniformSuggestion(
      lastLoad, repsMin, setCount,
      `Fell short of ${repsMin} reps last time. Stay at ${lastLoad} kg.`
    );
  }

  return buildOneMoreRepSuggestion(topLoadSets, repsMax);
}

// The same rep target on every set: after a weight change, or when last
// time's reps aren't a useful starting point (a missed range).
function buildUniformSuggestion(load, reps, setCount, reason) {
  return { load, reps, repsPerSet: new Array(setCount).fill(reps), reason };
}

// "withinRange": keep the weight, repeat last time's reps set by set, and
// add one rep to the weakest set only. One rep at a time is a step that's
// actually achievable next session, and lifting the weakest set first
// evens the sets out before the strongest pulls further ahead:
// 8·7·6 → 8·7·7 → 8·8·7 → 8·8·8, and then the weight goes up.
function buildOneMoreRepSuggestion(topLoadSets, repsMax) {
  // A set that went past the top of the range still only needs the top
  // next time; the range is what decides when the weight goes up.
  const repsPerSet = topLoadSets.map((set) => Math.min(set.reps, repsMax));
  const fewestReps = Math.min(...repsPerSet);
  // indexOf finds the *first* set with the fewest reps, so with a tie the
  // earlier set goes first.
  const weakestSetIndex = repsPerSet.indexOf(fewestReps);
  repsPerSet[weakestSetIndex] = fewestReps + 1;

  const lastLoad = topLoadSets[0].load;
  return {
    load: lastLoad,
    reps: Math.min(...repsPerSet),
    repsPerSet,
    reason: `Stay at ${lastLoad} kg, one more rep on set ${weakestSetIndex + 1} than last time.`
  };
}


// The suggested reps for one set, counting from 0. A set beyond those done
// last time (the plan has more sets now, or it's an extra set) gets the
// lowest target, the safe choice for a set with nothing to compare to.
function targetRepsForSet(suggestion, setIndex) {
  if (setIndex < suggestion.repsPerSet.length) {
    return suggestion.repsPerSet[setIndex];
  }
  return suggestion.reps;
}
