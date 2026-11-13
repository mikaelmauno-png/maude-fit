// ---------------------------------------------------------------------------
// Workout screen: the home screen's workout tiles, starting and ending a
// workout, logging sets, the rest timer and workout clock, readiness, changing
// exercises mid-workout, the catch-up workout, and unfinished workouts.
//
// The app's code is split over several files only to keep each one readable.
// They're plain <script> files, not modules, so they all share one global
// scope: a function in one file can call a function in any other. The one
// catch is order. Code that runs straight away while a file loads (an
// addEventListener line, say) can only use what earlier files, or this one,
// have defined. index.html loads them in this order:
// app.js, workout.js, library.js, history.js, stats.js, home-cards.js,
// settings.js.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Exercise list (main screen)
// ---------------------------------------------------------------------------

const exerciseListElement = document.getElementById("exerciseList");
const templateWorkoutCardsElement = document.getElementById("templateWorkoutCards");

// Redraws whichever exercise area applies right now: the full free-form
// library when there's no active workout template, or a card per planned exercise
// (each holding one pill per target set) when there is one.
function renderExerciseArea() {
  const template = getActiveTemplate();
  if (template) {
    exerciseListElement.hidden = true;
    templateWorkoutCardsElement.hidden = false;
    renderTemplateWorkoutCards(template);
  } else {
    exerciseListElement.hidden = false;
    templateWorkoutCardsElement.hidden = true;
    renderFreeformExerciseList();
  }
  // Redrawing the cards throws away the old ones, and an open set panel
  // sitting inside one of them goes with it, so put it back under the
  // freshly drawn pills.
  if (!setEntryPanel.hidden) {
    positionSetEntryPanel();
  }
}

function renderFreeformExerciseList() {
  exerciseListElement.innerHTML = "";

  // Archived exercises stay in the data (old sets/workout templates still reference
  // them) but shouldn't be offered for new logging.
  for (const exercise of appState.database.exercises.filter((candidate) => !candidate.isArchived)) {
    const itemElement = document.createElement("li");
    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "exercise-item";
    buttonElement.textContent = exercise.name;
    // Tapping an exercise only makes sense mid-workout; logging a set needs
    // a session to attach it to.
    buttonElement.disabled = appState.activeSessionId === null;
    buttonElement.addEventListener("click", () => {
      openSetEntryPanel(exercise.id);
    });
    // Marks where the set panel opens for this exercise (see
    // findSetEntryPanelAnchor).
    buttonElement.dataset.setPanelAnchor = exercise.id;
    itemElement.appendChild(buttonElement);

    const loggedCount = appState.database.sets.filter(
      (set) => set.sessionId === appState.activeSessionId && set.exerciseId === exercise.id
    ).length;
    // Only shown once there's something to review, so a fresh exercise row
    // stays a single fast tap-to-log button, same as before this existed.
    if (loggedCount > 0) {
      const reviewButton = document.createElement("button");
      reviewButton.type = "button";
      reviewButton.className = "card-action-button";
      reviewButton.textContent = `${loggedCount} set${loggedCount === 1 ? "" : "s"} logged · review`;
      reviewButton.addEventListener("click", () => openFreeformReview(exercise.id));
      itemElement.appendChild(reviewButton);
    }

    exerciseListElement.appendChild(itemElement);
  }
}

const freeformReviewCardElement = document.getElementById("freeformReviewCard");

function openFreeformReview(exerciseId) {
  appState.freeformReviewExerciseId = exerciseId;
  renderFreeformReview();
  freeformReviewCardElement.hidden = false;
}

function closeFreeformReview() {
  appState.freeformReviewExerciseId = null;
  freeformReviewCardElement.hidden = true;
}

function renderFreeformReview() {
  freeformReviewCardElement.innerHTML = "";
  if (appState.freeformReviewExerciseId === null) {
    return;
  }

  const exerciseId = appState.freeformReviewExerciseId;
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const loggedSets = appState.database.sets
    .filter((set) => set.sessionId === appState.activeSessionId && set.exerciseId === exerciseId)
    .sort((a, b) => a.order - b.order);

  // The exercise's sets could all have been deleted while this was open;
  // closing rather than showing an empty card avoids a confusing dead end.
  if (loggedSets.length === 0) {
    closeFreeformReview();
    return;
  }

  const cardElement = document.createElement("div");
  cardElement.className = "exercise-card";

  const headingElement = document.createElement("h3");
  headingElement.textContent = exercise.name;
  cardElement.appendChild(headingElement);

  const pillRowElement = document.createElement("div");
  pillRowElement.className = "set-pills";
  for (const set of loggedSets) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "set-pill set-pill-done";

    const weightSpan = document.createElement("span");
    weightSpan.className = "set-pill-weight";
    weightSpan.textContent = formatLoad(set.load, exercise);

    const repsSpan = document.createElement("span");
    repsSpan.className = "set-pill-reps";
    repsSpan.textContent = set.isWarmup ? `${set.reps} (warmup)` : `${set.reps} reps`;

    pill.append(weightSpan, repsSpan);
    pill.addEventListener("click", () => openSetEntryPanelForEdit(set.id));
    pillRowElement.appendChild(pill);
  }
  cardElement.appendChild(pillRowElement);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "card-action-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", closeFreeformReview);
  cardElement.appendChild(closeButton);

  freeformReviewCardElement.appendChild(cardElement);
}

// Builds one "pill" button for a single set: weight on top, reps below (the
// done vs. pending look and the reps text are the only real difference
// between an already-logged set and one still waiting to be done).
// `suggestion` is today's progression suggestion for this exercise (see
// progression.js), or null. When there is one, a not-yet-logged pill shows
// the suggested load instead of the workout template's fixed target load
// (with a goal set by hand, that's the goal's weight; see
// getSuggestionForPlanned).
// `setIndex` is this pill's position on the card, counting from 0, which
// picks that set's own rep target out of the suggestion.
function buildSetPill(loggedSet, planned, suggestion, setIndex) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = loggedSet ? "set-pill set-pill-done" : "set-pill set-pill-pending";

  const weightSpan = document.createElement("span");
  weightSpan.className = "set-pill-weight";
  const pendingLoad = suggestion ? suggestion.load : planned.targetLoad;
  weightSpan.textContent = formatLoad(loggedSet ? loggedSet.load : pendingLoad, findExerciseById(planned.exerciseId));

  // This set's own target from the suggestion ("7"), or the template's rep
  // range ("6-8") when there's no suggestion to follow.
  const repsSpan = document.createElement("span");
  repsSpan.className = "set-pill-reps";
  const repTarget = suggestion
    ?`${targetRepsForSet(suggestion, setIndex)}`
    : formatRepRange(planned.targetRepsMin, planned.targetRepsMax);
  repsSpan.textContent = loggedSet ? `${loggedSet.reps}/${repTarget}` : repTarget;

  pill.append(weightSpan, repsSpan);

  if (loggedSet) {
    // A plain tap is the fast correction path — knock the reps down by one
    // in place, no panel — and a long-press is the way to reach everything
    // else (load, RIR, warmup), so the two don't fight over what a tap
    // means on an already-logged pill.
    attachPillTapHandlers(
      pill,
      () => decrementLoggedSetReps(loggedSet.id),
      () => openSetEntryPanelForEdit(loggedSet.id)
    );
  } else {
    pill.addEventListener("click", () => {
      openSetEntryPanel(planned.exerciseId, {
        load: planned.targetLoad,
        repsMin: planned.targetRepsMin,
        repsMax: planned.targetRepsMax,
        targetRir: planned.targetRir,
        suggestion,
        setIndex
      });
    });
  }

  return pill;
}

// Calls `onTap` for a plain tap, `onLongPress` once the press has been held
// for LONG_PRESS_MS. Used instead of two separate buttons so a logged set
// pill can do double duty: tap to quickly correct reps, long-press to reach
// the full editor — see buildSetPill above.
const LONG_PRESS_MS = 500;

function attachPillTapHandlers(pill, onTap, onLongPress) {
  let pressTimer = null;
  let longPressFired = false;

  function cancelPress() {
    clearTimeout(pressTimer);
  }

  pill.addEventListener("pointerdown", () => {
    longPressFired = false;
    pressTimer = setTimeout(() => {
      longPressFired = true;
      onLongPress();
    }, LONG_PRESS_MS);
  });

  pill.addEventListener("pointerup", () => {
    cancelPress();
    if (!longPressFired) {
      onTap();
    }
  });

  // A finger sliding off the pill (scrolling, or just an inaccurate thumb)
  // shouldn't count as either a tap or a long-press.
  pill.addEventListener("pointerleave", cancelPress);
  pill.addEventListener("pointercancel", cancelPress);
}

// A plain tap's fast correction path for an already-logged set: one rep
// fewer, in place. Tapping past 1 rep removes the set entirely instead of
// going to 0 or negative — back to a pending pill — so over-tapping is a
// quick undo rather than a dead end. Never worth checking for a personal
// best here: removing reps can only make the set less impressive, never
// more.
function decrementLoggedSetReps(setId) {
  const set = appState.database.sets.find((candidate) => candidate.id === setId);
  if (set.reps <= 1) {
    appState.database.sets = appState.database.sets.filter((candidate) => candidate.id !== setId);
  } else {
    set.reps -= 1;
  }
  saveDatabase(appState.database);
  renderExerciseArea();
}

// Today's progression suggestion for one planned exercise in the active
// workout template, or null when the exercise has no past sessions to go on.
// While a goal set by hand applies (isGoalOverride), it's the suggestion
// at the goal's weight: the goal picks the weight, the rules still pick
// the reps (see suggestAtGoalLoad in progression.js).
function getSuggestionForPlanned(planned) {
  const session = getActiveSession();
  const suggestion = suggestNextTarget(
    appState.database, planned.exerciseId, planned.targetRepsMin, planned.targetRepsMax, planned.targetRir, session,
    isDeloadExerciseInSession(session, planned.exerciseId)
  );
  if (!isGoalOverride(planned, suggestion)) {
    return suggestion;
  }
  return suggestAtGoalLoad(
    appState.database, suggestion, planned.targetLoad, planned.targetRepsMin, planned.targetRepsMax,
    planned.targetRir, session, planned.exerciseId
  );
}

// True when a goal set by hand ("Set goal for next time") should be used
// instead of the progression suggestion's weight.
//
// The rule: a goal wins if it was set *after* the session the suggestion
// is based on, because then it's a deliberate decision made with that
// session's results already known. Once a newer session is logged, the
// suggestion is based on fresher evidence than the goal, so it takes over
// again. That makes every goal last exactly one session without anything
// having to be switched back off.
//
// ISO 8601 timestamps compare correctly as plain text, same as the session
// sort in progression.js.
//
// A deload suggestion always wins: a goal was set for a normal workout,
// and following it would undo the deload.
function isGoalOverride(planned, suggestion) {
  if (suggestion === null || suggestion.isDeload || planned.targetLoadSetAt === null) {
    return false;
  }
  return planned.targetLoadSetAt > suggestion.basedOnSessionStartedAt;
}

// The one-line text for the green suggestion line, shared by the workout
// card and the set panel.
function describeProgression(suggestion, exercise) {
  const label = suggestion.isGoal ? "Your goal" : "Suggested";
  return `${label}: ${formatLoad(suggestion.load, exercise)} × ${describeSuggestedReps(suggestion)}. ${suggestion.reason}`;
}

// "8" when every set has the same target, "8 · 7 · 7" when they differ.
function describeSuggestedReps(suggestion) {
  const isSameForEverySet = suggestion.repsPerSet.every((reps) => reps === suggestion.repsPerSet[0]);
  return isSameForEverySet ? `${suggestion.reps}` : suggestion.repsPerSet.join(" · ");
}

// The green suggestion line on a workout card, with the reason included so
// the suggestion never looks like a mystery number.
function buildSuggestionLine(planned, suggestion) {
  const lineElement = document.createElement("p");
  lineElement.className = "progression-suggestion";
  lineElement.textContent = describeProgression(suggestion, findExerciseById(planned.exerciseId));
  return lineElement;
}

