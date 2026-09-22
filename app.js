// ---------------------------------------------------------------------------
// App logic for the workout logger.
//
// All reading and writing of saved data happens through the functions in
// schema.js (loadDatabase, saveDatabase, exportDatabase, importDatabase).
// This file only holds UI behaviour: what's on screen and what happens when
// the user taps something.
// ---------------------------------------------------------------------------

// The single app-state object. `database` is the saved data; `activeSessionId`
// is null unless a workout is currently in progress; `setDraft` holds the
// in-progress values for whichever set is currently being entered (null when
// the entry panel is closed).
const appState = {
  database: loadDatabase(),
  activeSessionId: null,
  setDraft: null
};

// On a brand-new install the exercise library is empty. Fill it with the
// starter list once, and save immediately so a page refresh doesn't lose it
// (loadDatabase() would otherwise just return an empty list again).
if (appState.database.exercises.length === 0) {
  appState.database.exercises = STARTER_EXERCISES;
  saveDatabase(appState.database);
}


// ---------------------------------------------------------------------------
// Exercise list
// ---------------------------------------------------------------------------

// Rebuild the on-screen exercise list from whatever is currently in
// `appState.database`. Called on load, after a workout starts or ends (since
// that changes whether the buttons are tappable), and after a successful
// import (since import can replace the whole list).
function renderExerciseList() {
  const listElement = document.getElementById("exerciseList");
  listElement.innerHTML = "";

  for (const exercise of appState.database.exercises) {
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

renderExerciseList();


// ---------------------------------------------------------------------------
// Starting and ending a workout
// ---------------------------------------------------------------------------

const startWorkoutButton = document.getElementById("startWorkoutButton");
const endWorkoutButton = document.getElementById("endWorkoutButton");
const workoutStatus = document.getElementById("workoutStatus");

// Shows/hides the Start/End buttons and the status line to match whether a
// workout is currently active. Called whenever activeSessionId changes.
function updateWorkoutControls() {
  const isActive = appState.activeSessionId !== null;
  startWorkoutButton.hidden = isActive;
  endWorkoutButton.hidden = !isActive;
  workoutStatus.textContent = isActive ? "Workout in progress" : "";
}

startWorkoutButton.addEventListener("click", () => {
  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    dayStatus: "normal",
    notes: ""
  };
  appState.database.sessions.push(session);
  appState.activeSessionId = session.id;
  saveDatabase(appState.database);
  updateWorkoutControls();
  renderExerciseList();
});

endWorkoutButton.addEventListener("click", () => {
  const session = appState.database.sessions.find(
    (candidate) => candidate.id === appState.activeSessionId
  );
  session.endedAt = new Date().toISOString();
  appState.activeSessionId = null;
  saveDatabase(appState.database);
  closeSetEntryPanel();
  updateWorkoutControls();
  renderExerciseList();
});


// ---------------------------------------------------------------------------
// Logging a set
// ---------------------------------------------------------------------------

const setEntryPanel = document.getElementById("setEntryPanel");
const setEntryExerciseName = document.getElementById("setEntryExerciseName");
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

function openSetEntryPanel(exerciseId) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);
  const previous = findPreviousWorkingSet(exerciseId);

  // Pre-fill from the last working set for this exercise, if there is one,
  // so re-entering the same weight/reps needs zero taps on a typical set.
  appState.setDraft = {
    exerciseId,
    load: previous ? previous.load : 20,
    reps: previous ? previous.reps : 8,
    rir: previous ? previous.rir : 2,
    isWarmup: false
  };

  setEntryExerciseName.textContent = exercise.name;
  previousPerformance.textContent = previous
    ? `Last: ${previous.load} kg × ${previous.reps} (RIR ${previous.rir})`
    : "No previous data for this exercise.";

  renderSetDraft();
  setEntryPanel.hidden = false;
}

function closeSetEntryPanel() {
  appState.setDraft = null;
  setEntryPanel.hidden = true;
}

// One shared handler for all six stepper buttons: which field and which
// direction are read from the button's own data attributes, set in the
// listener registration below, rather than writing six near-identical
// functions.
function adjustSetDraftField(field, step, minimum) {
  const nextValue = appState.setDraft[field] + step;
  appState.setDraft[field] = Math.max(nextValue, minimum);
  renderSetDraft();
}

document.getElementById("loadDecrement").addEventListener("click", () => adjustSetDraftField("load", -2.5, 0));
document.getElementById("loadIncrement").addEventListener("click", () => adjustSetDraftField("load", 2.5, 0));
document.getElementById("repsDecrement").addEventListener("click", () => adjustSetDraftField("reps", -1, 1));
document.getElementById("repsIncrement").addEventListener("click", () => adjustSetDraftField("reps", 1, 1));
document.getElementById("rirDecrement").addEventListener("click", () => adjustSetDraftField("rir", -1, 0));
document.getElementById("rirIncrement").addEventListener("click", () => adjustSetDraftField("rir", 1, 0));

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
      appState.database = importDatabase(fileText);
      // An import can bring in a database with no session in progress, so
      // treat any active workout as no longer valid rather than pointing at
      // a session that may not exist in the freshly imported data.
      appState.activeSessionId = null;
      closeSetEntryPanel();
      updateWorkoutControls();
      renderExerciseList();
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
