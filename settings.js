// ---------------------------------------------------------------------------
// Settings: export and import, preferences, restoring the automatic copy,
// app updates — and, at the very end, the startup code.
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
// Export and import
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Settings: the preference choices, and the backup status line
// ---------------------------------------------------------------------------

// Rest targets on offer, in seconds; null is "Off". Short enough for
// accessory work, long enough for heavy compounds.
const REST_TARGET_CHOICES = [null, 60, 90, 120, 180, 240];

// "Off", "1:30", "3:00" — the same minutes:seconds look as the timer.
function describeRestTarget(seconds) {
  return seconds === null ? "Off" : formatElapsedTime(seconds);
}

function renderSettingsScreen() {
  renderPreferenceChoices(
    document.getElementById("defaultLoadIncrementOptions"),
    LOAD_INCREMENT_PRESETS,
    (increment) => `${increment} kg`,
    "defaultLoadIncrement"
  );
  renderPreferenceChoices(
    document.getElementById("restTargetOptions"),
    REST_TARGET_CHOICES,
    describeRestTarget,
    "restTargetSeconds"
  );
  document.getElementById("settingsBackupStatus").textContent = describeLastBackup(appState.database.lastBackedUpAt);
}

// One row of buttons for one preference: tapping a choice saves it at
// once (no Save button to forget) and lights it up. `describe` turns a
// value into its button label.
function renderPreferenceChoices(containerElement, choices, describe, preferenceKey) {
  containerElement.innerHTML = "";
  for (const choice of choices) {
    const choiceButton = document.createElement("button");
    choiceButton.type = "button";
    choiceButton.className = "day-status-option";
    choiceButton.textContent = describe(choice);
    choiceButton.dataset.value = choice;
    choiceButton.addEventListener("click", () => {
      appState.database.preferences[preferenceKey] = choice;
      saveDatabase(appState.database);
      renderSettingsScreen();
    });
    containerElement.appendChild(choiceButton);
  }
  highlightSelectedButton(containerElement, "value", appState.database.preferences[preferenceKey]);
}

// "Back up" here is the same backup as the home screen's "Back up now" button.
document.getElementById("exportButton").addEventListener("click", backUpData);

// Save a backup file off the phone, and remember that it happened, which is
// what the home screen's backup reminder counts from.
//
// "async" lets this wait for the share sheet to close (the "await" below)
// without freezing the page in the meantime.
async function backUpData() {
  const backedUpAt = new Date().toISOString();
  const backupFile = buildBackupFile(appState.database, backedUpAt);

  const wasSaved = await shareOrDownloadFile(backupFile);
  if (!wasSaved) {
    return;
  }
  appState.database.lastBackedUpAt = backedUpAt;
  saveDatabase(appState.database);
  renderBackupStatus();
}

// Hands the file to the phone's share sheet, where it can go straight to
// iCloud Drive, Mail or AirDrop. A download would land in the phone's own
// Downloads folder instead, which is lost along with the phone. Browsers
// that can't share files (most desktop ones) still get the download.
//
// Returns false only when the share sheet was closed without picking
// anywhere, so that doesn't count as a backup.
async function shareOrDownloadFile(file) {
  // canShare is missing entirely on some browsers, hence the first check.
  const canShareFiles = navigator.canShare !== undefined && navigator.canShare({ files: [file] });
  if (!canShareFiles) {
    downloadFile(file);
    return true;
  }

  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (error) {
    // AbortError is what share() reports when the sheet is dismissed.
    if (error.name === "AbortError") {
      return false;
    }
    // Anything else means sharing itself broke, so a download is still
    // better than no backup at all.
    console.error("Sharing the backup failed, downloading it instead.", error);
    downloadFile(file);
    return true;
  }
}

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
      // Import replaces everything, so keep what's here as the automatic
      // copy first: importing the wrong file can then be undone.
      saveAutoCopy(appState.database);
      replaceDatabase(fileText);
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


// Swaps in a whole new database (from an import or the automatic copy).
// importDatabase does the checking and saving; this resets the screen to
// match.
function replaceDatabase(jsonText) {
  closeSetEntryPanel();
  closeFreeformReview();
  hidePersonalBestBanner();
  closeDayStatusPanel();

  appState.database = importDatabase(jsonText);
  // The new data may not have a session in progress, so treat any active
  // workout as no longer valid rather than pointing at a session that may
  // not exist in it.
  appState.activeSessionId = null;
  showMainScreen();
  updateWorkoutControls();
  renderExerciseArea();
}


// ---------------------------------------------------------------------------
// Restoring the automatic copy
// ---------------------------------------------------------------------------

const autoCopyStatus = document.getElementById("autoCopyStatus");
const restoreAutoCopyButton = document.getElementById("restoreAutoCopyButton");