// One card per planned exercise, shown all at once — order doesn't matter,
// since any pill in any card can be tapped first.
function renderTemplateWorkoutCards(template) {
  templateWorkoutCardsElement.innerHTML = "";
  const session = getActiveSession();
  if (session.deload !== null) {
    templateWorkoutCardsElement.appendChild(buildDeloadBanner());
  }

  for (const planned of getSessionPlannedExercises(session, template)) {
    const exercise = appState.database.exercises.find((candidate) => candidate.id === planned.exerciseId);
    const loggedSets = appState.database.sets
      .filter(
        (set) =>
          set.sessionId === appState.activeSessionId &&
          set.exerciseId === planned.exerciseId &&
          !set.isWarmup
      )
      .sort((a, b) => a.order - b.order);

    const cardElement = document.createElement("div");
    cardElement.className = "exercise-card";

    const headingElement = document.createElement("h3");
    headingElement.textContent = exercise.name;
    // Not every card in a deload workout is a deload one: an exercise added
    // for today, or one whose deload was already done, is trained as usual.
    if (isDeloadExerciseInSession(session, planned.exerciseId)) {
      const deloadTag = document.createElement("span");
      deloadTag.className = "deload-tag";
      deloadTag.textContent = "Deload";
      headingElement.appendChild(deloadTag);
    }
    cardElement.appendChild(headingElement);

    if (planned.replacesExerciseId) {
      cardElement.appendChild(buildReplacementLine(planned.replacesExerciseId));
    }

    const suggestion = getSuggestionForPlanned(planned);
    if (suggestion) {
      cardElement.appendChild(buildSuggestionLine(planned, suggestion));
    }

    // Same line as in the set panel, so last session is visible between
    // sets without opening anything.
    const lastSessionLine = document.createElement("p");
    lastSessionLine.className = "last-session-line";
    lastSessionLine.textContent = describeLastSession(planned.exerciseId);
    cardElement.appendChild(lastSessionLine);

    const pillRowElement = document.createElement("div");
    pillRowElement.className = "set-pills";
    // Marks where the set panel opens for this exercise (see
    // findSetEntryPanelAnchor).
    pillRowElement.dataset.setPanelAnchor = planned.exerciseId;

    // One pill per planned set, filled in from whatever's actually been
    // logged so far for it.
    for (let setIndex = 0; setIndex < planned.targetSets; setIndex++) {
      const pill = buildSetPill(loggedSets[setIndex], planned, suggestion, setIndex);
      // Sets fill in from the left, so the first one not logged yet sits
      // right after the logged ones: that's the one to do next.
      if (setIndex === loggedSets.length) {
        pill.classList.add("set-pill-next");
      }
      pillRowElement.appendChild(pill);
    }

    // Any sets logged beyond the planned count (via the "+" pill below) get
    // their own pills too, rather than being invisible here.
    for (let setIndex = planned.targetSets; setIndex < loggedSets.length; setIndex++) {
      pillRowElement.appendChild(buildSetPill(loggedSets[setIndex], planned, suggestion, setIndex));
    }

    const addPill = document.createElement("button");
    addPill.type = "button";
    addPill.className = "set-pill set-pill-add";
    addPill.textContent = "+";
    addPill.addEventListener("click", () => openSetEntryPanel(planned.exerciseId));
    pillRowElement.appendChild(addPill);

    cardElement.appendChild(pillRowElement);

    // Adjusts this exercise's target sets/reps/load on the workout template itself,
    // so it's what shows next time this workout template is started (and for any of
    // today's pills for this exercise not yet logged, since they read the
    // same target).
    // Not for an exercise added for today only: it isn't in the template,
    // so there's no "next time" for a goal to apply to. Nor for a
    // replacement: the template's goal belongs to the exercise it replaces.
    // Nor in a catch-up workout, which has no template (see
    // buildCatchUpTemplate).
    if (!isAddedForThisWorkoutOnly(session, planned.exerciseId) && !planned.replacesExerciseId && !template.isCatchUp) {
      const nextGoalButton = document.createElement("button");
      nextGoalButton.type = "button";
      nextGoalButton.className = "card-action-button";
      nextGoalButton.textContent = "Set goal for next time";
      nextGoalButton.addEventListener("click", () => openNextGoalEditor(template.id, planned.exerciseId));
      cardElement.appendChild(nextGoalButton);
    }

    // Only in edit mode, so a stray thumb mid-set can't reach it.
    if (appState.isEditingWorkoutExercises && exercise.isGymSpecific && session.gymId) {
      cardElement.appendChild(buildMachineMaxButton(exercise, session.gymId));
    }
    if (appState.isEditingWorkoutExercises) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "card-action-button destructive-button";
      removeButton.textContent = "Remove from workout";
      removeButton.addEventListener("click", () => openRemoveExercisePanel(planned.exerciseId));
      cardElement.appendChild(removeButton);
    }

    templateWorkoutCardsElement.appendChild(cardElement);
  }

  templateWorkoutCardsElement.appendChild(buildWorkoutEditControls());
}

// One line above the cards, so the lighter targets never look like a
// mistake. The weight exception is spelled out in each card's own
// suggestion line (see buildDeloadSuggestion in progression.js).
function buildDeloadBanner() {
  const banner = document.createElement("p");
  banner.className = "deload-banner";
  banner.textContent =
    "Deload workout: fewer sets, stop 1–2 reps further from failure. " +
    "Same weight, except a little lighter in 1–3 rep exercises.";
  return banner;
}

// Sets the heaviest this gym's machine goes for this exercise, which turns
// its suggestions from more weight to more reps once it's reached (see
// chooseSuggestion in progression.js). Typed rather than stepped: it's
// set once per machine, and a stepper from 20 kg up to a stack's 150 kg
// would be a lot of taps.
function buildMachineMaxButton(exercise, gymId) {
  const gym = appState.database.gyms.find((candidate) => candidate.id === gymId);
  const currentMax = gym.machineMaxLoads[exercise.id];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card-action-button";
  button.textContent = typeof currentMax === "number"
    ? `Max weight at ${gym.name}: ${currentMax} kg`
    : `Set max weight at ${gym.name}`;
  button.addEventListener("click", () => {
    openTextEntryPanel({
      heading: `Max weight at ${gym.name}`,
      label: `Heaviest weight (kg) for ${exercise.name}. Leave empty for no limit.`,
      initialValue: typeof currentMax === "number" ? String(currentMax) : "",
      placeholder: "e.g. 120",
      isNumber: true,
      onSave: (typedText) => saveMachineMaxLoad(gym, exercise.id, typedText)
    });
  });
  return button;
}

// Empty clears the limit. Returns an error message for the text entry
// panel, or null once saved.
function saveMachineMaxLoad(gym, exerciseId, typedText) {
  if (typedText.trim() === "") {
    delete gym.machineMaxLoads[exerciseId];
  } else {
    // Same rule as a load increment: any positive number of kilograms.
    const maxLoad = parseLoadIncrement(typedText);
    if (maxLoad === null) {
      return "Enter the weight as a number of kilograms, e.g. 120.";
    }
    gym.machineMaxLoads[exerciseId] = maxLoad;
  }
  saveDatabase(appState.database);
  renderExerciseArea();
  return null;
}

// "Instead of Leg press", under a replacement's name, so it's clear why
// the card isn't what the template says.
function buildReplacementLine(originalExerciseId) {
  const original = appState.database.exercises.find((exercise) => exercise.id === originalExerciseId);
  const lineElement = document.createElement("p");
  lineElement.className = "last-session-line";
  lineElement.textContent = `Instead of ${original.name}`;
  return lineElement;
}

// Below the last card: "Edit exercises" switches edit mode on, which adds
// a "Remove from workout" button to each card and an "Add exercise" button
// here. Kept behind a toggle because changing the workout is rare, and the
// screen should stay about logging sets the rest of the time.
function buildWorkoutEditControls() {
  const controlsElement = document.createElement("div");
  controlsElement.className = "workout-edit-controls";

  if (appState.isEditingWorkoutExercises) {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.textContent = "Add exercise";
    addButton.addEventListener("click", openExercisePickerForActiveWorkout);
    controlsElement.appendChild(addButton);
  }

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "card-action-button";
  toggleButton.textContent = appState.isEditingWorkoutExercises ? "Done editing" : "Edit exercises";
  toggleButton.addEventListener("click", () => {
    appState.isEditingWorkoutExercises = !appState.isEditingWorkoutExercises;
    renderExerciseArea();
  });
  controlsElement.appendChild(toggleButton);

  return controlsElement;
}

renderExerciseArea();


// ---------------------------------------------------------------------------
// Starting and ending a workout
// ---------------------------------------------------------------------------

const startWorkoutChoices = document.getElementById("startWorkoutChoices");
const endWorkoutButton = document.getElementById("endWorkoutButton");
const workoutStatus = document.getElementById("workoutStatus");
const dayStatusButton = document.getElementById("dayStatusButton");

// Rebuilds the workout tiles and the "Start free-form workout" button. Once
// a workout is already in progress, those don't make sense any more — this
// shows a single "Resume workout" button back to the active workout screen
// instead, so there's always exactly one obvious thing to tap here.
function renderStartWorkoutChoices() {
  renderWorkoutTiles();
  startWorkoutChoices.innerHTML = "";
  startWorkoutChoices.hidden = false;

  if (appState.activeSessionId !== null) {
    const resumeButton = document.createElement("button");
    resumeButton.type = "button";
    resumeButton.textContent = "Resume workout";
    resumeButton.addEventListener("click", showActiveWorkoutScreen);
    startWorkoutChoices.appendChild(resumeButton);
    return;
  }

  const missedSets = findMissedSetsThisWeek();
  if (missedSets.length > 0) {
    startWorkoutChoices.appendChild(buildCatchUpChoice(missedSets));
  }

  const freeformButton = document.createElement("button");
  freeformButton.type = "button";
  freeformButton.textContent = "Start free-form workout";
  freeformButton.addEventListener("click", () => beginStartWorkout(null));
  startWorkoutChoices.appendChild(freeformButton);
}

// The catch-up offer: what's still missing this week, laid out like an
// open workout tile, so it reads as one more workout to do. It goes away
// by itself once those sets are done, or when the week ends.
function buildCatchUpChoice(missedSets) {
  const panel = document.createElement("div");
  panel.className = "workout-tile-panel catch-up-choice";

  const heading = document.createElement("h2");
  heading.textContent = "Catch-up";
  panel.appendChild(heading);

  const totalSets = missedSets.reduce((sum, planned) => sum + planned.targetSets, 0);
  const statusLine = document.createElement("p");
  statusLine.className = "workout-tile-panel-status";
  statusLine.textContent = `${totalSets} ${totalSets === 1 ? "set" : "sets"} not done this week`;
  panel.appendChild(statusLine);

  const exerciseList = document.createElement("ol");
  exerciseList.className = "workout-tile-exercise-list";
  missedSets.forEach((planned, index) => {
    exerciseList.appendChild(buildPlannedExerciseRow(planned, index + 1));
  });
  panel.appendChild(exerciseList);

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "workout-tile-start-button";
  startButton.textContent = "Start catch-up →";
  startButton.addEventListener("click", () => beginStartWorkout(null, true));
  panel.appendChild(startButton);

  return panel;
}


// ---------------------------------------------------------------------------
// Workout tiles (home screen)
//
// A two-column grid with one tile per active workout template. Tapping a
// tile opens a panel spanning both columns directly under that tile's row,
// so the details appear right where the thumb just was instead of at the
// bottom of the page.
// ---------------------------------------------------------------------------

const workoutTilesElement = document.getElementById("workoutTiles");

function renderWorkoutTiles() {
  workoutTilesElement.innerHTML = "";
  const activeTemplates = appState.database.workoutTemplates.filter((template) => !template.isArchived);

  // During a workout the Resume button is the only thing that makes sense
  // here, so the tiles step aside rather than invite starting a second one.
  if (appState.activeSessionId !== null || activeTemplates.length === 0) {
    workoutTilesElement.hidden = true;
    return;
  }
  workoutTilesElement.hidden = false;

  for (let index = 0; index < activeTemplates.length; index++) {
    const template = activeTemplates[index];
    const sessionThisWeek = findMostRecentFinishedSessionThisWeek(template.id);
    const isLastTile = index === activeTemplates.length - 1;
    // With an odd number of workouts the last tile would sit alone in half
    // a row; stretching it across both columns looks deliberate instead.
    const isAloneInItsRow = isLastTile && index % 2 === 0;
    workoutTilesElement.appendChild(buildWorkoutTile(template, sessionThisWeek, isAloneInItsRow));

    // The details panel has to come after the *whole row* in the page, not
    // right after the tapped tile — otherwise it would push the tile's
    // right-hand neighbour down onto the next line.
    const isEndOfRow = index % 2 === 1 || isLastTile;
    const rowStartIndex = index - (index % 2);
    const rowTemplates = activeTemplates.slice(rowStartIndex, index + 1);
    const selectedTemplate = rowTemplates.find(
      (rowTemplate) => rowTemplate.id === appState.selectedWorkoutTileTemplateId
    );
    if (isEndOfRow && selectedTemplate) {
      const selectedSession = findMostRecentFinishedSessionThisWeek(selectedTemplate.id);
      workoutTilesElement.appendChild(buildWorkoutTilePanel(selectedTemplate, selectedSession));
    }
  }
}

