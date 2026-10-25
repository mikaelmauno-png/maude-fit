// ---------------------------------------------------------------------------
// History: the list of finished workouts, bodyweight, and logging cardio.
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
// History (read-only list of finished workouts)
// ---------------------------------------------------------------------------

function formatSessionDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// Finished workouts and cardio sessions together, newest first, so History
// reads as one timeline of training. Each kind brings its own date and its
// own card builder; sorting the mixed list by date interleaves them.
function renderHistoryList() {
  const listElement = document.getElementById("historyList");
  listElement.innerHTML = "";

  const workoutEntries = appState.database.sessions
    .filter((session) => session.endedAt !== null)
    .map((session) => ({ date: session.startedAt, buildCard: () => buildWorkoutHistoryCard(session) }));
  const cardioEntries = appState.database.cardioSessions
    .map((cardioSession) => ({ date: cardioSession.performedAt, buildCard: () => buildCardioHistoryCard(cardioSession) }));
  const entries = workoutEntries.concat(cardioEntries).sort((a, b) => b.date.localeCompare(a.date));

  if (entries.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "Nothing logged yet.";
    listElement.appendChild(emptyMessage);
    return;
  }

  for (const entry of entries) {
    listElement.appendChild(entry.buildCard());
  }
}

// "Weekly workout 1", "Catch-up" or "Free-form": what a workout followed,
// for History and the monthly recap.
function describeWorkoutKind(session, template) {
  if (session.catchUpExercises) {
    return "Catch-up";
  }
  return template ? template.name : "Free-form";
}

// One finished workout: header, status line, then its sets grouped by
// exercise as tappable pills.
function buildWorkoutHistoryCard(session) {
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
    `${formatSessionDate(session.startedAt)} · ${describeWorkoutKind(session, template)}${gym ? ` · ${gym.name}` : ""}`;
  cardElement.appendChild(headerElement);

  // Unanswered readiness, "Normal" and empty notes say nothing, so the line
  // only appears when there's actually something to show.
  const hasStatusWorthShowing = session.dayStatus !== null && session.dayStatus !== "normal";
  const readinessText = session.readiness !== null
    ? `Readiness ${session.readiness}/${CHECK_IN_SCALE_MAX}`
    : null;
  const statusText = hasStatusWorthShowing ? DAY_STATUS_LABELS[session.dayStatus] : null;
  if (readinessText || statusText || session.notes !== "") {
    const statusLine = document.createElement("div");
    statusLine.className = "history-card-line";
    const answers = [readinessText, statusText].filter(Boolean).join(" · ");
    statusLine.textContent = [answers, session.notes].filter(Boolean).join(" — ");
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
      weightSpan.textContent = formatLoad(set.load, exercise);

      const repsSpan = document.createElement("span");
      repsSpan.className = "set-pill-reps";
      repsSpan.textContent = set.isWarmup ? `${set.reps} (warmup)` : `${set.reps} reps`;

      pill.append(weightSpan, repsSpan);
      pill.addEventListener("click", () => openSetEntryPanelForEdit(set.id));
      pillRowElement.appendChild(pill);
    }
    cardElement.appendChild(pillRowElement);
  }

  // At the very bottom of the card, well away from "Edit status" and the
  // set pills, so an inaccurate thumb reaching for those can't land on it.
  const deleteSessionButton = document.createElement("button");
  deleteSessionButton.type = "button";
  deleteSessionButton.className = "small-button destructive-button history-delete-button";
  deleteSessionButton.textContent = "Delete workout";
  deleteSessionButton.addEventListener("click", () => confirmAndDeleteSession(session, sessionSets.length));
  cardElement.appendChild(deleteSessionButton);

  return cardElement;
}

// "35 min · 5.3 km · effort 6 · 140 bpm": only what was recorded.
function describeCardioSession(cardioSession) {
  const parts = [`${cardioSession.durationMinutes} min`];
  if (cardioSession.distanceKm !== null) {
    parts.push(`${cardioSession.distanceKm} km`);
  }
  parts.push(`effort ${cardioSession.effort}`);
  if (cardioSession.averageHeartRate !== null) {
    parts.push(`${cardioSession.averageHeartRate} bpm`);
  }
  return parts.join(" · ");
}

