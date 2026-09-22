// ---------------------------------------------------------------------------
// App logic for the workout logger.
//
// All reading and writing of saved data happens through the functions in
// schema.js (loadDatabase, saveDatabase, exportDatabase, importDatabase).
// This file only holds UI behaviour: what's on screen and what happens when
// the user taps something.
// ---------------------------------------------------------------------------

// Loading can fail if localStorage holds data saved under an older
// SCHEMA_VERSION (see schema.js) — there's no migration written yet, so
// rather than leaving the app permanently broken, this starts fresh and says
// so clearly, instead of silently discarding whatever was there.
let initialDatabase;
try {
  initialDatabase = loadDatabase();
} catch (error) {
  console.error("Could not load saved data, starting fresh.", error);
  alert(
    "Saved data was from an older version of this app and could not be loaded. Starting with a blank database."
  );
  initialDatabase = createEmptyDatabase();
}

// The single app-state object.
const appState = {
  database: initialDatabase,
  activeSessionId: null,       // null unless a workout is in progress
  setDraft: null,               // in-progress values for the set being logged
  editingSetId: null,           // id of an existing set being corrected, or null when logging a new one
  schemeDraft: null,           // in-progress copy of the scheme being edited
  plannedExerciseDraft: null,  // in-progress values for a planned exercise
  pendingTemplateId: null,     // scheme chosen at Start Workout, held while the gym picker is open
  nextGoalTarget: null,        // { templateId, exerciseId } while adjusting an existing planned exercise's target from a workout card; null otherwise
  freeformReviewExerciseId: null // which exercise's logged-sets review card is open, in a free-form workout; null otherwise
};

// On a brand-new install the exercise library is empty. Fill it with the
// starter list once, and save immediately so a page refresh doesn't lose it
// (loadDatabase() would otherwise just return an empty list again).
if (appState.database.exercises.length === 0) {
  appState.database.exercises = STARTER_EXERCISES;
  saveDatabase(appState.database);
}


// ---------------------------------------------------------------------------
// Screens
//
// The app has several full-screen sections that are never shown at once.
// Rather than a router, this just toggles each section's `hidden` attribute
// directly — simple enough for the handful of screens this app has.
// ---------------------------------------------------------------------------

const mainScreen = document.getElementById("mainScreen");
const schemesScreen = document.getElementById("schemesScreen");
const schemeEditorScreen = document.getElementById("schemeEditorScreen");
const exercisePickerScreen = document.getElementById("exercisePickerScreen");
const plannedExerciseEntryPanel = document.getElementById("plannedExerciseEntryPanel");
const exercisesScreen = document.getElementById("exercisesScreen");
const historyScreen = document.getElementById("historyScreen");
const gymsScreen = document.getElementById("gymsScreen");
const gymPickerScreen = document.getElementById("gymPickerScreen");

// Every top-level screen, so each show*Screen() function below can hide all
// of them and then reveal just its own, without repeating this list six times.
const allScreens = [
  mainScreen, schemesScreen, schemeEditorScreen, exercisePickerScreen,
  plannedExerciseEntryPanel, exercisesScreen, historyScreen, gymsScreen, gymPickerScreen
];

function hideAllScreens() {
  for (const screen of allScreens) {
    screen.hidden = true;
  }
}

function showMainScreen() {
  hideAllScreens();
  mainScreen.hidden = false;
}

function showSchemesScreen() {
  hideAllScreens();
  schemesScreen.hidden = false;
  renderSchemesList();
}

function showSchemeEditorScreen() {
  hideAllScreens();
  schemeEditorScreen.hidden = false;
  renderSchemeEditor();
}

function showExercisesScreen() {
  hideAllScreens();
  exercisesScreen.hidden = false;
  renderExercisesManageList();
}

function showHistoryScreen() {
  hideAllScreens();
  historyScreen.hidden = false;
  renderHistoryList();
}

function showGymsScreen() {
  hideAllScreens();
  gymsScreen.hidden = false;
  renderGymsManageList();
}

function showGymPickerScreen() {
  hideAllScreens();
  gymPickerScreen.hidden = false;
  renderGymPicker();
}

document.getElementById("manageSchemesButton").addEventListener("click", showSchemesScreen);
document.getElementById("backFromSchemesButton").addEventListener("click", showMainScreen);
document.getElementById("manageExercisesButton").addEventListener("click", showExercisesScreen);
document.getElementById("backFromExercisesButton").addEventListener("click", showMainScreen);
document.getElementById("viewHistoryButton").addEventListener("click", showHistoryScreen);
document.getElementById("backFromHistoryButton").addEventListener("click", showMainScreen);
document.getElementById("manageGymsButton").addEventListener("click", showGymsScreen);
document.getElementById("backFromGymsButton").addEventListener("click", showMainScreen);