function renderAutoCopyStatus() {
  const autoCopy = loadAutoCopy();
  if (autoCopy === null) {
    autoCopyStatus.textContent = "No automatic copy yet.";
    restoreAutoCopyButton.hidden = true;
    return;
  }
  autoCopyStatus.textContent = `Automatic copy from ${formatDateAndTime(autoCopy.takenAt)}`;
  restoreAutoCopyButton.hidden = false;
}

// "27 Sep, 18:40" — the time matters here, since a copy is taken every
// time the app opens and there may be several on one day.
function formatDateAndTime(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

restoreAutoCopyButton.addEventListener("click", () => {
  const autoCopy = loadAutoCopy();
  if (autoCopy === null) {
    return;
  }

  // Replaces everything, and is never part of the common path, so it asks.
  const userConfirmed = confirm(
    `Replace all your current data with the automatic copy from ` +
    `${formatDateAndTime(autoCopy.takenAt)}?\n\n` +
    "Your current data becomes the new automatic copy, so restoring it " +
    "again undoes this."
  );
  if (!userConfirmed) {
    return;
  }

  try {
    // The copy was already read into autoCopy above, so it's safe to
    // overwrite the stored one with the current data. This is what makes
    // the restore undoable.
    saveAutoCopy(appState.database);
    // Through importDatabase, so a copy saved by an older app version is
    // upgraded and a damaged one is refused, exactly like an import.
    replaceDatabase(JSON.stringify(autoCopy.database));
    alert("Automatic copy restored.");
  } catch (error) {
    alert(error.message);
  }
});


// ---------------------------------------------------------------------------
// Backup reminder (home screen, only when idle)
//
// All data lives only in this phone's browser storage, so a backup file
// saved somewhere else is the only protection against losing the phone or
// the browser clearing its storage. Nothing can do that automatically (a
// web page can't save files without a tap), so this keeps the tap close:
// how long it's been, and a button right after each finished workout.
// ---------------------------------------------------------------------------

// After this many days without a backup the reminder turns a warning colour.
const BACKUP_WARNING_AGE_DAYS = 7;

const backupStatusElement = document.getElementById("backupStatus");
const backupStatusText = document.getElementById("backupStatusText");
const backUpNowButton = document.getElementById("backUpNowButton");

backUpNowButton.addEventListener("click", backUpData);

function renderBackupStatus() {
  const isIdle = appState.activeSessionId === null;
  const hasFinishedWorkouts = appState.database.sessions.some((session) => session.endedAt !== null);
  // Before the first finished workout there's nothing yet worth nagging about.
  if (!isIdle || !hasFinishedWorkouts) {
    backupStatusElement.hidden = true;
    return;
  }
  backupStatusElement.hidden = false;

  const lastBackedUpAt = appState.database.lastBackedUpAt;
  backupStatusText.textContent = describeLastBackup(lastBackedUpAt);
  backupStatusText.classList.toggle("backup-overdue", isBackupOverdue(lastBackedUpAt));
  backUpNowButton.hidden = !hasWorkoutSinceLastBackup(lastBackedUpAt);
}

function describeLastBackup(lastBackedUpAt) {
  if (lastBackedUpAt === null) {
    return "Never backed up";
  }
  const daysAgo = countCalendarDaysSince(lastBackedUpAt);
  if (daysAgo === 0) {
    return "Last backup: today";
  }
  if (daysAgo === 1) {
    return "Last backup: yesterday";
  }
  return `Last backup: ${daysAgo} days ago`;
}

function isBackupOverdue(lastBackedUpAt) {
  return lastBackedUpAt === null || countCalendarDaysSince(lastBackedUpAt) >= BACKUP_WARNING_AGE_DAYS;
}

// A workout finished after the last backup is one the backup doesn't have.
function hasWorkoutSinceLastBackup(lastBackedUpAt) {
  return appState.database.sessions.some((session) =>
    session.endedAt !== null &&
    (lastBackedUpAt === null || new Date(session.endedAt) > new Date(lastBackedUpAt))
  );
}

// Counts midnights passed, not 24-hour periods, so a backup made late last
// night reads as "yesterday" this morning rather than "today".
function countCalendarDaysSince(isoString) {
  const then = new Date(isoString);
  const now = new Date();
  // Local midnight of each day. Date.UTC is used only as a way to turn a
  // year/month/day into a plain number of milliseconds, which sidesteps
  // days that are 23 or 25 hours long when the clocks change.
  const thenDay = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((today - thenDay) / millisecondsPerDay);
}


// ---------------------------------------------------------------------------
// Startup
//
// Runs once, at the very end of the last script index.html loads. It can't
// happen any earlier: the screens look up page elements stored in `const`s
// declared all through the app's files, and JavaScript refuses to read a
// `const` before the line that declares it has run.
// ---------------------------------------------------------------------------

recoverUnfinishedSessions();
showMainScreen();
// Same steps startWorkout() takes, so a resumed workout looks exactly like
// one that was never interrupted.
if (appState.activeSessionId !== null) {
  showActiveWorkoutScreen();
  updateWorkoutControls();
  renderExerciseArea();
}