// One cardio session: date and activity, what was recorded, any notes, and
// Edit / Delete. Activities are archived rather than deleted once used, so
// the lookup always finds a name.
function buildCardioHistoryCard(cardioSession) {
  const activity = appState.database.cardioActivities.find(
    (candidate) => candidate.id === cardioSession.activityId
  );

  const cardElement = document.createElement("li");
  cardElement.className = "history-card";

  const headerElement = document.createElement("div");
  headerElement.className = "history-card-header";
  headerElement.textContent = `${formatSessionDate(cardioSession.performedAt)} · ${activity.name}`;
  cardElement.appendChild(headerElement);

  const detailLine = document.createElement("div");
  detailLine.className = "history-card-line";
  detailLine.textContent = describeCardioSession(cardioSession);
  cardElement.appendChild(detailLine);

  if (cardioSession.notes !== "") {
    const notesLine = document.createElement("div");
    notesLine.className = "history-card-line";
    notesLine.textContent = cardioSession.notes;
    cardElement.appendChild(notesLine);
  }

  cardElement.appendChild(buildSmallButton("Edit", () => showCardioLogScreenForEdit(cardioSession.id)));

  // Same placement as "Delete workout": at the bottom, away from Edit.
  const deleteButton = buildSmallButton("Delete cardio", () => confirmAndDeleteCardioSession(cardioSession));
  deleteButton.classList.add("destructive-button", "history-delete-button");
  cardElement.appendChild(deleteButton);

  return cardElement;
}

function confirmAndDeleteCardioSession(cardioSession) {
  const confirmed = confirm(
    `Delete the cardio session from ${formatSessionDate(cardioSession.performedAt)}? This can't be undone.`
  );
  if (!confirmed) {
    return;
  }
  appState.database.cardioSessions = appState.database.cardioSessions.filter(
    (candidate) => candidate.id !== cardioSession.id
  );
  saveDatabase(appState.database);
  renderHistoryList();
}

// The confirmation spells out how many sets go with it, since that's the
// part that's easy to forget: the sets are the actual training record.
function confirmAndDeleteSession(session, setCount) {
  const setsText = setCount === 1 ? "1 logged set" : `${setCount} logged sets`;
  const confirmed = confirm(
    `Delete the workout from ${formatSessionDate(session.startedAt)} and its ${setsText}? This can't be undone.`
  );
  if (!confirmed) {
    return;
  }
  deleteSessionAndItsSets(session.id);
  saveDatabase(appState.database);
  renderHistoryList();
}

// Removes the sets too, not just the session. Sets left pointing at a
// session that no longer exists would still count towards progression
// suggestions, personal bests and stats — training nobody can see or
// correct any more.
function deleteSessionAndItsSets(sessionId) {
  appState.database.sets = appState.database.sets.filter((set) => set.sessionId !== sessionId);
  appState.database.sessions = appState.database.sessions.filter((session) => session.id !== sessionId);
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

  renderChartRangePicker(document.getElementById("bodyweightRangePicker"), renderBodyweightChart);

  const recentEntries = appState.database.bodyweightEntries
    .filter((entry) => isWithinChartRange(entry.loggedAt))
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

  // Unlike the other two screens, the range buttons live inside the chart
  // area here, so they stay visible with the "nothing in range" note below
  // them instead of the whole area disappearing.
  const chartElement = document.getElementById("bodyweightChart");
  if (recentEntries.length === 0) {
    chartElement.textContent = describeEmptyChartRange();
    return;
  }

  const dataPoints = recentEntries.map((entry) => ({
    label: formatSessionDate(entry.loggedAt),
    value: entry.weightKg,
    date: entry.loggedAt
  }));

  chartElement.innerHTML = buildLineChartSVG(dataPoints, (value) => `${value} kg`);
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
  // A weigh-in mid-workout is a quick detour: once today's weight is
  // saved, go straight back to the workout. Correcting a past entry stays
  // on this screen, since that's a deliberate visit to the list.
  const wasLoggingToday = appState.editingBodyweightEntryId === null;
  saveDatabase(appState.database);
  resetBodyweightEntryToToday();
  if (wasLoggingToday && appState.isBodyweightOpenedFromWorkout) {
    showActiveWorkoutScreen();
    return;
  }
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
// Logging cardio — one CardioSession (schema.js), entered after it's done.
// The form works on appState.cardioDraft and only writes to the database
// on Save.
// ---------------------------------------------------------------------------

// Starting values when an activity has never been logged before.
const DEFAULT_CARDIO_MINUTES = 30;
const DEFAULT_CARDIO_DISTANCE_KM = 5;
const DEFAULT_CARDIO_HEART_RATE = 140;

// The most recent cardio session of one activity, or undefined. ISO date
// strings sort by time as plain text, so the largest one is the newest.
function findLastCardioSession(activityId) {
  return appState.database.cardioSessions
    .filter((session) => session.activityId === activityId)
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt))[0];
}

