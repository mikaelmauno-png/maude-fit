// ---------------------------------------------------------------------------
// Library: the exercise library and its edit panel, the muscle editor, gyms,
// workout templates and their editor, the exercise picker, planned exercise
// targets, and cardio activities.
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

// An id made from `name` that none of `existingItems` already uses: the
// plain slug if it's free, otherwise the slug with a number on the end
// ("rower-2"). Ids must be unique and never change (see schema.js), so two
// things with similar names can't end up sharing one. Returns "" when the
// name has no letters or numbers to make a slug from.
function makeUniqueIdFromName(name, existingItems) {
  const baseId = slugify(name);
  if (baseId === "") {
    return "";
  }
  let id = baseId;
  let suffix = 2;
  while (existingItems.some((item) => item.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix++;
  }
  return id;
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

// The library, in the same collapsible main-muscle groups as the exercise
// picker (see groupExercisesByMainMuscle). Every change redraws the whole
// list, which would snap every open group shut each time, so the groups
// open before the redraw are found first and opened again after.
// While something is typed in the search box, only matching exercises are
// listed, and their groups open by themselves so the matches are visible
// without extra taps.
function renderExercisesManageList() {
  const listElement = document.getElementById("exercisesManageList");
  const openGroupLabels = new Set(
    Array.from(listElement.querySelectorAll("details[open]")).map((groupElement) => groupElement.dataset.groupLabel)
  );
  listElement.innerHTML = "";

  const searchText = appState.exerciseSearchText.trim().toLowerCase();
  const isSearching = searchText !== "";
  const activeExercises = appState.database.exercises.filter((candidate) => !candidate.isArchived);
  const shownExercises = isSearching
    ? activeExercises.filter((exercise) => exercise.name.toLowerCase().includes(searchText))
    : activeExercises;

  for (const group of groupExercisesByMainMuscle(shownExercises)) {
    const groupElement = document.createElement("details");
    groupElement.className = "picker-group";
    groupElement.dataset.groupLabel = group.label;
    groupElement.open = isSearching || openGroupLabels.has(group.label);

    const summaryElement = document.createElement("summary");
    summaryElement.textContent = `${group.label} (${group.exercises.length})`;
    groupElement.appendChild(summaryElement);

    const groupListElement = document.createElement("ul");
    for (const exercise of group.exercises) {
      groupListElement.appendChild(buildExerciseManageRow(exercise));
    }
    groupElement.appendChild(groupListElement);
    listElement.appendChild(groupElement);
  }

  document.getElementById("exerciseSearchEmptyMessage").hidden = !isSearching || shownExercises.length > 0;
}

document.getElementById("exerciseSearchInput").addEventListener("input", (event) => {
  appState.exerciseSearchText = event.target.value;
  renderExercisesManageList();
});

// One exercise in the library: its name, tags and details, and a single
// Edit button. Everything that can be changed lives in the edit panel
// (openExerciseEditPanel), rather than six equal buttons on every row
// where Archive looked just like Rename.
function buildExerciseManageRow(exercise) {
  const rowElement = document.createElement("li");
  rowElement.className = "list-row";

  const infoElement = document.createElement("div");
  infoElement.className = "list-row-info";

  const nameSpan = document.createElement("span");
  nameSpan.className = "exercise-manage-name";
  nameSpan.append(buildExerciseNameWithTags(exercise));
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

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "small-button secondary-button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => openExerciseEditPanel(exercise.id));

  rowElement.append(infoElement, editButton);
  return rowElement;
}


// ---------------------------------------------------------------------------
// Exercise edit panel
// ---------------------------------------------------------------------------

const exerciseEditNameInput = document.getElementById("exerciseEditNameInput");
const exerciseEditIncrementInput = document.getElementById("exerciseEditIncrementInput");
const exerciseEditError = document.getElementById("exerciseEditError");

// Plate and weight-stack jumps common enough to offer as one-tap presets.
// Anything else (an odd machine's 2.27 kg) can still be typed.
const LOAD_INCREMENT_PRESETS = [1, 1.25, 2.5, 5];

// Works on a copy (appState.exerciseEditDraft), so Cancel leaves the
// exercise exactly as it was. The stored exercise only changes on Save.
function openExerciseEditPanel(exerciseId) {
  const exercise = findExerciseById(exerciseId);
  appState.exerciseEditDraft = {
    exerciseId,
    name: exercise.name,
    minimumLoadIncrement: exercise.minimumLoadIncrement,
    isGymSpecific: exercise.isGymSpecific,
    isBodyweight: exercise.isBodyweight
  };
  document.getElementById("exerciseEditHeading").textContent = exercise.name;
  exerciseEditNameInput.value = exercise.name;
  exerciseEditIncrementInput.value = exercise.minimumLoadIncrement;
  exerciseEditError.hidden = true;
  renderExerciseEditPanel();
  exerciseEditPanel.scrollTop = 0;
  // Over the library, not instead of it, like the other bottom sheets.
  exerciseEditPanel.hidden = false;
}

// Redraws the toggles and preset highlights from the draft. The two text
// boxes aren't redrawn here: rewriting a box while it's being typed in
// would move the cursor.
function renderExerciseEditPanel() {
  const draft = appState.exerciseEditDraft;
  setToggleButtonState(document.getElementById("exerciseEditGymSpecificToggle"), draft.isGymSpecific);
  setToggleButtonState(document.getElementById("exerciseEditBodyweightToggle"), draft.isBodyweight);

  const presetsElement = document.getElementById("exerciseEditIncrementPresets");
  presetsElement.innerHTML = "";
  for (const increment of LOAD_INCREMENT_PRESETS) {
    const presetButton = document.createElement("button");
    presetButton.type = "button";
    presetButton.className = "day-status-option";
    presetButton.textContent = `${increment} kg`;
    presetButton.dataset.value = increment;
    presetButton.addEventListener("click", () => {
      draft.minimumLoadIncrement = increment;
      exerciseEditIncrementInput.value = increment;
      renderExerciseEditPanel();
    });
    presetsElement.appendChild(presetButton);
  }
  highlightSelectedButton(presetsElement, "value", draft.minimumLoadIncrement);
}

// A grey/blue on-off button: blue and aria-pressed="true" while on.
function setToggleButtonState(buttonElement, isOn) {
  buttonElement.classList.toggle("day-status-option-selected", isOn);
  buttonElement.setAttribute("aria-pressed", String(isOn));
}

function closeExerciseEditPanel() {
  appState.exerciseEditDraft = null;
  exerciseEditPanel.hidden = true;
}

function showExerciseEditError(message) {
  exerciseEditError.textContent = message;
  exerciseEditError.hidden = false;
}

exerciseEditNameInput.addEventListener("input", () => {
  appState.exerciseEditDraft.name = exerciseEditNameInput.value;
});

// Kept as typed until Save, which checks it: a half-typed "1," shouldn't
// be rejected mid-keystroke.
exerciseEditIncrementInput.addEventListener("input", () => {
  appState.exerciseEditDraft.minimumLoadIncrement = parseLoadIncrement(exerciseEditIncrementInput.value);
  renderExerciseEditPanel();
});

document.getElementById("exerciseEditGymSpecificToggle").addEventListener("click", () => {
  appState.exerciseEditDraft.isGymSpecific = !appState.exerciseEditDraft.isGymSpecific;
  renderExerciseEditPanel();
});

document.getElementById("exerciseEditBodyweightToggle").addEventListener("click", () => {
  appState.exerciseEditDraft.isBodyweight = !appState.exerciseEditDraft.isBodyweight;
  renderExerciseEditPanel();
});

// The muscle editor saves on its own, straight to the exercise. This
// panel steps aside while it's open and comes back when it closes (see
// closeMuscleEditor), with the draft untouched.
document.getElementById("exerciseEditMusclesButton").addEventListener("click", () => {
  exerciseEditPanel.hidden = true;
  openMuscleEditor(appState.exerciseEditDraft.exerciseId);
});

document.getElementById("saveExerciseEditButton").addEventListener("click", () => {
  const draft = appState.exerciseEditDraft;
  const trimmedName = draft.name.trim();
  if (trimmedName === "") {
    showExerciseEditError("The name can't be empty.");
    return;
  }
  if (draft.minimumLoadIncrement === null) {
    showExerciseEditError("Enter a minimum weight raise above 0, e.g. 2.5.");
    return;
  }

  // Only these fields change. The id, which every set and workout points
  // at, never does (schema.js), so a rename keeps all the history.
  const exercise = findExerciseById(draft.exerciseId);
  exercise.name = trimmedName;
  exercise.minimumLoadIncrement = draft.minimumLoadIncrement;
  exercise.isGymSpecific = draft.isGymSpecific;
  exercise.isBodyweight = draft.isBodyweight;
  saveDatabase(appState.database);
  closeExerciseEditPanel();
  renderExercisesManageList();
});

document.getElementById("cancelExerciseEditButton").addEventListener("click", closeExerciseEditPanel);

// Archiving instead of deleting keeps past sets and workout templates that
// reference this exercise resolvable. Unsaved edits in the panel are
// dropped: archiving is the decision being made.
document.getElementById("archiveExerciseButton").addEventListener("click", () => {
  const exercise = findExerciseById(appState.exerciseEditDraft.exerciseId);
  exercise.isArchived = true;
  saveDatabase(appState.database);
  closeExerciseEditPanel();
  renderExercisesManageList();
  renderArchivedExercisesList();
});

// Collapsed by default (see the toggle button below) — archiving something
// with no way back through the UI would defeat the reason it's archived
// instead of deleted in the first place.
// True (not just archived) deletion is only safe when nothing in the data
// would be orphaned by it — no logged set, and no workout template still planning it.
function isExerciseUnused(exerciseId) {
  const usedInSets = appState.database.sets.some((set) => set.exerciseId === exerciseId);
  const usedInWorkoutTemplates = appState.database.workoutTemplates.some((template) =>
    template.plannedExercises.some((planned) => planned.exerciseId === exerciseId)
  );
  // An exercise added to one workout only, even with no sets logged yet,
  // still has that workout's card pointing at it.
  const usedInSessions = appState.database.sessions.some((session) =>
    isAddedForThisWorkoutOnly(session, exerciseId)
  );
  return !usedInSets && !usedInWorkoutTemplates && !usedInSessions;
}

function renderArchivedExercisesList() {
  const listElement = document.getElementById("archivedExercisesList");
  listElement.innerHTML = "";

  for (const exercise of appState.database.exercises.filter((candidate) => candidate.isArchived)) {
    const rowElement = document.createElement("li");
    rowElement.className = "list-row";

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

// The add form starts folded away, so the list is the first thing on the
// screen. Opening it fills in a clean form, with the minimum raise at the
// default chosen in Settings.
const newExerciseForm = document.getElementById("newExerciseForm");
const newExerciseError = document.getElementById("newExerciseError");

function showNewExerciseForm() {
  document.getElementById("newExerciseNameInput").value = "";
  document.getElementById("newExerciseGymSpecificCheckbox").checked = false;
  document.getElementById("newExerciseBodyweightCheckbox").checked = false;
  document.getElementById("newExerciseIncrementInput").value = appState.database.preferences.defaultLoadIncrement;
  newExerciseError.hidden = true;
  newExerciseForm.hidden = false;
  document.getElementById("showNewExerciseFormButton").hidden = true;
  document.getElementById("newExerciseNameInput").focus();
}

function hideNewExerciseForm() {
  newExerciseForm.hidden = true;
  document.getElementById("showNewExerciseFormButton").hidden = false;
}

function showNewExerciseError(message) {
  newExerciseError.textContent = message;
  newExerciseError.hidden = false;
}

document.getElementById("showNewExerciseFormButton").addEventListener("click", showNewExerciseForm);
document.getElementById("cancelNewExerciseButton").addEventListener("click", hideNewExerciseForm);

document.getElementById("addExerciseButton").addEventListener("click", () => {
  const nameInput = document.getElementById("newExerciseNameInput");
  const gymSpecificCheckbox = document.getElementById("newExerciseGymSpecificCheckbox");
  const bodyweightCheckbox = document.getElementById("newExerciseBodyweightCheckbox");
  const incrementInput = document.getElementById("newExerciseIncrementInput");
  const name = nameInput.value.trim();
  if (name === "") {
    showNewExerciseError("Enter a name for the exercise.");
    return;
  }

  const minimumLoadIncrement = parseLoadIncrement(incrementInput.value);
  if (minimumLoadIncrement === null) {
    showNewExerciseError("Enter a minimum weight raise above 0, e.g. 2.5.");
    return;
  }

  const id = makeUniqueIdFromName(name, appState.database.exercises);
  if (id === "") {
    showNewExerciseError("That name needs at least one letter or number.");
    return;
  }

  appState.database.exercises.push({
    id,
    name,
    // Empty for a moment: the muscle editor opens straight after this
    // (below), and stays empty only if that's skipped.
    muscles: {},
    isArchived: false,
    isGymSpecific: gymSpecificCheckbox.checked,
    isBodyweight: bodyweightCheckbox.checked,
    minimumLoadIncrement
  });
  saveDatabase(appState.database);
  hideNewExerciseForm();
  renderExercisesManageList();
  // Straight on to its muscles, so a new exercise doesn't sit in "No main
  // muscle set" just because that's a separate button. The same editor as
  // "Set muscles", rather than more buttons in the add form above.
  openMuscleEditor(id, true);
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

  // Said right under the button rather than in a pop-up.
  const resultElement = document.getElementById("addBuiltInExercisesResult");
  resultElement.textContent = missingExercises.length === 0
    ? "You already have all the built-in exercises."
    : `Added ${missingExercises.length} exercises.`;
  resultElement.hidden = false;
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

// How the muscle buttons are grouped on screen. Purely for finding a
// button quickly: the stored data still uses the plain muscle names from
// MUSCLE_GROUPS (schema.js) and knows nothing about these areas.
const MUSCLE_BODY_AREAS = [
  { label: "Chest", muscles: ["chest"] },
  { label: "Back", muscles: ["upperBack", "lats", "lowerBack", "traps"] },
  { label: "Shoulders", muscles: ["frontDelt", "sideDelt", "rearDelt"] },
  { label: "Arms", muscles: ["biceps", "triceps", "forearms"] },
  { label: "Core", muscles: ["abs", "obliques"] },
  { label: "Legs", muscles: ["glutes", "quads", "hamstrings", "adductors", "calves"] }
];

// MUSCLE_BODY_AREAS, plus an "Other" area for any muscle in MUSCLE_GROUPS
// that the list above doesn't mention. A muscle added to schema.js later
// then still gets a button, instead of silently having none.
function getMuscleBodyAreas() {
  const placedMuscles = MUSCLE_BODY_AREAS.flatMap((area) => area.muscles);
  const unplacedMuscles = MUSCLE_GROUPS.filter((muscle) => !placedMuscles.includes(muscle));
  if (unplacedMuscles.length === 0) {
    return MUSCLE_BODY_AREAS;
  }
  return MUSCLE_BODY_AREAS.concat([{ label: "Other", muscles: unplacedMuscles }]);
}

// Fills one section of the editor (main or secondary) with a small heading
// per body area and that area's buttons. `isSelected(muscle)` decides which
// buttons are highlighted and `onTap(muscle)` what a tap does. Muscles in
// `excludedMuscles` get no button, and an area left with none is skipped.
function renderMuscleOptionGroups(containerElement, excludedMuscles, isSelected, onTap) {
  containerElement.innerHTML = "";
  for (const area of getMuscleBodyAreas()) {
    const areaMuscles = area.muscles.filter((muscle) => !excludedMuscles.includes(muscle));
    if (areaMuscles.length === 0) {
      continue;
    }

    const areaElement = document.createElement("div");
    areaElement.className = "muscle-area";

    const labelElement = document.createElement("span");
    labelElement.className = "muscle-area-label";
    labelElement.textContent = area.label;
    areaElement.appendChild(labelElement);

    const buttonsElement = document.createElement("div");
    buttonsElement.className = "button-row";
    for (const muscle of areaMuscles) {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "day-status-option";
      optionButton.textContent = MUSCLE_GROUP_LABELS[muscle];
      optionButton.classList.toggle("day-status-option-selected", isSelected(muscle));
      optionButton.addEventListener("click", () => onTap(muscle));
      buttonsElement.appendChild(optionButton);
    }
    areaElement.appendChild(buttonsElement);
    containerElement.appendChild(areaElement);
  }
}

function chooseMainMuscle(muscle) {
  appState.muscleDraft.mainMuscle = muscle;
  // A muscle can't be both main and secondary at once, so promoting one
  // to main drops it from the secondary list if it was there.
  appState.muscleDraft.secondaryMuscles = appState.muscleDraft.secondaryMuscles.filter(
    (candidate) => candidate !== muscle
  );
  renderMuscleEditor();
}

function toggleSecondaryMuscle(muscle) {
  const index = appState.muscleDraft.secondaryMuscles.indexOf(muscle);
  if (index === -1) {
    appState.muscleDraft.secondaryMuscles.push(muscle);
  } else {
    appState.muscleDraft.secondaryMuscles.splice(index, 1);
  }
  renderMuscleEditor();
}

// Both sections are redrawn on every tap: the current main muscle decides
// which button the secondary section leaves out.
function renderMuscleEditor() {
  const draft = appState.muscleDraft;
  renderMuscleOptionGroups(
    mainMuscleOptionsElement, [], (muscle) => muscle === draft.mainMuscle, chooseMainMuscle
  );
  renderMuscleOptionGroups(
    secondaryMuscleOptionsElement,
    draft.mainMuscle ? [draft.mainMuscle] : [],
    (muscle) => draft.secondaryMuscles.includes(muscle),
    toggleSecondaryMuscle
  );
}

// `isNewExercise` is true straight after "Add exercise": the editor then
// says so, and Cancel becomes "Skip for now", since the exercise is already
// saved either way and skipping just leaves its muscles to set later.
function openMuscleEditor(exerciseId, isNewExercise = false) {
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
  document.getElementById("muscleEditorNewExerciseHint").hidden = !isNewExercise;
  document.getElementById("cancelMusclesButton").textContent = isNewExercise ? "Skip for now" : "Cancel";
  renderMuscleEditor();
  muscleEditorPanel.scrollTop = 0;
  // Deliberately not hideAllScreens(): exercisesScreen stays visible
  // underneath, same pattern as the other in-context panels.
  muscleEditorPanel.hidden = false;
}

function closeMuscleEditor() {
  appState.muscleEditorExerciseId = null;
  appState.muscleDraft = null;
  muscleEditorPanel.hidden = true;
  // Opened from the exercise edit panel ("Set muscles"): back to it, with
  // whatever was already changed there still in place.
  if (appState.exerciseEditDraft) {
    exerciseEditPanel.hidden = false;
  }
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
    rowElement.className = "list-row";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = gym.name;

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "small-button";
    renameButton.textContent = "Rename";
    renameButton.addEventListener("click", () => {
      // Only Gym.name changes — the id (referenced by Session.gymId) is
      // never touched by a rename.
      openTextEntryPanel({
        heading: "Rename gym",
        label: "Name",
        initialValue: gym.name,
        onSave: (typedName) => renameItem(gym, typedName, renderGymsManageList)
      });
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

    for (const replacement of gym.exerciseReplacements) {
      listElement.appendChild(buildGymReplacementRow(gym, replacement));
    }
    for (const exerciseId of Object.keys(gym.machineMaxLoads)) {
      listElement.appendChild(buildGymMachineMaxRow(gym, exerciseId));
    }
  }
}

// "Leg press → Hack squat" under its gym. Removing it only stops future
// workouts here from swapping; past workouts keep their own record of the
// swap (Session.replacedExercises), so no confirmation is needed.
function buildGymReplacementRow(gym, replacement) {
  const findName = (exerciseId) =>
    appState.database.exercises.find((exercise) => exercise.id === exerciseId).name;

  const rowElement = document.createElement("li");
  rowElement.className = "list-row gym-detail-row";

  const descriptionSpan = document.createElement("span");
  descriptionSpan.textContent =
    `${findName(replacement.exerciseId)} → ${findName(replacement.replacementExerciseId)}`;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "small-button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    forgetGymReplacement(gym.id, replacement.exerciseId);
    saveDatabase(appState.database);
    renderGymsManageList();
  });

  rowElement.append(descriptionSpan, removeButton);
  return rowElement;
}

// "Leg press: max 120 kg" under its gym. Set from a workout card in edit
// mode (buildMachineMaxButton); removable here once the gym gets a bigger
// stack, or if it was set by mistake.
function buildGymMachineMaxRow(gym, exerciseId) {
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);

  const rowElement = document.createElement("li");
  rowElement.className = "list-row gym-detail-row";

  const descriptionSpan = document.createElement("span");
  descriptionSpan.textContent = `${exercise.name}: max ${gym.machineMaxLoads[exerciseId]} kg`;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "small-button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    delete gym.machineMaxLoads[exerciseId];
    saveDatabase(appState.database);
    renderGymsManageList();
  });

  rowElement.append(descriptionSpan, removeButton);
  return rowElement;
}

function isGymUnused(gymId) {
  return !appState.database.sessions.some((session) => session.gymId === gymId);
}

function renderArchivedGymsList() {
  const listElement = document.getElementById("archivedGymsList");
  listElement.innerHTML = "";

  for (const gym of appState.database.gyms.filter((candidate) => candidate.isArchived)) {
    const rowElement = document.createElement("li");
    rowElement.className = "list-row";

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
    isArchived: false,
    exerciseReplacements: [],
    machineMaxLoads: {}
  });
  saveDatabase(appState.database);
  nameInput.value = "";
  renderGymsManageList();
});