function buildWorkoutTile(template, sessionThisWeek, isAloneInItsRow) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "workout-tile";
  if (sessionThisWeek) {
    tile.classList.add("workout-tile-done");
  }
  if (template.id === appState.selectedWorkoutTileTemplateId) {
    tile.classList.add("workout-tile-selected");
  }
  if (isAloneInItsRow) {
    tile.classList.add("workout-tile-full-width");
  }

  const statusLine = document.createElement("span");
  statusLine.className = "workout-tile-status";
  statusLine.textContent = sessionThisWeek
    ? `Done ${formatShortDate(sessionThisWeek.startedAt)}`
    : "Not done yet";
  tile.appendChild(statusLine);

  const nameLine = document.createElement("span");
  nameLine.className = "workout-tile-name";
  nameLine.textContent = template.name;
  tile.appendChild(nameLine);

  tile.addEventListener("click", () => toggleWorkoutTile(template.id));
  return tile;
}

// Tapping the open tile again closes it; tapping another one switches to it.
function toggleWorkoutTile(templateId) {
  const isAlreadyOpen = appState.selectedWorkoutTileTemplateId === templateId;
  appState.selectedWorkoutTileTemplateId = isAlreadyOpen ? null : templateId;
  renderWorkoutTiles();
}

function buildWorkoutTilePanel(template, sessionThisWeek) {
  const panel = document.createElement("div");
  panel.className = "workout-tile-panel";

  const heading = document.createElement("h2");
  heading.textContent = template.name;
  panel.appendChild(heading);

  const statusLine = document.createElement("p");
  statusLine.className = "workout-tile-panel-status";
  if (sessionThisWeek) {
    const percent = computeWorkoutTemplateCompletionPercent(template, sessionThisWeek);
    statusLine.textContent = `Done ${formatShortDate(sessionThisWeek.startedAt)} — ${percent}%`;
  } else {
    statusLine.textContent = "Not done this week";
  }
  // Handy before starting: "do I have time for this one today?"
  const estimate = estimateWorkoutDuration(template.id);
  if (estimate) {
    statusLine.textContent += ` · usually ${describeDurationEstimate(estimate)}`;
  }
  panel.appendChild(statusLine);

  const exerciseList = document.createElement("ol");
  exerciseList.className = "workout-tile-exercise-list";
  template.plannedExercises.forEach((planned, index) => {
    exerciseList.appendChild(buildPlannedExerciseRow(planned, index + 1));
  });
  panel.appendChild(exerciseList);

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "workout-tile-start-button";
  // Offered even when the workout is already done this week — repeating
  // one is unusual but legitimate, and hiding the button would make it
  // impossible from here.
  startButton.textContent = "Start workout →";
  startButton.addEventListener("click", () => beginStartWorkout(template.id));
  panel.appendChild(startButton);

  return panel;
}

// One numbered row: "Back squat" over "3 × 6-8 (100 kg)". The load shown
// is the workout's planned target, not the progression suggestion — the
// suggestion is still what pre-fills the steppers once the workout starts.
function buildPlannedExerciseRow(planned, position) {
  const row = document.createElement("li");

  const numberBadge = document.createElement("span");
  numberBadge.className = "workout-tile-exercise-number";
  numberBadge.textContent = String(position);
  row.appendChild(numberBadge);

  const exercise = appState.database.exercises.find((candidate) => candidate.id === planned.exerciseId);
  const textBlock = document.createElement("span");
  textBlock.className = "workout-tile-exercise-text";

  const nameLine = document.createElement("strong");
  nameLine.textContent = exercise ? exercise.name : "Unknown exercise";
  textBlock.appendChild(nameLine);

  const targetLine = document.createElement("span");
  targetLine.textContent = formatPlannedTarget(planned);
  textBlock.appendChild(targetLine);

  row.appendChild(textBlock);
  return row;
}

// A fixed target (min equals max) reads as "6", not "6-6".
function formatRepRange(repsMin, repsMax) {
  return repsMin === repsMax ? `${repsMin}` : `${repsMin}-${repsMax}`;
}

function formatPlannedTarget(planned) {
  const repRange = formatRepRange(planned.targetRepsMin, planned.targetRepsMax);
  const loadText = typeof planned.targetLoad === "number" ? ` (${planned.targetLoad} kg)` : "";
  return `${planned.targetSets} × ${repRange}${loadText}, RIR ${planned.targetRir}`;
}

// "22 Sep" — a tile is too narrow for the year, and within the current
// week the year is never in doubt anyway.
function formatShortDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function updateWorkoutControls() {
  const isActive = appState.activeSessionId !== null;
  endWorkoutButton.hidden = !isActive;
  dayStatusButton.hidden = !isActive;
  renderReadinessCard();
  renderBackstopOfferCards();
  workoutBodyweightButton.hidden = !isActive;
  renderWorkoutBodyweightButton();
  workoutStatus.textContent = isActive ? "Workout in progress" : "";
  renderStartWorkoutChoices();
  // Both timers, not just rest: otherwise the clock stays blank until the
  // once-a-second tick, and the screen jumps when it appears.
  updateWorkoutTimers();
  renderWeeklyWorkoutTemplateSummary();
  renderMuscleCounters();
}

// Called when a workout template (or free-form) is picked to start. If any gyms have
// been added, asks which one this workout is at before actually starting;
// otherwise there's nothing to ask, so it starts right away.
function beginStartWorkout(templateId, isCatchUp = false) {
  const activeGyms = appState.database.gyms.filter((gym) => !gym.isArchived);
  // Nothing to ask when there's zero or exactly one choice — a picker
  // screen for "pick the only gym you have" is a tap for no reason.
  if (activeGyms.length === 0) {
    startWorkout(templateId, null, isCatchUp);
    return;
  }
  if (activeGyms.length === 1) {
    startWorkout(templateId, activeGyms[0].id, isCatchUp);
    return;
  }
  appState.pendingTemplateId = templateId;
  appState.isPendingCatchUp = isCatchUp;
  showGymPickerScreen();
}

// The gym's standing swaps that apply to this workout's plan, copied so
// the session keeps its own record (see Session in schema.js). Nothing to
// swap in a free-form workout, which has no plan, or with no gym chosen.
//
// A swap is left out when its replacement is archived, or already planned
// in this template: two cards for one exercise would mix up its sets.
// Then the original shows as usual, and can be swapped by hand.
function chooseReplacementsForNewWorkout(plannedExercises, gymId) {
  const gym = appState.database.gyms.find((candidate) => candidate.id === gymId);
  if (!gym) {
    return [];
  }
  const plannedIds = plannedExercises.map((planned) => planned.exerciseId);
  return gym.exerciseReplacements
    .filter((replacement) => {
      const replacementExercise = appState.database.exercises.find(
        (exercise) => exercise.id === replacement.replacementExerciseId
      );
      return plannedIds.includes(replacement.exerciseId) &&
        !plannedIds.includes(replacement.replacementExerciseId) &&
        replacementExercise && !replacementExercise.isArchived;
    })
    .map((replacement) => ({ ...replacement }));
}

// The plan a new workout follows: its template's list, the sets still
// missing this week for a catch-up workout, or nothing for free-form.
function choosePlanForNewWorkout(templateId, isCatchUp) {
  if (isCatchUp) {
    return findMissedSetsThisWeek();
  }
  const template = appState.database.workoutTemplates.find((candidate) => candidate.id === templateId);
  return template ? template.plannedExercises : [];
}

function startWorkout(templateId, gymId, isCatchUp = false) {
  const plan = choosePlanForNewWorkout(templateId, isCatchUp);
  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    // Not set yet; see DAY_STATUSES in schema.js.
    dayStatus: null,
    readiness: null,
    deload: null,
    notes: "",
    templateId: templateId,
    gymId: gymId,
    addedExercises: [],
    removedExerciseIds: [],
    replacedExercises: chooseReplacementsForNewWorkout(plan, gymId),
    catchUpExercises: isCatchUp ? plan : null
  };
  // Needs the rest of the session first: it reads the template, the
  // catch-up plan and the gym swaps.
  session.deload = chooseSessionDeload(session);
  appState.database.sessions.push(session);
  appState.isEditingWorkoutExercises = false;
  appState.activeSessionId = session.id;
  appState.pendingTemplateId = null;
  appState.isPendingCatchUp = false;
  saveDatabase(appState.database);
  closeFreeformReview();
  hidePersonalBestBanner();
  closeDayStatusPanel();
  showActiveWorkoutScreen();
  updateWorkoutControls();
  renderExerciseArea();
}

// True when a workout holds nothing at all: no sets (warmups included) and
// no day status or notes. A readiness answer alone doesn't count: it's
// tapped first thing, so a workout started by mistake often has one. Such
// a workout was almost certainly started by
// mistake, and saving it would turn that workout's tile green for the week
// (at 0%) and leave a blank card in History.
function isSessionEmpty(session) {
  const hasSets = appState.database.sets.some((set) => set.sessionId === session.id);
  const hasNoStatus = session.dayStatus === null || session.dayStatus === "normal";
  return !hasSets && hasNoStatus && session.notes === "";
}

// No status prompt here any more: readiness and its reason are asked at
// the start (see the readiness card), where the answer isn't coloured by
// how the workout went. Asking again at the end would mean two check-ins
// per workout.
endWorkoutButton.addEventListener("click", () => {
  finishActiveWorkout();
});

function finishActiveWorkout() {
  const session = getActiveSession();
  if (isSessionEmpty(session)) {
    deleteSessionAndItsSets(session.id);
  } else {
    session.endedAt = new Date().toISOString();
    countDeloadSessionsDone(session);
  }
  saveDatabase(appState.database);
  closeSetEntryPanel();
  closeFreeformReview();
  hidePersonalBestBanner();
  closeDayStatusPanel();
  appState.activeSessionId = null;
  appState.isEditingWorkoutExercises = false;
  showMainScreen();
  updateWorkoutControls();
  renderExerciseArea();
}


// Each deload slot this workout gave its lighter workout to is marked as
// having had it. The exercise ids are refreshed first in case the template
// lost an exercise mid-workout ("Remove from workout template").
function countDeloadSessionsDone(session) {
  const deload = findSessionDeload(session);
  if (!deload) {
    return;
  }
  refreshSessionDeloadExerciseIds(session);
  for (const slot of findSlotsGivenDeloadSession(session, deload, appState.database.sets)) {
    slot.sessionsDone += 1;
  }
}


// ---------------------------------------------------------------------------
// Rest timer
//
// Normally one timer, counting up from whenever the most recently logged set
// (in the current workout, any exercise, warmups included — this is about
// physical exertion, not performance context) was saved.
//
// During a superset — two or more exercises each part-way through their
// planned sets — it shows one timer per exercise instead, each counting from
// that exercise's own last set, since that's the rest that matters when you
// go back to it. Purely computed from existing Set.performedAt timestamps,
// so there's no new stored state.
// ---------------------------------------------------------------------------

const restTimerElement = document.getElementById("restTimer");

// An exercise left unfinished longer than this is treated as abandoned, not
// as part of a superset, so its timer doesn't sit there counting up forever.
const SUPERSET_TIMER_CUTOFF_MINUTES = 15;

function secondsSince(isoString) {
  return Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
}

function findMostRecentSet(sets) {
  return sets.reduce((latest, set) => (set.performedAt > latest.performedAt ? set : latest));
}

// The exercises currently part-way through their planned sets, each as
// { exerciseName, lastSetAt }, newest first. Only template workouts have a
// planned set count to be "part-way" through, so a free-form workout always
// gets an empty list (and with it the single timer).
function findUnfinishedExerciseTimers(sessionSets) {
  const template = getActiveTemplate();
  if (!template) {
    return [];
  }

  const timers = [];
  for (const planned of getSessionPlannedExercises(getActiveSession(), template)) {
    const exerciseSets = sessionSets.filter((set) => set.exerciseId === planned.exerciseId);
    const workingSetCount = exerciseSets.filter((set) => !set.isWarmup).length;
    const isStartedButUnfinished = exerciseSets.length > 0 && workingSetCount < planned.targetSets;
    if (!isStartedButUnfinished) {
      continue;
    }

    const lastSetAt = findMostRecentSet(exerciseSets).performedAt;
    if (secondsSince(lastSetAt) > SUPERSET_TIMER_CUTOFF_MINUTES * 60) {
      continue;
    }
    const exercise = appState.database.exercises.find((candidate) => candidate.id === planned.exerciseId);
    timers.push({ exerciseName: exercise.name, lastSetAt });
  }
  return timers.sort((a, b) => b.lastSetAt.localeCompare(a.lastSetAt));
}

// True once the rest target from Settings has passed. With no target set
// (null), never: the timer then just counts, as it always has.
function isRestTargetReached(restSeconds) {
  const targetSeconds = appState.database.preferences.restTargetSeconds;
  return targetSeconds !== null && restSeconds >= targetSeconds;
}

