// ---------------------------------------------------------------------------
// App logic for the workout logger.
//
// All reading and writing of saved data happens through the functions in
// schema.js (loadDatabase, saveDatabase, exportDatabase, importDatabase).
// This file only holds UI behaviour: what's on screen and what happens when
// the user taps something.
// ---------------------------------------------------------------------------

// Registers service-worker.js, which caches the app's own files so it still
// loads with no signal — this app is meant to be used mid-workout at a gym.
// Guarded because older browsers don't support service workers at all; the
// app still works without one, just without offline caching.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
}

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
  freeformReviewExerciseId: null, // which exercise's logged-sets review card is open, in a free-form workout; null otherwise
  dayStatusDraft: null,           // { dayStatus, notes } while the today's-status panel is open; null otherwise
  dayStatusEditingSessionId: null, // which session the open day-status panel is editing (active or a past one); null when the panel is closed
  muscleEditorExerciseId: null,   // which exercise's muscle editor is open; null otherwise
  muscleDraft: null,              // { mainMuscle, secondaryMuscles } while the muscle editor is open; null otherwise
  exerciseStatsSelectedGymId: null, // which gym's data the stats charts are scoped to, when the exercise is gym-specific and used at more than one gym
  bodyweightDraftWeightKg: null,    // value shown on the bodyweight stepper; null only before the Bodyweight screen has been opened once
  editingBodyweightEntryId: null,   // id of a past entry being corrected, or null while logging today's weight
  bodyDiagramView: "front"          // which side of the muscle-diagram body outline is showing, "front" or "back"
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
const activeWorkoutScreen = document.getElementById("activeWorkoutScreen");
const settingsScreen = document.getElementById("settingsScreen");
const dataScreen = document.getElementById("dataScreen");
const schemesScreen = document.getElementById("schemesScreen");
const schemeEditorScreen = document.getElementById("schemeEditorScreen");
const exercisePickerScreen = document.getElementById("exercisePickerScreen");
const plannedExerciseEntryPanel = document.getElementById("plannedExerciseEntryPanel");
const exercisesScreen = document.getElementById("exercisesScreen");
const historyScreen = document.getElementById("historyScreen");
const gymsScreen = document.getElementById("gymsScreen");
const gymPickerScreen = document.getElementById("gymPickerScreen");
const exerciseStatsListScreen = document.getElementById("exerciseStatsListScreen");
const exerciseStatsDetailScreen = document.getElementById("exerciseStatsDetailScreen");
const muscleEditorPanel = document.getElementById("muscleEditorPanel");
const personalBestsScreen = document.getElementById("personalBestsScreen");
const muscleStatsListScreen = document.getElementById("muscleStatsListScreen");
const muscleStatsDetailScreen = document.getElementById("muscleStatsDetailScreen");
const bodyweightScreen = document.getElementById("bodyweightScreen");
// A top-level section (not nested in another screen) so it can be shown
// over either activeWorkoutScreen or historyScreen — see the comment above
// it in index.html for why. Declared here, with the other screens, rather
// than down in the "Logging a set" section where it's used, so it can join
// allScreens below.
const setEntryPanel = document.getElementById("setEntryPanel");
// Same reasoning as setEntryPanel above — top-level so it can layer over
// either activeWorkoutScreen (the "Today's status" button) or historyScreen
// (a past session's "Edit status" button).
const dayStatusPanel = document.getElementById("dayStatusPanel");

// Every top-level screen, so each show*Screen() function below can hide all
// of them and then reveal just its own, without repeating this list six times.
const allScreens = [
  mainScreen, activeWorkoutScreen, settingsScreen, dataScreen, schemesScreen, schemeEditorScreen,
  exercisePickerScreen, plannedExerciseEntryPanel, exercisesScreen, historyScreen, gymsScreen,
  gymPickerScreen, setEntryPanel, exerciseStatsListScreen, exerciseStatsDetailScreen, muscleEditorPanel,
  personalBestsScreen, muscleStatsListScreen, muscleStatsDetailScreen, dayStatusPanel,
  bodyweightScreen
];

function hideAllScreens() {
  for (const screen of allScreens) {
    screen.hidden = true;
  }
}

function showMainScreen() {
  hideAllScreens();
  mainScreen.hidden = false;
  renderWeeklySchemeSummary();
  renderMuscleCounters();
}

// Doesn't touch appState.activeSessionId or end the workout — this just
// changes which screen is visible. The session (if any) keeps running
// whether this screen or the home screen is what's on top.
function showActiveWorkoutScreen() {
  hideAllScreens();
  activeWorkoutScreen.hidden = false;
}

function showSettingsScreen() {
  hideAllScreens();
  settingsScreen.hidden = false;
}