// Shown right after picking a workout template (or free-form) to start, so the new
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
      startWorkout(appState.pendingTemplateId, gym.id, appState.isPendingCatchUp);
    });
    itemElement.appendChild(buttonElement);
    listElement.appendChild(itemElement);
  }
}

document.getElementById("skipGymPickerButton").addEventListener("click", () => {
  startWorkout(appState.pendingTemplateId, null, appState.isPendingCatchUp);
});


// ---------------------------------------------------------------------------
// Workout templates list
// ---------------------------------------------------------------------------

function renderWorkoutTemplatesList() {
  const listElement = document.getElementById("workoutTemplatesList");
  listElement.innerHTML = "";

  const activeTemplates = appState.database.workoutTemplates.filter((template) => !template.isArchived);
  for (const template of activeTemplates) {
    const rowElement = document.createElement("li");
    rowElement.className = "list-row";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = template.name;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "small-button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      // A deep copy, so cancelling the edit doesn't leave half-applied
      // changes on the saved workout template.
      appState.workoutTemplateDraft = JSON.parse(JSON.stringify(template));
      showWorkoutTemplateEditorScreen();
    });

    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.className = "small-button";
    archiveButton.textContent = "Archive";
    archiveButton.addEventListener("click", () => {
      // Archiving instead of deleting keeps past sessions that followed this
      // workout template resolvable, the same reasoning as Exercise.isArchived.
      template.isArchived = true;
      saveDatabase(appState.database);
      renderWorkoutTemplatesList();
      renderArchivedWorkoutTemplatesList();
    });

    rowElement.append(nameSpan, editButton, archiveButton);
    listElement.appendChild(rowElement);
  }
}

