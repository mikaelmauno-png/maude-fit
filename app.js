// ---------------------------------------------------------------------------
// App logic for the workout logger.
//
// All reading and writing of saved data happens through the functions in
// schema.js (loadDatabase, saveDatabase, buildBackupFile, importDatabase).
// The UI code (what's on screen and what happens when the user taps
// something) is split over this file and six more, loaded by index.html in
// this order: app.js, workout.js, library.js, history.js, stats.js,
// home-cards.js, settings.js. They're plain <script> files sharing one
// global scope, so a function in one can call a function in any other. This
// file comes first because it loads the saved data and creates appState,
// which everything else uses. It also holds what every area shares or what
// must exist from the very first line: screen switching, the text entry
// panel, and watching for app updates (the service worker registration
// just below starts that straight away).
// ---------------------------------------------------------------------------

// Registers service-worker.js, which caches the app's own files so it still
// loads with no signal — this app is meant to be used mid-workout at a gym.
// Guarded because older browsers don't support service workers at all; the
// app still works without one, just without offline caching.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js");
  watchForAppUpdates();
}

// Copies the stored text that couldn't be loaded to its own backup key, and
// returns that key. This must happen before the app starts on a blank
// database: the very next save writes to STORAGE_KEY and would otherwise
// overwrite the old training history for good.
//
// The raw text is copied as-is, without parsing, so even corrupt JSON is
// kept exactly as it was. The timestamp in the key means a second failure
// later on can never overwrite an earlier backup.
function backUpUnloadableData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const backupKey = `${STORAGE_KEY}-backup-${new Date().toISOString()}`;
  localStorage.setItem(backupKey, raw);
  return backupKey;
}

// Data that has just loaded without errors is a known-good state, so this
// is when the automatic copy (see schema.js) is refreshed: if something
// then goes wrong while the app is open, the copy from before it is intact.
//
// Data without a single workout is never copied. Otherwise a fresh start
// (a first run, or after the data couldn't be loaded below) would replace
// a copy full of real history with a near-empty one on the next opening.
function takeStartupAutoCopy(database) {
  if (database.sessions.length === 0) {
    return;
  }
  saveAutoCopy(database);
}

// Loading fails if the stored data is corrupt, or was saved under a schema
// version that has no migration in schema.js. Starting on a blank database
// keeps the app usable, but only once the old data is safely backed up.
let initialDatabase;
try {
  initialDatabase = loadDatabase();
  takeStartupAutoCopy(initialDatabase);
} catch (error) {
  console.error("Could not load saved data.", error);

  let backupKey;
  try {
    backupKey = backUpUnloadableData();
  } catch (backupError) {
    // Usually a full storage quota. Without a backup, starting fresh would
    // destroy the old data on the first save, so stop here instead. A
    // broken app can be fixed; lost history can't be recovered.
    console.error("Could not back up the unloadable data.", backupError);
    alert(
      "Your saved data could not be loaded, and it could not be backed up " +
      "either. The app will not start, so that nothing gets overwritten. " +
      "Your data is still stored under \"" + STORAGE_KEY + "\"."
    );
    throw backupError;
  }

  alert(
    "Your saved data could not be loaded (" + error.message + ").\n\n" +
    "Nothing was deleted: a copy was kept under \"" + backupKey + "\". " +
    "Starting with a blank database." +
    (loadAutoCopy() !== null
      ? "\n\nAn earlier automatic copy can be restored from Settings → Back up / Import."
      : "")
  );
  initialDatabase = createEmptyDatabase();
}