function showDataScreen() {
  hideAllScreens();
  dataScreen.hidden = false;
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

function showExerciseStatsListScreen() {
  hideAllScreens();
  exerciseStatsListScreen.hidden = false;
  renderExerciseStatsList();
}

function showExerciseStatsDetailScreen(exerciseId) {
  hideAllScreens();
  exerciseStatsDetailScreen.hidden = false;
  // Reset here, not inside renderExerciseStatsDetail() itself — that
  // function is also called by the gym picker's own click handler to
  // re-render with the newly picked gym, and resetting there would
  // immediately undo that pick.
  appState.exerciseStatsSelectedGymId = null;
  renderExerciseStatsDetail(exerciseId);
}

function showPersonalBestsScreen() {
  hideAllScreens();
  personalBestsScreen.hidden = false;
  renderPersonalBestsList();
}

function showMuscleStatsListScreen() {
  hideAllScreens();
  muscleStatsListScreen.hidden = false;
  renderBodyDiagram();
  renderMuscleStatsList();
}

function showMuscleStatsDetailScreen(muscle) {
  hideAllScreens();
  muscleStatsDetailScreen.hidden = false;
  renderMuscleStatsDetail(muscle);
}

function showBodyweightScreen() {
  hideAllScreens();
  bodyweightScreen.hidden = false;
  resetBodyweightEntryToToday();
  renderBodyweightScreen();
}

document.getElementById("viewSettingsButton").addEventListener("click", showSettingsScreen);
document.getElementById("backFromSettingsButton").addEventListener("click", showMainScreen);
document.getElementById("manageSchemesButton").addEventListener("click", showSchemesScreen);
// These three "Back" buttons return to Settings, not the main screen —
// Settings is where each of these screens was actually opened from now.
document.getElementById("backFromSchemesButton").addEventListener("click", showSettingsScreen);
document.getElementById("manageExercisesButton").addEventListener("click", showExercisesScreen);
document.getElementById("backFromExercisesButton").addEventListener("click", showSettingsScreen);
document.getElementById("viewHistoryButton").addEventListener("click", showHistoryScreen);
document.getElementById("backFromHistoryButton").addEventListener("click", showMainScreen);
document.getElementById("viewBodyweightButton").addEventListener("click", showBodyweightScreen);
document.getElementById("backFromBodyweightButton").addEventListener("click", showMainScreen);
document.getElementById("manageGymsButton").addEventListener("click", showGymsScreen);
document.getElementById("backFromGymsButton").addEventListener("click", showSettingsScreen);
document.getElementById("viewDataButton").addEventListener("click", showDataScreen);
document.getElementById("backFromDataButton").addEventListener("click", showSettingsScreen);
document.getElementById("homeFromWorkoutButton").addEventListener("click", showMainScreen);


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
// `suggestion` is today's progression suggestion for this exercise (see
// progression.js), or null. When there is one, a not-yet-logged pill shows
// the suggested load instead of the scheme's fixed target load.
function buildSetPill(loggedSet, planned, suggestion) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = loggedSet ? "set-pill set-pill-done" : "set-pill set-pill-pending";

  const weightSpan = document.createElement("span");
  weightSpan.className = "set-pill-weight";
  const pendingLoad = suggestion ? suggestion.load : planned.targetLoad;
  weightSpan.textContent = `${loggedSet ? loggedSet.load : pendingLoad} kg`;

  const repsSpan = document.createElement("span");
  repsSpan.className = "set-pill-reps";
  repsSpan.textContent = loggedSet
    ? `${loggedSet.reps}/${planned.targetRepsMin}-${planned.targetRepsMax}`
    : `${planned.targetRepsMin}-${planned.targetRepsMax}`;

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
        suggestion
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

// The green "Suggested: 82.5 kg × 8" line on a workout card, with the
// reason underneath so the suggestion never looks like a mystery number.
function buildSuggestionLine(suggestion) {
  const lineElement = document.createElement("p");
  lineElement.className = "progression-suggestion";
  lineElement.textContent = `Suggested: ${suggestion.load} kg × ${suggestion.reps}. ${suggestion.reason}`;
  return lineElement;
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

    const suggestion = suggestNextTarget(
      appState.database, planned.exerciseId, planned.targetRepsMin, planned.targetRepsMax, getActiveSession()
    );
    if (suggestion) {
      cardElement.appendChild(buildSuggestionLine(suggestion));
    }

    const pillRowElement = document.createElement("div");
    pillRowElement.className = "set-pills";

    // One pill per planned set, filled in from whatever's actually been
    // logged so far for it.
    for (let setIndex = 0; setIndex < planned.targetSets; setIndex++) {
      pillRowElement.appendChild(buildSetPill(loggedSets[setIndex], planned, suggestion));
    }

    // Any sets logged beyond the planned count (via the "+" pill below) get
    // their own pills too, rather than being invisible here.
    for (let setIndex = planned.targetSets; setIndex < loggedSets.length; setIndex++) {
      pillRowElement.appendChild(buildSetPill(loggedSets[setIndex], planned, suggestion));
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
const dayStatusButton = document.getElementById("dayStatusButton");

// Rebuilds the "Start: <scheme>" / "Start free-form workout" buttons. Once a
// workout is already in progress, those don't make sense any more — this
// shows a single "Resume workout" button back to the active workout screen
// instead, so there's always exactly one obvious thing to tap here.
function renderStartWorkoutChoices() {
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
  dayStatusButton.hidden = !isActive;
  workoutStatus.textContent = isActive ? "Workout in progress" : "";
  renderStartWorkoutChoices();
  updateRestTimer();
  renderWeeklySchemeSummary();
  renderMuscleCounters();
}

// Called when a scheme (or free-form) is picked to start. If any gyms have
// been added, asks which one this workout is at before actually starting;
// otherwise there's nothing to ask, so it starts right away.
function beginStartWorkout(templateId) {
  const activeGyms = appState.database.gyms.filter((gym) => !gym.isArchived);
  // Nothing to ask when there's zero or exactly one choice — a picker
  // screen for "pick the only gym you have" is a tap for no reason.
  if (activeGyms.length === 0) {
    startWorkout(templateId, null);
    return;
  }
  if (activeGyms.length === 1) {
    startWorkout(templateId, activeGyms[0].id);
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
  hidePersonalBestBanner();
  closeDayStatusPanel();
  showActiveWorkoutScreen();
  updateWorkoutControls();
  renderExerciseArea();
}

endWorkoutButton.addEventListener("click", () => {
  const session = getActiveSession();
  session.endedAt = new Date().toISOString();
  saveDatabase(appState.database);
  closeSetEntryPanel();
  closeFreeformReview();
  hidePersonalBestBanner();
  closeDayStatusPanel();
  appState.activeSessionId = null;
  showMainScreen();
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
// Personal-best notification
//
// Checked only when a brand-new set is saved (not when correcting an
// existing one, to keep this scoped to "you just did that" moments rather
// than retroactive data fixes). Two independent kinds of PR: heaviest
// weight ever, and highest single-set volume (load × reps) ever, for that
// exercise. Warmups never count, and for a gym-specific exercise the
// comparison is scoped to the same gym, matching findPreviousWorkingSet().
// ---------------------------------------------------------------------------

const prBannerElement = document.getElementById("prBanner");
let prBannerTimeoutId = null;

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

  if (prBannerTimeoutId) {
    clearTimeout(prBannerTimeoutId);
  }
  prBannerTimeoutId = setTimeout(() => {
    prBannerElement.hidden = true;
    prBannerTimeoutId = null;
  }, 6000);
}

function hidePersonalBestBanner() {
  if (prBannerTimeoutId) {
    clearTimeout(prBannerTimeoutId);
    prBannerTimeoutId = null;
  }
  prBannerElement.hidden = true;
}


// ---------------------------------------------------------------------------
// Today's status (Session.dayStatus / notes)
//
// Deliberately not part of starting or ending a workout — either would add
// a mandatory step to this app's two most frequent actions. Available as an
// optional button any time a workout is active instead.
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

// Built once from DAY_STATUSES (schema.js) rather than hardcoded in HTML,
// so this can't quietly drift out of sync with the schema's contract.
for (const status of DAY_STATUSES) {
  const optionButton = document.createElement("button");
  optionButton.type = "button";
  optionButton.className = "day-status-option";
  optionButton.textContent = DAY_STATUS_LABELS[status];
  optionButton.dataset.dayStatus = status;
  optionButton.addEventListener("click", () => {
    appState.dayStatusDraft.dayStatus = status;
    renderDayStatusPanel();
  });
  dayStatusOptionsElement.appendChild(optionButton);
}

function renderDayStatusPanel() {
  dayStatusNotesInput.value = appState.dayStatusDraft.notes;
  for (const optionButton of dayStatusOptionsElement.children) {
    const isSelected = optionButton.dataset.dayStatus === appState.dayStatusDraft.dayStatus;
    optionButton.classList.toggle("day-status-option-selected", isSelected);
  }
}

// sessionId lets this same panel edit either the in-progress session (from
// the "Today's status" button) or a finished one (from a History card's
// "Edit status" button) — the panel itself doesn't care which.
function openDayStatusPanel(sessionId) {
  const session = appState.database.sessions.find((candidate) => candidate.id === sessionId);
  appState.dayStatusEditingSessionId = sessionId;
  appState.dayStatusDraft = { dayStatus: session.dayStatus, notes: session.notes };
  dayStatusHeading.textContent = session.endedAt === null ? "Today's status" : "Edit status";
  renderDayStatusPanel();
  dayStatusPanel.hidden = false;
}

function closeDayStatusPanel() {
  appState.dayStatusDraft = null;
  appState.dayStatusEditingSessionId = null;
  dayStatusPanel.hidden = true;
  // Safe to call even when History isn't the visible screen — it just
  // redraws the (currently hidden) history list. Same pattern as
  // closeSetEntryPanel() below.
  if (!historyScreen.hidden) {
    renderHistoryList();
  }
}

dayStatusButton.addEventListener("click", () => openDayStatusPanel(getActiveSession().id));

dayStatusNotesInput.addEventListener("input", () => {
  appState.dayStatusDraft.notes = dayStatusNotesInput.value;
});

document.getElementById("saveDayStatusButton").addEventListener("click", () => {
  const session = appState.database.sessions.find(
    (candidate) => candidate.id === appState.dayStatusEditingSessionId
  );
  session.dayStatus = appState.dayStatusDraft.dayStatus;
  session.notes = appState.dayStatusDraft.notes;
  saveDatabase(appState.database);
  closeDayStatusPanel();
});

document.getElementById("cancelDayStatusButton").addEventListener("click", () => {
  closeDayStatusPanel();
});


// ---------------------------------------------------------------------------
// Logging a set
// ---------------------------------------------------------------------------

const setEntryExerciseName = document.getElementById("setEntryExerciseName");
const plannedTarget = document.getElementById("plannedTarget");
const previousPerformance = document.getElementById("previousPerformance");
const progressionSuggestion = document.getElementById("progressionSuggestion");
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

// `planTarget` (optional) is `{ load, repsMin, repsMax, suggestion }` from
// a scheme's plan, passed in when opened from a pending set pill. When
// present, load/reps default to the plan rather than to past performance,
// since the plan is what today is supposed to follow. If progression.js
// produced a suggestion, that takes priority over the plan's fixed load,
// because it's the plan's rep range applied to what actually happened last
// time.
// Guards against a stepper's typed-number input being stuck open from a
// previous panel session — it should always lose focus and hide itself
// before the panel closes, but if that somehow didn't happen (the panel
// closing without the input ever blurring), this is what stops the field
// from showing a raw number input instead of its normal button the next
// time the panel opens.
function resetSetEntryStepperEditUI() {
  for (const field of ["load", "reps", "rir"]) {
    document.getElementById(`${field}ValueInput`).hidden = true;
    document.getElementById(`${field}Value`).hidden = false;
    document.getElementById(`${field}Decrement`).hidden = false;
    document.getElementById(`${field}Increment`).hidden = false;
  }
}

function openSetEntryPanel(exerciseId, planTarget = null) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const previous = findPreviousWorkingSet(exerciseId);

  resetSetEntryStepperEditUI();
  hidePersonalBestBanner();
  appState.editingSetId = null;
  const suggestion = planTarget ? planTarget.suggestion : null;
  appState.setDraft = {
    exerciseId,
    load: chooseStartingLoad(planTarget, suggestion, previous),
    reps: chooseStartingReps(planTarget, suggestion, previous),
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

  if (suggestion) {
    progressionSuggestion.textContent = `Suggested: ${suggestion.load} kg × ${suggestion.reps}. ${suggestion.reason}`;
    progressionSuggestion.hidden = false;
  } else {
    progressionSuggestion.hidden = true;
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

// Where the load stepper starts: the progression suggestion if there is
// one, else the scheme's planned load, else last time's load, else an empty
// Olympic bar (20 kg) for an exercise that's never been done.
function chooseStartingLoad(planTarget, suggestion, previous) {
  // Once a set's already been logged for this exercise this session, later
  // sets default to that actual weight instead of resetting back to the
  // suggestion or the scheme's static target every time — the target only
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
  return previous ? previous.load : 20;
}

// Reps deliberately don't carry forward the same way load does: the target
// (whatever a set falls short of it) is still what every set of the
// exercise should keep aiming for today, not just what the first set
// happened to hit.
function chooseStartingReps(planTarget, suggestion, previous) {
  if (suggestion) {
    return suggestion.reps;
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
  setEntryPanel.hidden = false;
}

function closeSetEntryPanel() {
  appState.setDraft = null;
  appState.editingSetId = null;
  setEntryPanel.hidden = true;
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
document.getElementById("rirDecrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "rir", -1, 0, renderSetDraft));
document.getElementById("rirIncrement").addEventListener("click", () =>
  adjustDraftField(appState.setDraft, "rir", 1, 0, renderSetDraft));

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
makeStepperValueEditable(
  document.getElementById("rirValue"), document.getElementById("rirValueInput"),
  document.getElementById("rirDecrement"), document.getElementById("rirIncrement"),
  () => appState.setDraft, "rir", 0, true, renderSetDraft
);

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

// Builds the "Main: X · Secondary: Y, Z" summary line for one exercise's
// muscles, or null when none are set yet — used both in the manage list and
// nowhere else, so callers decide what to show instead when it's null.
function describeMuscles(muscles) {
  const mainEntry = Object.entries(muscles).find(([, weight]) => weight === 1.0);
  const secondaryEntries = Object.entries(muscles).filter(
    ([key, weight]) => weight !== 1.0 || key !== (mainEntry ? mainEntry[0] : null)
  );

  if (!mainEntry && secondaryEntries.length === 0) {
    return null;
  }

  const parts = [];
  if (mainEntry) {
    parts.push(`Main: ${MUSCLE_GROUP_LABELS[mainEntry[0]]}`);
  }
  if (secondaryEntries.length > 0) {
    parts.push(`Secondary: ${secondaryEntries.map(([key]) => MUSCLE_GROUP_LABELS[key]).join(", ")}`);
  }
  return parts.join(" · ");
}

function renderExercisesManageList() {
  const listElement = document.getElementById("exercisesManageList");
  listElement.innerHTML = "";

  for (const exercise of appState.database.exercises.filter((candidate) => !candidate.isArchived)) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const infoElement = document.createElement("div");
    infoElement.className = "scheme-list-item-info";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = exercise.isGymSpecific ? `${exercise.name} (gym-specific)` : exercise.name;
    infoElement.appendChild(nameSpan);

    const incrementSpan = document.createElement("span");
    incrementSpan.className = "history-card-line";
    incrementSpan.textContent = `Min raise: ${exercise.minimumLoadIncrement} kg`;
    infoElement.appendChild(incrementSpan);

    const musclesDescription = describeMuscles(exercise.muscles);
    if (musclesDescription) {
      const muscleSpan = document.createElement("span");
      muscleSpan.className = "history-card-line";
      muscleSpan.textContent = musclesDescription;
      infoElement.appendChild(muscleSpan);
    }

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "small-button";
    renameButton.textContent = "Rename";
    renameButton.addEventListener("click", () => {
      // Only Exercise.name changes here — the id (used by every set and
      // scheme that references this exercise) is stable per schema.js and
      // is never touched by a rename.
      const newName = prompt("Rename exercise", exercise.name);
      if (newName === null) {
        return;
      }
      const trimmedName = newName.trim();
      if (trimmedName === "") {
        alert("Name can't be empty.");
        return;
      }
      exercise.name = trimmedName;
      saveDatabase(appState.database);
      renderExercisesManageList();
    });

    const incrementButton = document.createElement("button");
    incrementButton.type = "button";
    incrementButton.className = "small-button";
    incrementButton.textContent = "Min raise";
    incrementButton.addEventListener("click", () => {
      const typedIncrement = prompt("Smallest weight raise for this exercise (kg)", exercise.minimumLoadIncrement);
      if (typedIncrement === null) {
        return;
      }
      const newIncrement = parseLoadIncrement(typedIncrement);
      if (newIncrement === null) {
        alert("Enter a weight above 0, e.g. 2.5.");
        return;
      }
      exercise.minimumLoadIncrement = newIncrement;
      saveDatabase(appState.database);
      renderExercisesManageList();
    });

    const musclesButton = document.createElement("button");
    musclesButton.type = "button";
    musclesButton.className = "small-button";
    musclesButton.textContent = "Set muscles";
    musclesButton.addEventListener("click", () => openMuscleEditor(exercise.id));

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
      renderArchivedExercisesList();
    });

    rowElement.append(infoElement, renameButton, incrementButton, musclesButton, gymToggleButton, archiveButton);
    listElement.appendChild(rowElement);
  }
}

// Collapsed by default (see the toggle button below) — archiving something
// with no way back through the UI would defeat the reason it's archived
// instead of deleted in the first place.
// True (not just archived) deletion is only safe when nothing in the data
// would be orphaned by it — no logged set, and no scheme still planning it.
function isExerciseUnused(exerciseId) {
  const usedInSets = appState.database.sets.some((set) => set.exerciseId === exerciseId);
  const usedInSchemes = appState.database.workoutTemplates.some((template) =>
    template.plannedExercises.some((planned) => planned.exerciseId === exerciseId)
  );
  return !usedInSets && !usedInSchemes;
}

function renderArchivedExercisesList() {
  const listElement = document.getElementById("archivedExercisesList");
  listElement.innerHTML = "";

  for (const exercise of appState.database.exercises.filter((candidate) => candidate.isArchived)) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = exercise.name;

    const unarchiveButton = document.createElement("button");
    unarchiveButton.type = "button";
    unarchiveButton.className = "small-button";
    unarchiveButton.textContent = "Unarchive";
    unarchiveButton.addEventListener("click", () => {
      exercise.isArchived = false;
      saveDatabase(appState.database);
      renderExercisesManageList();
      renderArchivedExercisesList();
    });

    rowElement.append(nameSpan, unarchiveButton);

    // Only offered when nothing references this exercise — otherwise
    // Archive (already reversible via Unarchive) is the only removal path,
    // per the "do not delete data" data rule.
    if (isExerciseUnused(exercise.id)) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "small-button destructive-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        const confirmed = confirm(`Delete "${exercise.name}"? This can't be undone.`);
        if (!confirmed) {
          return;
        }
        appState.database.exercises = appState.database.exercises.filter(
          (candidate) => candidate.id !== exercise.id
        );
        saveDatabase(appState.database);
        renderArchivedExercisesList();
      });
      rowElement.appendChild(deleteButton);
    }

    listElement.appendChild(rowElement);
  }
}

document.getElementById("toggleArchivedExercisesButton").addEventListener("click", (event) => {
  const archivedListElement = document.getElementById("archivedExercisesList");
  archivedListElement.hidden = !archivedListElement.hidden;
  event.currentTarget.textContent = archivedListElement.hidden ? "Show archived" : "Hide archived";
  if (!archivedListElement.hidden) {
    renderArchivedExercisesList();
  }
});

// Turns typed text into a weight increment, or null if it isn't a usable
// one. Accepts a comma as the decimal mark too ("1,25"), since a Finnish
// phone keyboard often offers a comma rather than a dot.
function parseLoadIncrement(text) {
  const parsed = parseFloat(String(text).replace(",", "."));
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

document.getElementById("addExerciseButton").addEventListener("click", () => {
  const nameInput = document.getElementById("newExerciseNameInput");
  const gymSpecificCheckbox = document.getElementById("newExerciseGymSpecificCheckbox");
  const incrementInput = document.getElementById("newExerciseIncrementInput");
  const name = nameInput.value.trim();
  if (name === "") {
    alert("Enter a name for the exercise.");
    return;
  }

  const minimumLoadIncrement = parseLoadIncrement(incrementInput.value);
  if (minimumLoadIncrement === null) {
    alert("Enter a minimum weight raise above 0, e.g. 2.5.");
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
    // Empty until set via "Set muscles" in the exercise list below — kept
    // out of the add-exercise form itself to keep adding an exercise a
    // single quick step.
    muscles: {},
    isArchived: false,
    isGymSpecific: gymSpecificCheckbox.checked,
    minimumLoadIncrement
  });
  saveDatabase(appState.database);
  nameInput.value = "";
  gymSpecificCheckbox.checked = false;
  incrementInput.value = "2.5";
  renderExercisesManageList();
});


// An exercise counts as "already there" if either its id or its name
// matches. The name check matters for exercises typed in by hand before
// this list existed: those got an id made from the typed name, which may
// differ slightly from the built-in id, but the same name still means the
// same exercise — adding it twice would split its history in two.
function isExerciseAlreadyInLibrary(builtInExercise) {
  const builtInName = builtInExercise.name.toLowerCase();
  return appState.database.exercises.some(
    (existing) => existing.id === builtInExercise.id || existing.name.toLowerCase() === builtInName
  );
}

document.getElementById("addBuiltInExercisesButton").addEventListener("click", () => {
  const missingExercises = STARTER_EXERCISES.filter((exercise) => !isExerciseAlreadyInLibrary(exercise));

  for (const exercise of missingExercises) {
    // Copy rather than push the built-in object itself, so editing an
    // exercise's muscles later can't quietly change the STARTER_EXERCISES
    // constant too.
    appState.database.exercises.push({ ...exercise, muscles: { ...exercise.muscles } });
  }
  saveDatabase(appState.database);
  renderExercisesManageList();

  if (missingExercises.length === 0) {
    alert("You already have all the built-in exercises.");
  } else {
    alert(`Added ${missingExercises.length} exercises.`);
  }
});

// ---------------------------------------------------------------------------
// Muscle editor — one main muscle (weight 1.0) and any number of secondary
// muscles (weight 0.5) for one exercise, per schema.js's Exercise.muscles
// contract.
// ---------------------------------------------------------------------------

const MUSCLE_GROUP_LABELS = {
  chest: "Chest",
  upperBack: "Upper back",
  lats: "Lats",
  lowerBack: "Lower back",
  traps: "Traps",
  frontDelt: "Front delt",
  sideDelt: "Side delt",
  rearDelt: "Rear delt",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  adductors: "Adductors",
  calves: "Calves"
};

const mainMuscleOptionsElement = document.getElementById("mainMuscleOptions");
const secondaryMuscleOptionsElement = document.getElementById("secondaryMuscleOptions");

// Built once from MUSCLE_GROUPS (schema.js), same reasoning as the
// dayStatus options — the UI can't drift from the schema's own list.
for (const muscle of MUSCLE_GROUPS) {
  const optionButton = document.createElement("button");
  optionButton.type = "button";
  optionButton.className = "day-status-option";
  optionButton.textContent = MUSCLE_GROUP_LABELS[muscle];
  optionButton.dataset.muscle = muscle;
  optionButton.addEventListener("click", () => {
    appState.muscleDraft.mainMuscle = muscle;
    // A muscle can't be both main and secondary at once, so promoting one
    // to main drops it from the secondary list if it was there.
    appState.muscleDraft.secondaryMuscles = appState.muscleDraft.secondaryMuscles.filter(
      (candidate) => candidate !== muscle
    );
    renderMuscleEditor();
  });
  mainMuscleOptionsElement.appendChild(optionButton);
}

function renderMuscleEditor() {
  for (const optionButton of mainMuscleOptionsElement.children) {
    optionButton.classList.toggle(
      "day-status-option-selected",
      optionButton.dataset.muscle === appState.muscleDraft.mainMuscle
    );
  }

  // Rebuilt each time, since which muscle to exclude (the current main
  // one) can change — unlike the main list above, which never changes.
  secondaryMuscleOptionsElement.innerHTML = "";
  for (const muscle of MUSCLE_GROUPS) {
    if (muscle === appState.muscleDraft.mainMuscle) {
      continue;
    }
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "day-status-option";
    optionButton.textContent = MUSCLE_GROUP_LABELS[muscle];
    if (appState.muscleDraft.secondaryMuscles.includes(muscle)) {
      optionButton.classList.add("day-status-option-selected");
    }
    optionButton.addEventListener("click", () => {
      const index = appState.muscleDraft.secondaryMuscles.indexOf(muscle);
      if (index === -1) {
        appState.muscleDraft.secondaryMuscles.push(muscle);
      } else {
        appState.muscleDraft.secondaryMuscles.splice(index, 1);
      }
      renderMuscleEditor();
    });
    secondaryMuscleOptionsElement.appendChild(optionButton);
  }
}

function openMuscleEditor(exerciseId) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);

  // Derives main/secondary from the stored weighted object rather than
  // assuming it already fits that shape: the first muscle at weight 1.0 is
  // "main" for editing, everything else stored counts as "secondary" —
  // which also means saving normalizes any legacy data (like the starter
  // Romanian deadlift, stored with two muscles at 1.0) to the clean shape
  // the moment it's edited.
  const muscleEntries = Object.entries(exercise.muscles);
  const mainEntry = muscleEntries.find(([, weight]) => weight === 1.0);
  const mainMuscle = mainEntry ? mainEntry[0] : null;

  appState.muscleEditorExerciseId = exerciseId;
  appState.muscleDraft = {
    mainMuscle,
    secondaryMuscles: muscleEntries.map(([key]) => key).filter((key) => key !== mainMuscle)
  };

  document.getElementById("muscleEditorExerciseName").textContent = exercise.name;
  renderMuscleEditor();
  // Deliberately not hideAllScreens(): exercisesScreen stays visible
  // underneath, same pattern as the other in-context panels.
  muscleEditorPanel.hidden = false;
}

function closeMuscleEditor() {
  appState.muscleEditorExerciseId = null;
  appState.muscleDraft = null;
  muscleEditorPanel.hidden = true;
}

document.getElementById("saveMusclesButton").addEventListener("click", () => {
  const exercise = appState.database.exercises.find(
    (candidate) => candidate.id === appState.muscleEditorExerciseId
  );
  const newMuscles = {};
  if (appState.muscleDraft.mainMuscle) {
    newMuscles[appState.muscleDraft.mainMuscle] = 1.0;
  }
  for (const muscle of appState.muscleDraft.secondaryMuscles) {
    newMuscles[muscle] = 0.5;
  }
  exercise.muscles = newMuscles;

  saveDatabase(appState.database);
  closeMuscleEditor();
  renderExercisesManageList();
});

document.getElementById("cancelMusclesButton").addEventListener("click", () => {
  closeMuscleEditor();
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

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "small-button";
    renameButton.textContent = "Rename";
    renameButton.addEventListener("click", () => {
      // Only Gym.name changes — the id (referenced by Session.gymId) is
      // never touched by a rename.
      const newName = prompt("Rename gym", gym.name);
      if (newName === null) {
        return;
      }
      const trimmedName = newName.trim();
      if (trimmedName === "") {
        alert("Name can't be empty.");
        return;
      }
      gym.name = trimmedName;
      saveDatabase(appState.database);
      renderGymsManageList();
    });

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
      renderArchivedGymsList();
    });

    rowElement.append(nameSpan, renameButton, archiveButton);
    listElement.appendChild(rowElement);
  }
}