// ---------------------------------------------------------------------------
// Looking up the active session and the scheme it follows
// ---------------------------------------------------------------------------

function getActiveSession() {
  if (appState.activeSessionId === null) {
    return null;
  }
  return appState.database.sessions.find((session) => session.id === appState.activeSessionId) || null;
}

// Returns the WorkoutTemplate the current workout is following, or null for
// a free-form workout (or when no workout is active).
function getActiveTemplate() {
  const session = getActiveSession();
  if (!session || !session.templateId) {
    return null;
  }
  return appState.database.workoutTemplates.find((template) => template.id === session.templateId) || null;
}


// ---------------------------------------------------------------------------
// Exercise list (main screen)
// ---------------------------------------------------------------------------

const exerciseListElement = document.getElementById("exerciseList");
const schemeWorkoutCardsElement = document.getElementById("schemeWorkoutCards");

// Redraws whichever exercise area applies right now: the full free-form
// library when there's no active scheme, or a card per planned exercise
// (each holding one pill per target set) when there is one.
function renderExerciseArea() {
  const template = getActiveTemplate();
  if (template) {
    exerciseListElement.hidden = true;
    schemeWorkoutCardsElement.hidden = false;
    renderSchemeWorkoutCards(template);
  } else {
    exerciseListElement.hidden = false;
    schemeWorkoutCardsElement.hidden = true;
    renderFreeformExerciseList();
  }
}

function renderFreeformExerciseList() {
  exerciseListElement.innerHTML = "";

  // Archived exercises stay in the data (old sets/schemes still reference
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
    weightSpan.textContent = `${set.load} kg`;

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
function buildSetPill(loggedSet, planned) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = loggedSet ? "set-pill set-pill-done" : "set-pill set-pill-pending";

  const weightSpan = document.createElement("span");
  weightSpan.className = "set-pill-weight";
  weightSpan.textContent = `${loggedSet ? loggedSet.load : planned.targetLoad} kg`;

  const repsSpan = document.createElement("span");
  repsSpan.className = "set-pill-reps";
  repsSpan.textContent = loggedSet
    ? `${loggedSet.reps}/${planned.targetRepsMin}-${planned.targetRepsMax}`
    : `${planned.targetRepsMin}-${planned.targetRepsMax}`;

  pill.append(weightSpan, repsSpan);

  pill.addEventListener("click", () => {
    if (loggedSet) {
      openSetEntryPanelForEdit(loggedSet.id);
    } else {
      openSetEntryPanel(planned.exerciseId, {
        load: planned.targetLoad,
        repsMin: planned.targetRepsMin,
        repsMax: planned.targetRepsMax
      });
    }
  });

  return pill;
}

// One card per planned exercise, shown all at once — order doesn't matter,
// since any pill in any card can be tapped first.
function renderSchemeWorkoutCards(template) {
  schemeWorkoutCardsElement.innerHTML = "";

  for (const planned of template.plannedExercises) {
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
    cardElement.appendChild(headingElement);

    const pillRowElement = document.createElement("div");
    pillRowElement.className = "set-pills";

    // One pill per planned set, filled in from whatever's actually been
    // logged so far for it.
    for (let setIndex = 0; setIndex < planned.targetSets; setIndex++) {
      pillRowElement.appendChild(buildSetPill(loggedSets[setIndex], planned));
    }

    // Any sets logged beyond the planned count (via the "+" pill below) get
    // their own pills too, rather than being invisible here.
    for (let setIndex = planned.targetSets; setIndex < loggedSets.length; setIndex++) {
      pillRowElement.appendChild(buildSetPill(loggedSets[setIndex], planned));
    }

    const addPill = document.createElement("button");
    addPill.type = "button";
    addPill.className = "set-pill set-pill-add";
    addPill.textContent = "+";
    addPill.addEventListener("click", () => openSetEntryPanel(planned.exerciseId));
    pillRowElement.appendChild(addPill);

    cardElement.appendChild(pillRowElement);

    // Adjusts this exercise's target sets/reps/load on the scheme itself,
    // so it's what shows next time this scheme is started (and for any of
    // today's pills for this exercise not yet logged, since they read the
    // same target).
    const nextGoalButton = document.createElement("button");
    nextGoalButton.type = "button";
    nextGoalButton.className = "card-action-button";
    nextGoalButton.textContent = "Set goal for next time";
    nextGoalButton.addEventListener("click", () => openNextGoalEditor(template.id, planned.exerciseId));
    cardElement.appendChild(nextGoalButton);

    schemeWorkoutCardsElement.appendChild(cardElement);
  }
}

renderExerciseArea();


// ---------------------------------------------------------------------------
// Starting and ending a workout
// ---------------------------------------------------------------------------

const startWorkoutChoices = document.getElementById("startWorkoutChoices");
const endWorkoutButton = document.getElementById("endWorkoutButton");
const workoutStatus = document.getElementById("workoutStatus");