function isWorkoutTemplateUnused(templateId) {
  return !appState.database.sessions.some((session) => session.templateId === templateId);
}

function renderArchivedWorkoutTemplatesList() {
  const listElement = document.getElementById("archivedWorkoutTemplatesList");
  listElement.innerHTML = "";

  const archivedTemplates = appState.database.workoutTemplates.filter((template) => template.isArchived);
  for (const template of archivedTemplates) {
    const rowElement = document.createElement("li");
    rowElement.className = "list-row";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = template.name;

    const unarchiveButton = document.createElement("button");
    unarchiveButton.type = "button";
    unarchiveButton.className = "small-button";
    unarchiveButton.textContent = "Unarchive";
    unarchiveButton.addEventListener("click", () => {
      template.isArchived = false;
      saveDatabase(appState.database);
      renderWorkoutTemplatesList();
      renderArchivedWorkoutTemplatesList();
      renderStartWorkoutChoices();
    });

    rowElement.append(nameSpan, unarchiveButton);

    if (isWorkoutTemplateUnused(template.id)) {
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
        renderArchivedWorkoutTemplatesList();
      });
      rowElement.appendChild(deleteButton);
    }

    listElement.appendChild(rowElement);
  }
}

document.getElementById("toggleArchivedWorkoutTemplatesButton").addEventListener("click", (event) => {
  const archivedListElement = document.getElementById("archivedWorkoutTemplatesList");
  archivedListElement.hidden = !archivedListElement.hidden;
  event.currentTarget.textContent = archivedListElement.hidden ? "Show archived" : "Hide archived";
  if (!archivedListElement.hidden) {
    renderArchivedWorkoutTemplatesList();
  }
});