// The single app-state object.
const appState = {
  database: initialDatabase,
  activeSessionId: null,       // null unless a workout is in progress
  setDraft: null,               // in-progress values for the set being logged
  editingSetId: null,           // id of an existing set being corrected, or null when logging a new one
  isAppUpdateWaiting: false,   // true once a new app version has taken over but this page hasn't reloaded into it yet
  selectedWorkoutTileTemplateId: null, // which home-screen workout tile's details panel is open; null when none
  workoutTemplateDraft: null,  // in-progress copy of the workout template being edited
  plannedExerciseDraft: null,  // in-progress values for a planned exercise
  isTargetRirSetByHand: false, // true once the open planned-exercise panel's target RIR was changed by hand, or came from an existing plan; until then it follows the rep range (see renderPlannedExerciseDraftAfterRepsChange)
  pendingTemplateId: null,     // workout template chosen at Start Workout, held while the gym picker is open
  isPendingCatchUp: false,     // true while the gym picker is open for starting a catch-up workout
  isEditingWorkoutExercises: false, // true while the active workout shows its "Add exercise" and "Remove" buttons
  exercisePickerPurpose: null, // "workoutTemplate" (adding to the template being edited), "activeWorkout" (adding to the workout in progress) or "replacement" (choosing what replaces removeExerciseTargetId at this gym) while the exercise picker is open
  isAddingExerciseToWorkout: false, // true while the target panel is setting up an exercise being added to the workout in progress
  removeExerciseTargetId: null, // which exercise the "Remove from workout" panel (or the replacement picker opened from it) is about; null when both are closed
  nextGoalTarget: null,        // { templateId, exerciseId } while adjusting an existing planned exercise's target from a workout card; null otherwise
  freeformReviewExerciseId: null, // which exercise's logged-sets review card is open, in a free-form workout; null otherwise
  dayStatusDraft: null,           // { readiness, dayStatus, notes } while the today's-status panel is open; null otherwise
  dayStatusEditingSessionId: null, // which session the open day-status panel is editing (active or a past one); null when the panel is closed
  muscleEditorExerciseId: null,   // which exercise's muscle editor is open; null otherwise
  muscleDraft: null,              // { mainMuscle, secondaryMuscles } while the muscle editor is open; null otherwise
  exerciseEditDraft: null,        // { exerciseId, name, minimumLoadIncrement, isGymSpecific, isBodyweight } while the exercise edit panel is open; null otherwise
  textEntryRequest: null,         // { onSave } while the text entry panel is open; onSave(text) returns an error message, or null when saved
  exerciseSearchText: "",         // what's typed in the exercise library's search box
  checkInDraft: null,               // { weekStart, fatigue, stress, motivation, recovery, notes } while the weekly check-in screen is open; a rating is null until answered
  isCheckInOpenedFromStats: false, // true when the check-in screen was opened from Stats, so saving stays there instead of going home
  cardioDraft: null,                // the cardio session being logged or edited while the Log cardio screen is open (see startNewCardioDraft); null otherwise
  recapMonth: null,                 // { year, monthIndex } the monthly recap is showing (monthIndex 0 = January); null until it's first opened
  exerciseStatsSelectedGymId: null, // which gym's data the stats charts are scoped to, when the exercise is gym-specific and used at more than one gym
  bodyweightDraftWeightKg: null,    // value shown on the bodyweight stepper; null only before the Bodyweight screen has been opened once
  editingBodyweightEntryId: null,   // id of a past entry being corrected, or null while logging today's weight
  isBodyweightOpenedFromWorkout: false, // true when the Bodyweight screen was opened from the active workout, so Back and Save return there instead of home
  bodyDiagramView: "front",         // which side of the muscle-diagram body outline is showing, "front" or "back"
  personalBestBannerTimeoutId: null // the pending timer that hides the personal-best banner, so a newer banner can cancel it; null when none is pending
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
const workoutTemplatesScreen = document.getElementById("workoutTemplatesScreen");
const workoutTemplateEditorScreen = document.getElementById("workoutTemplateEditorScreen");
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
const monthlyRecapScreen = document.getElementById("monthlyRecapScreen");
const weeklyCheckInScreen = document.getElementById("weeklyCheckInScreen");
const cardioActivitiesScreen = document.getElementById("cardioActivitiesScreen");
const cardioLogScreen = document.getElementById("cardioLogScreen");
const muscleStatsListScreen = document.getElementById("muscleStatsListScreen");
const muscleStatsDetailScreen = document.getElementById("muscleStatsDetailScreen");
const bodyweightScreen = document.getElementById("bodyweightScreen");
const statsScreen = document.getElementById("statsScreen");
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
const removeExercisePanel = document.getElementById("removeExercisePanel");
const exerciseEditPanel = document.getElementById("exerciseEditPanel");
const textEntryPanel = document.getElementById("textEntryPanel");

// Every top-level screen, so each show*Screen() function below can hide all
// of them and then reveal just its own, without repeating this list six times.
const allScreens = [
  mainScreen, activeWorkoutScreen, settingsScreen, dataScreen, workoutTemplatesScreen, workoutTemplateEditorScreen,
  exercisePickerScreen, plannedExerciseEntryPanel, exercisesScreen, historyScreen, gymsScreen,
  gymPickerScreen, setEntryPanel, exerciseStatsListScreen, exerciseStatsDetailScreen, muscleEditorPanel,
  personalBestsScreen, muscleStatsListScreen, muscleStatsDetailScreen, dayStatusPanel,
  bodyweightScreen, removeExercisePanel, monthlyRecapScreen, weeklyCheckInScreen,
  cardioActivitiesScreen, cardioLogScreen, statsScreen, exerciseEditPanel, textEntryPanel
];

// Hides the bottom bar too: most screens don't have it, so the four that
// do turn it back on themselves with showBottomNav.
function hideAllScreens() {
  for (const screen of allScreens) {
    screen.hidden = true;
  }
  bottomNavBar.hidden = true;
}

// The bottom bar, and which of its four buttons to light up as "you are
// here". Keys are the nav button ids.
const bottomNavBar = document.getElementById("bottomNavBar");
const bottomNavButtonIds = {
  home: "navHomeButton",
  history: "viewHistoryButton",
  bodyweight: "viewBodyweightButton",
  settings: "viewSettingsButton"
};

function showBottomNav(currentPlace) {
  bottomNavBar.hidden = false;
  for (const [place, buttonId] of Object.entries(bottomNavButtonIds)) {
    document.getElementById(buttonId).classList.toggle("bottom-nav-button-current", place === currentPlace);
  }
}

function showMainScreen() {
  hideAllScreens();
  mainScreen.hidden = false;
  showBottomNav("home");
  renderFirstRunHint();
  renderStartWorkoutChoices();
  completeDeloadIfFinished();
  makeBackstopOfferIfDue();
  renderBackstopOfferCards();
  renderDeloadCard();
  renderDevelopmentReminders();
  renderWeeklyCheckInPrompt();
  renderBackupStatus();
  renderWeeklyWorkoutTemplateSummary();
  renderMuscleCounters();
  // Coming back home (e.g. after ending a workout) is the moment a waiting
  // update can finally be applied.
  reloadForUpdateIfSafe();
}

// Doesn't touch appState.activeSessionId or end the workout — this just
// changes which screen is visible. The session (if any) keeps running
// whether this screen or the home screen is what's on top.
function showActiveWorkoutScreen() {
  hideAllScreens();
  activeWorkoutScreen.hidden = false;
  // Today's weigh-in may have just been logged on the Bodyweight screen.
  renderWorkoutBodyweightButton();
}

// Back to wherever the Bodyweight screen was opened from.
function leaveBodyweightScreen() {
  if (appState.isBodyweightOpenedFromWorkout) {
    showActiveWorkoutScreen();
  } else {
    showMainScreen();
  }
}

// A brand-new install has no workouts, which leaves the home screen with
// little more than "Start free-form workout". Once any workout exists
// (archived ones count: whoever made one knows where they live), the hint
// is gone for good.
function renderFirstRunHint() {
  const hasAnyWorkoutTemplate = appState.database.workoutTemplates.length > 0;
  document.getElementById("firstRunHint").hidden = hasAnyWorkoutTemplate || appState.activeSessionId !== null;
}

function showSettingsScreen() {
  hideAllScreens();
  settingsScreen.hidden = false;
  showBottomNav("settings");
  renderSettingsScreen();
}

function showStatsScreen() {
  hideAllScreens();
  statsScreen.hidden = false;
  // Stats is reached from History, so History stays the lit-up place.
  showBottomNav("history");
}

function showDataScreen() {
  hideAllScreens();
  dataScreen.hidden = false;
  renderAutoCopyStatus();
}

function showWorkoutTemplatesScreen() {
  hideAllScreens();
  workoutTemplatesScreen.hidden = false;
  renderWorkoutTemplatesList();
}

function showWorkoutTemplateEditorScreen() {
  hideAllScreens();
  workoutTemplateEditorScreen.hidden = false;
  renderWorkoutTemplateEditor();
}

function showExercisesScreen() {
  hideAllScreens();
  exercisesScreen.hidden = false;
  // A fresh visit: no edit left half-open from before (it would pop back
  // up when the muscle editor closes), and the add form folded away.
  appState.exerciseEditDraft = null;
  hideNewExerciseForm();
  renderExercisesManageList();
}

function showHistoryScreen() {
  hideAllScreens();
  historyScreen.hidden = false;
  showBottomNav("history");
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
  renderDropDetectionReadout();
}

function showMuscleStatsDetailScreen(muscle) {
  hideAllScreens();
  muscleStatsDetailScreen.hidden = false;
  renderMuscleStatsDetail(muscle);
}

function showBodyweightScreen(isOpenedFromWorkout) {
  hideAllScreens();
  appState.isBodyweightOpenedFromWorkout = isOpenedFromWorkout;
  bodyweightScreen.hidden = false;
  // From a workout: no bottom bar (it never shows during one), just a way
  // back to the workout. Otherwise the bar is the way out.
  document.getElementById("backFromBodyweightButton").hidden = !isOpenedFromWorkout;
  if (!isOpenedFromWorkout) {
    showBottomNav("bodyweight");
  }
  resetBodyweightEntryToToday();
  renderBodyweightScreen();
}

document.getElementById("viewSettingsButton").addEventListener("click", showSettingsScreen);
document.getElementById("manageWorkoutTemplatesButton").addEventListener("click", showWorkoutTemplatesScreen);
// These three "Back" buttons return to Settings, not the main screen —
// Settings is where each of these screens was actually opened from now.
document.getElementById("backFromWorkoutTemplatesButton").addEventListener("click", showSettingsScreen);
document.getElementById("manageExercisesButton").addEventListener("click", showExercisesScreen);
document.getElementById("backFromExercisesButton").addEventListener("click", showSettingsScreen);
document.getElementById("viewHistoryButton").addEventListener("click", showHistoryScreen);
document.getElementById("viewStatsButton").addEventListener("click", showStatsScreen);
document.getElementById("backFromStatsButton").addEventListener("click", showHistoryScreen);
document.getElementById("viewBodyweightButton").addEventListener("click", () => showBodyweightScreen(false));
// Already home: scroll back up to the workouts instead, which is what
// tapping the current tab does in most phone apps.
document.getElementById("navHomeButton").addEventListener("click", () => {
  if (mainScreen.hidden) {
    showMainScreen();
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});
document.getElementById("backFromBodyweightButton").addEventListener("click", leaveBodyweightScreen);
document.getElementById("manageGymsButton").addEventListener("click", showGymsScreen);
document.getElementById("backFromGymsButton").addEventListener("click", showSettingsScreen);
document.getElementById("viewDataButton").addEventListener("click", showDataScreen);
document.getElementById("backFromDataButton").addEventListener("click", showSettingsScreen);
document.getElementById("homeFromWorkoutButton").addEventListener("click", showMainScreen);


// ---------------------------------------------------------------------------
// Looking up the active session and the workout template it follows
// ---------------------------------------------------------------------------

function getActiveSession() {
  if (appState.activeSessionId === null) {
    return null;
  }
  return appState.database.sessions.find((session) => session.id === appState.activeSessionId) || null;
}

// Returns the WorkoutTemplate the current workout is following, or null for
// a free-form workout (or when no workout is active). A catch-up workout
// gets a stand-in built from its own plan (see buildCatchUpTemplate).
function getActiveTemplate() {
  const session = getActiveSession();
  if (session && session.catchUpExercises) {
    return buildCatchUpTemplate(session);
  }
  if (!session || !session.templateId) {
    return null;
  }
  return appState.database.workoutTemplates.find((template) => template.id === session.templateId) || null;
}

// A catch-up workout has no saved template, but shaped like one it can
// use the same workout cards, set panel and suggestions as a template
// workout. isCatchUp marks it, so the buttons that would change a real
// template ("Set goal for next time", "Remove from template") stay hidden:
// there's no template behind it to change.
function buildCatchUpTemplate(session) {
  return {
    id: null,
    name: "Catch-up",
    isArchived: false,
    isCatchUp: true,
    plannedExercises: session.catchUpExercises
  };
}

// A template workout's exercise list for that day: the template's own
// list, minus anything skipped for that workout only, plus anything added
// for that workout only (see Session in schema.js), with any exercise this
// gym can't do swapped for its replacement. An added exercise with a
// listPosition goes back in at that place; the rest go at the end.
//
// In a deload workout, the template's exercises also get their deload's
// smaller set count (see applyDeloadSetCount).
function getSessionPlannedExercises(session, template) {
  const dayList = template.plannedExercises
    .filter((planned) => !session.removedExerciseIds.includes(planned.exerciseId))
    .map((planned) => applyDeloadSetCount(session, applyReplacement(session, planned)));

  // Put back in ascending order, so each insert lands where it was when
  // its position was recorded (every earlier one is already in place).
  const withPosition = session.addedExercises
    .filter((planned) => typeof planned.listPosition === "number")
    .sort((a, b) => a.listPosition - b.listPosition);
  for (const planned of withPosition) {
    // splice(position, 0, item) inserts without removing anything.
    dayList.splice(Math.min(planned.listPosition, dayList.length), 0, planned);
  }

  const withoutPosition = session.addedExercises.filter((planned) => typeof planned.listPosition !== "number");
  return dayList.concat(withoutPosition);
}

// The swap for one template exercise in this workout, or null when it
// isn't swapped.
function findReplacementOf(session, exerciseId) {
  return session.replacedExercises.find((replacement) => replacement.exerciseId === exerciseId) || null;
}

// The other direction: which swap put this exercise into the workout, or
// null when it's there in its own right. Needed because a replacement's
// card is about the replacement, while the template only knows the
// original.
function findReplacementBy(session, replacementExerciseId) {
  return session.replacedExercises.find(
    (replacement) => replacement.replacementExerciseId === replacementExerciseId
  ) || null;
}

// The planned entry as it is done today. A swapped exercise keeps the
// original's sets and rep range, so the workout keeps its shape, but
// starts from its own last load: the original's target load is for a
// different movement. replacesExerciseId is only on this day-list copy,
// never saved, so the card can say what it stands in for.
function applyReplacement(session, planned) {
  const replacement = findReplacementOf(session, planned.exerciseId);
  if (!replacement) {
    return planned;
  }
  const previous = findMostRecentWorkingSet(replacement.replacementExerciseId);
  return {
    ...planned,
    exerciseId: replacement.replacementExerciseId,
    targetLoad: previous ? previous.load : defaultStartingLoad(findExerciseById(replacement.replacementExerciseId)),
    // Any goal set by hand was for the original, so it doesn't apply.
    targetLoadSetAt: null,
    replacesExerciseId: planned.exerciseId
  };
}

// The Deload a workout was part of, or null for a normal workout.
function findSessionDeload(session) {
  if (!session.deload) {
    return null;
  }
  return appState.database.deloads.find((deload) => deload.id === session.deload.deloadId) || null;
}

// True when this exercise is done as deload sets in this workout. Takes
// the exercise as done (a gym swap's own id), same as the sets.
function isDeloadExerciseInSession(session, exerciseId) {
  return session.deload !== null && session.deload.exerciseIds.includes(exerciseId);
}

// The planned entry with the deload's smaller set count, when it's done as
// deload sets in this workout. The count comes from the Deload record,
// which saved it when the deload started, so a past deload workout still
// reads with the sets it planned even if the template changed since.
//
// A catch-up workout keeps its own counts: they're the sets still missing,
// worked out from workouts that were already cut down.
function applyDeloadSetCount(session, planned) {
  const deload = findSessionDeload(session);
  if (!deload || session.catchUpExercises || !isDeloadExerciseInSession(session, planned.exerciseId)) {
    return planned;
  }
  const originalExerciseId = planned.replacesExerciseId || planned.exerciseId;
  const slot = findDeloadSlot(deload, session.templateId, originalExerciseId);
  return slot ? { ...planned, targetSets: slot.plannedSets } : planned;
}

// The plan a workout's deload exercises are chosen from (see
// chooseDeloadExerciseIds in deload.js): the template's own list, or the
// catch-up plan.
function findPlanForDeloadChoice(session) {
  if (session.catchUpExercises) {
    return session.catchUpExercises;
  }
  const template = appState.database.workoutTemplates.find((candidate) => candidate.id === session.templateId);
  return template ? template.plannedExercises : [];
}

// Session.deload for a workout starting now: which deload it's part of and
// which of its exercises are done as deload sets, or null when there's no
// deload running or none of this workout's exercises are in it. A
// free-form workout is never part of one: it has no slots.
function chooseSessionDeload(session) {
  const deload = findActiveDeload(appState.database);
  if (!deload || (!session.templateId && !session.catchUpExercises)) {
    return null;
  }
  const exerciseIds = chooseDeloadExerciseIds(session, findPlanForDeloadChoice(session), deload);
  return exerciseIds.length > 0 ? { deloadId: deload.id, exerciseIds } : null;
}

// After a gym swap is made or undone mid-workout, the exercise done for a
// slot changes, and Session.deload.exerciseIds has to follow it: it lists
// the exercises as done, since that's what the sets carry.
function refreshSessionDeloadExerciseIds(session) {
  const deload = findSessionDeload(session);
  if (deload) {
    session.deload.exerciseIds = chooseDeloadExerciseIds(session, findPlanForDeloadChoice(session), deload);
  }
}

function isAddedForThisWorkoutOnly(session, exerciseId) {
  return session.addedExercises.some((planned) => planned.exerciseId === exerciseId);
}


// ---------------------------------------------------------------------------
// Text entry panel: the app's own replacement for the browser's prompt()
// box, used wherever one value has to be typed (renaming a gym or a cardio
// activity, a machine's heaviest weight).
// ---------------------------------------------------------------------------

const textEntryInput = document.getElementById("textEntryInput");
const textEntryError = document.getElementById("textEntryError");

// `onSave(text)` gets what was typed. It does the saving itself and
// returns null when that worked, or a message saying what to fix, which
// is shown in the panel while it stays open. `isNumber` brings up the
// phone's number keyboard instead of letters.
function openTextEntryPanel({ heading, label, initialValue, placeholder = "", isNumber = false, onSave }) {
  appState.textEntryRequest = { onSave };
  document.getElementById("textEntryHeading").textContent = heading;
  document.getElementById("textEntryLabel").textContent = label;
  textEntryInput.value = initialValue;
  textEntryInput.placeholder = placeholder;
  textEntryInput.inputMode = isNumber ? "decimal" : "text";
  textEntryError.hidden = true;
  textEntryPanel.hidden = false;
  textEntryInput.focus();
}

function closeTextEntryPanel() {
  appState.textEntryRequest = null;
  textEntryPanel.hidden = true;
}

function saveTextEntry() {
  const errorMessage = appState.textEntryRequest.onSave(textEntryInput.value);
  if (errorMessage) {
    textEntryError.textContent = errorMessage;
    textEntryError.hidden = false;
    return;
  }
  closeTextEntryPanel();
}

document.getElementById("saveTextEntryButton").addEventListener("click", saveTextEntry);
document.getElementById("cancelTextEntryButton").addEventListener("click", closeTextEntryPanel);
// The keyboard's own Enter/Go key saves too, so there's no reaching past
// the keyboard for the Save button.
textEntryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    saveTextEntry();
  }
});