// Rebuilds the "Start: <scheme>" / "Start free-form workout" buttons, and
// hides the whole group once a workout is already in progress.
function renderStartWorkoutChoices() {
  startWorkoutChoices.innerHTML = "";

  if (appState.activeSessionId !== null) {
    startWorkoutChoices.hidden = true;
    return;
  }
  startWorkoutChoices.hidden = false;

  const activeTemplates = appState.database.workoutTemplates.filter((template) => !template.isArchived);
  for (const template of activeTemplates) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Start: ${template.name}`;
    button.addEventListener("click", () => beginStartWorkout(template.id));
    startWorkoutChoices.appendChild(button);
  }

  const freeformButton = document.createElement("button");
  freeformButton.type = "button";
  freeformButton.textContent = "Start free-form workout";
  freeformButton.addEventListener("click", () => beginStartWorkout(null));
  startWorkoutChoices.appendChild(freeformButton);
}

function updateWorkoutControls() {
  const isActive = appState.activeSessionId !== null;
  endWorkoutButton.hidden = !isActive;
  workoutStatus.textContent = isActive ? "Workout in progress" : "";
  renderStartWorkoutChoices();
  updateRestTimer();
}

// Called when a scheme (or free-form) is picked to start. If any gyms have
// been added, asks which one this workout is at before actually starting;
// otherwise there's nothing to ask, so it starts right away.
function beginStartWorkout(templateId) {
  const activeGyms = appState.database.gyms.filter((gym) => !gym.isArchived);
  if (activeGyms.length === 0) {
    startWorkout(templateId, null);
    return;
  }
  appState.pendingTemplateId = templateId;
  showGymPickerScreen();
}

function startWorkout(templateId, gymId) {
  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    dayStatus: "normal",
    notes: "",
    templateId: templateId,
    gymId: gymId
  };
  appState.database.sessions.push(session);
  appState.activeSessionId = session.id;
  appState.pendingTemplateId = null;
  saveDatabase(appState.database);
  closeFreeformReview();
  showMainScreen();
  updateWorkoutControls();
  renderExerciseArea();
}

endWorkoutButton.addEventListener("click", () => {
  const session = getActiveSession();
  session.endedAt = new Date().toISOString();
  saveDatabase(appState.database);
  closeSetEntryPanel();
  closeFreeformReview();
  appState.activeSessionId = null;
  updateWorkoutControls();
  renderExerciseArea();
});

renderStartWorkoutChoices();


// ---------------------------------------------------------------------------
// Rest timer
//
// Counts up from whenever the most recently logged set (in the current
// workout, any exercise, warmups included — this is about physical
// exertion, not performance context) was saved. Purely computed from
// existing Set.performedAt timestamps, so there's no new stored state.
// ---------------------------------------------------------------------------

const restTimerElement = document.getElementById("restTimer");

function updateRestTimer() {
  if (appState.activeSessionId === null) {
    restTimerElement.textContent = "";
    return;
  }

  const sessionSets = appState.database.sets.filter((set) => set.sessionId === appState.activeSessionId);
  if (sessionSets.length === 0) {
    restTimerElement.textContent = "";
    return;
  }

  const mostRecentSet = sessionSets.reduce((latest, set) =>
    set.performedAt > latest.performedAt ? set : latest
  );

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(mostRecentSet.performedAt).getTime()) / 1000)
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  restTimerElement.textContent = `Rest: ${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Runs for the lifetime of the page rather than being started/stopped
// around each workout — simpler, and updateRestTimer() already no-ops
// cleanly when there's nothing to show.
setInterval(updateRestTimer, 1000);
updateRestTimer();


// ---------------------------------------------------------------------------
// Logging a set
// ---------------------------------------------------------------------------

const setEntryPanel = document.getElementById("setEntryPanel");
const setEntryExerciseName = document.getElementById("setEntryExerciseName");
const plannedTarget = document.getElementById("plannedTarget");
const previousPerformance = document.getElementById("previousPerformance");
const rirRow = document.getElementById("rirRow");
const warmupCheckbox = document.getElementById("warmupCheckbox");

const loadValueElement = document.getElementById("loadValue");
const repsValueElement = document.getElementById("repsValue");
const rirValueElement = document.getElementById("rirValue");
const saveSetButton = document.getElementById("saveSetButton");
const deleteSetButton = document.getElementById("deleteSetButton");

// Finds the most recently performed working (non-warmup) set for an
// exercise, across all past sessions. Warmups are excluded because they
// don't represent what was actually trained.
//
// For a gym-specific exercise (machine/cable — see schema.js), this only
// looks at sets from sessions logged at the same gym as the current one,
// since those load numbers aren't comparable across locations. It falls
// back to an ungrouped, all-gyms lookup when the exercise isn't flagged
// gym-specific, or when today's session has no gym set to scope by.
function findPreviousWorkingSet(exerciseId) {
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

// Redraws the stepper values and the RIR row's visibility from
// `appState.setDraft`. Called after every stepper button press and every
// warmup toggle, so the panel always shows the current draft.
function renderSetDraft() {
  loadValueElement.textContent = `${appState.setDraft.load} kg`;
  repsValueElement.textContent = appState.setDraft.reps;
  rirValueElement.textContent = appState.setDraft.rir;
  rirRow.hidden = appState.setDraft.isWarmup;
  warmupCheckbox.checked = appState.setDraft.isWarmup;
}

// `planTarget` (optional) is `{ load, repsMin, repsMax }` from a scheme's
// plan, passed in when opened from a pending set pill. When present,
// load/reps default to the plan rather than to past performance, since the
// plan is what today is supposed to follow.
function openSetEntryPanel(exerciseId, planTarget = null) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const previous = findPreviousWorkingSet(exerciseId);

  appState.editingSetId = null;
  appState.setDraft = {
    exerciseId,
    load: planTarget ? planTarget.load : (previous ? previous.load : 20),
    reps: planTarget ? planTarget.repsMin : (previous ? previous.reps : 8),
    rir: previous ? previous.rir : 2,
    isWarmup: false
  };

  setEntryExerciseName.textContent = exercise.name;
  saveSetButton.textContent = "Save set";
  deleteSetButton.hidden = true;

  if (planTarget) {
    plannedTarget.textContent = `Planned: ${planTarget.repsMin}-${planTarget.repsMax} reps @ ${planTarget.load} kg`;
    plannedTarget.hidden = false;
  } else {
    plannedTarget.hidden = true;
  }

  if (previous) {
    // Says "at this gym" when the comparison is gym-scoped, so it's clear
    // why "No previous data" can still show up for an exercise that's
    // actually been done many times, just not at today's gym.
    const scopeNote = exercise.isGymSpecific && getActiveSession() && getActiveSession().gymId
      ? " at this gym"
      : "";
    previousPerformance.textContent =
      `Last${scopeNote}: ${previous.load} kg × ${previous.reps} (RIR ${previous.rir})`;
  } else {
    previousPerformance.textContent = "No previous data for this exercise.";
  }

  renderSetDraft();
  setEntryPanel.hidden = false;
}

// Opens the same panel, but pre-filled from an already-logged set so it can
// be corrected in place, per the data rule that editing a set replaces it
// rather than creating a duplicate history entry.
function openSetEntryPanelForEdit(setId) {
  const set = appState.database.sets.find((candidate) => candidate.id === setId);
  const exercise = appState.database.exercises.find((candidate) => candidate.id === set.exerciseId);

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
  previousPerformance.textContent = "Editing a previously logged set.";
  saveSetButton.textContent = "Save changes";
  deleteSetButton.hidden = false;

  renderSetDraft();
  setEntryPanel.hidden = false;
}

function closeSetEntryPanel() {
  appState.setDraft = null;
  appState.editingSetId = null;
  setEntryPanel.hidden = true;
  // The cards' pills depend on which sets exist, so refresh them too.
  renderExerciseArea();
  if (!freeformReviewCardElement.hidden) {
    renderFreeformReview();
  }
  updateRestTimer();
}

// One shared handler for every stepper button pair (set entry and planned
// exercise entry both use this): which draft object, field, step, and floor
// to use are supplied by each button's own listener below, rather than
// writing a near-identical function per field.
function adjustDraftField(draftObject, field, step, minimum, render) {
  const nextValue = draftObject[field] + step;
  draftObject[field] = Math.max(nextValue, minimum);
  render();
}

document.getElementById("loadDecrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "load", -2.5, 0, renderSetDraft));
document.getElementById("loadIncrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "load", 2.5, 0, renderSetDraft));
document.getElementById("repsDecrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "reps", -1, 1, renderSetDraft));
document.getElementById("repsIncrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "reps", 1, 1, renderSetDraft));
document.getElementById("rirDecrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "rir", -1, 0, renderSetDraft));
document.getElementById("rirIncrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "rir", 1, 0, renderSetDraft));

warmupCheckbox.addEventListener("change", () => {
  appState.setDraft.isWarmup = warmupCheckbox.checked;
  renderSetDraft();
});

saveSetButton.addEventListener("click", () => {
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

    appState.database.sets.push({
      id: crypto.randomUUID(),
      sessionId: appState.activeSessionId,
      exerciseId: draft.exerciseId,
      order,
      load: draft.load,
      reps: draft.reps,
      rir,
      isWarmup: draft.isWarmup,
      performedAt: new Date().toISOString()
    });
  }

  saveDatabase(appState.database);
  closeSetEntryPanel();
});

document.getElementById("cancelSetButton").addEventListener("click", () => {
  closeSetEntryPanel();
});

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
  closeSetEntryPanel();
});


// ---------------------------------------------------------------------------
// Exercise library (add new exercises, archive old ones)
// ---------------------------------------------------------------------------

// Turns a name into the kind of id schema.js expects for Exercise records:
// stable, lowercase, hyphenated (see the Exercise shape comment in
// schema.js). Runs once when an exercise is created; the id never changes
// after that even if the name is edited later.
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderExercisesManageList() {
  const listElement = document.getElementById("exercisesManageList");
  listElement.innerHTML = "";

  for (const exercise of appState.database.exercises.filter((candidate) => !candidate.isArchived)) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = exercise.isGymSpecific ? `${exercise.name} (gym-specific)` : exercise.name;

    const gymToggleButton = document.createElement("button");
    gymToggleButton.type = "button";
    gymToggleButton.className = "small-button";
    gymToggleButton.textContent = exercise.isGymSpecific ? "Unmark" : "Mark gym-specific";
    gymToggleButton.addEventListener("click", () => {
      exercise.isGymSpecific = !exercise.isGymSpecific;
      saveDatabase(appState.database);
      renderExercisesManageList();
    });

    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.className = "small-button";
    archiveButton.textContent = "Archive";
    archiveButton.addEventListener("click", () => {
      // Archiving instead of deleting keeps past sets and schemes that
      // reference this exercise resolvable.
      exercise.isArchived = true;
      saveDatabase(appState.database);
      renderExercisesManageList();
    });

    rowElement.append(nameSpan, gymToggleButton, archiveButton);
    listElement.appendChild(rowElement);
  }
}

document.getElementById("addExerciseButton").addEventListener("click", () => {
  const nameInput = document.getElementById("newExerciseNameInput");
  const gymSpecificCheckbox = document.getElementById("newExerciseGymSpecificCheckbox");
  const name = nameInput.value.trim();
  if (name === "") {
    alert("Enter a name for the exercise.");
    return;
  }

  const baseId = slugify(name);
  if (baseId === "") {
    alert("That name needs at least one letter or number.");
    return;
  }

  // Exercise ids must be stable and unique (schema.js: "never changes"), so
  // two exercises can't share one — append a number if the plain slug is
  // already taken.
  let id = baseId;
  let suffix = 2;
  while (appState.database.exercises.some((exercise) => exercise.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix++;
  }

  appState.database.exercises.push({
    id,
    name,
    // Left empty on purpose — per schema.js, muscle weights are for the
    // future training engine and nothing reads them yet.
    muscles: {},
    isArchived: false,
    isGymSpecific: gymSpecificCheckbox.checked
  });
  saveDatabase(appState.database);
  nameInput.value = "";
  gymSpecificCheckbox.checked = false;
  renderExercisesManageList();
});


// ---------------------------------------------------------------------------
// Gyms (add gyms trained at, archive old ones) and the gym picker shown when
// starting a workout
// ---------------------------------------------------------------------------

function renderGymsManageList() {
  const listElement = document.getElementById("gymsManageList");
  listElement.innerHTML = "";

  for (const gym of appState.database.gyms.filter((candidate) => !candidate.isArchived)) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = gym.name;

    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.className = "small-button";
    archiveButton.textContent = "Archive";
    archiveButton.addEventListener("click", () => {
      // Archiving instead of deleting keeps past sessions logged at this gym
      // resolvable, same reasoning as Exercise and WorkoutTemplate.
      gym.isArchived = true;
      saveDatabase(appState.database);
      renderGymsManageList();
    });

    rowElement.append(nameSpan, archiveButton);
    listElement.appendChild(rowElement);
  }
}

document.getElementById("addGymButton").addEventListener("click", () => {
  const nameInput = document.getElementById("newGymNameInput");
  const name = nameInput.value.trim();
  if (name === "") {
    alert("Enter a name for the gym.");
    return;
  }

  appState.database.gyms.push({
    id: crypto.randomUUID(),
    name,
    isArchived: false
  });
  saveDatabase(appState.database);
  nameInput.value = "";
  renderGymsManageList();
});

// Shown right after picking a scheme (or free-form) to start, so the new
// session's gymId can be set from the moment it's created.
function renderGymPicker() {
  const listElement = document.getElementById("gymPickerList");
  listElement.innerHTML = "";

  for (const gym of appState.database.gyms.filter((candidate) => !candidate.isArchived)) {
    const itemElement = document.createElement("li");
    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "exercise-item";
    buttonElement.textContent = gym.name;
    buttonElement.addEventListener("click", () => {
      startWorkout(appState.pendingTemplateId, gym.id);
    });
    itemElement.appendChild(buttonElement);
    listElement.appendChild(itemElement);
  }
}

document.getElementById("skipGymPickerButton").addEventListener("click", () => {
  startWorkout(appState.pendingTemplateId, null);
});


// ---------------------------------------------------------------------------
// History (read-only list of finished workouts)
// ---------------------------------------------------------------------------

function formatSessionDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function renderHistoryList() {
  const listElement = document.getElementById("historyList");
  listElement.innerHTML = "";

  const pastSessions = appState.database.sessions
    .filter((session) => session.endedAt !== null)
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  if (pastSessions.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "No finished workouts yet.";
    listElement.appendChild(emptyMessage);
    return;
  }

  for (const session of pastSessions) {
    const template = session.templateId
      ? appState.database.workoutTemplates.find((candidate) => candidate.id === session.templateId)
      : null;
    const gym = session.gymId
      ? appState.database.gyms.find((candidate) => candidate.id === session.gymId)
      : null;

    const cardElement = document.createElement("li");
    cardElement.className = "history-card";

    const headerElement = document.createElement("div");
    headerElement.className = "history-card-header";
    headerElement.textContent =
      `${formatSessionDate(session.startedAt)} · ${template ? template.name : "Free-form"}${gym ? ` · ${gym.name}` : ""}`;
    cardElement.appendChild(headerElement);

    // Group this session's sets by exercise, in the order each exercise was
    // first worked, so the summary reads like the workout actually went.
    const setsByExercise = [];
    const sessionSets = appState.database.sets
      .filter((set) => set.sessionId === session.id)
      .sort((a, b) => a.order - b.order);

    for (const set of sessionSets) {
      let group = setsByExercise.find((candidate) => candidate.exerciseId === set.exerciseId);
      if (!group) {
        group = { exerciseId: set.exerciseId, sets: [] };
        setsByExercise.push(group);
      }
      group.sets.push(set);
    }

    if (setsByExercise.length === 0) {
      const emptyLine = document.createElement("div");
      emptyLine.className = "history-card-line";
      emptyLine.textContent = "No sets logged.";
      cardElement.appendChild(emptyLine);
    }

    for (const group of setsByExercise) {
      const exercise = appState.database.exercises.find((candidate) => candidate.id === group.exerciseId);
      const setsText = group.sets
        .map((set) => `${set.load} kg × ${set.reps}${set.isWarmup ? " (warmup)" : ` (RIR ${set.rir})`}`)
        .join(", ");

      const lineElement = document.createElement("div");
      lineElement.className = "history-card-line";
      // Exercise names are never deleted (only archived), so this lookup
      // always resolves even for a long-retired exercise.
      lineElement.textContent = `${exercise.name}: ${setsText}`;
      cardElement.appendChild(lineElement);
    }

    listElement.appendChild(cardElement);
  }
}


// ---------------------------------------------------------------------------
// Schemes list
// ---------------------------------------------------------------------------

function renderSchemesList() {
  const listElement = document.getElementById("schemesList");
  listElement.innerHTML = "";

  const activeTemplates = appState.database.workoutTemplates.filter((template) => !template.isArchived);
  for (const template of activeTemplates) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = template.name;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "small-button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      // A deep copy, so cancelling the edit doesn't leave half-applied
      // changes on the saved scheme.
      appState.schemeDraft = JSON.parse(JSON.stringify(template));
      showSchemeEditorScreen();
    });

    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.className = "small-button";
    archiveButton.textContent = "Archive";
    archiveButton.addEventListener("click", () => {
      // Archiving instead of deleting keeps past sessions that followed this
      // scheme resolvable, the same reasoning as Exercise.isArchived.
      template.isArchived = true;
      saveDatabase(appState.database);
      renderSchemesList();
    });

    rowElement.append(nameSpan, editButton, archiveButton);
    listElement.appendChild(rowElement);
  }
}

document.getElementById("addSchemeButton").addEventListener("click", () => {
  appState.schemeDraft = {
    id: crypto.randomUUID(),
    name: "",
    isArchived: false,
    plannedExercises: []
  };
  showSchemeEditorScreen();
});


// ---------------------------------------------------------------------------
// Scheme editor
// ---------------------------------------------------------------------------

const schemeNameInput = document.getElementById("schemeNameInput");

function renderSchemeEditor() {
  // Whether this id already exists among saved schemes tells new from
  // existing, without needing extra state that would have to be kept out of
  // what eventually gets saved.
  const isNewScheme = !appState.database.workoutTemplates.some(
    (template) => template.id === appState.schemeDraft.id
  );
  document.getElementById("schemeEditorTitle").textContent = isNewScheme ? "New scheme" : "Edit scheme";
  schemeNameInput.value = appState.schemeDraft.name;

  const listElement = document.getElementById("plannedExerciseList");
  listElement.innerHTML = "";

  appState.schemeDraft.plannedExercises.forEach((planned, index) => {
    const exercise = appState.database.exercises.find((candidate) => candidate.id === planned.exerciseId);

    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const detailSpan = document.createElement("span");
    detailSpan.textContent =
      `${exercise.name}: ${planned.targetSets} × ${planned.targetRepsMin}-${planned.targetRepsMax} @ ${planned.targetLoad} kg`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "small-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      appState.schemeDraft.plannedExercises.splice(index, 1);
      renderSchemeEditor();
    });

    rowElement.append(detailSpan, removeButton);
    listElement.appendChild(rowElement);
  });
}

