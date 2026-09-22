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
  checklistExerciseId: null,   // which exercise's set checklist is open
  schemeDraft: null,           // in-progress copy of the scheme being edited
  plannedExerciseDraft: null   // in-progress values for a planned exercise
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

// Every top-level screen, so each show*Screen() function below can hide all
// of them and then reveal just its own, without repeating this list six times.
const allScreens = [
  mainScreen, schemesScreen, schemeEditorScreen, exercisePickerScreen,
  plannedExerciseEntryPanel, exercisesScreen, historyScreen
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

document.getElementById("manageSchemesButton").addEventListener("click", showSchemesScreen);
document.getElementById("backFromSchemesButton").addEventListener("click", showMainScreen);
document.getElementById("manageExercisesButton").addEventListener("click", showExercisesScreen);
document.getElementById("backFromExercisesButton").addEventListener("click", showMainScreen);
document.getElementById("viewHistoryButton").addEventListener("click", showHistoryScreen);
document.getElementById("backFromHistoryButton").addEventListener("click", showMainScreen);


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

// Redraws whichever exercise list applies right now: the full library when
// there's no active scheme, or just that scheme's exercises with their
// targets and progress when there is one.
function renderExerciseArea() {
  const template = getActiveTemplate();
  if (template) {
    renderSchemeExerciseList(template);
  } else {
    renderFreeformExerciseList();
  }
}

function renderFreeformExerciseList() {
  const listElement = document.getElementById("exerciseList");
  listElement.innerHTML = "";

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
    listElement.appendChild(itemElement);
  }
}

function renderSchemeExerciseList(template) {
  const listElement = document.getElementById("exerciseList");
  listElement.innerHTML = "";

  for (const planned of template.plannedExercises) {
    const exercise = appState.database.exercises.find((candidate) => candidate.id === planned.exerciseId);
    const loggedCount = appState.database.sets.filter(
      (set) =>
        set.sessionId === appState.activeSessionId &&
        set.exerciseId === planned.exerciseId &&
        !set.isWarmup
    ).length;

    const itemElement = document.createElement("li");
    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "exercise-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "exercise-item-name";
    nameSpan.textContent = exercise.name;

    const detailSpan = document.createElement("span");
    detailSpan.className = "exercise-item-detail";
    detailSpan.textContent =
      `${loggedCount}/${planned.targetSets} sets · ${planned.targetRepsMin}-${planned.targetRepsMax} reps @ ${planned.targetLoad} kg`;

    buttonElement.append(nameSpan, detailSpan);
    buttonElement.addEventListener("click", () => {
      openChecklist(planned.exerciseId);
    });

    itemElement.appendChild(buttonElement);
    listElement.appendChild(itemElement);
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
    button.addEventListener("click", () => startWorkout(template.id));
    startWorkoutChoices.appendChild(button);
  }

  const freeformButton = document.createElement("button");
  freeformButton.type = "button";
  freeformButton.textContent = "Start free-form workout";
  freeformButton.addEventListener("click", () => startWorkout(null));
  startWorkoutChoices.appendChild(freeformButton);
}

function updateWorkoutControls() {
  const isActive = appState.activeSessionId !== null;
  endWorkoutButton.hidden = !isActive;
  workoutStatus.textContent = isActive ? "Workout in progress" : "";
  renderStartWorkoutChoices();
}

function startWorkout(templateId) {
  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    dayStatus: "normal",
    notes: "",
    templateId: templateId
  };
  appState.database.sessions.push(session);
  appState.activeSessionId = session.id;
  saveDatabase(appState.database);
  updateWorkoutControls();
  renderExerciseArea();
}

endWorkoutButton.addEventListener("click", () => {
  const session = getActiveSession();
  session.endedAt = new Date().toISOString();
  saveDatabase(appState.database);
  // Closing these first, while activeSessionId still points at the session
  // that's ending, matters: closeSetEntryPanel() can re-render the checklist,
  // which looks up the active template through activeSessionId — clearing it
  // first would make that lookup fail.
  closeChecklist();
  closeSetEntryPanel();
  appState.activeSessionId = null;
  updateWorkoutControls();
  renderExerciseArea();
});

renderStartWorkoutChoices();


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

// Finds the most recently performed working (non-warmup) set for an
// exercise, across all past sessions. Warmups are excluded because they
// don't represent what was actually trained.
function findPreviousWorkingSet(exerciseId) {
  const matchingSets = appState.database.sets.filter(
    (set) => set.exerciseId === exerciseId && !set.isWarmup
  );

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
// plan, passed in when opened from the set checklist below. When present,
// load/reps default to the plan rather than to past performance, since the
// plan is what today is supposed to follow.
function openSetEntryPanel(exerciseId, planTarget = null) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const previous = findPreviousWorkingSet(exerciseId);

  appState.setDraft = {
    exerciseId,
    load: planTarget ? planTarget.load : (previous ? previous.load : 20),
    reps: planTarget ? planTarget.repsMin : (previous ? previous.reps : 8),
    rir: previous ? previous.rir : 2,
    isWarmup: false
  };

  setEntryExerciseName.textContent = exercise.name;

  if (planTarget) {
    plannedTarget.textContent = `Planned: ${planTarget.repsMin}-${planTarget.repsMax} reps @ ${planTarget.load} kg`;
    plannedTarget.hidden = false;
  } else {
    plannedTarget.hidden = true;
  }

  previousPerformance.textContent = previous
    ? `Last: ${previous.load} kg × ${previous.reps} (RIR ${previous.rir})`
    : "No previous data for this exercise.";

  renderSetDraft();
  setEntryPanel.hidden = false;
}

