// ---------------------------------------------------------------------------
// Training recommendations: double progression.
//
// "Double progression" means progressing two things in turn. First the reps
// go up at a fixed weight, until every set reaches the top of the workout template's
// rep range. Then the weight goes up by the exercise's minimum raise, which
// drops the reps back towards the bottom of the range, and the cycle
// repeats.
//
// Each planned exercise also has a target RIR (reps in reserve: how many
// more reps each set could have done). The logged RIR steers the steps:
// a session clearly easier than the target moves faster (more reps at
// once, or two weight steps), one harder than the target holds back. And
// before adding weight, the rules check the new weight still allows the
// bottom of the range, so a small exercise isn't given a jump too big for
// it (see canAddWeight).
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


// Lives here rather than in app.js because the suggestion reasons below
// need it too, and this file loads first; app.js uses it for every load
// it shows.
// How a load reads on screen. For a bodyweight exercise the stored load is
// only the weight added (see Exercise.isBodyweight in schema.js), so it's
// shown on top of "BW" — "10 kg" alone on a pull-up would read as if the
// whole pull-up weighed 10 kg.
function formatLoad(load, exercise) {
  if (exercise && exercise.isBodyweight) {
    return load === 0 ? "BW" : `BW + ${load} kg`;
  }
  return `${load} kg`;
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
//
// With `isScopedToWorkout`, only sessions of the same workout template
// count too. The same exercise is often trained differently in different
// workouts (3 × 1 heavy in one, 3 × 6 in another), so a volume day's
// results say nothing about how to approach the heavy day. When today's
// workout isn't known (free-form), there's nothing to scope to, and every
// session of the exercise counts.
//
// A session where this exercise was done as deload sets is left out too:
// those sets were easy on purpose, so judging progress on them would
// drop the weight after every deload.
function findRecentSessions(database, exercise, activeSession, sessionCount, isScopedToWorkout) {
  const scopeToGymId = exercise.isGymSpecific && activeSession && activeSession.gymId
    ? activeSession.gymId
    : null;
  const scopeToTemplateId = isScopedToWorkout && activeSession
    ? findWorkoutTemplateIdOf(activeSession, exercise.id)
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
    // wasDoneAsDeload is in deload.js, which loads after this file. That's
    // fine: it's only called once the app is running, by which time every
    // file has loaded.
    if (wasDoneAsDeload(session, exercise.id)) {
      return false;
    }
    if (scopeToGymId !== null && session.gymId !== scopeToGymId) {
      return false;
    }
    if (scopeToTemplateId !== null && findWorkoutTemplateIdOf(session, exercise.id) !== scopeToTemplateId) {
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


// Which workout template one exercise in a session was done for, or null
// when none (a free-form workout). Usually the session's own template. In
// a catch-up workout, each exercise was carried over from a template of
// its own (see Session.catchUpExercises in schema.js); an exercise done
// there as a replacement counts for the one it stood in for. Catch-up
// workouts saved before fromTemplateId existed give null.
function findWorkoutTemplateIdOf(session, exerciseId) {
  if (!session.catchUpExercises) {
    return session.templateId;
  }
  const replacement = session.replacedExercises.find(
    (candidate) => candidate.replacementExerciseId === exerciseId
  );
  const plannedExerciseId = replacement ? replacement.exerciseId : exerciseId;
  const catchUpEntry = session.catchUpExercises.find((planned) => planned.exerciseId === plannedExerciseId);
  return catchUpEntry && catchUpEntry.fromTemplateId ? catchUpEntry.fromTemplateId : null;
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


// RIR answers above this are counted as this. Reps-in-reserve guesses are
// fairly accurate close to failure (within about a rep) but get much
// vaguer further away, where people tend to underestimate what's left. A
// logged RIR of 6 is too uncertain to act on as "6", so the rules treat it
// as "4 or more".
const PROGRESSION_RIR_COUNTED_MAX = 4;

// A session this many reps in reserve away from the target (on average,
// above or below) counts as clearly off target, not just a normal day's
// wobble: one rep either way is within how accurately RIR can be guessed.
const PROGRESSION_CLEARLY_OFF_TARGET_RIR = 2;

// The most weight steps one suggestion adds at once, even after a session
// that was far too easy: a bigger jump rests on an estimate stretched too
// far to trust.
const PROGRESSION_MAX_INCREMENTS_AT_ONCE = 2;

// When a weight step is too big for an exercise (see canAddWeight), reps
// keep going up past the top of the range instead. Once they reach this
// many times the top, the weight goes up anyway: the strength estimate
// that decides is least accurate at high reps, so it shouldn't hold the
// weight back forever.
const PROGRESSION_REPS_PAST_TOP_FACTOR = 1.5;


// The RIR the rules act on for one set. A missing RIR (sets logged before
// it was asked) counts as 0, so a set with no answer is never treated as
// easy.
function countedRir(set) {
  if (typeof set.rir !== "number") {
    return 0;
  }
  return Math.min(set.rir, PROGRESSION_RIR_COUNTED_MAX);
}

// How far last session's heaviest sets were from the target RIR, on
// average: +2 means 2 more reps in reserve than planned (too easy), -1
// means 1 rep closer to failure than planned (too hard).
function findRirGap(topLoadSets, targetRir) {
  const totalRir = topLoadSets.reduce((sum, set) => sum + countedRir(set), 0);
  return totalRir / topLoadSets.length - targetRir;
}


// Sorts one session's top-load sets into one of three outcomes:
//
// - "missedRange":  at least one set fell short of the minimum reps
// - "reachedTop":   every set reached the maximum reps
// - "withinRange":  everything else: inside the range, room to add reps
//
// How hard the sets were (RIR) is judged separately, by findRirGap.
function classifySessionOutcome(topLoadSets, repsMin, repsMax) {
  if (topLoadSets.some((set) => set.reps < repsMin)) {
    return "missedRange";
  }
  if (topLoadSets.every((set) => set.reps >= repsMax)) {
    return "reachedTop";
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
// - `isDeload` is true when it's a deload workout's suggestion, which the
//   app treats as more important than a goal set by hand
// Returns null when there's no past data to base it on.
//
// `targetRir` is the planned exercise's target (see WorkoutTemplate in
// schema.js). `isDeload` says this exercise is done as deload sets today
// (see Session.deload in schema.js); the app works that out.
function suggestNextTarget(database, exerciseId, repsMin, repsMax, targetRir, activeSession, isDeload) {
  const exercise = database.exercises.find((candidate) => candidate.id === exerciseId);

  // Two sessions are needed at most: the latest, plus the one before it to
  // tell a single bad day apart from a real stall (missedTwiceAtSameLoad).
  // Only this workout's own sessions: with none yet, there's no
  // suggestion, and the steppers start from the workout's planned load.
  const recentSessions = findRecentSessions(database, exercise, activeSession, 2, true);
  if (recentSessions.length === 0) {
    return null;
  }

  if (isDeload) {
    const deloadSuggestion = buildDeloadSuggestion(recentSessions[0], repsMin, repsMax, exercise);
    deloadSuggestion.basedOnSessionStartedAt = recentSessions[0].session.startedAt;
    return deloadSuggestion;
  }

  const rules = {
    increment: exercise.minimumLoadIncrement,
    repsMin,
    repsMax,
    targetRir,
    maxLoad: findMachineMaxLoad(database, exercise, activeSession),
    exercise,
    bodyweightKg: findLatestBodyweightKg(database)
  };
  const suggestion = chooseSuggestion(recentSessions, rules);
  suggestion.basedOnSessionStartedAt = recentSessions[0].session.startedAt;
  return suggestion;
}


// The heaviest today's gym's machine goes for this exercise (see
// Gym.machineMaxLoads in schema.js), or null when there's no known limit.
// Only a gym-specific exercise has one: a barbell has no top.
function findMachineMaxLoad(database, exercise, activeSession) {
  if (!exercise.isGymSpecific || !activeSession || !activeSession.gymId) {
    return null;
  }
  const gym = database.gyms.find((candidate) => candidate.id === activeSession.gymId);
  const maxLoad = gym ? gym.machineMaxLoads[exercise.id] : undefined;
  return typeof maxLoad === "number" ? maxLoad : null;
}

// The most recent weigh-in, or null with none. Today's suggestion is
// about today, so the latest weight is the right one (the drop test, which
// looks back at old sessions, uses each session's own date instead).
function findLatestBodyweightKg(database) {
  let latest = null;
  for (const entry of database.bodyweightEntries) {
    if (latest === null || entry.loggedAt > latest.loggedAt) {
      latest = entry;
    }
  }
  return latest === null ? null : latest.weightKg;
}


// ---------------------------------------------------------------------------
// Will a heavier weight still fit the rep range?
//
// Before adding weight, the rules check that the bottom of the range is
// still reachable at the target RIR with it. That's what stops a 2.5 kg
// step on a 10 kg lateral raise (25% heavier): last session's sets give a
// strength estimate, and the estimate says how many reps the new weight
// would allow.
// ---------------------------------------------------------------------------

// The weight a set actually moved: for a bodyweight exercise the stored
// load is only what's added (see Exercise.isBodyweight in schema.js), so
// the lifter's own weight goes on top. Null when that weight isn't known.
function findTotalLoad(load, exercise, bodyweightKg) {
  if (!exercise.isBodyweight) {
    return load;
  }
  return bodyweightKg === null ? null : load + bodyweightKg;
}

// Epley's estimate of a one-rep max from a set taken `repsToFailure` reps
// from failure (reps done plus reps in reserve). The drop test in
// deload.js uses the same formula.
function epleyOneRepMax(totalLoad, repsToFailure) {
  return totalLoad * (1 + repsToFailure / 30);
}

// Epley turned around: how many reps to failure a weight allows, for a
// given one-rep max.
function repsToFailureAt(totalLoad, oneRepMax) {
  return 30 * (oneRepMax / totalLoad - 1);
}

// Last session's strength, as the average estimate over its heaviest sets.
// Uses the counted RIR, so a guessed RIR of 6 can't inflate it.
function estimateSessionOneRepMax(topLoadSets, totalLoad) {
  const estimates = topLoadSets.map((set) => epleyOneRepMax(totalLoad, set.reps + countedRir(set)));
  return estimates.reduce((sum, estimate) => sum + estimate, 0) / estimates.length;
}

// True when `newLoad` still allows the bottom of the rep range at the
// target RIR. When the lifter's total weight isn't known (a bodyweight
// exercise with no weigh-in), there's nothing to estimate from, so the
// plain double-progression step is allowed.
function canAddWeight(topLoadSets, newLoad, rules) {
  const lastTotal = findTotalLoad(topLoadSets[0].load, rules.exercise, rules.bodyweightKg);
  const newTotal = findTotalLoad(newLoad, rules.exercise, rules.bodyweightKg);
  if (lastTotal === null || newTotal === null || newTotal <= 0) {
    return true;
  }
  const oneRepMax = estimateSessionOneRepMax(topLoadSets, lastTotal);
  return repsToFailureAt(newTotal, oneRepMax) - rules.targetRir >= rules.repsMin;
}


// ---------------------------------------------------------------------------
// Choosing the suggestion
// ---------------------------------------------------------------------------

// Applies the double-progression rules to the latest session's results.
// Returns `{ load, reps, repsPerSet, reason }`. `rules` holds the planned
// exercise's targets and limits (see suggestNextTarget); `maxLoad` in it
// is the machine's heaviest weight, or null for no limit.
function chooseSuggestion(recentSessions, rules) {
  // In the order they were done, so "set 3" in the targets means the
  // third set, same as on the workout card.
  const topLoadSets = findTopLoadSets(recentSessions[0].workingSets).sort((a, b) => a.order - b.order);
  const outcome = classifySessionOutcome(topLoadSets, rules.repsMin, rules.repsMax);
  const rirGap = findRirGap(topLoadSets, rules.targetRir);

  if (outcome === "missedRange") {
    return chooseAfterMissedRange(recentSessions, topLoadSets, rules);
  }
  if (rules.maxLoad !== null && topLoadSets[0].load >= rules.maxLoad) {
    return chooseAtMachineMax(topLoadSets, rirGap, rules);
  }
  if (outcome === "reachedTop") {
    return chooseAfterReachingTop(topLoadSets, rirGap, rules);
  }
  return chooseWithinRange(topLoadSets, rirGap, rules);
}

// Fell short of the bottom of the range: stay, and only drop the weight
// when it happens twice in a row at the same load.
function chooseAfterMissedRange(recentSessions, topLoadSets, rules) {
  const lastLoad = topLoadSets[0].load;
  if (missedTwiceAtSameLoad(recentSessions, rules.repsMin, rules.repsMax)) {
    return buildUniformSuggestion(
      Math.max(roundLoad(lastLoad - rules.increment), 0), rules.repsMin, topLoadSets.length,
      `Fell short of ${rules.repsMin} reps twice in a row, so drop ${rules.increment} kg.`
    );
  }
  return buildUniformSuggestion(
    lastLoad, rules.repsMin, topLoadSets.length,
    `Fell short of ${rules.repsMin} reps last time. Stay at ${formatLoad(lastLoad, rules.exercise)}.`
  );
}

// Already at the machine's heaviest weight, more weight isn't an option,
// so reps keep climbing past the range instead — unless last time was
// harder than the target, in which case those reps are repeated first.
function chooseAtMachineMax(topLoadSets, rirGap, rules) {
  const lastLoad = topLoadSets[0].load;
  if (rirGap < 0) {
    return {
      load: lastLoad,
      reps: Math.min(...topLoadSets.map((set) => set.reps)),
      repsPerSet: topLoadSets.map((set) => set.reps),
      reason: `${lastLoad} kg is this machine's heaviest. Last time was past your target RIR ${rules.targetRir}, so repeat those reps.`
    };
  }
  return buildRepsOnlySuggestion(
    topLoadSets,
    `${lastLoad} kg is this machine's heaviest, so add a rep instead`
  );
}

// Every set reached the top of the range. If that took more effort than
// the target, repeat it until it doesn't. Otherwise add weight: two steps
// after a session that was far too easy, one normally, and none (reps
// instead) when even one step is too big a jump for this exercise.
function chooseAfterReachingTop(topLoadSets, rirGap, rules) {
  const lastLoad = topLoadSets[0].load;
  const setCount = topLoadSets.length;

  if (rirGap < 0) {
    return buildUniformSuggestion(
      lastLoad, rules.repsMax, setCount,
      `Reached ${rules.repsMax} reps, but closer to failure than your target RIR ${rules.targetRir}. ` +
      `Repeat ${formatLoad(lastLoad, rules.exercise)} before adding weight.`
    );
  }

  // One step short of the machine's max: go up to it, rather than past it
  // to a weight the machine doesn't have.
  if (rules.maxLoad !== null && lastLoad + rules.increment > rules.maxLoad) {
    return buildUniformSuggestion(
      rules.maxLoad, rules.repsMin, setCount,
      `All sets reached ${rules.repsMax} reps last time, so go up to ${rules.maxLoad} kg, this machine's heaviest.`
    );
  }

  const isFarTooEasy = rirGap >= PROGRESSION_CLEARLY_OFF_TARGET_RIR;
  const doubleStepLoad = roundLoad(lastLoad + PROGRESSION_MAX_INCREMENTS_AT_ONCE * rules.increment);
  const isDoubleStepAllowed = rules.maxLoad === null || doubleStepLoad <= rules.maxLoad;
  if (isFarTooEasy && isDoubleStepAllowed && canAddWeight(topLoadSets, doubleStepLoad, rules)) {
    return buildUniformSuggestion(
      doubleStepLoad, rules.repsMin, setCount,
      `All sets reached ${rules.repsMax} reps with reps to spare (target RIR ${rules.targetRir}), ` +
      `so add ${roundLoad(PROGRESSION_MAX_INCREMENTS_AT_ONCE * rules.increment)} kg.`
    );
  }

  const singleStepLoad = roundLoad(lastLoad + rules.increment);
  const fewestReps = Math.min(...topLoadSets.map((set) => set.reps));
  const hasRepsHitTheirCap = fewestReps >= Math.ceil(PROGRESSION_REPS_PAST_TOP_FACTOR * rules.repsMax);
  if (canAddWeight(topLoadSets, singleStepLoad, rules) || hasRepsHitTheirCap) {
    return buildUniformSuggestion(
      singleStepLoad, rules.repsMin, setCount,
      `All sets reached ${rules.repsMax} reps last time, so add ${rules.increment} kg.`
    );
  }

  return buildRepsOnlySuggestion(
    topLoadSets,
    `${rules.increment} kg more would be too big a jump to still get ${rules.repsMin} reps, so add a rep instead`
  );
}

// Inside the range. Normally one more rep on the weakest set. After a
// session clearly easier than the target, every set jumps towards the
// reps that would have hit the target; after one clearly harder, the same
// reps are repeated.
function chooseWithinRange(topLoadSets, rirGap, rules) {
  const lastLoad = topLoadSets[0].load;
  if (rirGap >= PROGRESSION_CLEARLY_OFF_TARGET_RIR) {
    return buildRepsToTargetSuggestion(topLoadSets, rules);
  }
  if (rirGap <= -PROGRESSION_CLEARLY_OFF_TARGET_RIR) {
    const repsPerSet = topLoadSets.map((set) => set.reps);
    return {
      load: lastLoad,
      reps: Math.min(...repsPerSet),
      repsPerSet,
      reason: `Last time was closer to failure than your target RIR ${rules.targetRir}. ` +
        `Repeat ${formatLoad(lastLoad, rules.exercise)} with the same reps.`
    };
  }
  return buildOneMoreRepSuggestion(topLoadSets, rules.repsMax, rules.exercise);
}

// Each set's reps raised by the reps it had to spare beyond the target
// ("8 reps at RIR 4, target 2" → 10), up to the top of the range, and
// always at least one rep more somewhere.
function buildRepsToTargetSuggestion(topLoadSets, rules) {
  const repsPerSet = topLoadSets.map((set) =>
    Math.min(set.reps + Math.max(countedRir(set) - rules.targetRir, 0), rules.repsMax)
  );
  const hasAnySetGoneUp = repsPerSet.some((reps, index) => reps > topLoadSets[index].reps);
  if (!hasAnySetGoneUp) {
    return buildOneMoreRepSuggestion(topLoadSets, rules.repsMax, rules.exercise);
  }
  const lastLoad = topLoadSets[0].load;
  return {
    load: lastLoad,
    reps: Math.min(...repsPerSet),
    repsPerSet,
    reason: `Stay at ${formatLoad(lastLoad, rules.exercise)}. Last time had reps to spare ` +
      `(target RIR ${rules.targetRir}), so more reps on each set.`
  };
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
function buildOneMoreRepSuggestion(topLoadSets, repsMax, exercise) {
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
    reason: `Stay at ${formatLoad(lastLoad, exercise)}, one more rep on set ${weakestSetIndex + 1} than last time.`
  };
}


// Same as buildOneMoreRepSuggestion, but with no top of the range: for
// when more weight isn't an option (the machine's heaviest) or would be
// too big a jump. Reps past the range are the way left to make the weight
// harder. `reasonStart` says why; the rest of the sentence is added here.
function buildRepsOnlySuggestion(topLoadSets, reasonStart) {
  const repsPerSet = topLoadSets.map((set) => set.reps);
  const fewestReps = Math.min(...repsPerSet);
  const weakestSetIndex = repsPerSet.indexOf(fewestReps);
  repsPerSet[weakestSetIndex] = fewestReps + 1;

  const lastLoad = topLoadSets[0].load;
  return {
    load: lastLoad,
    reps: Math.min(...repsPerSet),
    repsPerSet,
    reason: `${reasonStart}: one more on set ${weakestSetIndex + 1}.`
  };
}


// At or below this top of the rep range, a deload also lowers the weight.
// In a 1–3 rep slot, "same weight, bottom of the range" would be a single
// at the weight normally done for 2–3: still close to a max effort, so
// it wouldn't make the workout any lighter.
const DELOAD_LOW_REP_RANGE_MAX = 3;

// How many of the exercise's minimum raises a low-rep deload takes off.
// Two is clearly lighter without being so light the lift feels new: about
// 5 kg on a barbell, 10 kg on a machine with 5 kg plates.
const DELOAD_LOW_REP_LOAD_STEPS_DOWN = 2;

// A deload workout's targets: the weight of the last normal session (its
// heaviest sets), with every set at the bottom of the rep range, so the
// sets stop 1–2 reps further from failure than usual. Deload sessions
// never count as "last normal session": findRecentSessions leaves them
// out. For a bodyweight exercise the load is only the weight added, so
// it's only that which comes down, and never below none.
function buildDeloadSuggestion(lastNormalSession, repsMin, repsMax, exercise) {
  const topLoadSets = findTopLoadSets(lastNormalSession.workingSets);
  const lastLoad = topLoadSets[0].load;
  const setCount = topLoadSets.length;

  if (repsMax <= DELOAD_LOW_REP_RANGE_MAX) {
    const loadDrop = DELOAD_LOW_REP_LOAD_STEPS_DOWN * exercise.minimumLoadIncrement;
    const lighterLoad = Math.max(roundLoad(lastLoad - loadDrop), 0);
    const suggestion = buildUniformSuggestion(
      lighterLoad, repsMin, setCount,
      `Deload: ${formatLoad(lastLoad, exercise)} minus ${loadDrop} kg, ${repsMin} ${repsMin === 1 ? "rep" : "reps"} a set.`
    );
    suggestion.isDeload = true;
    return suggestion;
  }

  const suggestion = buildUniformSuggestion(
    lastLoad, repsMin, setCount,
    `Deload: same weight as last time, ${repsMin} reps a set, stop 1–2 reps further from failure.`
  );
  suggestion.isDeload = true;
  return suggestion;
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