schemeNameInput.addEventListener("input", () => {
  appState.schemeDraft.name = schemeNameInput.value;
});

document.getElementById("addPlannedExerciseButton").addEventListener("click", () => {
  exercisePickerScreen.hidden = false;
  schemeEditorScreen.hidden = true;
  renderExercisePicker();
});

document.getElementById("saveSchemeButton").addEventListener("click", () => {
  const draft = appState.schemeDraft;

  if (draft.name.trim() === "") {
    alert("Give the scheme a name before saving.");
    return;
  }
  if (draft.plannedExercises.length === 0) {
    alert("Add at least one exercise before saving.");
    return;
  }

  const existingIndex = appState.database.workoutTemplates.findIndex((template) => template.id === draft.id);
  if (existingIndex === -1) {
    appState.database.workoutTemplates.push(draft);
  } else {
    appState.database.workoutTemplates[existingIndex] = draft;
  }

  saveDatabase(appState.database);
  appState.schemeDraft = null;
  renderStartWorkoutChoices();
  showSchemesScreen();
});

document.getElementById("cancelSchemeEditButton").addEventListener("click", () => {
  appState.schemeDraft = null;
  showSchemesScreen();
});


// ---------------------------------------------------------------------------
// Exercise picker (for adding an exercise to the scheme being edited)
// ---------------------------------------------------------------------------