function isGymUnused(gymId) {
  return !appState.database.sessions.some((session) => session.gymId === gymId);
}

function renderArchivedGymsList() {
  const listElement = document.getElementById("archivedGymsList");
  listElement.innerHTML = "";

  for (const gym of appState.database.gyms.filter((candidate) => candidate.isArchived)) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = gym.name;

    const unarchiveButton = document.createElement("button");
    unarchiveButton.type = "button";
    unarchiveButton.className = "small-button";
    unarchiveButton.textContent = "Unarchive";
    unarchiveButton.addEventListener("click", () => {
      gym.isArchived = false;
      saveDatabase(appState.database);
      renderGymsManageList();
      renderArchivedGymsList();
    });

    rowElement.append(nameSpan, unarchiveButton);

    if (isGymUnused(gym.id)) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "small-button destructive-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        const confirmed = confirm(`Delete "${gym.name}"? This can't be undone.`);
        if (!confirmed) {
          return;
        }
        appState.database.gyms = appState.database.gyms.filter((candidate) => candidate.id !== gym.id);
        saveDatabase(appState.database);
        renderArchivedGymsList();
      });
      rowElement.appendChild(deleteButton);
    }

    listElement.appendChild(rowElement);
  }
}

document.getElementById("toggleArchivedGymsButton").addEventListener("click", (event) => {
  const archivedListElement = document.getElementById("archivedGymsList");
  archivedListElement.hidden = !archivedListElement.hidden;
  event.currentTarget.textContent = archivedListElement.hidden ? "Show archived" : "Hide archived";
  if (!archivedListElement.hidden) {
    renderArchivedGymsList();
  }
});

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

    // "Normal" and empty notes are the defaults every session starts with,
    // so only shown when there's actually something to say.
    if (session.dayStatus !== "normal" || session.notes !== "") {
      const statusLine = document.createElement("div");
      statusLine.className = "history-card-line";
      const statusText = session.dayStatus !== "normal" ? DAY_STATUS_LABELS[session.dayStatus] : null;
      statusLine.textContent = [statusText, session.notes].filter(Boolean).join(" — ");
      cardElement.appendChild(statusLine);
    }

    // Lets a mislogged or forgotten status/note be corrected after the fact —
    // the dayStatusPanel doesn't care whether the session it's editing is
    // still active or long finished.
    const editStatusButton = document.createElement("button");
    editStatusButton.type = "button";
    editStatusButton.className = "small-button";
    editStatusButton.textContent = "Edit status";
    editStatusButton.addEventListener("click", () => openDayStatusPanel(session.id));
    cardElement.appendChild(editStatusButton);

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

      const nameLine = document.createElement("div");
      nameLine.className = "history-card-line";
      // Exercise names are never deleted (only archived), so this lookup
      // always resolves even for a long-retired exercise.
      nameLine.textContent = exercise.name;
      cardElement.appendChild(nameLine);

      // Pills rather than plain comma-joined text, same component the
      // active-workout cards use, so each set is its own tap target for
      // correcting a past session — text alone isn't tappable in any
      // reasonably-sized way.
      const pillRowElement = document.createElement("div");
      pillRowElement.className = "set-pills";
      for (const set of group.sets) {
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
    }

    listElement.appendChild(cardElement);
  }
}