function updateRestTimer() {
  restTimerElement.innerHTML = "";
  restTimerElement.classList.remove("rest-timer-superset", "rest-target-reached");
  if (appState.activeSessionId === null) {
    return;
  }

  const sessionSets = appState.database.sets.filter((set) => set.sessionId === appState.activeSessionId);
  if (sessionSets.length === 0) {
    return;
  }

  const unfinishedExerciseTimers = findUnfinishedExerciseTimers(sessionSets);
  if (unfinishedExerciseTimers.length < 2) {
    const mostRecentSet = findMostRecentSet(sessionSets);
    const restSeconds = secondsSince(mostRecentSet.performedAt);
    restTimerElement.textContent = `Rest: ${formatElapsedTime(restSeconds)}`;
    restTimerElement.classList.toggle("rest-target-reached", isRestTargetReached(restSeconds));
    return;
  }

  // One line per exercise. The class switches to a smaller font so two or
  // three lines still fit in the pinned block without covering the screen.
  restTimerElement.classList.add("rest-timer-superset");
  for (const timer of unfinishedExerciseTimers) {
    const lineElement = document.createElement("span");
    lineElement.className = "rest-timer-line";

    const nameElement = document.createElement("span");
    nameElement.className = "rest-timer-exercise";
    nameElement.textContent = timer.exerciseName;

    const timeElement = document.createElement("span");
    const restSeconds = secondsSince(timer.lastSetAt);
    timeElement.textContent = formatElapsedTime(restSeconds);
    // Per line: in a superset each exercise's rest is its own.
    lineElement.classList.toggle("rest-target-reached", isRestTargetReached(restSeconds));

    lineElement.append(nameElement, timeElement);
    restTimerElement.appendChild(lineElement);
  }
}


// ---------------------------------------------------------------------------
// Workout clock and duration estimate
//
// "Workout 32:10 · usually 70–80 min": time since the workout started, and
// how long the same workout template has taken before. Like the rest timer,
// computed from timestamps already stored, so nothing new is saved.
// ---------------------------------------------------------------------------

const workoutClockElement = document.getElementById("workoutClock");

// "1:05:09" past an hour, "32:10" before that.
function formatElapsedTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

function updateWorkoutClock() {
  const session = getActiveSession();
  if (!session) {
    workoutClockElement.textContent = "";
    return;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000));
  let clockText = `Workout ${formatElapsedTime(elapsedSeconds)}`;

  const estimate = session.templateId ? estimateWorkoutDuration(session.templateId) : null;
  if (estimate) {
    clockText += ` · usually ${describeDurationEstimate(estimate)}`;
  }
  workoutClockElement.textContent = clockText;
}

// How many minutes each recent finished session of this workout template
// took, newest first. Measured from start to the last logged set rather
// than to endedAt: tapping "End workout" late (in the car, or the next
// morning) would otherwise make the workout look far longer than it was.
function findRecentWorkoutDurationsInMinutes(templateId, sessionCount) {
  return appState.database.sessions
    .filter((session) => session.templateId === templateId && session.endedAt !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, sessionCount)
    .map((session) => {
      const durationMilliseconds = new Date(findLastActivityTime(session)) - new Date(session.startedAt);
      return durationMilliseconds / 60000;
    })
    // A session with a single set (or none) has no meaningful length.
    .filter((minutes) => minutes > 0);
}

// A typical range for this workout's length, as { lowMinutes, highMinutes }
// rounded to 5 minutes, or null with fewer than two past sessions to go on.
// With four or more, the quickest and slowest quarter are left out, so one
// unusually short or long day doesn't stretch the range. Uses the last ten
// sessions, so the estimate follows the workout as it changes over months.
function estimateWorkoutDuration(templateId) {
  const durations = findRecentWorkoutDurationsInMinutes(templateId, 10).sort((a, b) => a - b);
  if (durations.length < 2) {
    return null;
  }

  let typicalDurations = durations;
  if (durations.length >= 4) {
    const quarter = Math.floor(durations.length / 4);
    typicalDurations = durations.slice(quarter, durations.length - quarter);
  }

  const roundToFive = (minutes) => Math.round(minutes / 5) * 5;
  return {
    lowMinutes: roundToFive(typicalDurations[0]),
    highMinutes: roundToFive(typicalDurations[typicalDurations.length - 1])
  };
}

// "70–80 min", or "~75 min" when the range has collapsed to one value.
function describeDurationEstimate(estimate) {
  if (estimate.lowMinutes === estimate.highMinutes) {
    return `~${estimate.lowMinutes} min`;
  }
  return `${estimate.lowMinutes}–${estimate.highMinutes} min`;
}

function updateWorkoutTimers() {
  updateWorkoutClock();
  updateRestTimer();
}

// Runs for the lifetime of the page rather than being started/stopped
// around each workout — simpler, and both updates already no-op cleanly
// when there's nothing to show.
setInterval(updateWorkoutTimers, 1000);
updateWorkoutTimers();


// ---------------------------------------------------------------------------
// Personal-best notification
//
// Checked only when a brand-new set is saved (not when correcting an
// existing one, to keep this scoped to "you just did that" moments rather
// than retroactive data fixes). Two independent kinds of PR: heaviest
// weight ever, and highest single-set volume (load × reps) ever, for that
// exercise. Warmups never count, and for a gym-specific exercise the
// comparison is scoped to the same gym, matching findMostRecentWorkingSet().
// ---------------------------------------------------------------------------

const prBannerElement = document.getElementById("prBanner");

function checkForPersonalBest(exerciseId, newSet) {
  if (newSet.isWarmup) {
    return { isWeightPR: false, isVolumePR: false };
  }

  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const activeSession = getActiveSession();

  let priorSets = appState.database.sets.filter(
    (set) => set.exerciseId === exerciseId && !set.isWarmup && set.id !== newSet.id
  );

  if (exercise.isGymSpecific && activeSession && activeSession.gymId) {
    const sessionIdsAtThisGym = new Set(
      appState.database.sessions
        .filter((session) => session.gymId === activeSession.gymId)
        .map((session) => session.id)
    );
    priorSets = priorSets.filter((set) => sessionIdsAtThisGym.has(set.sessionId));
  }

  // No prior sets means nothing to beat yet — the first time you log an
  // exercise isn't a "personal best" in any meaningful sense.
  if (priorSets.length === 0) {
    return { isWeightPR: false, isVolumePR: false };
  }

  const previousMaxLoad = Math.max(...priorSets.map((set) => set.load));
  const previousMaxVolume = Math.max(...priorSets.map((set) => set.load * set.reps));

  return {
    isWeightPR: newSet.load > previousMaxLoad,
    isVolumePR: newSet.load * newSet.reps > previousMaxVolume
  };
}

function showPersonalBestBanner(exerciseName, personalBest) {
  let message;
  if (personalBest.isWeightPR && personalBest.isVolumePR) {
    message = `Personal best for ${exerciseName} — heaviest weight and highest volume yet.`;
  } else if (personalBest.isWeightPR) {
    message = `Personal best for ${exerciseName} — heaviest weight yet.`;
  } else {
    message = `Personal best for ${exerciseName} — highest volume yet.`;
  }

  prBannerElement.textContent = message;
  prBannerElement.hidden = false;

  if (appState.personalBestBannerTimeoutId) {
    clearTimeout(appState.personalBestBannerTimeoutId);
  }
  appState.personalBestBannerTimeoutId = setTimeout(() => {
    prBannerElement.hidden = true;
    appState.personalBestBannerTimeoutId = null;
  }, 6000);
}

function hidePersonalBestBanner() {
  if (appState.personalBestBannerTimeoutId) {
    clearTimeout(appState.personalBestBannerTimeoutId);
    appState.personalBestBannerTimeoutId = null;
  }
  prBannerElement.hidden = true;
}


// ---------------------------------------------------------------------------
// Today's status (Session.readiness / dayStatus / notes)
//
// Available as a button any time a workout is active, and from a History
// card for a finished one. Never a required step. The readiness card at the
// top of the workout screen sets the same fields in one tap; this panel is
// where notes go, and where a past workout's answers can be corrected.
// ---------------------------------------------------------------------------

const DAY_STATUS_LABELS = {
  normal: "Normal",
  poorSleep: "Poor sleep",
  ill: "Ill",
  stressed: "Stressed"
};

const dayStatusHeading = document.getElementById("dayStatusHeading");
const dayStatusOptionsElement = document.getElementById("dayStatusOptions");
const dayStatusNotesInput = document.getElementById("dayStatusNotesInput");
const dayStatusReadinessButtonsElement = document.getElementById("dayStatusReadinessButtons");

// Every pick in these panels works like this: tapping a value selects it,
// and tapping the already-selected one clears it back to null. That undoes
// a mis-tap without needing a separate "clear" button.
function toggledValue(currentValue, tappedValue) {
  return currentValue === tappedValue ? null : tappedValue;
}

// One button per point on the 1-5 scale. Shared by the readiness card and
// this panel so the two can't end up with different scales.
function createReadinessButtons(containerElement, onPick) {
  for (let value = CHECK_IN_SCALE_MIN; value <= CHECK_IN_SCALE_MAX; value++) {
    const valueButton = document.createElement("button");
    valueButton.type = "button";
    valueButton.className = "day-status-option";
    valueButton.textContent = value;
    valueButton.dataset.value = value;
    valueButton.addEventListener("click", () => onPick(value));
    containerElement.appendChild(valueButton);
  }
}

// dataset values are always strings, hence String() before comparing. A
// null selection matches no button, so nothing is highlighted.
function highlightSelectedButton(containerElement, datasetKey, selectedValue) {
  for (const button of containerElement.children) {
    const isSelected = button.dataset[datasetKey] === String(selectedValue);
    button.classList.toggle("day-status-option-selected", isSelected);
  }
}

createReadinessButtons(dayStatusReadinessButtonsElement, (value) => {
  appState.dayStatusDraft.readiness = toggledValue(appState.dayStatusDraft.readiness, value);
  renderDayStatusPanel();
});

// Built once from DAY_STATUSES (schema.js) rather than hardcoded in HTML,
// so this can't quietly drift out of sync with the schema's contract.
for (const status of DAY_STATUSES) {
  const optionButton = document.createElement("button");
  optionButton.type = "button";
  optionButton.className = "day-status-option";
  optionButton.textContent = DAY_STATUS_LABELS[status];
  optionButton.dataset.dayStatus = status;
  optionButton.addEventListener("click", () => {
    appState.dayStatusDraft.dayStatus = toggledValue(appState.dayStatusDraft.dayStatus, status);
    renderDayStatusPanel();
  });
  dayStatusOptionsElement.appendChild(optionButton);
}

function renderDayStatusPanel() {
  dayStatusNotesInput.value = appState.dayStatusDraft.notes;
  highlightSelectedButton(dayStatusReadinessButtonsElement, "value", appState.dayStatusDraft.readiness);
  highlightSelectedButton(dayStatusOptionsElement, "dayStatus", appState.dayStatusDraft.dayStatus);
}

// sessionId lets this same panel edit either the in-progress session (from
// the "Today's status" button) or a finished one (from a History card's
// "Edit status" button) — the panel itself doesn't care which.
function openDayStatusPanel(sessionId) {
  const session = appState.database.sessions.find((candidate) => candidate.id === sessionId);
  appState.dayStatusEditingSessionId = sessionId;
  appState.dayStatusDraft = {
    readiness: session.readiness,
    dayStatus: session.dayStatus,
    notes: session.notes
  };
  dayStatusHeading.textContent = session.endedAt === null ? "Today's status" : "Edit status";
  renderDayStatusPanel();
  dayStatusPanel.hidden = false;
}

function saveDayStatusDraft() {
  const session = appState.database.sessions.find(
    (candidate) => candidate.id === appState.dayStatusEditingSessionId
  );
  session.readiness = appState.dayStatusDraft.readiness;
  session.dayStatus = appState.dayStatusDraft.dayStatus;
  session.notes = appState.dayStatusDraft.notes;
  saveDatabase(appState.database);
}

function closeDayStatusPanel() {
  appState.dayStatusDraft = null;
  appState.dayStatusEditingSessionId = null;
  dayStatusPanel.hidden = true;
  renderReadinessCard();
  // Safe to call even when History isn't the visible screen — it just
  // redraws the (currently hidden) history list. Same pattern as
  // closeSetEntryPanel() below.
  if (!historyScreen.hidden) {
    renderHistoryList();
  }
}

dayStatusButton.addEventListener("click", () => openDayStatusPanel(getActiveSession().id));


// ---------------------------------------------------------------------------
// Bodyweight from the workout screen — a shortcut to the Bodyweight screen,
// for weighing in at the gym without leaving the workout via Home.
// ---------------------------------------------------------------------------

const workoutBodyweightButton = document.getElementById("workoutBodyweightButton");