// Opens the editor on a blank workout. Shared by Workouts' "Add workout"
// and the home screen's first-run "Create a workout".
function startNewWorkoutTemplate() {
  appState.workoutTemplateDraft = {
    id: crypto.randomUUID(),
    name: "",
    isArchived: false,
    plannedExercises: []
  };
  showWorkoutTemplateEditorScreen();
}

document.getElementById("addWorkoutTemplateButton").addEventListener("click", startNewWorkoutTemplate);
document.getElementById("firstRunCreateWorkoutButton").addEventListener("click", startNewWorkoutTemplate);


// ---------------------------------------------------------------------------
// Workout template editor
// ---------------------------------------------------------------------------

const workoutTemplateNameInput = document.getElementById("workoutTemplateNameInput");

function renderWorkoutTemplateEditor() {
  // Whether this id already exists among saved workout templates tells new from
  // existing, without needing extra state that would have to be kept out of
  // what eventually gets saved.
  const isNewWorkoutTemplate = !appState.database.workoutTemplates.some(
    (template) => template.id === appState.workoutTemplateDraft.id
  );
  document.getElementById("workoutTemplateEditorTitle").textContent = isNewWorkoutTemplate ? "New workout" : "Edit workout";
  workoutTemplateNameInput.value = appState.workoutTemplateDraft.name;

  const listElement = document.getElementById("plannedExerciseList");
  listElement.innerHTML = "";

  appState.workoutTemplateDraft.plannedExercises.forEach((planned, index) => {
    const exercise = appState.database.exercises.find((candidate) => candidate.id === planned.exerciseId);

    const rowElement = document.createElement("li");
    rowElement.className = "list-row";

    const detailSpan = document.createElement("span");
    detailSpan.textContent =
      `${exercise.name}: ${planned.targetSets} × ${formatRepRange(planned.targetRepsMin, planned.targetRepsMax)} @ ${planned.targetLoad} kg, RIR ${planned.targetRir}`;

    // Swaps this entry with its neighbor in the array — order in
    // plannedExercises is display order, nothing more, so a swap is enough.
    const moveUpButton = document.createElement("button");
    moveUpButton.type = "button";
    moveUpButton.className = "small-button tiny-button";
    moveUpButton.textContent = "↑";
    moveUpButton.disabled = index === 0;
    moveUpButton.addEventListener("click", () => {
      const plannedExercises = appState.workoutTemplateDraft.plannedExercises;
      [plannedExercises[index - 1], plannedExercises[index]] = [plannedExercises[index], plannedExercises[index - 1]];
      renderWorkoutTemplateEditor();
    });

    const moveDownButton = document.createElement("button");
    moveDownButton.type = "button";
    moveDownButton.className = "small-button tiny-button";
    moveDownButton.textContent = "↓";
    moveDownButton.disabled = index === appState.workoutTemplateDraft.plannedExercises.length - 1;
    moveDownButton.addEventListener("click", () => {
      const plannedExercises = appState.workoutTemplateDraft.plannedExercises;
      [plannedExercises[index], plannedExercises[index + 1]] = [plannedExercises[index + 1], plannedExercises[index]];
      renderWorkoutTemplateEditor();
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "small-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      appState.workoutTemplateDraft.plannedExercises.splice(index, 1);
      renderWorkoutTemplateEditor();
    });

    rowElement.append(detailSpan, moveUpButton, moveDownButton, removeButton);
    listElement.appendChild(rowElement);
  });
  renderSingleSlotMuscleNote();
}