// The activity logged most recently of all, so the usual one is already
// picked when the screen opens.
function findLastUsedCardioActivityId() {
  const newest = appState.database.cardioSessions
    .slice()
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt))[0];
  return newest ? newest.activityId : null;
}

// Shape of appState.cardioDraft:
// {
//   editingSessionId: null,       // id of the session being corrected, or
//                                 // null when logging a new one
//   activityId: "rower",          // null until one is picked
//   isYesterday: false,           // new sessions only: log it as yesterday
//   durationMinutes: 30,
//   effort: null,                 // null until tapped; Save needs it
//   distanceKm: null,             // null = not recorded (stepper hidden)
//   averageHeartRate: null,       // null = not recorded (stepper hidden)
//   notes: ""
// }
function startNewCardioDraft() {
  appState.cardioDraft = {
    editingSessionId: null,
    activityId: null,
    isYesterday: false,
    durationMinutes: DEFAULT_CARDIO_MINUTES,
    effort: null,
    distanceKm: null,
    averageHeartRate: null,
    notes: ""
  };
  const lastActivityId = findLastUsedCardioActivityId();
  const lastActivity = appState.database.cardioActivities.find((activity) => activity.id === lastActivityId);
  if (lastActivity && !lastActivity.isArchived) {
    chooseCardioActivity(lastActivity.id);
  }
}

// Picking an activity starts the duration (and distance or heart rate, if
// shown) at what was logged last time for it, so a regular session needs
// only a nudge. Effort isn't carried over: it's the one thing worth
// thinking about fresh each time.
function chooseCardioActivity(activityId) {
  const draft = appState.cardioDraft;
  draft.activityId = activityId;
  const last = findLastCardioSession(activityId);
  draft.durationMinutes = last ? last.durationMinutes : DEFAULT_CARDIO_MINUTES;
  if (draft.distanceKm !== null && last && last.distanceKm !== null) {
    draft.distanceKm = last.distanceKm;
  }
  if (draft.averageHeartRate !== null && last && last.averageHeartRate !== null) {
    draft.averageHeartRate = last.averageHeartRate;
  }
}

function showCardioLogScreen() {
  hideAllScreens();
  startNewCardioDraft();
  cardioLogScreen.hidden = false;
  renderCardioLog();
}

// The same screen, filled in from a saved session so it can be corrected.
// The date isn't offered for change here: Today/Yesterday only makes sense
// at the moment of logging.
function showCardioLogScreenForEdit(cardioSessionId) {
  const cardioSession = appState.database.cardioSessions.find((candidate) => candidate.id === cardioSessionId);
  hideAllScreens();
  appState.cardioDraft = {
    editingSessionId: cardioSession.id,
    activityId: cardioSession.activityId,
    isYesterday: false,
    durationMinutes: cardioSession.durationMinutes,
    effort: cardioSession.effort,
    distanceKm: cardioSession.distanceKm,
    averageHeartRate: cardioSession.averageHeartRate,
    notes: cardioSession.notes
  };
  cardioLogScreen.hidden = false;
  renderCardioLog();
}