// Shows today's weight once it's logged, so a glance tells whether the
// weigh-in is already done.
function renderWorkoutBodyweightButton() {
  const todaysEntry = findTodaysBodyweightEntry();
  workoutBodyweightButton.textContent = todaysEntry
    ? `Bodyweight: ${todaysEntry.weightKg.toFixed(1)} kg`
    : "Log bodyweight";
}

workoutBodyweightButton.addEventListener("click", () => showBodyweightScreen(true));

dayStatusNotesInput.addEventListener("input", () => {
  appState.dayStatusDraft.notes = dayStatusNotesInput.value;
});

document.getElementById("saveDayStatusButton").addEventListener("click", () => {
  saveDayStatusDraft();
  closeDayStatusPanel();
});

document.getElementById("cancelDayStatusButton").addEventListener("click", () => {
  closeDayStatusPanel();
});

// Green with the chosen status once set ("Today: Poor sleep"), plain grey
// "Today's status" until then, so a glance shows whether it's done.
function renderDayStatusButton() {
  const session = getActiveSession();
  const isSet = session !== null && session.dayStatus !== null;
  dayStatusButton.textContent = isSet ? `Today: ${DAY_STATUS_LABELS[session.dayStatus]}` : "Today's status";
  dayStatusButton.classList.toggle("day-status-button-set", isSet);
}


// ---------------------------------------------------------------------------
// Readiness card (top of the workout screen)
//
// One tap for "How ready do you feel to train?" (Session.readiness), and an
// optional reason (Session.dayStatus). Saved on every tap with no Save
// step, since it's answered standing in the gym. Ignoring it is fine: both
// fields stay null, which means "not answered", never "felt normal".
// ---------------------------------------------------------------------------

const readinessCard = document.getElementById("readinessCard");
const readinessButtonsElement = document.getElementById("readinessButtons");
const readinessReasonButtonsElement = document.getElementById("readinessReasonButtons");

// "Normal" is left out here: a readiness of 4 or 5 already says that. It
// stays in the status panel, and in old data, as a valid value.
const READINESS_REASON_STATUSES = DAY_STATUSES.filter((status) => status !== "normal");

createReadinessButtons(readinessButtonsElement, (value) => {
  const session = getActiveSession();
  session.readiness = toggledValue(session.readiness, value);
  saveDatabase(appState.database);
  renderReadinessCard();
});

for (const status of READINESS_REASON_STATUSES) {
  const reasonButton = document.createElement("button");
  reasonButton.type = "button";
  reasonButton.className = "day-status-option";
  reasonButton.textContent = DAY_STATUS_LABELS[status];
  reasonButton.dataset.dayStatus = status;
  reasonButton.addEventListener("click", () => {
    const session = getActiveSession();
    session.dayStatus = toggledValue(session.dayStatus, status);
    saveDatabase(appState.database);
    renderReadinessCard();
  });
  readinessReasonButtonsElement.appendChild(reasonButton);
}

function renderReadinessCard() {
  renderDayStatusButton();
  const session = getActiveSession();
  readinessCard.hidden = session === null;
  if (session === null) {
    return;
  }
  highlightSelectedButton(readinessButtonsElement, "value", session.readiness);
  highlightSelectedButton(readinessReasonButtonsElement, "dayStatus", session.dayStatus);
}


// ---------------------------------------------------------------------------
// Logging a set
// ---------------------------------------------------------------------------

const setEntryExerciseName = document.getElementById("setEntryExerciseName");
const plannedTarget = document.getElementById("plannedTarget");
const previousPerformance = document.getElementById("previousPerformance");
const progressionSuggestion = document.getElementById("progressionSuggestion");
const rirRow = document.getElementById("rirRow");
const rirButtonsElement = document.getElementById("rirButtons");
const warmupToggleButton = document.getElementById("warmupToggleButton");

const loadValueElement = document.getElementById("loadValue");
const repsValueElement = document.getElementById("repsValue");
const saveSetButton = document.getElementById("saveSetButton");
const deleteSetButton = document.getElementById("deleteSetButton");

// Finds the most recently performed working (non-warmup) set for an
// exercise, across all sessions — today's included. Warmups are excluded
// because they don't represent what was actually trained.
//
// Only used to pick the set panel's starting values: once a set has been
// logged today, the next one should start from it. What's *shown* as last
// time's performance comes from describeLastSession below instead, which
// deliberately skips today and covers the whole session, not one set.
//
// For a gym-specific exercise (machine/cable — see schema.js), this only
// looks at sets from sessions logged at the same gym as the current one,
// since those load numbers aren't comparable across locations. It falls
// back to an ungrouped, all-gyms lookup when the exercise isn't flagged
// gym-specific, or when today's session has no gym set to scope by.
function findMostRecentWorkingSet(exerciseId) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const activeSession = getActiveSession();

  let matchingSets = appState.database.sets.filter(
    (set) => set.exerciseId === exerciseId && !set.isWarmup
  );

  if (exercise.isGymSpecific && activeSession && activeSession.gymId) {
    const sessionIdsAtThisGym = new Set(
      appState.database.sessions
        .filter((session) => session.gymId === activeSession.gymId)
        .map((session) => session.id)
    );
    matchingSets = matchingSets.filter((set) => sessionIdsAtThisGym.has(set.sessionId));
  }

  if (matchingSets.length === 0) {
    return null;
  }

  return matchingSets.reduce((mostRecent, set) =>
    set.performedAt > mostRecent.performedAt ? set : mostRecent
  );
}

// The grey "Last time" line, shown on a workout card and in the set panel:
// every working set from the most recent earlier session of this exercise,
// e.g. "Last time · 22 Sep: 100 kg × 8 · 8 · 7 — RIR 2 · 2 · 1".
//
// Built on findRecentSessions from progression.js, which already skips
// today's session, ignores warmups, and keeps a gym-specific exercise to
// today's gym. Sharing it means this line and the green suggestion are
// always based on the same session and can't disagree.
function describeLastSession(exerciseId) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const activeSession = getActiveSession();
  // Said out loud when the lookup is gym-scoped, so "not done before" isn't
  // confusing for an exercise that has been done plenty — just elsewhere.
  const isScopedToThisGym = Boolean(exercise.isGymSpecific && activeSession && activeSession.gymId);

  // This workout's own last session, same as the suggestion uses. Never
  // done in this workout, the last time from any workout is still worth
  // seeing, labelled with that workout so it isn't mistaken for this one.
  const sameWorkoutSessions = findRecentSessions(appState.database, exercise, activeSession, 1, true);
  const isFromAnotherWorkout = sameWorkoutSessions.length === 0;
  const recentSessions = isFromAnotherWorkout
    ? findRecentSessions(appState.database, exercise, activeSession, 1, false)
    : sameWorkoutSessions;
  if (recentSessions.length === 0) {
    return isScopedToThisGym ? "Not done at this gym before." : "First time doing this exercise.";
  }

  const { session, workingSets } = recentSessions[0];
  const setsInOrder = workingSets.slice().sort((a, b) => a.order - b.order);
  const workoutNote = isFromAnotherWorkout && activeSession
    ? describeOtherWorkoutNote(session, exerciseId)
    : "";
  const scopeNote = (isScopedToThisGym ? " (at this gym)" : "") + workoutNote;
  const rirText = setsInOrder.map((set) => set.rir).join(" · ");
  return `Last time · ${formatShortDate(session.startedAt)}${scopeNote}: ` +
    `${formatLoadsAndReps(setsInOrder)} — RIR ${rirText}`;
}

// " (in Workout 2)" after the date in the "Last time" line, when that last
// time was in a different workout from today's. Nothing for a free-form
// workout, which has no workout of its own to differ from.
function describeOtherWorkoutNote(pastSession, exerciseId) {
  const pastTemplateId = findWorkoutTemplateIdOf(pastSession, exerciseId);
  if (findWorkoutTemplateIdOf(getActiveSession(), exerciseId) === null) {
    return "";
  }
  const pastTemplate = appState.database.workoutTemplates.find((template) => template.id === pastTemplateId);
  return ` (in ${pastTemplate ? pastTemplate.name : "free-form"})`;
}

// "100 kg × 8 · 8 · 7" when every set used the same weight (the usual
// case), otherwise each set in full: "100×8 · 100×8 · 97.5×7". For a
// bodyweight exercise the loads are what was added: "BW + 10 kg × 8 · 8".
function formatLoadsAndReps(sets) {
  const exercise = findExerciseById(sets[0].exerciseId);
  const everySetSameLoad = sets.every((set) => set.load === sets[0].load);
  if (everySetSameLoad) {
    return `${formatLoad(sets[0].load, exercise)} × ${sets.map((set) => set.reps).join(" · ")}`;
  }
  const prefix = exercise && exercise.isBodyweight ? "BW + " : "";
  return sets.map((set) => `${prefix}${set.load}×${set.reps}`).join(" · ");
}


// The exercise's name followed by small tags ("Gym-specific",
// "Bodyweight") for the kinds that change how it's logged. Tags rather
// than "(gym-specific)" in the name itself, so the name reads cleanly and
// the kind still stands out. Returns elements to append, not text.
function buildExerciseNameWithTags(exercise) {
  const fragment = document.createDocumentFragment();
  fragment.append(exercise.name);
  if (exercise.isGymSpecific) {
    fragment.append(buildExerciseTag("Gym-specific"));
  }
  if (exercise.isBodyweight) {
    fragment.append(buildExerciseTag("Bodyweight"));
  }
  return fragment;
}

function buildExerciseTag(label) {
  const tagElement = document.createElement("span");
  tagElement.className = "exercise-tag";
  tagElement.textContent = label;
  return tagElement;
}

function findExerciseById(exerciseId) {
  return appState.database.exercises.find((candidate) => candidate.id === exerciseId);
}

// Redraws the stepper values and the RIR row's visibility from
// `appState.setDraft`. Called after every stepper button press and every
// warmup toggle, so the panel always shows the current draft.
function renderSetDraft() {
  loadValueElement.textContent = formatLoad(appState.setDraft.load, findExerciseById(appState.setDraft.exerciseId));
  repsValueElement.textContent = appState.setDraft.reps;
  renderRirButtons(appState.setDraft.rir);
  rirRow.hidden = appState.setDraft.isWarmup;
  warmupToggleButton.classList.toggle("day-status-option-selected", appState.setDraft.isWarmup);
  // Tells a screen reader the button is on or off, which the colour alone
  // can't.
  warmupToggleButton.setAttribute("aria-pressed", String(appState.setDraft.isWarmup));
}

// The RIR buttons go up to 5: past that, "how many more could I have done"
// is a guess anyway. A higher value already stored (an older set, or a
// typed one) gets its own extra button, rather than being shown as 5 —
// the record must say exactly what was logged.
const RIR_BUTTON_MAX = 5;

function renderRirButtons(selectedRir) {
  rirButtonsElement.innerHTML = "";
  const values = [];
  for (let value = 0; value <= RIR_BUTTON_MAX; value++) {
    values.push(value);
  }
  if (selectedRir > RIR_BUTTON_MAX) {
    values.push(selectedRir);
  }

  for (const value of values) {
    const rirButton = document.createElement("button");
    rirButton.type = "button";
    rirButton.className = "day-status-option";
    rirButton.textContent = value;
    rirButton.dataset.value = value;
    rirButton.addEventListener("click", () => {
      appState.setDraft.rir = value;
      renderSetDraft();
    });
    rirButtonsElement.appendChild(rirButton);
  }
  highlightSelectedButton(rirButtonsElement, "value", selectedRir);
}

// Guards against a stepper's typed-number input being stuck open from a
// previous panel session — it should always lose focus and hide itself
// before the panel closes, but if that somehow didn't happen (the panel
// closing without the input ever blurring), this is what stops the field
// from showing a raw number input instead of its normal button the next
// time the panel opens.
function resetSetEntryStepperEditUI() {
  for (const field of ["load", "reps"]) {
    document.getElementById(`${field}ValueInput`).hidden = true;
    document.getElementById(`${field}Value`).hidden = false;
    document.getElementById(`${field}Decrement`).hidden = false;
    document.getElementById(`${field}Increment`).hidden = false;
  }
}