// Drop detection (deload.js) needs at least two exercises across all
// workouts that mainly train a muscle. The note is shown here, where it can
// be acted on, and counts this workout as if it were saved already, so
// adding or removing an exercise updates it straight away.
function renderSingleSlotMuscleNote() {
  const draft = appState.workoutTemplateDraft;
  const templatesIfSaved = appState.database.workoutTemplates
    .filter((template) => !template.isArchived && template.id !== draft.id)
    .concat([draft]);
  const hasBodyweightLog = appState.database.bodyweightEntries.length > 0;
  const singleSlotMuscles = findSingleSlotMuscles(templatesIfSaved, appState.database.exercises, hasBodyweightLog);

  const noteElement = document.getElementById("singleSlotMuscleNote");
  noteElement.hidden = singleSlotMuscles.length === 0;
  const muscleNames = singleSlotMuscles.map((muscle) => MUSCLE_GROUP_LABELS[muscle]).join(", ");
  const isOneMuscle = singleSlotMuscles.length === 1;
  noteElement.textContent =
    "Spotting a performance drop takes two exercises, in any of your workouts, " +
    "that mainly train a muscle and give a usable strength estimate (minimum reps " +
    `plus target RIR at most ${DROP_E1RM_MAX_REPS_PLUS_RIR}, and a logged bodyweight for ` +
    `bodyweight exercises). Only one does for: ${muscleNames}. Until there's a ` +
    `second, only whole-body deloads will cover ${isOneMuscle ? "it" : "them"}.`;
}