// ---------------------------------------------------------------------------
// Bodyweight — separate from workout sessions entirely (a weigh-in isn't
// tied to a gym visit), at most one entry per calendar day. See
// BodyweightEntry in schema.js for why a full timestamp is stored instead of
// a plain date.
// ---------------------------------------------------------------------------

const bodyweightEntryHeading = document.getElementById("bodyweightEntryHeading");
const bodyweightValueElement = document.getElementById("bodyweightValue");
const saveBodyweightButton = document.getElementById("saveBodyweightButton");
const cancelBodyweightEditButton = document.getElementById("cancelBodyweightEditButton");
const deleteBodyweightButton = document.getElementById("deleteBodyweightButton");

// Local calendar day as "YYYY-MM-DD", from the Date object's local getters —
// not toISOString(), which is UTC and so can land on the wrong day near
// midnight depending on the browser's timezone.
function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function findTodaysBodyweightEntry() {
  const todayKey = getLocalDateKey(new Date());
  return appState.database.bodyweightEntries.find(
    (entry) => getLocalDateKey(new Date(entry.loggedAt)) === todayKey
  );
}

// Puts the stepper into "logging today" mode: today's entry if one already
// exists (so re-opening the screen shows what's already logged, not a reset
// value), otherwise the most recent entry as a starting point for a small
// adjustment, otherwise a plain default.
function resetBodyweightEntryToToday() {
  appState.editingBodyweightEntryId = null;

  const todaysEntry = findTodaysBodyweightEntry();
  if (todaysEntry) {
    appState.bodyweightDraftWeightKg = todaysEntry.weightKg;
    return;
  }

  const mostRecentEntry = appState.database.bodyweightEntries
    .slice()
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))[0];
  appState.bodyweightDraftWeightKg = mostRecentEntry ? mostRecentEntry.weightKg : 70;
}

function renderBodyweightDraft() {
  bodyweightValueElement.textContent = `${appState.bodyweightDraftWeightKg.toFixed(1)} kg`;
  bodyweightEntryHeading.textContent = appState.editingBodyweightEntryId
    ? "Editing a past entry"
    : "Log today's weight";
  cancelBodyweightEditButton.hidden = appState.editingBodyweightEntryId === null;
  deleteBodyweightButton.hidden = appState.editingBodyweightEntryId === null;
  saveBodyweightButton.textContent = appState.editingBodyweightEntryId ? "Save changes" : "Save";
}

function renderBodyweightChart() {
  const chartAreaElement = document.getElementById("bodyweightChartArea");
  const emptyMessageElement = document.getElementById("bodyweightEmptyMessage");

  if (appState.database.bodyweightEntries.length === 0) {
    chartAreaElement.hidden = true;
    emptyMessageElement.hidden = false;
    return;
  }
  chartAreaElement.hidden = false;
  emptyMessageElement.hidden = true;

  // Capped to the most recent 30 entries so the chart stays readable years
  // into logging — same reasoning the exercise stats charts cap to 8 weeks.
  const recentEntries = appState.database.bodyweightEntries
    .slice()
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
    .slice(-30);

  const dataPoints = recentEntries.map((entry) => ({
    label: formatSessionDate(entry.loggedAt),
    value: entry.weightKg
  }));

  document.getElementById("bodyweightChart").innerHTML =
    buildLineChartSVG(dataPoints, (value) => `${value} kg`);
}

function renderBodyweightList() {
  const listElement = document.getElementById("bodyweightList");
  listElement.innerHTML = "";

  const entriesNewestFirst = appState.database.bodyweightEntries
    .slice()
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));

  for (const entry of entriesNewestFirst) {
    const itemElement = document.createElement("li");
    itemElement.className = "history-card";

    const headerElement = document.createElement("div");
    headerElement.className = "history-card-header";
    headerElement.textContent = `${formatSessionDate(entry.loggedAt)} — ${entry.weightKg.toFixed(1)} kg`;
    itemElement.appendChild(headerElement);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "small-button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      appState.editingBodyweightEntryId = entry.id;
      appState.bodyweightDraftWeightKg = entry.weightKg;
      renderBodyweightDraft();
    });
    itemElement.appendChild(editButton);

    listElement.appendChild(itemElement);
  }
}

function renderBodyweightScreen() {
  renderBodyweightDraft();
  renderBodyweightChart();
  renderBodyweightList();
}

// 0.5 kg steps, not 0.1 — 0.5 is exactly representable in binary
// floating-point (unlike 0.1), so repeated taps never drift into something
// like 70.30000000000000004. Plenty precise for tracking a trend.
document.getElementById("bodyweightDecrement").addEventListener("click", () =>
  adjustDraftField(appState, "bodyweightDraftWeightKg", -0.5, 0, renderBodyweightDraft));
document.getElementById("bodyweightIncrement").addEventListener("click", () =>
  adjustDraftField(appState, "bodyweightDraftWeightKg", 0.5, 0, renderBodyweightDraft));