// `planTarget` (optional) is `{ load, repsMin, repsMax, suggestion,
// setIndex }` from a workout template's plan, passed in when opened from a
// pending set pill. When present, load/reps default to the plan rather than
// to past performance, since the plan is what today is supposed to follow.
// If progression.js produced a suggestion, that takes priority over the
// plan's fixed load, because it's the plan's rep range applied to what
// actually happened last time. A goal set by hand is already part of the
// suggestion by now (see getSuggestionForPlanned).
function openSetEntryPanel(exerciseId, planTarget = null) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const previous = findMostRecentWorkingSet(exerciseId);

  resetSetEntryStepperEditUI();
  hidePersonalBestBanner();
  appState.editingSetId = null;
  const suggestion = planTarget ? planTarget.suggestion : null;
  appState.setDraft = {
    exerciseId,
    load: chooseStartingLoad(planTarget, suggestion, previous, exercise),
    reps: chooseStartingReps(planTarget, suggestion, previous),
    rir: previous ? previous.rir : 2,
    isWarmup: false
  };

  setEntryExerciseName.textContent = exercise.name;
  saveSetButton.textContent = "Save set";
  deleteSetButton.hidden = true;

  if (planTarget) {
    plannedTarget.textContent =
      `Planned: ${formatRepRange(planTarget.repsMin, planTarget.repsMax)} reps @ ${formatLoad(planTarget.load, exercise)}, ` +
      `RIR ${planTarget.targetRir}`;
    plannedTarget.hidden = false;
  } else {
    plannedTarget.hidden = true;
  }

  if (suggestion) {
    progressionSuggestion.textContent = describeProgression(suggestion, exercise);
    progressionSuggestion.hidden = false;
  } else {
    progressionSuggestion.hidden = true;
  }

  previousPerformance.textContent = describeLastSession(exerciseId);

  renderSetDraft();
  showSetEntryPanel();
}

// Where the load stepper starts: the progression suggestion if there is
// one, else the workout template's planned load, else last time's load, else an empty
// Olympic bar (20 kg) for an exercise that's never been done.
function chooseStartingLoad(planTarget, suggestion, previous, exercise) {
  // Once a set's already been logged for this exercise this session, later
  // sets default to that actual weight instead of resetting back to the
  // suggestion or the workout template's static target every time — the target only
  // matters for deciding where to *start* today, and by the second set
  // that's already been resolved into a real number.
  if (previous && previous.sessionId === appState.activeSessionId) {
    return previous.load;
  }
  if (suggestion) {
    return suggestion.load;
  }
  if (planTarget) {
    return planTarget.load;
  }
  return previous ? previous.load : defaultStartingLoad(exercise);
}

// For an exercise never done before: an empty Olympic bar (20 kg), or
// nothing added for a bodyweight exercise, whose load is only what's added.
function defaultStartingLoad(exercise) {
  return exercise && exercise.isBodyweight ? 0 : 20;
}

// Reps deliberately don't carry forward the same way load does: each set
// has its own target today (see targetRepsForSet in progression.js), which
// doesn't change just because an earlier set fell short of its own.
// A suggestion only ever arrives together with a planTarget, which says
// which set on the card was tapped.
function chooseStartingReps(planTarget, suggestion, previous) {
  if (suggestion) {
    return targetRepsForSet(suggestion, planTarget.setIndex);
  }
  if (planTarget) {
    return planTarget.repsMax;
  }
  return previous ? previous.reps : 8;
}

// Opens the same panel, but pre-filled from an already-logged set so it can
// be corrected in place, per the data rule that editing a set replaces it
// rather than creating a duplicate history entry.
function openSetEntryPanelForEdit(setId) {
  const set = appState.database.sets.find((candidate) => candidate.id === setId);
  const exercise = appState.database.exercises.find((candidate) => candidate.id === set.exerciseId);

  resetSetEntryStepperEditUI();
  hidePersonalBestBanner();
  appState.editingSetId = setId;
  appState.setDraft = {
    exerciseId: set.exerciseId,
    load: set.load,
    reps: set.reps,
    // A warmup's rir is stored as null; the stepper still needs a number to
    // display and count from if the warmup box gets unchecked.
    rir: set.rir === null ? 2 : set.rir,
    isWarmup: set.isWarmup
  };

  setEntryExerciseName.textContent = exercise.name;
  plannedTarget.hidden = true;
  progressionSuggestion.hidden = true;
  previousPerformance.textContent = "Editing a previously logged set.";
  saveSetButton.textContent = "Save changes";
  deleteSetButton.hidden = false;

  renderSetDraft();
  showSetEntryPanel();
}


// ---------------------------------------------------------------------------
// Where the set panel appears
//
// During a workout the panel opens inside the exercise's card, right under
// its pills, so what you tapped and the steppers stay next to each other.
// Anywhere else (editing a past set from History) there are no pills to sit
// under, so it stays a bottom sheet. It is one and the same element either
// way: it is moved around the page rather than duplicated, so all the
// stepper and button code above works unchanged wherever it sits.
// ---------------------------------------------------------------------------

// A comment node is invisible on the page, but marks the panel's original
// spot in index.html so it can be put back exactly there.
const setEntryPanelHomeMarker = document.createComment("set entry panel home");
setEntryPanel.before(setEntryPanelHomeMarker);

function showSetEntryPanel() {
  setEntryPanel.hidden = false;
  positionSetEntryPanel();
  // "nearest" scrolls only as far as needed to bring the whole panel on
  // screen, and not at all when it already is, so the pills just tapped
  // stay in view above it.
  setEntryPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function positionSetEntryPanel() {
  const anchor = findSetEntryPanelAnchor();
  if (anchor === null) {
    returnSetEntryPanelHome();
    return;
  }
  anchor.after(setEntryPanel);
  setEntryPanel.classList.remove("bottom-sheet");
  setEntryPanel.classList.add("inline-set-panel");
}

function returnSetEntryPanelHome() {
  setEntryPanelHomeMarker.after(setEntryPanel);
  setEntryPanel.classList.remove("inline-set-panel");
  setEntryPanel.classList.add("bottom-sheet");
}

// The element the panel should sit directly after, or null for "use the
// bottom sheet". Looked up fresh every time from the data-set-panel-anchor
// markers, rather than remembering the tapped element, because the cards
// are redrawn from scratch after almost every change and the old element
// would no longer be on the page.
function findSetEntryPanelAnchor() {
  if (activeWorkoutScreen.hidden) {
    return null;
  }
  const exerciseId = appState.setDraft.exerciseId;
  // Correcting a set from a free-form workout's review card: open under
  // that card's pills, where the tap came from.
  const isEditingFromReviewCard =
    appState.editingSetId !== null && appState.freeformReviewExerciseId === exerciseId;
  if (isEditingFromReviewCard) {
    return freeformReviewCardElement.querySelector(".set-pills");
  }
  // Only look inside whichever of the two layouts is in use: the other one
  // is hidden but can still hold leftover buttons from before, which would
  // otherwise match first and swallow the panel out of sight.
  const visibleExerciseArea = getActiveTemplate() ? templateWorkoutCardsElement : exerciseListElement;
  // CSS.escape makes any exercise id safe to put inside a selector, even
  // one with characters that would otherwise mean something to CSS.
  return visibleExerciseArea.querySelector(`[data-set-panel-anchor="${CSS.escape(exerciseId)}"]`);
}

// Closing the set panel shifts the page: the panel itself (a few hundred
// pixels tall, sitting inside the exercise card) disappears, and the rest
// timer, deload offer and cards are redrawn. The browser keeps the same
// scroll position through all that, so everything below slides up and you
// end up looking further down the list than where you were logging. This
// runs `updatePage` and then scrolls by exactly the amount the tapped
// exercise's pills moved, so they sit at the same spot on screen as before.
function keepTappedExerciseInPlace(updatePage) {
  const anchorBefore = setEntryPanel.hidden ? null : findSetEntryPanelAnchor();
  if (anchorBefore === null) {
    // Bottom sheet (History) or nothing open: there's nothing to keep put.
    updatePage();
    return;
  }
  const exerciseId = appState.setDraft.exerciseId;
  const wasInReviewCard = freeformReviewCardElement.contains(anchorBefore);
  const topBefore = anchorBefore.getBoundingClientRect().top;

  updatePage();

  // The old pills were thrown away by the redraw, so look up their
  // replacement. setDraft is cleared by now, which is why the exercise id
  // was saved above instead of calling findSetEntryPanelAnchor again.
  const anchorAfter = findRedrawnAnchor(exerciseId, wasInReviewCard);
  if (anchorAfter === null) {
    return;
  }
  const distanceMoved = anchorAfter.getBoundingClientRect().top - topBefore;
  window.scrollBy(0, distanceMoved);
}

function findRedrawnAnchor(exerciseId, wasInReviewCard) {
  if (wasInReviewCard) {
    return freeformReviewCardElement.hidden ? null : freeformReviewCardElement.querySelector(".set-pills");
  }
  const visibleExerciseArea = getActiveTemplate() ? templateWorkoutCardsElement : exerciseListElement;
  return visibleExerciseArea.querySelector(`[data-set-panel-anchor="${CSS.escape(exerciseId)}"]`);
}

function closeSetEntryPanel() {
  appState.setDraft = null;
  appState.editingSetId = null;
  setEntryPanel.hidden = true;
  // Back to its spot in index.html first, so the redraw below doesn't throw
  // it away along with the old cards.
  returnSetEntryPanelHome();
  // The cards' pills depend on which sets exist, so refresh them too. Safe
  // to call even while browsing History with no active workout — it just
  // redraws the (currently hidden) main-screen exercise area.
  renderExerciseArea();
  if (!freeformReviewCardElement.hidden) {
    renderFreeformReview();
  }
  if (!historyScreen.hidden) {
    renderHistoryList();
  }
  updateRestTimer();
}

// One shared handler for every stepper button pair (set entry and planned
// exercise entry both use this): which draft object, field, step, and floor
// to use are supplied by each button's own listener below, rather than
// writing a near-identical function per field.
function adjustDraftField(draftObject, field, step, minimum, render) {
  // Rounded because adding decimal steps like 1.25 can leave tiny
  // floating-point errors (see roundLoad in progression.js).
  const nextValue = roundLoad(draftObject[field] + step);
  draftObject[field] = Math.max(nextValue, minimum);
  render();
}

// Wires up "tap the number to type it" for one stepper: tapping the value
// button swaps the +/- buttons and the value for a real number input, for
// setting a large change directly instead of tapping +/- dozens of times
// (jumping 20kg to 100kg at 2.5kg a tap is 32 taps). Confirms on blur or
// Enter; Escape discards the typed text and confirms the unchanged value
// instead, so there's only one code path that actually commits anything.
//
// `getDraftObject` is a function, not the draft object itself, because the
// object it points to (appState.setDraft, appState.plannedExerciseDraft, or
// appState itself for bodyweight) doesn't exist yet when this runs at
// startup — it's only read once the value is actually tapped.
function makeStepperValueEditable(
  valueButton, valueInput, decrementButton, incrementButton, getDraftObject, field, minimum, isInteger, render
) {
  function endEdit() {
    const draftObject = getDraftObject();
    const parsed = parseFloat(valueInput.value);
    if (!Number.isNaN(parsed)) {
      const value = isInteger ? Math.round(parsed) : parsed;
      draftObject[field] = Math.max(value, minimum);
    }
    valueInput.hidden = true;
    decrementButton.hidden = false;
    valueButton.hidden = false;
    incrementButton.hidden = false;
    render();
  }

  valueButton.addEventListener("click", () => {
    decrementButton.hidden = true;
    valueButton.hidden = true;
    incrementButton.hidden = true;
    valueInput.hidden = false;
    valueInput.value = getDraftObject()[field];
    valueInput.focus();
    valueInput.select();
  });

  valueInput.addEventListener("blur", endEdit);
  valueInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      valueInput.blur();
    } else if (event.key === "Escape") {
      valueInput.value = getDraftObject()[field];
      valueInput.blur();
    }
  });
}

// The load stepper moves by the exercise's own minimum raise (schema.js),
// so a 5 kg machine stack steps 45 → 50 → 55 rather than landing on
// weights the machine can't actually be set to. Looked up on every tap,
// because the same stepper serves whichever exercise the panel is open for.
function getLoadStep(exerciseId) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  return exercise.minimumLoadIncrement;
}