function closeSetEntryPanel() {
  appState.setDraft = null;
  setEntryPanel.hidden = true;
  // The checklist's logged/remaining counts and the scheme exercise list's
  // progress both depend on the sets that exist, so refresh them too.
  if (!document.getElementById("plannedSetChecklist").hidden) {
    renderChecklist();
  }
  renderExerciseArea();
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

document.getElementById("saveSetButton").addEventListener("click", () => {
  const draft = appState.setDraft;

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
    // RIR is meaningless for a warmup, so it's stored as null rather than a
    // made-up number — schema.js's contract calls this out explicitly.
    rir: draft.isWarmup ? null : draft.rir,
    isWarmup: draft.isWarmup,
    performedAt: new Date().toISOString()
  };

  appState.database.sets.push(newSet);
  saveDatabase(appState.database);
  closeSetEntryPanel();
});

document.getElementById("cancelSetButton").addEventListener("click", () => {
  closeSetEntryPanel();
});


// ---------------------------------------------------------------------------
// Planned-set checklist (shown instead of the plain exercise tap, when the
// active workout follows a scheme)
// ---------------------------------------------------------------------------

const plannedSetChecklist = document.getElementById("plannedSetChecklist");
const checklistExerciseName = document.getElementById("checklistExerciseName");
const checklistRows = document.getElementById("checklistRows");

function openChecklist(exerciseId) {
  appState.checklistExerciseId = exerciseId;
  plannedSetChecklist.hidden = false;
  renderChecklist();
}

function closeChecklist() {
  appState.checklistExerciseId = null;
  plannedSetChecklist.hidden = true;
}

function renderChecklist() {
  const template = getActiveTemplate();
  const planned = template.plannedExercises.find(
    (candidate) => candidate.exerciseId === appState.checklistExerciseId
  );
  const exercise = appState.database.exercises.find(
    (candidate) => candidate.id === appState.checklistExerciseId
  );

  checklistExerciseName.textContent = exercise.name;
  checklistRows.innerHTML = "";

  const loggedSets = appState.database.sets
    .filter(
      (set) =>
        set.sessionId === appState.activeSessionId &&
        set.exerciseId === appState.checklistExerciseId &&
        !set.isWarmup
    )
    .sort((a, b) => a.order - b.order);

  for (let setIndex = 0; setIndex < planned.targetSets; setIndex++) {
    const rowElement = document.createElement("li");
    rowElement.className = "scheme-list-item";
    const loggedSet = loggedSets[setIndex];

    if (loggedSet) {
      const doneSpan = document.createElement("span");
      doneSpan.textContent =
        `Set ${setIndex + 1}: ${loggedSet.load} kg × ${loggedSet.reps} (RIR ${loggedSet.rir}) ✓`;
      rowElement.appendChild(doneSpan);
    } else {
      const rowButton = document.createElement("button");
      rowButton.type = "button";
      rowButton.className = "exercise-item";
      rowButton.textContent =
        `Set ${setIndex + 1}: target ${planned.targetRepsMin}-${planned.targetRepsMax} reps @ ${planned.targetLoad} kg`;
      rowButton.addEventListener("click", () => {
        openSetEntryPanel(appState.checklistExerciseId, {
          load: planned.targetLoad,
          repsMin: planned.targetRepsMin,
          repsMax: planned.targetRepsMax
        });
      });
      rowElement.appendChild(rowButton);
    }

    checklistRows.appendChild(rowElement);
  }
}

document.getElementById("addExtraSetButton").addEventListener("click", () => {
  // Beyond the planned count, fall back to ordinary previous-performance
  // pre-filling rather than a plan target.
  openSetEntryPanel(appState.checklistExerciseId);
});

document.getElementById("closeChecklistButton").addEventListener("click", () => {
  closeChecklist();
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
    nameSpan.textContent = exercise.name;

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

    rowElement.append(nameSpan, archiveButton);
    listElement.appendChild(rowElement);
  }
}

document.getElementById("addExerciseButton").addEventListener("click", () => {
  const nameInput = document.getElementById("newExerciseNameInput");
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
    isArchived: false
  });
  saveDatabase(appState.database);
  nameInput.value = "";
  renderExercisesManageList();
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

    const cardElement = document.createElement("li");
    cardElement.className = "history-card";

    const headerElement = document.createElement("div");
    headerElement.className = "history-card-header";
    headerElement.textContent =
      `${formatSessionDate(session.startedAt)} · ${template ? template.name : "Free-form"}`;
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
// within the scheme being edited)
// ---------------------------------------------------------------------------

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

document.getElementById("savePlannedExerciseButton").addEventListener("click", () => {
  appState.schemeDraft.plannedExercises.push(appState.plannedExerciseDraft);
  appState.plannedExerciseDraft = null;
  plannedExerciseEntryPanel.hidden = true;
  schemeEditorScreen.hidden = false;
  renderSchemeEditor();
});

document.getElementById("cancelPlannedExerciseButton").addEventListener("click", () => {
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
      // Closed before swapping in the new database and clearing
      // activeSessionId: closeSetEntryPanel() can re-render the checklist,
      // which looks up the active template through the *current* database
      // and session — doing that lookup against a database that no longer
      // has them (or after the session's already cleared) would crash.
      closeChecklist();
      closeSetEntryPanel();

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