makeStepperValueEditable(
  document.getElementById("bodyweightValue"), document.getElementById("bodyweightValueInput"),
  document.getElementById("bodyweightDecrement"), document.getElementById("bodyweightIncrement"),
  () => appState, "bodyweightDraftWeightKg", 0, false, renderBodyweightDraft
);

saveBodyweightButton.addEventListener("click", () => {
  if (appState.editingBodyweightEntryId) {
    // Editing a past entry corrects its weight only — the date it happened
    // on doesn't change.
    const entry = appState.database.bodyweightEntries.find(
      (candidate) => candidate.id === appState.editingBodyweightEntryId
    );
    entry.weightKg = appState.bodyweightDraftWeightKg;
  } else {
    const existingTodaysEntry = findTodaysBodyweightEntry();
    if (existingTodaysEntry) {
      existingTodaysEntry.weightKg = appState.bodyweightDraftWeightKg;
    } else {
      appState.database.bodyweightEntries.push({
        id: crypto.randomUUID(),
        loggedAt: new Date().toISOString(),
        weightKg: appState.bodyweightDraftWeightKg
      });
    }
  }
  saveDatabase(appState.database);
  resetBodyweightEntryToToday();
  renderBodyweightScreen();
});

cancelBodyweightEditButton.addEventListener("click", () => {
  resetBodyweightEntryToToday();
  renderBodyweightScreen();
});

deleteBodyweightButton.addEventListener("click", () => {
  const confirmed = confirm("Delete this bodyweight entry? This can't be undone.");
  if (!confirmed) return;
  appState.database.bodyweightEntries = appState.database.bodyweightEntries.filter(
    (candidate) => candidate.id !== appState.editingBodyweightEntryId
  );
  saveDatabase(appState.database);
  resetBodyweightEntryToToday();
  renderBodyweightScreen();
});


// ---------------------------------------------------------------------------
// Week boundaries — shared by the weekly scheme summary and the per-exercise
// stats charts below, so "which week is this in" is computed one way.
// ---------------------------------------------------------------------------