document.getElementById("loadDecrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "load", -getLoadStep(appState.setDraft.exerciseId), 0, renderSetDraft));
document.getElementById("loadIncrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "load", getLoadStep(appState.setDraft.exerciseId), 0, renderSetDraft));
document.getElementById("repsDecrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "reps", -1, 1, renderSetDraft));
document.getElementById("repsIncrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "reps", 1, 1, renderSetDraft));

makeStepperValueEditable(
  document.getElementById("loadValue"), document.getElementById("loadValueInput"),
  document.getElementById("loadDecrement"), document.getElementById("loadIncrement"),
  () => appState.setDraft, "load", 0, false, renderSetDraft
);
makeStepperValueEditable(
  document.getElementById("repsValue"), document.getElementById("repsValueInput"),
  document.getElementById("repsDecrement"), document.getElementById("repsIncrement"),
  () => appState.setDraft, "reps", 1, true, renderSetDraft
);
warmupToggleButton.addEventListener("click", () => {
  appState.setDraft.isWarmup = !appState.setDraft.isWarmup;
  renderSetDraft();
});

saveSetButton.addEventListener("click", () => {
  keepTappedExerciseInPlace(saveSetDraft);
});

document.getElementById("cancelSetButton").addEventListener("click", () => {
  keepTappedExerciseInPlace(closeSetEntryPanel);
});

function saveSetDraft() {
  const draft = appState.setDraft;
  // RIR is meaningless for a warmup, so it's stored as null rather than a
  // made-up number — schema.js's contract calls this out explicitly.
  const rir = draft.isWarmup ? null : draft.rir;

  if (appState.editingSetId) {
    // Editing replaces the existing record's fields in place — same id,
    // same sessionId/order/performedAt — rather than creating a second
    // history entry for what is still conceptually one set.
    const existingSet = appState.database.sets.find((set) => set.id === appState.editingSetId);
    existingSet.load = draft.load;
    existingSet.reps = draft.reps;
    existingSet.rir = rir;
    existingSet.isWarmup = draft.isWarmup;
  } else {
    // A set's position within its session. Counting existing sets for this
    // session works as an order number without needing a separate counter.
    const order = appState.database.sets.filter(
      (set) => set.sessionId === appState.activeSessionId
    ).length;

    const newSet = {
      id: crypto.randomUUID(),
      sessionId: appState.activeSessionId,
      exerciseId: draft.exerciseId,
      order,
      load: draft.load,
      reps: draft.reps,
      rir,
      isWarmup: draft.isWarmup,
      performedAt: new Date().toISOString()
    };

    // Checked against sets logged before this one, so it has to run before
    // the push below adds this set to that same list.
    const personalBest = checkForPersonalBest(draft.exerciseId, newSet);
    appState.database.sets.push(newSet);

    if (personalBest.isWeightPR || personalBest.isVolumePR) {
      const exercise = appState.database.exercises.find((candidate) => candidate.id === draft.exerciseId);
      showPersonalBestBanner(exercise.name, personalBest);
    }
  }

  saveDatabase(appState.database);
  closeSetEntryPanel();
  // The workout's deload offer is only for before the first set.
  renderBackstopOfferCards();
}

deleteSetButton.addEventListener("click", () => {
  // A set is a leaf record nothing else references by id, unlike Exercise or
  // WorkoutTemplate, so an explicit, confirmed delete (per the data rules)
  // can remove it outright rather than archiving it.
  const confirmed = confirm("Delete this set? This can't be undone.");
  if (!confirmed) {
    return;
  }

  const index = appState.database.sets.findIndex((set) => set.id === appState.editingSetId);
  appState.database.sets.splice(index, 1);
  saveDatabase(appState.database);
  keepTappedExerciseInPlace(closeSetEntryPanel);
});


// ---------------------------------------------------------------------------
// Catch-up workout: this week's planned sets that weren't done
// ---------------------------------------------------------------------------

function isThisWeek(isoString) {
  const { start, end } = getCurrentWeekRange();
  const date = new Date(isoString);
  return date >= start && date < end;
}

// Everything a template workout planned for that day, skipped exercises
// included: a skipped exercise is the clearest case of sets not done.
function getEverythingPlannedForSession(session, template) {
  const skipped = template.plannedExercises
    .filter((planned) => session.removedExerciseIds.includes(planned.exerciseId))
    .map((planned) => applyDeloadSetCount(session, applyReplacement(session, planned)));
  return getSessionPlannedExercises(session, template).concat(skipped);
}

// How many of each planned exercise's sets one finished workout didn't
// do, as a list of { planned, missedSets }, leaving out what was done in
// full. Extra sets beyond the plan don't make up for another exercise.
function findMissedSetsInSession(session, template) {
  const missed = [];
  for (const planned of getEverythingPlannedForSession(session, template)) {
    const doneSets = appState.database.sets.filter(
      (set) => set.sessionId === session.id && set.exerciseId === planned.exerciseId && !set.isWarmup
    ).length;
    if (doneSets < planned.targetSets) {
      missed.push({ planned, missedSets: planned.targetSets - doneSets });
    }
  }
  return missed;
}

// How many working sets of each exercise this week's catch-up workouts
// already did, as a Map from exercise id to a count. A set done on a
// replacement counts for the exercise it stood in for, since that's the
// one the catch-up plan listed.
function countCatchUpSetsDoneThisWeek() {
  const doneByExerciseId = new Map();
  const catchUpSessions = appState.database.sessions.filter(
    (session) => session.catchUpExercises && isThisWeek(session.startedAt)
  );
  for (const session of catchUpSessions) {
    for (const set of appState.database.sets) {
      if (set.sessionId !== session.id || set.isWarmup) {
        continue;
      }
      const plannedExerciseId = getTemplateExerciseId(session, set.exerciseId);
      doneByExerciseId.set(plannedExerciseId, (doneByExerciseId.get(plannedExerciseId) || 0) + 1);
    }
  }
  return doneByExerciseId;
}

// The catch-up plan: every set this week's finished template workouts
// planned but didn't do, minus whatever catch-up workouts this week have
// made up since. Same shape as a template's plannedExercises, with
// targetSets being the sets still missing. Empty when nothing is.
//
// Only the latest finished workout of each template counts, same as the
// home screen's "done this week" (findMostRecentFinishedSessionThisWeek).
// An exercise missed in two workouts becomes one entry with both sets
// added together, keeping the first one's rep range and load: two cards
// for one exercise would mix up which sets belong to which.
function findMissedSetsThisWeek() {
  const missedByExerciseId = new Map();
  const activeTemplates = appState.database.workoutTemplates.filter((template) => !template.isArchived);
  for (const template of activeTemplates) {
    const session = findMostRecentFinishedSessionThisWeek(template.id);
    if (!session) {
      continue;
    }
    for (const { planned, missedSets } of findMissedSetsInSession(session, template)) {
      const existing = missedByExerciseId.get(planned.exerciseId);
      if (existing) {
        existing.targetSets += missedSets;
      } else {
        missedByExerciseId.set(planned.exerciseId, {
          exerciseId: planned.exerciseId,
          // So suggestions follow this template's history (see
          // findWorkoutTemplateIdOf in progression.js).
          fromTemplateId: template.id,
          targetSets: missedSets,
          targetRepsMin: planned.targetRepsMin,
          targetRepsMax: planned.targetRepsMax,
          targetLoad: planned.targetLoad,
          targetRir: planned.targetRir,
          // A goal set by hand belongs to its template, not to this plan.
          targetLoadSetAt: null
        });
      }
    }
  }

  const doneByExerciseId = countCatchUpSetsDoneThisWeek();
  const stillMissing = [];
  for (const planned of missedByExerciseId.values()) {
    planned.targetSets -= doneByExerciseId.get(planned.exerciseId) || 0;
    if (planned.targetSets > 0) {
      stillMissing.push(planned);
    }
  }
  return stillMissing;
}

const weeklyWorkoutTemplateSummaryElement = document.getElementById("weeklyWorkoutTemplateSummary");
const weeklyBarsElement = document.getElementById("weeklyBars");

function renderWeeklyWorkoutTemplateSummary() {
  // Only meaningful as a "what's left this week" dashboard when there's
  // nothing currently being logged — during a workout, the exercise cards
  // themselves are that context.
  if (appState.activeSessionId !== null) {
    weeklyWorkoutTemplateSummaryElement.hidden = true;
    return;
  }

  const activeTemplates = appState.database.workoutTemplates.filter((template) => !template.isArchived);
  if (activeTemplates.length === 0) {
    weeklyWorkoutTemplateSummaryElement.hidden = true;
    return;
  }
  weeklyWorkoutTemplateSummaryElement.hidden = false;

  weeklyBarsElement.innerHTML = "";
  let completedCount = 0;

  for (const template of activeTemplates) {
    const mostRecentSession = findMostRecentFinishedSessionThisWeek(template.id);
    if (mostRecentSession) {
      completedCount++;
    }

    const barContainer = document.createElement("div");
    barContainer.className = "weekly-bar-container";

    const track = document.createElement("div");
    track.className = "weekly-bar-track";

    if (mostRecentSession) {
      const percent = computeWorkoutTemplateCompletionPercent(template, mostRecentSession);
      const fill = document.createElement("div");
      fill.className = "weekly-bar-fill";
      // A floor so even a low percentage still shows a visible sliver
      // instead of looking identical to "not done".
      fill.style.height = `${Math.max(percent, 8)}%`;
      // Below this the green part is shorter than the label's text, which
      // would be cut off — so the label moves to sit just above the fill.
      const minimumPercentThatFitsLabel = 20;
      if (percent < minimumPercentThatFitsLabel) {
        fill.classList.add("weekly-bar-fill-short");
      }
      const percentLabel = document.createElement("span");
      percentLabel.className = "weekly-bar-percent";
      percentLabel.textContent = `${percent}%`;
      fill.appendChild(percentLabel);
      track.appendChild(fill);
    }
    barContainer.appendChild(track);

    const label = document.createElement("div");
    label.className = "weekly-bar-label";
    label.textContent = template.name;
    barContainer.appendChild(label);

    if (mostRecentSession) {
      const dateLabel = document.createElement("div");
      dateLabel.className = "weekly-bar-date";
      dateLabel.textContent = formatSessionDate(mostRecentSession.startedAt);
      barContainer.appendChild(dateLabel);
    }

    weeklyBarsElement.appendChild(barContainer);
  }

  document.getElementById("weeklyWorkoutTemplateSummaryHeading").textContent =
    `This week's workouts — ${completedCount}/${activeTemplates.length} done`;
}


// ---------------------------------------------------------------------------
// Changing the exercises of the workout in progress
//
// Adding reuses the exercise picker and the target panel above; removing
// has a small panel of its own. Either can apply to this workout only
// (stored on the session, see Session in schema.js) or to the template as
// well, so it's there next time too.
// ---------------------------------------------------------------------------

const savePlannedExerciseToTemplateButton = document.getElementById("savePlannedExerciseToTemplateButton");

function openExercisePickerForActiveWorkout() {
  appState.exercisePickerPurpose = "activeWorkout";
  activeWorkoutScreen.hidden = true;
  exercisePickerScreen.hidden = false;
  renderExercisePicker();
  window.scrollTo(0, 0);
}

// Starting targets: the template's own, when it still lists this exercise
// (it was only skipped for today). Otherwise 3 × 8-10 at the load last used
// for this exercise, if any, so the load stepper needs a few taps at most;
// otherwise defaultStartingLoad (an empty bar, or nothing added).
function chooseTargetsForAddingToWorkout(exercise, template) {
  const plannedInTemplate = template.plannedExercises.find((planned) => planned.exerciseId === exercise.id);
  if (plannedInTemplate) {
    return { ...plannedInTemplate };
  }
  const previous = findMostRecentWorkingSet(exercise.id);
  return {
    exerciseId: exercise.id,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetLoad: previous ? previous.load : defaultStartingLoad(exercise),
    targetRir: defaultTargetRir(10),
    targetLoadSetAt: null
  };
}

function openTargetPanelForAddingToWorkout(exercise) {
  const template = getActiveTemplate();
  appState.isAddingExerciseToWorkout = true;
  appState.plannedExerciseDraft = chooseTargetsForAddingToWorkout(exercise, template);
  // A copy of the template's own targets already has a chosen RIR; a fresh
  // one still follows its rep range.
  appState.isTargetRirSetByHand = template.plannedExercises.some((planned) => planned.exerciseId === exercise.id);

  document.getElementById("plannedExerciseEntryName").textContent = exercise.name;
  plannedExerciseEntryHint.textContent = template.isCatchUp
    ? "Add it to this catch-up workout."
    : `Add it to today's workout only, or to "${template.name}" as well so it's there next time too.`;
  plannedExerciseEntryHint.hidden = false;
  // The two save buttons are the "only today, or the template too?"
  // question, so choosing is one tap with no extra dialog afterwards. A
  // catch-up workout has no template, so only the first applies.
  document.getElementById("savePlannedExerciseButton").textContent = template.isCatchUp ? "Add" : "Only today";
  savePlannedExerciseToTemplateButton.textContent = "Today + template";
  savePlannedExerciseToTemplateButton.hidden = Boolean(template.isCatchUp);

  renderPlannedExerciseDraft();
  exercisePickerScreen.hidden = true;
  activeWorkoutScreen.hidden = false;
  plannedExerciseEntryPanel.hidden = false;
}

function closeTargetPanelForAddingToWorkout() {
  appState.isAddingExerciseToWorkout = false;
  appState.exercisePickerPurpose = null;
  appState.plannedExerciseDraft = null;
  plannedExerciseEntryPanel.hidden = true;
  resetPlannedExerciseEntryPanelToAddMode();
  renderExerciseArea();
}

function addDraftExerciseToActiveWorkout(isAlsoAddedToTemplate) {
  const session = getActiveSession();
  const template = getActiveTemplate();
  const draft = appState.plannedExerciseDraft;

  // The exercise might have been skipped for today earlier; adding it back
  // undoes that skip, whichever button was used.
  session.removedExerciseIds = session.removedExerciseIds.filter((id) => id !== draft.exerciseId);

  if (isAlsoAddedToTemplate) {
    // If the template still lists it (it was only skipped for today), its
    // targets are updated rather than listing it twice.
    const existingPlanned = template.plannedExercises.find((planned) => planned.exerciseId === draft.exerciseId);
    if (existingPlanned) {
      Object.assign(existingPlanned, draft);
    } else {
      template.plannedExercises.push(draft);
    }
  } else {
    session.addedExercises.push(draft);
  }

  saveDatabase(appState.database);
  closeTargetPanelForAddingToWorkout();
}

savePlannedExerciseToTemplateButton.addEventListener("click", () => addDraftExerciseToActiveWorkout(true));

const removeExerciseHeading = document.getElementById("removeExerciseHeading");
const removeExerciseHint = document.getElementById("removeExerciseHint");
const removeExerciseTodayButton = document.getElementById("removeExerciseTodayButton");
const removeExerciseFromTemplateButton = document.getElementById("removeExerciseFromTemplateButton");
const replaceExerciseButton = document.getElementById("replaceExerciseButton");
const restoreOriginalExerciseButton = document.getElementById("restoreOriginalExerciseButton");

function hasSetsInActiveWorkout(exerciseId) {
  return appState.database.sets.some(
    (set) => set.sessionId === appState.activeSessionId && set.exerciseId === exerciseId
  );
}

// Which of the two remove buttons make sense depends on where the exercise
// came from and whether it already has sets today. Logged sets are never
// deleted from here: an exercise with sets today keeps its card today.
function openRemoveExercisePanel(exerciseId) {
  const session = getActiveSession();
  const template = getActiveTemplate();
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const hasSetsToday = hasSetsInActiveWorkout(exerciseId);
  const isTodayOnly = isAddedForThisWorkoutOnly(session, exerciseId);
  // A template has to keep at least one exercise, same rule as the
  // template editor's Save button.
  const isLastInTemplate = template.plannedExercises.length === 1;
  // A catch-up workout has no template to remove anything from.
  const canRemoveFromTemplate = !isTodayOnly && !isLastInTemplate && !template.isCatchUp;

  appState.removeExerciseTargetId = exerciseId;
  removeExerciseHeading.textContent = `Remove ${exercise.name}?`;
  removeExerciseTodayButton.hidden = hasSetsToday;
  removeExerciseTodayButton.textContent = isTodayOnly ? "Remove" : "Skip it today only";
  removeExerciseFromTemplateButton.hidden = !canRemoveFromTemplate;
  removeExerciseFromTemplateButton.textContent = hasSetsToday
    ? `Remove from "${template.name}" from next time`
    : `Remove today and from "${template.name}"`;

  if (isTodayOnly && hasSetsToday) {
    removeExerciseHint.textContent =
      "It already has sets logged today. Delete those sets first (long-press a pill) to remove it.";
  } else if (isTodayOnly) {
    removeExerciseHint.textContent = "It was added for today only, so the template isn't affected.";
  } else if (hasSetsToday) {
    removeExerciseHint.textContent = "It already has sets logged today, so it stays in today's workout.";
  } else {
    removeExerciseHint.textContent = "";
  }
  if (!isTodayOnly && isLastInTemplate && !template.isCatchUp) {
    removeExerciseHint.textContent += " It's the only exercise in the template, so it can't be removed from there.";
  }

  showReplacementButtons(session, exerciseId, !hasSetsToday && !isTodayOnly);
  removeExercisePanel.hidden = false;
}

// The panel's gym buttons: "Not available at <gym>" picks a replacement
// that this gym then remembers, and on a replacement's card, "Back to
// <original>" undoes the swap. Both only before any sets are logged on the
// card, since swapping would leave those sets on a card that's gone. And
// only for a template exercise at a known gym: an exercise added for today
// can just be removed, and with no gym there's nowhere to remember it.
function showReplacementButtons(session, exerciseId, canSwapToday) {
  const gym = appState.database.gyms.find((candidate) => candidate.id === session.gymId);
  const replacement = findReplacementBy(session, exerciseId);

  replaceExerciseButton.hidden = !gym || !canSwapToday;
  if (gym) {
    replaceExerciseButton.textContent = `Not available at ${gym.name}`;
  }

  restoreOriginalExerciseButton.hidden = !replacement || !canSwapToday;
  if (replacement) {
    const original = appState.database.exercises.find((candidate) => candidate.id === replacement.exerciseId);
    restoreOriginalExerciseButton.textContent = `Back to ${original.name}`;
  }
}

// A replacement's card is about the replacement, but the template (and
// the skip list) only know the exercise it stands in for.
function getTemplateExerciseId(session, cardExerciseId) {
  const replacement = findReplacementBy(session, cardExerciseId);
  return replacement ? replacement.exerciseId : cardExerciseId;
}

function closeRemoveExercisePanel() {
  appState.removeExerciseTargetId = null;
  removeExercisePanel.hidden = true;
  renderExerciseArea();
}

function removeExerciseFromActiveWorkoutOnly(exerciseId) {
  const session = getActiveSession();
  if (isAddedForThisWorkoutOnly(session, exerciseId)) {
    session.addedExercises = session.addedExercises.filter((planned) => planned.exerciseId !== exerciseId);
  } else {
    session.removedExerciseIds.push(getTemplateExerciseId(session, exerciseId));
  }
}

// With sets already logged today, a copy of its targets moves to this
// workout's own list, so today's card (and its logged sets) stays put
// while the template drops it from next time on. listPosition (see Session
// in schema.js) keeps the card in the same place in today's list.
//
// For a replacement's card, it's the original that leaves the template.
// The card copied into today's list is the replacement as done today, and
// the swap itself is dropped: with the original gone from the template,
// there's nothing left for it to swap.
function removeExerciseFromTemplate(exerciseId) {
  const session = getActiveSession();
  const template = getActiveTemplate();
  const templateExerciseId = getTemplateExerciseId(session, exerciseId);
  const todaysList = getSessionPlannedExercises(session, template);
  const placeInTodaysList = todaysList.findIndex((candidate) => candidate.exerciseId === exerciseId);
  const todaysCard = todaysList[placeInTodaysList];
  template.plannedExercises = template.plannedExercises.filter(
    (candidate) => candidate.exerciseId !== templateExerciseId
  );
  session.replacedExercises = session.replacedExercises.filter(
    (replacement) => replacement.exerciseId !== templateExerciseId
  );
  if (hasSetsInActiveWorkout(exerciseId)) {
    // `{ ...todaysCard }` makes a separate copy of the object, so the two
    // lists never share (and accidentally co-edit) one object.
    // replacesExerciseId only belongs on a day-list copy (see
    // applyReplacement), so it's taken back off before saving.
    const savedCard = { ...todaysCard, listPosition: placeInTodaysList };
    delete savedCard.replacesExerciseId;
    session.addedExercises.push(savedCard);
  }
}

removeExerciseTodayButton.addEventListener("click", () => {
  removeExerciseFromActiveWorkoutOnly(appState.removeExerciseTargetId);
  saveDatabase(appState.database);
  closeRemoveExercisePanel();
});

removeExerciseFromTemplateButton.addEventListener("click", () => {
  removeExerciseFromTemplate(appState.removeExerciseTargetId);
  saveDatabase(appState.database);
  closeRemoveExercisePanel();
});

document.getElementById("cancelRemoveExerciseButton").addEventListener("click", closeRemoveExercisePanel);

// The exercise picker is reused to choose the replacement. The target id
// stays set while the picker is open, so it's known what is being
// replaced; the panel itself is hidden, not closed.
replaceExerciseButton.addEventListener("click", () => {
  removeExercisePanel.hidden = true;
  appState.exercisePickerPurpose = "replacement";
  activeWorkoutScreen.hidden = true;
  exercisePickerScreen.hidden = false;
  renderExercisePicker();
  window.scrollTo(0, 0);
});

restoreOriginalExerciseButton.addEventListener("click", () => {
  const session = getActiveSession();
  const originalExerciseId = getTemplateExerciseId(session, appState.removeExerciseTargetId);
  session.replacedExercises = session.replacedExercises.filter(
    (replacement) => replacement.exerciseId !== originalExerciseId
  );
  forgetGymReplacement(session.gymId, originalExerciseId);
  refreshSessionDeloadExerciseIds(session);
  saveDatabase(appState.database);
  closeRemoveExercisePanel();
});

// Swaps the card's exercise for `replacementExercise` in this workout, and
// has the gym remember it, so the swap happens by itself next time. When
// the card is already a replacement, the new choice replaces that one:
// it's always the template's exercise that's being stood in for.
function replaceExerciseAtThisGym(cardExerciseId, replacementExercise) {
  const session = getActiveSession();
  const originalExerciseId = getTemplateExerciseId(session, cardExerciseId);
  const newReplacement = { exerciseId: originalExerciseId, replacementExerciseId: replacementExercise.id };

  session.replacedExercises = session.replacedExercises
    .filter((replacement) => replacement.exerciseId !== originalExerciseId)
    .concat({ ...newReplacement });
  refreshSessionDeloadExerciseIds(session);

  const gym = appState.database.gyms.find((candidate) => candidate.id === session.gymId);
  gym.exerciseReplacements = gym.exerciseReplacements
    .filter((replacement) => replacement.exerciseId !== originalExerciseId)
    .concat({ ...newReplacement });
}

function forgetGymReplacement(gymId, originalExerciseId) {
  const gym = appState.database.gyms.find((candidate) => candidate.id === gymId);
  gym.exerciseReplacements = gym.exerciseReplacements.filter(
    (replacement) => replacement.exerciseId !== originalExerciseId
  );
}

function chooseReplacementFromPicker(exercise) {
  replaceExerciseAtThisGym(appState.removeExerciseTargetId, exercise);
  saveDatabase(appState.database);
  appState.exercisePickerPurpose = null;
  exercisePickerScreen.hidden = true;
  activeWorkoutScreen.hidden = false;
  closeRemoveExercisePanel();
}


// ---------------------------------------------------------------------------
// Unfinished workouts
//
// Which workout is in progress lives only in memory (appState), but phones
// close background web apps whenever they like — e.g. while the screen is
// locked between sets. The workout itself is safely stored, just with no
// endedAt, so on startup it can be picked back up. Without this it would
// stay unfinished forever: missing from History, yet its sets would still
// feed progression suggestions, personal bests and stats.
// ---------------------------------------------------------------------------

// Long enough to cover a long rest between sets or exercises, short enough
// that yesterday's forgotten workout isn't reopened the next morning.
const HOURS_WITHIN_WHICH_A_WORKOUT_RESUMES = 3;

// The newest unfinished workout is resumed if it saw activity recently.
// Every other unfinished workout is finished as of its last set, so it
// shows up in History like any other.
function recoverUnfinishedSessions() {
  const unfinishedSessions = appState.database.sessions
    .filter((session) => session.endedAt === null)
    .sort((a, b) => findLastActivityTime(b).localeCompare(findLastActivityTime(a)));
  if (unfinishedSessions.length === 0) {
    return;
  }

  const newestSession = unfinishedSessions[0];
  if (isRecentEnoughToResume(newestSession)) {
    appState.activeSessionId = newestSession.id;
  } else {
    closeUnfinishedSession(newestSession);
  }
  for (const olderSession of unfinishedSessions.slice(1)) {
    closeUnfinishedSession(olderSession);
  }
  saveDatabase(appState.database);
}

// When the last set was logged, or when the workout started if no set was.
// Either way an ISO string, so two of them compare correctly as text.
function findLastActivityTime(session) {
  let lastActivityTime = session.startedAt;
  for (const set of appState.database.sets) {
    if (set.sessionId === session.id && set.performedAt > lastActivityTime) {
      lastActivityTime = set.performedAt;
    }
  }
  return lastActivityTime;
}

function isRecentEnoughToResume(session) {
  const millisecondsSinceActivity = Date.now() - new Date(findLastActivityTime(session)).getTime();
  const hoursSinceActivity = millisecondsSinceActivity / (60 * 60 * 1000);
  return hoursSinceActivity <= HOURS_WITHIN_WHICH_A_WORKOUT_RESUMES;
}

// An empty workout is dropped rather than finished, same as ending one by
// hand (see isSessionEmpty).
function closeUnfinishedSession(session) {
  if (isSessionEmpty(session)) {
    deleteSessionAndItsSets(session.id);
    return;
  }
  finishSessionAtLastActivity(session);
}

// The real end time is unknown, so the last logged set stands in for it —
// the closest thing to "when training actually stopped" there is.
function finishSessionAtLastActivity(session) {
  session.endedAt = findLastActivityTime(session);
}