// ---------------------------------------------------------------------------
// Exercise picker (for adding an exercise to the workout template being edited)
// ---------------------------------------------------------------------------

// Sorts exercises into groups by their main muscle (the one weighted 1.0),
// in the fixed MUSCLE_GROUPS order from schema.js so the groups always
// appear in the same place. Exercises with no main muscle set yet go in a
// last group of their own rather than disappearing from the picker.
// Muscles with no exercises are left out, so no group is ever empty.
function groupExercisesByMainMuscle(exercises) {
  const groups = [];
  for (const muscle of MUSCLE_GROUPS) {
    const exercisesForMuscle = exercises.filter((exercise) => exercise.muscles[muscle] === 1.0);
    if (exercisesForMuscle.length > 0) {
      groups.push({ label: MUSCLE_GROUP_LABELS[muscle], exercises: exercisesForMuscle });
    }
  }

  const exercisesWithoutMainMuscle = exercises.filter(
    (exercise) => !Object.values(exercise.muscles).includes(1.0)
  );
  if (exercisesWithoutMainMuscle.length > 0) {
    groups.push({ label: "No main muscle set", exercises: exercisesWithoutMainMuscle });
  }
  return groups;
}

// One collapsible group in the picker. <details> is the browser's own
// open/close box: tapping its <summary> line toggles the list underneath,
// with no JavaScript needed. Every group starts closed, so the whole list
// of muscles fits on one screen and one tap opens the one you want.
function buildExercisePickerGroup(group) {
  const groupElement = document.createElement("details");
  groupElement.className = "picker-group";

  const summaryElement = document.createElement("summary");
  summaryElement.textContent = `${group.label} (${group.exercises.length})`;
  groupElement.appendChild(summaryElement);

  const listElement = document.createElement("ul");
  for (const exercise of group.exercises) {
    listElement.appendChild(buildExercisePickerItem(exercise));
  }
  groupElement.appendChild(listElement);
  return groupElement;
}

function renderExercisePicker() {
  const pickerElement = document.getElementById("exercisePickerGroups");
  pickerElement.innerHTML = "";

  let activeExercises = appState.database.exercises.filter((candidate) => !candidate.isArchived);
  // Adding to a workout in progress: leave out what's already in it, so the
  // same exercise can't end up with two cards.
  if (appState.exercisePickerPurpose === "activeWorkout" || appState.exercisePickerPurpose === "replacement") {
    const exerciseIdsInWorkout = getSessionPlannedExercises(getActiveSession(), getActiveTemplate())
      .map((planned) => planned.exerciseId);
    activeExercises = activeExercises.filter((exercise) => !exerciseIdsInWorkout.includes(exercise.id));
  }
  for (const group of groupExercisesByMainMuscle(activeExercises)) {
    pickerElement.appendChild(buildExercisePickerGroup(group));
  }
}

// One exercise inside a group. Tapping it moves on to setting that
// exercise's target sets, reps and load for the workout being edited.
function buildExercisePickerItem(exercise) {
  const itemElement = document.createElement("li");
  const buttonElement = document.createElement("button");
  buttonElement.type = "button";
  buttonElement.className = "exercise-item";
  buttonElement.textContent = exercise.name;
  buttonElement.addEventListener("click", () => {
    if (appState.exercisePickerPurpose === "activeWorkout") {
      openTargetPanelForAddingToWorkout(exercise);
      return;
    }
    if (appState.exercisePickerPurpose === "replacement") {
      chooseReplacementFromPicker(exercise);
      return;
    }
    appState.plannedExerciseDraft = {
      exerciseId: exercise.id,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetLoad: 20,
      targetRir: defaultTargetRir(10),
      // A workout template's first target is a starting point, not a goal set by
      // hand, so it never overrides a progression suggestion.
      targetLoadSetAt: null
    };
    appState.isTargetRirSetByHand = false;
    document.getElementById("plannedExerciseEntryName").textContent = exercise.name;
    renderPlannedExerciseDraft();
    exercisePickerScreen.hidden = true;
    // The panel is a bottom sheet (style.css), so it needs a screen
    // behind it: the workout being edited, where the exercise is about
    // to land.
    workoutTemplateEditorScreen.hidden = false;
    plannedExerciseEntryPanel.hidden = false;
  });
  itemElement.appendChild(buttonElement);
  return itemElement;
}