// The Monday-to-Monday week containing `date`. `end` is exclusive (the
// following Monday), so a comparison is just `start <= x && x < end`.
function getWeekRangeContaining(date) {
  const dayOfWeek = date.getDay(); // 0 = Sunday
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function getCurrentWeekRange() {
  return getWeekRangeContaining(new Date());
}

// A stable, sortable string identifying a week — the ISO date of its
// Monday, e.g. "2026-09-21".
function getWeekKey(date) {
  return getWeekRangeContaining(date).start.toISOString().slice(0, 10);
}


// ---------------------------------------------------------------------------
// Weekly scheme completion summary (main screen, only when idle)
//
// Completion % for a scheme this week = total reps actually logged across
// its exercises this week, divided by total reps planned (using the
// midpoint of each exercise's rep range, since a plan is a range not a
// single number), capped at 100.
// ---------------------------------------------------------------------------

function computeSchemeCompletionPercent(template, session) {
  const sessionWorkingSets = appState.database.sets.filter(
    (set) => set.sessionId === session.id && !set.isWarmup
  );

  let plannedReps = 0;
  let actualReps = 0;

  for (const planned of template.plannedExercises) {
    plannedReps += ((planned.targetRepsMin + planned.targetRepsMax) / 2) * planned.targetSets;
    for (const set of sessionWorkingSets) {
      if (set.exerciseId === planned.exerciseId) {
        actualReps += set.reps;
      }
    }
  }

  if (plannedReps === 0) {
    return 0;
  }
  return Math.min(100, Math.round((actualReps / plannedReps) * 100));
}

const weeklySchemeSummaryElement = document.getElementById("weeklySchemeSummary");
const weeklyBarsElement = document.getElementById("weeklyBars");

function renderWeeklySchemeSummary() {
  // Only meaningful as a "what's left this week" dashboard when there's
  // nothing currently being logged — during a workout, the exercise cards
  // themselves are that context.
  if (appState.activeSessionId !== null) {
    weeklySchemeSummaryElement.hidden = true;
    return;
  }

  const activeTemplates = appState.database.workoutTemplates.filter((template) => !template.isArchived);
  if (activeTemplates.length === 0) {
    weeklySchemeSummaryElement.hidden = true;
    return;
  }
  weeklySchemeSummaryElement.hidden = false;

  const { start, end } = getCurrentWeekRange();
  weeklyBarsElement.innerHTML = "";
  let completedCount = 0;

  for (const template of activeTemplates) {
    // The most recent session this week following this scheme, if any —
    // picks one representative session when a scheme was somehow done
    // more than once in a week, rather than trying to combine them.
    const sessionsThisWeek = appState.database.sessions
      .filter((session) => {
        if (session.templateId !== template.id || session.endedAt === null) {
          return false;
        }
        const startedAt = new Date(session.startedAt);
        return startedAt >= start && startedAt < end;
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const mostRecentSession = sessionsThisWeek[0] || null;
    if (mostRecentSession) {
      completedCount++;
    }

    const barContainer = document.createElement("div");
    barContainer.className = "weekly-bar-container";

    const track = document.createElement("div");
    track.className = "weekly-bar-track";

    if (mostRecentSession) {
      const percent = computeSchemeCompletionPercent(template, mostRecentSession);
      const fill = document.createElement("div");
      fill.className = "weekly-bar-fill";
      // A floor so even a low percentage still shows a visible sliver
      // instead of looking identical to "not done".
      fill.style.height = `${Math.max(percent, 8)}%`;
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

  document.getElementById("weeklySchemeSummaryHeading").textContent =
    `This week's workouts — ${completedCount}/${activeTemplates.length} done`;
}


// ---------------------------------------------------------------------------
// Sets-per-muscle counter (main screen, only when idle)
//
// "Completed" sums each working set's muscle weight (1.0 for its main
// muscle, 0.5 for each secondary) across this week's logged sets, whatever
// exercise or session they came from. "Projected" sums targetSets x muscle
// weight across every active scheme — the same "each scheme once this
// week" assumption the weekly scheme summary above already makes.
// ---------------------------------------------------------------------------

function computeMuscleCounters() {
  const { start, end } = getCurrentWeekRange();

  const projected = {};
  for (const template of appState.database.workoutTemplates) {
    if (template.isArchived) {
      continue;
    }
    for (const planned of template.plannedExercises) {
      const exercise = appState.database.exercises.find((candidate) => candidate.id === planned.exerciseId);
      if (!exercise) {
        continue;
      }
      for (const [muscle, weight] of Object.entries(exercise.muscles)) {
        projected[muscle] = (projected[muscle] || 0) + planned.targetSets * weight;
      }
    }
  }

  const completed = {};
  const thisWeekWorkingSets = appState.database.sets.filter((set) => {
    if (set.isWarmup) {
      return false;
    }
    const performedAt = new Date(set.performedAt);
    return performedAt >= start && performedAt < end;
  });
  for (const set of thisWeekWorkingSets) {
    const exercise = appState.database.exercises.find((candidate) => candidate.id === set.exerciseId);
    if (!exercise) {
      continue;
    }
    for (const [muscle, weight] of Object.entries(exercise.muscles)) {
      completed[muscle] = (completed[muscle] || 0) + weight;
    }
  }

  const allMuscles = new Set([...Object.keys(projected), ...Object.keys(completed)]);
  const rows = Array.from(allMuscles).map((muscle) => ({
    muscle,
    completed: completed[muscle] || 0,
    projected: projected[muscle] || 0
  }));

  // Most-planned muscles first, so the muscles this week's schemes actually
  // emphasize are what's visible without scrolling.
  rows.sort((a, b) => (b.projected - a.projected) || (b.completed - a.completed));
  return rows;
}

// Weighted counts are often fractional (secondary muscles count as 0.5),
// but a whole number shouldn't show a pointless ".0".
function formatSetCount(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const muscleCountersElement = document.getElementById("muscleCounters");
const muscleCounterRowsElement = document.getElementById("muscleCounterRows");

function renderMuscleCounters() {
  if (appState.activeSessionId !== null) {
    muscleCountersElement.hidden = true;
    return;
  }

  const rows = computeMuscleCounters();
  if (rows.length === 0) {
    // Either no exercise has muscles set yet, or nothing planned/logged
    // this week — nothing meaningful to show either way.
    muscleCountersElement.hidden = true;
    return;
  }
  muscleCountersElement.hidden = false;

  muscleCounterRowsElement.innerHTML = "";
  for (const row of rows) {
    const rowElement = document.createElement("div");
    rowElement.className = "muscle-counter-row";

    const labelElement = document.createElement("div");
    labelElement.className = "muscle-counter-label";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = MUSCLE_GROUP_LABELS[row.muscle] || row.muscle;

    const countSpan = document.createElement("span");
    countSpan.className = "muscle-counter-count";
    countSpan.textContent = `${formatSetCount(row.completed)} / ${formatSetCount(row.projected)}`;

    labelElement.append(nameSpan, countSpan);
    rowElement.appendChild(labelElement);

    const trackElement = document.createElement("div");
    trackElement.className = "muscle-counter-track";
    const fillElement = document.createElement("div");
    fillElement.className = "muscle-counter-fill";
    // With nothing projected but something completed (e.g. purely
    // free-form work), a full bar reads better than a division by zero.
    const ratio = row.projected > 0
      ? Math.min(100, (row.completed / row.projected) * 100)
      : (row.completed > 0 ? 100 : 0);
    fillElement.style.width = `${ratio}%`;
    trackElement.appendChild(fillElement);
    rowElement.appendChild(trackElement);

    muscleCounterRowsElement.appendChild(rowElement);
  }
}


// ---------------------------------------------------------------------------
// Muscle diagram — the same weekly completed/projected numbers as the bars
// above, drawn onto a stylized body outline instead. Two views (front/back)
// because no single flat silhouette shows every muscle at once; each of the
// 18 groups in MUSCLE_GROUPS appears in exactly one view, whichever side
// it's normally visible from. This is a schematic (simple rounded
// rectangles and circles placed by eye), not an anatomical illustration —
// good enough to show "which muscles have I been neglecting", not to teach
// anatomy.
// ---------------------------------------------------------------------------

// The plain grey body shape both views are drawn on top of. Shared between
// front and back since, at this level of simplification, the two look the
// same — only which regions light up differs.
const BODY_DIAGRAM_OUTLINE = [
  { shape: "circle", cx: 100, cy: 22, r: 16 },                        // head
  { shape: "rect", x: 92, y: 36, width: 16, height: 10 },              // neck
  { shape: "rect", x: 70, y: 46, width: 60, height: 90, rx: 14 },      // torso
  { shape: "rect", x: 72, y: 136, width: 56, height: 40, rx: 10 },     // hips
  { shape: "rect", x: 36, y: 50, width: 22, height: 80, rx: 10 },      // left upper arm
  { shape: "rect", x: 142, y: 50, width: 22, height: 80, rx: 10 },     // right upper arm
  { shape: "rect", x: 34, y: 132, width: 20, height: 70, rx: 8 },      // left forearm
  { shape: "rect", x: 146, y: 132, width: 20, height: 70, rx: 8 },     // right forearm
  { shape: "rect", x: 74, y: 176, width: 24, height: 90, rx: 10 },     // left thigh
  { shape: "rect", x: 102, y: 176, width: 24, height: 90, rx: 10 },    // right thigh
  { shape: "rect", x: 76, y: 268, width: 20, height: 80, rx: 8 },      // left calf
  { shape: "rect", x: 104, y: 268, width: 20, height: 80, rx: 8 }      // right calf
];

// A bilateral muscle (e.g. biceps) gets two entries, one per limb, both
// colored from the same data — there's only one tracked value per muscle,
// not a separate left and right.
const BODY_DIAGRAM_REGIONS = {
  front: [
    { muscle: "chest", shape: "rect", x: 74, y: 54, width: 52, height: 26, rx: 8 },
    { muscle: "abs", shape: "rect", x: 80, y: 84, width: 40, height: 40, rx: 6 },
    { muscle: "obliques", shape: "rect", x: 70, y: 84, width: 10, height: 40 },
    { muscle: "obliques", shape: "rect", x: 120, y: 84, width: 10, height: 40 },
    // Front delt sits toward the torso side of the shoulder, side delt
    // toward the outer edge — placed apart rather than stacked, so the one
    // drawn second doesn't just paint over the other.
    { muscle: "frontDelt", shape: "circle", cx: 52, cy: 56, r: 9 },
    { muscle: "frontDelt", shape: "circle", cx: 148, cy: 56, r: 9 },
    { muscle: "sideDelt", shape: "rect", x: 36, y: 52, width: 8, height: 26 },
    { muscle: "sideDelt", shape: "rect", x: 156, y: 52, width: 8, height: 26 },
    { muscle: "biceps", shape: "rect", x: 38, y: 82, width: 18, height: 40, rx: 6 },
    { muscle: "biceps", shape: "rect", x: 144, y: 82, width: 18, height: 40, rx: 6 },
    { muscle: "forearms", shape: "rect", x: 36, y: 136, width: 18, height: 60, rx: 6 },
    { muscle: "forearms", shape: "rect", x: 146, y: 136, width: 18, height: 60, rx: 6 },
    { muscle: "quads", shape: "rect", x: 76, y: 182, width: 20, height: 76, rx: 8 },
    { muscle: "quads", shape: "rect", x: 104, y: 182, width: 20, height: 76, rx: 8 },
    { muscle: "adductors", shape: "rect", x: 96, y: 182, width: 8, height: 76 }
  ],
  back: [
    { muscle: "traps", shape: "rect", x: 86, y: 40, width: 28, height: 18, rx: 6 },
    { muscle: "upperBack", shape: "rect", x: 76, y: 58, width: 48, height: 30, rx: 8 },
    { muscle: "lats", shape: "rect", x: 68, y: 70, width: 14, height: 40 },
    { muscle: "lats", shape: "rect", x: 118, y: 70, width: 14, height: 40 },
    { muscle: "lowerBack", shape: "rect", x: 80, y: 112, width: 40, height: 26, rx: 6 },
    { muscle: "rearDelt", shape: "circle", cx: 44, cy: 54, r: 10 },
    { muscle: "rearDelt", shape: "circle", cx: 156, cy: 54, r: 10 },
    { muscle: "triceps", shape: "rect", x: 38, y: 82, width: 18, height: 40, rx: 6 },
    { muscle: "triceps", shape: "rect", x: 144, y: 82, width: 18, height: 40, rx: 6 },
    { muscle: "glutes", shape: "rect", x: 76, y: 138, width: 48, height: 36, rx: 10 },
    { muscle: "hamstrings", shape: "rect", x: 76, y: 182, width: 20, height: 76, rx: 8 },
    { muscle: "hamstrings", shape: "rect", x: 104, y: 182, width: 20, height: 76, rx: 8 },
    { muscle: "calves", shape: "rect", x: 76, y: 268, width: 20, height: 76, rx: 8 },
    { muscle: "calves", shape: "rect", x: 104, y: 268, width: 20, height: 76, rx: 8 }
  ]
};

// Linear blend between two "#rrggbb" colors — `ratio` 0 gives `fromColor`,
// 1 gives `toColor`, anything between is a proportional mix of each
// channel. Used instead of an SVG gradient so the same color logic works
// for both the diagram (many small shapes) and could be reused anywhere
// else a "how close to the target" color is needed.
function blendColor(fromColor, toColor, ratio) {
  const fromChannels = [fromColor.slice(1, 3), fromColor.slice(3, 5), fromColor.slice(5, 7)]
    .map((hex) => parseInt(hex, 16));
  const toChannels = [toColor.slice(1, 3), toColor.slice(3, 5), toColor.slice(5, 7)]
    .map((hex) => parseInt(hex, 16));

  const blendedChannels = fromChannels.map((fromValue, index) => {
    const toValue = toChannels[index];
    const value = Math.round(fromValue + (toValue - fromValue) * ratio);
    return value.toString(16).padStart(2, "0");
  });

  return `#${blendedChannels.join("")}`;
}

// Same grey-to-green as the muscle-counter bars (empty track color to full
// fill color), so the diagram and the bars read as the same scale.
function colorForMuscleCompletion(row) {
  if (!row || (row.completed === 0 && row.projected === 0)) {
    return "#2a2a2a";
  }
  const ratio = row.projected > 0
    ? Math.min(1, row.completed / row.projected)
    : 1; // logged with nothing planned (pure free-form work) reads as "done"
  return blendColor("#2a2a2a", "#3a8a45", ratio);
}

function buildBodyDiagramSVG(view, muscleRows) {
  const rowsByMuscle = {};
  for (const row of muscleRows) {
    rowsByMuscle[row.muscle] = row;
  }

  function regionToSVG(region, fill, isTappable) {
    const fillAttr = fill
      ? `fill="${fill}"`
      : `fill="none" stroke="#555555" stroke-width="2"`;
    // data-muscle plus a shared class is how the single click listener
    // below (added once, not per-shape) figures out which muscle a tap
    // landed on.
    const tapAttrs = isTappable ? `class="body-diagram-region" data-muscle="${region.muscle}"` : "";

    if (region.shape === "circle") {
      return `<circle cx="${region.cx}" cy="${region.cy}" r="${region.r}" ${fillAttr} ${tapAttrs} />`;
    }
    const rxAttr = region.rx ? `rx="${region.rx}"` : "";
    return `<rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" ${rxAttr} ${fillAttr} ${tapAttrs} />`;
  }

  const outlineSVG = BODY_DIAGRAM_OUTLINE
    .map((region) => regionToSVG(region, null, false))
    .join("");

  const regionsSVG = BODY_DIAGRAM_REGIONS[view]
    .map((region) => regionToSVG(region, colorForMuscleCompletion(rowsByMuscle[region.muscle]), true))
    .join("");

  return `<svg viewBox="0 0 200 360" xmlns="http://www.w3.org/2000/svg">${outlineSVG}${regionsSVG}</svg>`;
}

const bodyDiagramElement = document.getElementById("bodyDiagram");
const bodyDiagramFrontButton = document.getElementById("bodyDiagramFrontButton");
const bodyDiagramBackButton = document.getElementById("bodyDiagramBackButton");

function renderBodyDiagram() {
  const rows = computeMuscleCounters();
  if (rows.length === 0) {
    // Same "nothing meaningful to show" condition as the main-screen bars.
    bodyDiagramElement.hidden = true;
    return;
  }
  bodyDiagramElement.hidden = false;

  bodyDiagramFrontButton.classList.toggle("day-status-option-selected", appState.bodyDiagramView === "front");
  bodyDiagramBackButton.classList.toggle("day-status-option-selected", appState.bodyDiagramView === "back");

  document.getElementById("bodyDiagramSVG").innerHTML = buildBodyDiagramSVG(appState.bodyDiagramView, rows);
}

bodyDiagramFrontButton.addEventListener("click", () => {
  appState.bodyDiagramView = "front";
  renderBodyDiagram();
});
bodyDiagramBackButton.addEventListener("click", () => {
  appState.bodyDiagramView = "back";
  renderBodyDiagram();
});

// One listener for every region, rather than one per shape — the shapes
// themselves are rebuilt from scratch (via innerHTML) on every render, so
// listeners attached directly to them would just be thrown away each time.
document.getElementById("bodyDiagramSVG").addEventListener("click", (event) => {
  const regionElement = event.target.closest("[data-muscle]");
  if (!regionElement) {
    return;
  }
  showMuscleStatsDetailScreen(regionElement.dataset.muscle);
});


// ---------------------------------------------------------------------------
// Exercise stats (weight and reps over time, per exercise)
//
// Both charts describe the same representative set for each week — that
// week's heaviest working set for the exercise — so "80 kg" in the weight
// chart and "6 reps" in the reps chart at the same week are the same set.
// ---------------------------------------------------------------------------

// Every gym a (non-warmup) set for this exercise has been logged at,
// derived from those sets' sessions — used to decide whether the stats
// charts need a gym picker at all (a gym-specific exercise done at only
// one gym doesn't need one; its chart is already unambiguous).
function getGymsUsedForExercise(exerciseId) {
  const sessionIds = new Set(
    appState.database.sets
      .filter((set) => set.exerciseId === exerciseId && !set.isWarmup)
      .map((set) => set.sessionId)
  );
  const gymIds = new Set();
  for (const session of appState.database.sessions) {
    if (session.gymId && sessionIds.has(session.id)) {
      gymIds.add(session.gymId);
    }
  }
  return appState.database.gyms.filter((gym) => gymIds.has(gym.id));
}

// One point per week that has data (most recent `weekCount` such weeks),
// each the heaviest non-warmup set logged that week for this exercise.
// `gymId` (optional) restricts this to sets from sessions at that gym —
// used for a gym-specific exercise, so the chart doesn't mix load numbers
// that aren't comparable between locations.
function getWeeklyBestSets(exerciseId, weekCount, gymId = null) {
  let workingSets = appState.database.sets.filter(
    (set) => set.exerciseId === exerciseId && !set.isWarmup
  );

  if (gymId !== null) {
    const sessionIdsAtGym = new Set(
      appState.database.sessions.filter((session) => session.gymId === gymId).map((session) => session.id)
    );
    workingSets = workingSets.filter((set) => sessionIdsAtGym.has(set.sessionId));
  }

  const bestByWeekKey = new Map();
  for (const set of workingSets) {
    const weekKey = getWeekKey(new Date(set.performedAt));
    const existingBest = bestByWeekKey.get(weekKey);
    if (!existingBest || set.load > existingBest.load) {
      bestByWeekKey.set(weekKey, set);
    }
  }

  // Week keys are ISO dates (Monday of that week), so sorting the strings
  // sorts them chronologically too.
  const sortedWeekKeys = Array.from(bestByWeekKey.keys()).sort();
  return sortedWeekKeys.slice(-weekCount).map((weekKey) => bestByWeekKey.get(weekKey));
}

// Builds a small hand-drawn line chart as an SVG string (no charting
// library — nothing can load from a CDN, per CLAUDE.md). `dataPoints` is
// `[{ label, value }]` in left-to-right order.
function buildLineChartSVG(dataPoints, valueFormatter) {
  const width = 320;
  const height = 160;
  const padding = { top: 20, right: 20, bottom: 24, left: 20 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = dataPoints.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  // Flat data (every point the same) would otherwise divide by zero.
  const valueRange = maxValue - minValue || 1;

  const xStep = dataPoints.length > 1 ? plotWidth / (dataPoints.length - 1) : 0;
  const points = dataPoints.map((point, index) => {
    const x = padding.left + index * xStep;
    const y = padding.top + plotHeight - ((point.value - minValue) / valueRange) * plotHeight;
    return { x, y, point };
  });

  const pathData = points
    .map((p, index) => `${index === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const circlesSVG = points
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#2a6df4" />`)
    .join("");

  // A label centered ("middle") on the first or last point would extend
  // past the chart's left/right edge and get clipped by the viewBox — so
  // edge points anchor to their own side instead, and only interior points
  // stay centered on their dot.
  function anchorFor(index) {
    if (index === 0) return "start";
    if (index === points.length - 1) return "end";
    return "middle";
  }

  const valueLabelsSVG = points
    .map((p, index) => {
      // Clamps the label near the top of the chart instead of letting it
      // run off the edge when the point itself is close to the top.
      const labelY = Math.max(p.y - 8, 12);
      return `<text x="${p.x.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="11" fill="#f0f0f0" text-anchor="${anchorFor(index)}">${valueFormatter(p.point.value)}</text>`;
    })
    .join("");

  const axisLabelsSVG = points
    .map((p, index) => `<text x="${p.x.toFixed(1)}" y="${height - 6}" font-size="10" fill="#9a9a9a" text-anchor="${anchorFor(index)}">${p.point.label}</text>`)
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${pathData}" fill="none" stroke="#2a6df4" stroke-width="2" />` +
    circlesSVG + valueLabelsSVG + axisLabelsSVG +
    `</svg>`;
}

function renderExerciseStatsList() {
  const listElement = document.getElementById("exerciseStatsList");
  listElement.innerHTML = "";

  // Only exercises with at least one working set ever logged — an empty
  // chart isn't useful, so there's nothing to tap into for those.
  const exercisesWithHistory = appState.database.exercises.filter((exercise) =>
    appState.database.sets.some((set) => set.exerciseId === exercise.id && !set.isWarmup)
  );

  for (const exercise of exercisesWithHistory) {
    const itemElement = document.createElement("li");
    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "exercise-item";
    // Same "(gym-specific)" convention the Manage Exercises list already
    // uses — otherwise it's not obvious why only some exercises' detail
    // screens show a gym picker.
    buttonElement.textContent = exercise.isGymSpecific ? `${exercise.name} (gym-specific)` : exercise.name;
    buttonElement.addEventListener("click", () => showExerciseStatsDetailScreen(exercise.id));
    itemElement.appendChild(buttonElement);
    listElement.appendChild(itemElement);
  }
}

function renderExerciseStatsDetail(exerciseId) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  document.getElementById("exerciseStatsDetailName").textContent = exercise.name;

  const gymPickerElement = document.getElementById("exerciseStatsGymPicker");
  const gymsUsed = exercise.isGymSpecific ? getGymsUsedForExercise(exerciseId) : [];

  if (gymsUsed.length > 1) {
    // Defaults to the first render's selection staying sticky across
    // re-renders, but falls back to the most recently used gym the first
    // time this exercise's stats are opened.
    if (!gymsUsed.some((gym) => gym.id === appState.exerciseStatsSelectedGymId)) {
      appState.exerciseStatsSelectedGymId = gymsUsed[0].id;
    }

    gymPickerElement.innerHTML = "";
    gymPickerElement.hidden = false;
    for (const gym of gymsUsed) {
      const gymButton = document.createElement("button");
      gymButton.type = "button";
      gymButton.className = "day-status-option";
      gymButton.textContent = gym.name;
      gymButton.classList.toggle("day-status-option-selected", gym.id === appState.exerciseStatsSelectedGymId);
      gymButton.addEventListener("click", () => {
        appState.exerciseStatsSelectedGymId = gym.id;
        renderExerciseStatsDetail(exerciseId);
      });
      gymPickerElement.appendChild(gymButton);
    }
  } else {
    gymPickerElement.hidden = true;
    // Only one gym (or none) has ever been used, so there's nothing to
    // scope by — that single gym's data is already all of it.
    appState.exerciseStatsSelectedGymId = gymsUsed[0] ? gymsUsed[0].id : null;
  }

  const weeklyBestSets = getWeeklyBestSets(exerciseId, 8, appState.exerciseStatsSelectedGymId);
  const emptyMessage = document.getElementById("exerciseStatsEmptyMessage");
  const chartsContainer = document.getElementById("exerciseStatsCharts");

  if (weeklyBestSets.length === 0) {
    emptyMessage.hidden = false;
    chartsContainer.hidden = true;
    return;
  }
  emptyMessage.hidden = true;
  chartsContainer.hidden = false;

  const weightPoints = weeklyBestSets.map((set) => ({
    label: formatSessionDate(set.performedAt),
    value: set.load
  }));
  const repsPoints = weeklyBestSets.map((set) => ({
    label: formatSessionDate(set.performedAt),
    value: set.reps
  }));

  document.getElementById("exerciseStatsWeightChart").innerHTML =
    buildLineChartSVG(weightPoints, (value) => `${value} kg`);
  document.getElementById("exerciseStatsRepsChart").innerHTML =
    buildLineChartSVG(repsPoints, (value) => `${value}`);
}

document.getElementById("viewExerciseStatsButton").addEventListener("click", showExerciseStatsListScreen);
document.getElementById("backFromExerciseStatsListButton").addEventListener("click", showHistoryScreen);
document.getElementById("backFromExerciseStatsDetailButton").addEventListener("click", showExerciseStatsListScreen);


// ---------------------------------------------------------------------------
// Personal bests — heaviest-ever and highest-single-set-volume-ever, per
// exercise, across all history (not scoped to "this week" like the other
// main-screen summaries).
// ---------------------------------------------------------------------------

// The single set, among all non-warmup sets ever logged for this exercise,
// that's the best by `metric` — "weight" (heaviest load) or "volume"
// (highest load x reps in one set). Returns null if the exercise has no
// working-set history at all.
function getBestEverSet(exerciseId, metric) {
  const workingSets = appState.database.sets.filter(
    (set) => set.exerciseId === exerciseId && !set.isWarmup
  );
  if (workingSets.length === 0) {
    return null;
  }

  if (metric === "weight") {
    return workingSets.reduce((best, set) => (set.load > best.load ? set : best));
  }
  return workingSets.reduce((best, set) =>
    (set.load * set.reps > best.load * best.reps ? set : best)
  );
}

// Which gym (if any) a given set was logged at, by way of its session —
// used to label a gym-specific exercise's best set with where it happened,
// since a single "best fact with attribution" isn't the same kind of
// misleading-if-mixed problem the stats trend charts have.
function getGymNameForSet(set) {
  const session = appState.database.sessions.find((candidate) => candidate.id === set.sessionId);
  if (!session || !session.gymId) {
    return null;
  }
  const gym = appState.database.gyms.find((candidate) => candidate.id === session.gymId);
  return gym ? gym.name : null;
}

function renderPersonalBestsList() {
  const listElement = document.getElementById("personalBestsList");
  listElement.innerHTML = "";

  const exercisesWithHistory = appState.database.exercises.filter((exercise) =>
    appState.database.sets.some((set) => set.exerciseId === exercise.id && !set.isWarmup)
  );

  if (exercisesWithHistory.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "No working sets logged yet.";
    listElement.appendChild(emptyMessage);
    return;
  }

  for (const exercise of exercisesWithHistory) {
    const weightBest = getBestEverSet(exercise.id, "weight");
    const volumeBest = getBestEverSet(exercise.id, "volume");

    const cardElement = document.createElement("li");
    cardElement.className = "history-card";

    const headingElement = document.createElement("div");
    headingElement.className = "history-card-header";
    headingElement.textContent = exercise.name;
    cardElement.appendChild(headingElement);

    const weightGymName = exercise.isGymSpecific ? getGymNameForSet(weightBest) : null;
    const weightLine = document.createElement("div");
    weightLine.className = "history-card-line";
    weightLine.textContent =
      `Heaviest: ${weightBest.load} kg × ${weightBest.reps} · ${formatSessionDate(weightBest.performedAt)}` +
      (weightGymName ? ` · ${weightGymName}` : "");
    cardElement.appendChild(weightLine);

    const volumeGymName = exercise.isGymSpecific ? getGymNameForSet(volumeBest) : null;
    const volumeLine = document.createElement("div");
    volumeLine.className = "history-card-line";
    volumeLine.textContent =
      `Best single set: ${volumeBest.load} kg × ${volumeBest.reps} (${volumeBest.load * volumeBest.reps} kg total) · ` +
      `${formatSessionDate(volumeBest.performedAt)}` + (volumeGymName ? ` · ${volumeGymName}` : "");
    cardElement.appendChild(volumeLine);

    listElement.appendChild(cardElement);
  }
}

document.getElementById("viewPersonalBestsButton").addEventListener("click", showPersonalBestsScreen);
document.getElementById("backFromPersonalBestsButton").addEventListener("click", showHistoryScreen);


// ---------------------------------------------------------------------------
// Muscle stats — a per-muscle trend chart extending the main screen's
// "this week" counter across the last several weeks, same weighted-sets
// computation (1.0 main muscle, 0.5 secondary) applied per week instead of
// just the current one.
// ---------------------------------------------------------------------------

// One point per week that has data (most recent `weekCount` such weeks):
// the total weighted sets for `muscle` across every exercise that has it,
// summed from that week's non-warmup sets.
function getWeeklyMuscleSetCounts(muscle, weekCount) {
  const countsByWeekKey = new Map();

  for (const set of appState.database.sets) {
    if (set.isWarmup) {
      continue;
    }
    const exercise = appState.database.exercises.find((candidate) => candidate.id === set.exerciseId);
    const weight = exercise ? exercise.muscles[muscle] : undefined;
    if (weight === undefined) {
      continue;
    }
    const weekKey = getWeekKey(new Date(set.performedAt));
    countsByWeekKey.set(weekKey, (countsByWeekKey.get(weekKey) || 0) + weight);
  }

  // Week keys are ISO dates (Monday of that week), so sorting the strings
  // sorts them chronologically too — same trick getWeeklyBestSets() uses.
  const sortedWeekKeys = Array.from(countsByWeekKey.keys()).sort();
  return sortedWeekKeys.slice(-weekCount).map((weekKey) => ({
    weekKey,
    value: countsByWeekKey.get(weekKey)
  }));
}

function renderMuscleStatsList() {
  const listElement = document.getElementById("muscleStatsList");
  listElement.innerHTML = "";

  const musclesWithHistory = MUSCLE_GROUPS.filter((muscle) =>
    appState.database.sets.some((set) => {
      if (set.isWarmup) {
        return false;
      }
      const exercise = appState.database.exercises.find((candidate) => candidate.id === set.exerciseId);
      return exercise && exercise.muscles[muscle] !== undefined;
    })
  );

  if (musclesWithHistory.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "No exercises with muscles set have been logged yet.";
    listElement.appendChild(emptyMessage);
    return;
  }

  for (const muscle of musclesWithHistory) {
    const itemElement = document.createElement("li");
    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "exercise-item";
    buttonElement.textContent = MUSCLE_GROUP_LABELS[muscle];
    buttonElement.addEventListener("click", () => showMuscleStatsDetailScreen(muscle));
    itemElement.appendChild(buttonElement);
    listElement.appendChild(itemElement);
  }
}

function renderMuscleStatsDetail(muscle) {
  document.getElementById("muscleStatsDetailName").textContent = MUSCLE_GROUP_LABELS[muscle];

  const weeklyCounts = getWeeklyMuscleSetCounts(muscle, 8);
  const emptyMessage = document.getElementById("muscleStatsEmptyMessage");
  const chartContainer = document.getElementById("muscleStatsChartContainer");

  if (weeklyCounts.length === 0) {
    emptyMessage.hidden = false;
    chartContainer.hidden = true;
    return;
  }
  emptyMessage.hidden = true;
  chartContainer.hidden = false;

  const points = weeklyCounts.map((entry) => ({
    // weekKey is already an ISO date (that week's Monday), so it can be
    // formatted the same way a set's performedAt is elsewhere.
    label: formatSessionDate(entry.weekKey),
    value: entry.value
  }));

  document.getElementById("muscleStatsChart").innerHTML =
    buildLineChartSVG(points, (value) => formatSetCount(value));
}

document.getElementById("viewMuscleStatsButton").addEventListener("click", showMuscleStatsListScreen);
document.getElementById("backFromMuscleStatsListButton").addEventListener("click", showHistoryScreen);
document.getElementById("backFromMuscleStatsDetailButton").addEventListener("click", showMuscleStatsListScreen);


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
      renderArchivedSchemesList();
    });

    rowElement.append(nameSpan, editButton, archiveButton);
    listElement.appendChild(rowElement);
  }
}

function isSchemeUnused(templateId) {
  return !appState.database.sessions.some((session) => session.templateId === templateId);
}

function renderArchivedSchemesList() {
  const listElement = document.getElementById("archivedSchemesList");
  listElement.innerHTML = "";

  const archivedTemplates = appState.database.workoutTemplates.filter((template) => template.isArchived);
  for (const template of archivedTemplates) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = template.name;

    const unarchiveButton = document.createElement("button");
    unarchiveButton.type = "button";
    unarchiveButton.className = "small-button";
    unarchiveButton.textContent = "Unarchive";
    unarchiveButton.addEventListener("click", () => {
      template.isArchived = false;
      saveDatabase(appState.database);
      renderSchemesList();
      renderArchivedSchemesList();
      renderStartWorkoutChoices();
    });

    rowElement.append(nameSpan, unarchiveButton);

    if (isSchemeUnused(template.id)) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "small-button destructive-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        const confirmed = confirm(`Delete "${template.name}"? This can't be undone.`);
        if (!confirmed) {
          return;
        }
        appState.database.workoutTemplates = appState.database.workoutTemplates.filter(
          (candidate) => candidate.id !== template.id
        );
        saveDatabase(appState.database);
        renderArchivedSchemesList();
      });
      rowElement.appendChild(deleteButton);
    }

    listElement.appendChild(rowElement);
  }
}