function renderExercisePicker() {
  const listElement = document.getElementById("exercisePickerList");
  listElement.innerHTML = "";

  for (const exercise of appState.database.exercises.filter((candidate) => !candidate.isArchived)) {
    const itemElement = document.createElement("li");
    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "exercise-item";
    buttonElement.textContent = exercise.name;
    buttonElement.addEventListener("click", () => {
      appState.plannedExerciseDraft = {
        exerciseId: exercise.id,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
        targetLoad: 20
      };
      document.getElementById("plannedExerciseEntryName").textContent = exercise.name;
      renderPlannedExerciseDraft();
      exercisePickerScreen.hidden = true;
      plannedExerciseEntryPanel.hidden = false;
    });
    itemElement.appendChild(buttonElement);
    listElement.appendChild(itemElement);
  }
}

document.getElementById("cancelExercisePickerButton").addEventListener("click", () => {
  exercisePickerScreen.hidden = true;
  schemeEditorScreen.hidden = false;
});


// ---------------------------------------------------------------------------
// Planned exercise target entry (sets / rep range / load for one exercise
// within the scheme being edited) — also reused, via nextGoalTarget, to
// adjust an existing planned exercise's target from an active workout card.
// ---------------------------------------------------------------------------

const plannedExerciseEntryHint = document.getElementById("plannedExerciseEntryHint");