document.getElementById("cancelExercisePickerButton").addEventListener("click", () => {
  exercisePickerScreen.hidden = true;
  if (appState.exercisePickerPurpose === "replacement") {
    activeWorkoutScreen.hidden = false;
    closeRemoveExercisePanel();
  } else if (appState.exercisePickerPurpose === "activeWorkout") {
    activeWorkoutScreen.hidden = false;
  } else {
    workoutTemplateEditorScreen.hidden = false;
  }
  appState.exercisePickerPurpose = null;
});


// ---------------------------------------------------------------------------
// Planned exercise target entry (sets / rep range / load for one exercise
// within the workout template being edited) — also reused, via nextGoalTarget, to
// adjust an existing planned exercise's target from an active workout card.
// ---------------------------------------------------------------------------

const plannedExerciseEntryHint = document.getElementById("plannedExerciseEntryHint");

// Opens the same panel used to add a new exercise to a workout template, but for
// changing an *existing* one's target — triggered by "Set goal for next
// time" on a workout card. Doesn't touch appState.workoutTemplateDraft: this saves
// straight to the template in appState.database, not to an in-progress edit.
function openNextGoalEditor(templateId, exerciseId) {
  const template = appState.database.workoutTemplates.find((candidate) => candidate.id === templateId);
  const planned = template.plannedExercises.find((candidate) => candidate.exerciseId === exerciseId);
  const exercise = appState.database.exercises.find((candidate) => candidate.id === exerciseId);

  // Starts from the weight today's sets are actually aiming at (the
  // suggestion, unless a goal already overrides it), not from the workout template's
  // stored target, which may be an old starting weight by now.
  const suggestion = getSuggestionForPlanned(planned);
  const currentLoad = suggestion && !isGoalOverride(planned, suggestion) ? suggestion.load : planned.targetLoad;

  // `startingLoad` is remembered so saving can tell whether the load was
  // actually changed; see the save handler.
  appState.nextGoalTarget = { templateId, exerciseId, startingLoad: currentLoad };
  appState.plannedExerciseDraft = {
    // Only here so the target-load stepper can look up this exercise's
    // minimum raise; the save handler copies the target fields one by one
    // and ignores this.
    exerciseId,
    targetSets: planned.targetSets,
    targetRepsMin: planned.targetRepsMin,
    targetRepsMax: planned.targetRepsMax,
    targetLoad: currentLoad,
    targetRir: planned.targetRir
  };
  // An existing exercise's target was already chosen, so changing its rep
  // range shouldn't quietly move it.
  appState.isTargetRirSetByHand = true;

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
  document.getElementById("targetRirValue").textContent = draft.targetRir;
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
  adjustDraftField(appState.plannedExerciseDraft, "targetRepsMax", -1, 1, renderPlannedExerciseDraftAfterRepsChange));
document.getElementById("targetRepsMaxIncrement").addEventListener("click", () =>
  adjustDraftField(appState.plannedExerciseDraft, "targetRepsMax", 1, 1, renderPlannedExerciseDraftAfterRepsChange));

// Until the target RIR is touched, it follows the rep range's default (see
// defaultTargetRir in schema.js), so picking 12-15 reps gives RIR 1
// without a second thing to remember. Once it's been set by hand, it stays.
function renderPlannedExerciseDraftAfterRepsChange() {
  const draft = appState.plannedExerciseDraft;
  if (!appState.isTargetRirSetByHand) {
    draft.targetRir = defaultTargetRir(draft.targetRepsMax);
  }
  renderPlannedExerciseDraft();
}

// Not adjustDraftField: that only has a floor, and the target RIR has a
// ceiling too (TARGET_RIR_MAX in schema.js).
function adjustTargetRir(step) {
  const draft = appState.plannedExerciseDraft;
  draft.targetRir = Math.min(Math.max(draft.targetRir + step, TARGET_RIR_MIN), TARGET_RIR_MAX);
  appState.isTargetRirSetByHand = true;
  renderPlannedExerciseDraft();
}

document.getElementById("targetRirDecrement").addEventListener("click", () => adjustTargetRir(-1));
document.getElementById("targetRirIncrement").addEventListener("click", () => adjustTargetRir(1));
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
  () => appState.plannedExerciseDraft, "targetRepsMax", 1, true, renderPlannedExerciseDraftAfterRepsChange
);
makeStepperValueEditable(
  document.getElementById("targetLoadValue"), document.getElementById("targetLoadValueInput"),
  document.getElementById("targetLoadDecrement"), document.getElementById("targetLoadIncrement"),
  () => appState.plannedExerciseDraft, "targetLoad", 0, false, renderPlannedExerciseDraft
);

// Resets the panel back to its "add a new exercise to the workout template being
// edited" defaults, so the next time it's opened for that purpose it
// doesn't carry over the next-goal wording.
function resetPlannedExerciseEntryPanelToAddMode() {
  plannedExerciseEntryHint.hidden = true;
  document.getElementById("savePlannedExerciseButton").textContent = "Add to workout";
  savePlannedExerciseToTemplateButton.hidden = true;
}