document.getElementById("toggleArchivedSchemesButton").addEventListener("click", (event) => {
  const archivedListElement = document.getElementById("archivedSchemesList");
  archivedListElement.hidden = !archivedListElement.hidden;
  event.currentTarget.textContent = archivedListElement.hidden ? "Show archived" : "Hide archived";
  if (!archivedListElement.hidden) {
    renderArchivedSchemesList();
  }
});

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
  document.getElementById("schemeEditorTitle").textContent = isNewScheme ? "New workout" : "Edit workout";
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

    // Swaps this entry with its neighbor in the array — order in
    // plannedExercises is display order, nothing more, so a swap is enough.
    const moveUpButton = document.createElement("button");
    moveUpButton.type = "button";
    moveUpButton.className = "small-button tiny-button";
    moveUpButton.textContent = "↑";
    moveUpButton.disabled = index === 0;
    moveUpButton.addEventListener("click", () => {
      const plannedExercises = appState.schemeDraft.plannedExercises;
      [plannedExercises[index - 1], plannedExercises[index]] = [plannedExercises[index], plannedExercises[index - 1]];
      renderSchemeEditor();
    });

    const moveDownButton = document.createElement("button");
    moveDownButton.type = "button";
    moveDownButton.className = "small-button tiny-button";
    moveDownButton.textContent = "↓";
    moveDownButton.disabled = index === appState.schemeDraft.plannedExercises.length - 1;
    moveDownButton.addEventListener("click", () => {
      const plannedExercises = appState.schemeDraft.plannedExercises;
      [plannedExercises[index], plannedExercises[index + 1]] = [plannedExercises[index + 1], plannedExercises[index]];
      renderSchemeEditor();
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "small-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      appState.schemeDraft.plannedExercises.splice(index, 1);
      renderSchemeEditor();
    });

    rowElement.append(detailSpan, moveUpButton, moveDownButton, removeButton);
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
    alert("Give the workout a name before saving.");
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
    // Only here so the target-load stepper can look up this exercise's
    // minimum raise; the save handler copies the target fields one by one
    // and ignores this.
    exerciseId,
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
  // Deliberately not hideAllScreens(): activeWorkoutScreen (with the workout
  // cards) stays visible underneath, same as how the set entry panel works.
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
  adjustDraftField(
    appState.plannedExerciseDraft, "targetLoad", -getLoadStep(appState.plannedExerciseDraft.exerciseId), 0, renderPlannedExerciseDraft
  ));