// Opens the same panel used to add a new exercise to a scheme, but for
// changing an *existing* one's target — triggered by "Set goal for next
// time" on a workout card. Doesn't touch appState.schemeDraft: this saves
// straight to the template in appState.database, not to an in-progress edit.
function openNextGoalEditor(templateId, exerciseId) {
  const template = appState.database.workoutTemplates.find((candidate) => candidate.id === templateId);
  const planned = template.plannedExercises.find((candidate) => candidate.exerciseId === exerciseId);
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);

  appState.nextGoalTarget = { templateId, exerciseId };
  appState.plannedExerciseDraft = {
    targetSets: planned.targetSets,
    targetRepsMin: planned.targetRepsMin,
    targetRepsMax: planned.targetRepsMax,
    targetLoad: planned.targetLoad
  };

  document.getElementById("plannedExerciseEntryName").textContent = exercise.name;
  plannedExerciseEntryHint.textContent =
    `Changes the target in "${template.name}" from now on, including any of today's sets for this exercise not yet logged.`;
  plannedExerciseEntryHint.hidden = false;
  document.getElementById("savePlannedExerciseButton").textContent = "Save goal";

  renderPlannedExerciseDraft();
  // Deliberately not hideAllScreens(): mainScreen (with the workout cards)
  // stays visible underneath, same as how the set entry panel works.
  plannedExerciseEntryPanel.hidden = false;
}