// Built fresh on every render: the list of activities can change in
// Settings between visits, and only active ones are offered. An archived
// activity still shows when editing a session that used it.
function renderCardioActivityOptions() {
  const optionsElement = document.getElementById("cardioActivityOptions");
  optionsElement.innerHTML = "";
  const draft = appState.cardioDraft;
  const offeredActivities = appState.database.cardioActivities.filter(
    (activity) => !activity.isArchived || activity.id === draft.activityId
  );
  for (const activity of offeredActivities) {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "day-status-option";
    optionButton.textContent = activity.name;
    optionButton.classList.toggle("day-status-option-selected", activity.id === draft.activityId);
    optionButton.addEventListener("click", () => {
      chooseCardioActivity(activity.id);
      renderCardioLog();
    });
    optionsElement.appendChild(optionButton);
  }
}

// Built once: 1 to 10 never changes.
const cardioEffortOptionsElement = document.getElementById("cardioEffortOptions");
for (let effort = CARDIO_EFFORT_MIN; effort <= CARDIO_EFFORT_MAX; effort++) {
  const effortButton = document.createElement("button");
  effortButton.type = "button";
  effortButton.className = "day-status-option";
  effortButton.textContent = effort;
  effortButton.dataset.effort = effort;
  effortButton.addEventListener("click", () => {
    appState.cardioDraft.effort = effort;
    renderCardioLog();
  });
  cardioEffortOptionsElement.appendChild(effortButton);
}

function renderCardioOptionalRows() {
  const draft = appState.cardioDraft;
  const hasDistance = draft.distanceKm !== null;
  const hasHeartRate = draft.averageHeartRate !== null;
  document.getElementById("cardioDistanceRow").hidden = !hasDistance;
  document.getElementById("addCardioDistanceButton").hidden = hasDistance;
  document.getElementById("cardioHeartRateRow").hidden = !hasHeartRate;
  document.getElementById("addCardioHeartRateButton").hidden = hasHeartRate;
  if (hasDistance) {
    document.getElementById("cardioDistanceValue").textContent = `${draft.distanceKm} km`;
  }
  if (hasHeartRate) {
    document.getElementById("cardioHeartRateValue").textContent = `${draft.averageHeartRate} bpm`;
  }
}

function renderCardioLog() {
  const draft = appState.cardioDraft;
  const isEditing = draft.editingSessionId !== null;
  document.getElementById("cardioLogHeading").textContent = isEditing ? "Edit cardio" : "Log cardio";

  renderCardioActivityOptions();

  document.getElementById("cardioDayChoice").hidden = isEditing;
  document.getElementById("cardioTodayButton").classList.toggle("day-status-option-selected", !draft.isYesterday);
  document.getElementById("cardioYesterdayButton").classList.toggle("day-status-option-selected", draft.isYesterday);

  document.getElementById("cardioDurationValue").textContent = `${draft.durationMinutes} min`;

  for (const effortButton of cardioEffortOptionsElement.children) {
    // dataset values are strings, hence Number() before comparing.
    effortButton.classList.toggle("day-status-option-selected", Number(effortButton.dataset.effort) === draft.effort);
  }

  renderCardioOptionalRows();
  document.getElementById("cardioNotesInput").value = draft.notes;
  document.getElementById("saveCardioButton").disabled = draft.activityId === null || draft.effort === null;
}

// Wires one stepper (−, value, +, and tap-the-value-to-type) to a field of
// the cardio draft. The three cardio steppers differ only in these values.
function connectCardioStepper(idPrefix, field, step, minimum, isInteger) {
  const decrementButton = document.getElementById(`${idPrefix}Decrement`);
  const incrementButton = document.getElementById(`${idPrefix}Increment`);
  decrementButton.addEventListener("click", () =>
    adjustDraftField(appState.cardioDraft, field, -step, minimum, renderCardioLog));
  incrementButton.addEventListener("click", () =>
    adjustDraftField(appState.cardioDraft, field, step, minimum, renderCardioLog));
  makeStepperValueEditable(
    document.getElementById(`${idPrefix}Value`), document.getElementById(`${idPrefix}ValueInput`),
    decrementButton, incrementButton,
    () => appState.cardioDraft, field, minimum, isInteger, renderCardioLog
  );
}