document.getElementById("targetLoadIncrement").addEventListener("click", () =>
  adjustDraftField(
    appState.plannedExerciseDraft, "targetLoad", getLoadStep(appState.plannedExerciseDraft.exerciseId), 0, renderPlannedExerciseDraft
  ));

makeStepperValueEditable(
  document.getElementById("targetSetsValue"), document.getElementById("targetSetsValueInput"),
  document.getElementById("targetSetsDecrement"), document.getElementById("targetSetsIncrement"),
  () => appState.plannedExerciseDraft, "targetSets", 1, true, renderPlannedExerciseDraft
);
makeStepperValueEditable(
  document.getElementById("targetRepsMinValue"), document.getElementById("targetRepsMinValueInput"),
  document.getElementById("targetRepsMinDecrement"), document.getElementById("targetRepsMinIncrement"),
  () => appState.plannedExerciseDraft, "targetRepsMin", 1, true, renderPlannedExerciseDraft
);
makeStepperValueEditable(
  document.getElementById("targetRepsMaxValue"), document.getElementById("targetRepsMaxValueInput"),
  document.getElementById("targetRepsMaxDecrement"), document.getElementById("targetRepsMaxIncrement"),
  () => appState.plannedExerciseDraft, "targetRepsMax", 1, true, renderPlannedExerciseDraft
);
makeStepperValueEditable(
  document.getElementById("targetLoadValue"), document.getElementById("targetLoadValueInput"),
  document.getElementById("targetLoadDecrement"), document.getElementById("targetLoadIncrement"),
  () => appState.plannedExerciseDraft, "targetLoad", 0, false, renderPlannedExerciseDraft
);

// Resets the panel back to its "add a new exercise to the scheme being
// edited" defaults, so the next time it's opened for that purpose it
// doesn't carry over the next-goal wording.
function resetPlannedExerciseEntryPanelToAddMode() {
  plannedExerciseEntryHint.hidden = true;
  document.getElementById("savePlannedExerciseButton").textContent = "Add to workout";
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
      hidePersonalBestBanner();
      closeDayStatusPanel();

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