// The shared rename check: Gym, CardioActivity and Exercise all only
// change their name, never their id, so history follows the new name.
// Returns the error message for openTextEntryPanel, or null once renamed.
function renameItem(item, typedName, rerender) {
  const trimmedName = typedName.trim();
  if (trimmedName === "") {
    return "The name can't be empty.";
  }
  item.name = trimmedName;
  saveDatabase(appState.database);
  rerender();
  return null;
}


// ---------------------------------------------------------------------------
// App updates
//
// A new version reaches the phone in the background: service-worker.js
// notices changed files, downloads them, and takes over. But the page
// already on screen was loaded from the old files, so without a reload the
// new version would only show up the *next* time the app is opened.
//
// The reload only ever happens on the home screen with no workout in
// progress. A workout in progress does come back after a reload (see
// "Unfinished workouts" below), but whatever was on the set-entry panel's
// steppers and not yet saved would be lost — not worth risking mid-set.
// ---------------------------------------------------------------------------

function watchForAppUpdates() {
  // On the very first visit no service worker is in charge yet, and the
  // first one taking over is just installation, not an update — there is
  // nothing newer to reload into.
  const hadServiceWorkerAtLoad = navigator.serviceWorker.controller !== null;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadServiceWorkerAtLoad) {
      return;
    }
    appState.isAppUpdateWaiting = true;
    reloadForUpdateIfSafe();
  });

  // Switching back to the app on a phone usually just wakes up the old page
  // instead of loading it again, and the browser only checks for a new
  // version on a real load. So check by hand each time the app comes back
  // into view.
  document.addEventListener("visibilitychange", checkForAppUpdate);
}

function checkForAppUpdate() {
  if (document.visibilityState !== "visible") {
    return;
  }
  navigator.serviceWorker.getRegistration().then((registration) => {
    if (!registration) {
      return;
    }
    // Fails with no signal. Nothing to do about that — the next time the
    // app comes back into view it simply tries again.
    registration.update().catch(() => {});
  });
}

function reloadForUpdateIfSafe() {
  if (!appState.isAppUpdateWaiting) {
    return;
  }
  const isIdleOnHomeScreen = !mainScreen.hidden && appState.activeSessionId === null;
  if (!isIdleOnHomeScreen) {
    // Stays waiting; showMainScreen() calls this again on the way home.
    return;
  }
  location.reload();
}