document.getElementById("savePlannedExerciseButton").addEventListener("click", () => {
  if (appState.isAddingExerciseToWorkout) {
    addDraftExerciseToActiveWorkout(false);
    return;
  }
  if (appState.nextGoalTarget) {
    const { templateId, exerciseId, startingLoad } = appState.nextGoalTarget;
    const template = appState.database.workoutTemplates.find((candidate) => candidate.id === templateId);
    const planned = template.plannedExercises.find((candidate) => candidate.exerciseId === exerciseId);
    const draft = appState.plannedExerciseDraft;

    planned.targetSets = draft.targetSets;
    planned.targetRepsMin = draft.targetRepsMin;
    planned.targetRepsMax = draft.targetRepsMax;
    planned.targetRir = draft.targetRir;

    // Only a load that was actually changed counts as a goal set by hand.
    // Saving just to adjust sets or reps shouldn't lock in the current
    // weight and quietly switch off the next session's suggestion.
    if (draft.targetLoad !== startingLoad) {
      planned.targetLoad = draft.targetLoad;
      planned.targetLoadSetAt = new Date().toISOString();
    }
    saveDatabase(appState.database);

    appState.nextGoalTarget = null;
    appState.plannedExerciseDraft = null;
    plannedExerciseEntryPanel.hidden = true;
    resetPlannedExerciseEntryPanelToAddMode();
    renderExerciseArea();
    return;
  }

  appState.workoutTemplateDraft.plannedExercises.push(appState.plannedExerciseDraft);
  appState.plannedExerciseDraft = null;
  plannedExerciseEntryPanel.hidden = true;
  workoutTemplateEditorScreen.hidden = false;
  renderWorkoutTemplateEditor();
});

document.getElementById("cancelPlannedExerciseButton").addEventListener("click", () => {
  if (appState.isAddingExerciseToWorkout) {
    closeTargetPanelForAddingToWorkout();
    return;
  }
  if (appState.nextGoalTarget) {
    appState.nextGoalTarget = null;
    appState.plannedExerciseDraft = null;
    plannedExerciseEntryPanel.hidden = true;
    resetPlannedExerciseEntryPanelToAddMode();
    return;
  }

  appState.plannedExerciseDraft = null;
  plannedExerciseEntryPanel.hidden = true;
  workoutTemplateEditorScreen.hidden = false;
});


// ---------------------------------------------------------------------------
// Cardio activities (Settings) — the list a cardio session picks its
// activity from. Same add / rename / archive pattern as the Gyms screen.
// ---------------------------------------------------------------------------

function showCardioActivitiesScreen() {
  hideAllScreens();
  cardioActivitiesScreen.hidden = false;
  renderCardioActivitiesList();
}

function isCardioActivityUnused(activityId) {
  return !appState.database.cardioSessions.some((session) => session.activityId === activityId);
}

function buildSmallButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

// Only CardioActivity.name changes: the id, which cardio sessions point at,
// stays the same, so history follows the activity under its new name.
function renameCardioActivity(activity) {
  openTextEntryPanel({
    heading: "Rename activity",
    label: "Name",
    initialValue: activity.name,
    onSave: (typedName) => renameItem(activity, typedName, renderCardioActivitiesList)
  });
}

// Archiving rather than deleting keeps past cardio sessions of this
// activity resolvable; it just stops being offered for new ones.
function setCardioActivityArchived(activity, isArchived) {
  activity.isArchived = isArchived;
  saveDatabase(appState.database);
  renderCardioActivitiesList();
}

// Only offered for an archived activity no cardio session uses, so nothing
// in the history can be left pointing at an activity that's gone.
function deleteCardioActivity(activity) {
  const confirmed = confirm(`Delete "${activity.name}"? This can't be undone.`);
  if (!confirmed) {
    return;
  }
  appState.database.cardioActivities = appState.database.cardioActivities.filter(
    (candidate) => candidate.id !== activity.id
  );
  saveDatabase(appState.database);
  renderCardioActivitiesList();
}

function buildCardioActivityRow(activity) {
  const rowElement = document.createElement("li");
  rowElement.className = "list-row";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = activity.name;
  rowElement.appendChild(nameSpan);

  if (activity.isArchived) {
    rowElement.appendChild(buildSmallButton("Unarchive", () => setCardioActivityArchived(activity, false)));
    if (isCardioActivityUnused(activity.id)) {
      const deleteButton = buildSmallButton("Delete", () => deleteCardioActivity(activity));
      deleteButton.classList.add("destructive-button");
      rowElement.appendChild(deleteButton);
    }
  } else {
    rowElement.appendChild(buildSmallButton("Rename", () => renameCardioActivity(activity)));
    rowElement.appendChild(buildSmallButton("Archive", () => setCardioActivityArchived(activity, true)));
  }
  return rowElement;
}

// Both lists are drawn every time; the archived one simply stays hidden
// until "Show archived" is tapped.
function renderCardioActivitiesList() {
  const activeListElement = document.getElementById("cardioActivitiesList");
  const archivedListElement = document.getElementById("archivedCardioActivitiesList");
  activeListElement.innerHTML = "";
  archivedListElement.innerHTML = "";

  for (const activity of appState.database.cardioActivities) {
    const targetList = activity.isArchived ? archivedListElement : activeListElement;
    targetList.appendChild(buildCardioActivityRow(activity));
  }
}

document.getElementById("addCardioActivityButton").addEventListener("click", () => {
  const nameInput = document.getElementById("newCardioActivityNameInput");
  const name = nameInput.value.trim();
  if (name === "") {
    alert("Enter a name for the activity.");
    return;
  }
  const id = makeUniqueIdFromName(name, appState.database.cardioActivities);
  if (id === "") {
    alert("That name needs at least one letter or number.");
    return;
  }

  appState.database.cardioActivities.push({ id, name, isArchived: false });
  saveDatabase(appState.database);
  nameInput.value = "";
  renderCardioActivitiesList();
});

document.getElementById("toggleArchivedCardioActivitiesButton").addEventListener("click", (event) => {
  const archivedListElement = document.getElementById("archivedCardioActivitiesList");
  archivedListElement.hidden = !archivedListElement.hidden;
  event.currentTarget.textContent = archivedListElement.hidden ? "Show archived" : "Hide archived";
});

document.getElementById("manageCardioActivitiesButton").addEventListener("click", showCardioActivitiesScreen);
document.getElementById("backFromCardioActivitiesButton").addEventListener("click", showSettingsScreen);