function renderPlannedExerciseDraft() {
  const draft = appState.plannedExerciseDraft;
  document.getElementById("targetSetsValue").textContent = draft.targetSets;
  document.getElementById("targetRepsMinValue").textContent = draft.targetRepsMin;
  document.getElementById("targetRepsMaxValue").textContent = draft.targetRepsMax;
  document.getElementById("targetLoadValue").textContent = `${draft.targetLoad} kg`;
}

document.getElementById("targetSetsDecrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetSets", -1, 1, renderPlannedExerciseDraft));
document.getElementById("targetSetsIncrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetSets", 1, 1, renderPlannedExerciseDraft));
document.getElementById("targetRepsMinDecrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetRepsMin", -1, 1, renderPlannedExerciseDraft));
document.getElementById("targetRepsMinIncrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetRepsMin", 1, 1, renderPlannedExerciseDraft));
document.getElementById("targetRepsMaxDecrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetRepsMax", -1, 1, renderPlannedExerciseDraft));
document.getElementById("targetRepsMaxIncrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetRepsMax", 1, 1, renderPlannedExerciseDraft));
document.getElementById("targetLoadDecrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetLoad", -2.5, 0, renderPlannedExerciseDraft));
document.getElementById("targetLoadIncrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetLoad", 2.5, 0, renderPlannedExerciseDraft));