// Minutes step by 5 (most sessions are round numbers); typing gives any
// exact value. Distance steps by 0.1 km, heart rate by 1 bpm, both starting
// from last time's value so a small nudge is the usual change.
connectCardioStepper("cardioDuration", "durationMinutes", 5, 1, true);
connectCardioStepper("cardioDistance", "distanceKm", 0.1, 0, false);
connectCardioStepper("cardioHeartRate", "averageHeartRate", 1, 30, true);

// Showing an optional field starts it at last time's value for this
// activity, or a sensible default.
function showOptionalCardioField(field, defaultValue) {
  const draft = appState.cardioDraft;
  const last = draft.activityId ? findLastCardioSession(draft.activityId) : undefined;
  draft[field] = last && last[field] !== null ? last[field] : defaultValue;
  renderCardioLog();
}

document.getElementById("addCardioDistanceButton").addEventListener("click", () =>
  showOptionalCardioField("distanceKm", DEFAULT_CARDIO_DISTANCE_KM));
document.getElementById("addCardioHeartRateButton").addEventListener("click", () =>
  showOptionalCardioField("averageHeartRate", DEFAULT_CARDIO_HEART_RATE));
document.getElementById("removeCardioDistanceButton").addEventListener("click", () => {
  appState.cardioDraft.distanceKm = null;
  renderCardioLog();
});
document.getElementById("removeCardioHeartRateButton").addEventListener("click", () => {
  appState.cardioDraft.averageHeartRate = null;
  renderCardioLog();
});

document.getElementById("cardioTodayButton").addEventListener("click", () => {
  appState.cardioDraft.isYesterday = false;
  renderCardioLog();
});
document.getElementById("cardioYesterdayButton").addEventListener("click", () => {
  appState.cardioDraft.isYesterday = true;
  renderCardioLog();
});

document.getElementById("cardioNotesInput").addEventListener("input", (event) => {
  appState.cardioDraft.notes = event.target.value;
});

// "Yesterday" is the same clock time a day earlier: the exact hour isn't
// known when logging after the fact, and the date is what matters.
function chooseCardioPerformedAt(isYesterday) {
  const performedAt = new Date();
  if (isYesterday) {
    performedAt.setDate(performedAt.getDate() - 1);
  }
  return performedAt.toISOString();
}

// The draft's values in the stored CardioSession shape (schema.js).
function buildCardioSessionFields(draft) {
  return {
    activityId: draft.activityId,
    durationMinutes: draft.durationMinutes,
    effort: draft.effort,
    distanceKm: draft.distanceKm,
    averageHeartRate: draft.averageHeartRate,
    notes: draft.notes.trim()
  };
}

// Editing replaces the session's values in place (keeping its id and date),
// per the data rule that a correction replaces, never duplicates.
function saveCardioDraft() {
  const draft = appState.cardioDraft;
  if (draft.editingSessionId !== null) {
    const existing = appState.database.cardioSessions.find((candidate) => candidate.id === draft.editingSessionId);
    Object.assign(existing, buildCardioSessionFields(draft));
    saveDatabase(appState.database);
    return;
  }
  appState.database.cardioSessions.push({
    id: crypto.randomUUID(),
    performedAt: chooseCardioPerformedAt(draft.isYesterday),
    ...buildCardioSessionFields(draft)
  });
  saveDatabase(appState.database);
}

// Back to wherever the screen was opened from: History for an edit, home
// for a new session.
function leaveCardioLogScreen() {
  const wasEditing = appState.cardioDraft.editingSessionId !== null;
  appState.cardioDraft = null;
  if (wasEditing) {
    showHistoryScreen();
  } else {
    showMainScreen();
  }
}

document.getElementById("saveCardioButton").addEventListener("click", () => {
  saveCardioDraft();
  leaveCardioLogScreen();
});
document.getElementById("backFromCardioLogButton").addEventListener("click", leaveCardioLogScreen);
document.getElementById("logCardioButton").addEventListener("click", showCardioLogScreen);