// Resets the panel back to its "add a new exercise to the scheme being
// edited" defaults, so the next time it's opened for that purpose it
// doesn't carry over the next-goal wording.
function resetPlannedExerciseEntryPanelToAddMode() {
  plannedExerciseEntryHint.hidden = true;
  document.getElementById("savePlannedExerciseButton").textContent = "Add to scheme";
}

document.getElementById("savePlannedExerciseButton").addEventListener("click", () => {
  if (appState.nextGoalTarget) {
    const { templateId, exerciseId } = appState.nextGoalTarget;
    const template = appState.database.workoutTemplates.find((candidate) => candidate.id === templateId);
    const planned = template.plannedExercises.find((candidate) => candidate.exerciseId === exerciseId);
    const draft = appState.plannedExerciseDraft;

    planned.targetSets = draft.targetSets;
    planned.targetRepsMin = draft.targetRepsMin;
    planned.targetRepsMax = draft.targetRepsMax;
    planned.targetLoad = draft.targetLoad;
    saveDatabase(appState.database);

    appState.nextGoalTarget = null;
    appState.plannedExerciseDraft = null;
    plannedExerciseEntryPanel.hidden = true;
    resetPlannedExerciseEntryPanelToAddMode();
    renderExerciseArea();
    return;
  }

  appState.schemeDraft.plannedExercises.push(appState.plannedExerciseDraft);
  appState.plannedExerciseDraft = null;
  plannedExerciseEntryPanel.hidden = true;
  schemeEditorScreen.hidden = false;
  renderSchemeEditor();
});

document.getElementById("cancelPlannedExerciseButton").addEventListener("click", () => {
  if (appState.nextGoalTarget) {
    appState.nextGoalTarget = null;
    appState.plannedExerciseDraft = null;
    plannedExerciseEntryPanel.hidden = true;
    resetPlannedExerciseEntryPanelToAddMode();
    return;
  }

  appState.plannedExerciseDraft = null;
  plannedExerciseEntryPanel.hidden = true;
  schemeEditorScreen.hidden = false;
});


// ---------------------------------------------------------------------------
// Export and import
// ---------------------------------------------------------------------------

// Export: schema.js already does all the work (reading storage, building
// the file, triggering the download), so this just wires the click.
document.getElementById("exportButton").addEventListener("click", () => {
  exportDatabase();
});

// Import is a two-step interaction: clicking the visible "Import" button
// clicks the hidden real file input on its behalf, which opens the phone's
// or browser's file picker.
const importFileInput = document.getElementById("importFileInput");

document.getElementById("importButton").addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", () => {
  const chosenFile = importFileInput.files[0];
  if (!chosenFile) {
    return;
  }

  // Reading a file's contents happens asynchronously, so the rest of the
  // work continues inside this callback once the read finishes.
  const reader = new FileReader();
  reader.onload = () => {
    const fileText = reader.result;

    // Import overwrites everything, so confirm before touching storage.
    // This isn't the common path (logging sets), so a confirmation here
    // doesn't conflict with keeping the common path dialog-free.
    const userConfirmed = confirm(
      "This will overwrite your saved data with the contents of this file. Continue?"
    );
    if (!userConfirmed) {
      return;
    }

    try {
      closeSetEntryPanel();
      closeFreeformReview();

      appState.database = importDatabase(fileText);
      // An import can bring in a database with no session in progress, so
      // treat any active workout as no longer valid rather than pointing at
      // a session that may not exist in the freshly imported data.
      appState.activeSessionId = null;
      showMainScreen();
      updateWorkoutControls();
      renderExerciseArea();
      alert("Import complete.");
    } catch (error) {
      alert(error.message);
    }

    // Without this, choosing the same file again wouldn't fire a second
    // "change" event, and Import would silently seem to do nothing.
    importFileInput.value = "";
  };
  reader.readAsText(chosenFile);
});
