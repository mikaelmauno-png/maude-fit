// ---------------------------------------------------------------------------
// Home-screen cards: the deload card, the backstop deload offer, the
// development reminders, and the backup reminder.
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
// Deload card (home screen)
//
// Starts a whole-body deload by hand, and shows how far along a running
// one is. The rules for what a deload does are in deload.js; this part
// only saves the Deload record and draws the card.
// ---------------------------------------------------------------------------

const deloadCard = document.getElementById("deloadCard");
const deloadCardText = document.getElementById("deloadCardText");
const startDeloadButton = document.getElementById("startDeloadButton");
const cancelDeloadButton = document.getElementById("cancelDeloadButton");

// Marks a running deload completed once every slot is settled (see
// isDeloadSlotSettled). Runs whenever the home screen is shown, because a
// slot can settle with no workout at all, just by time passing.
function completeDeloadIfFinished() {
  const deload = findActiveDeload(appState.database);
  const nowIso = new Date().toISOString();
  if (deload && isDeloadFinished(deload, appState.database.workoutTemplates, nowIso)) {
    deload.status = "completed";
    deload.completedAt = nowIso;
    saveDatabase(appState.database);
  }
}

// Hidden during a workout, like the other home-screen cards: a deload
// starting halfway through one would change nothing until the next. Also
// hidden with no active workout template, since there'd be nothing to
// deload.
function renderDeloadCard() {
  const hasActiveTemplate = appState.database.workoutTemplates.some((template) => !template.isArchived);
  if (appState.activeSessionId !== null || !hasActiveTemplate) {
    deloadCard.hidden = true;
    return;
  }

  // While a backstop offer is waiting, its Accept does the same as Start
  // a deload, and two cards offering one thing would be clutter.
  if (findPendingBackstopOffer(appState.database) !== null) {
    deloadCard.hidden = true;
    return;
  }
  deloadCard.hidden = false;

  const deload = findActiveDeload(appState.database);
  startDeloadButton.hidden = deload !== null;
  cancelDeloadButton.hidden = deload === null;
  if (deload === null) {
    deloadCardText.textContent =
      "Run down or stalling? A deload gives each exercise one lighter workout: " +
      "about a third fewer sets, stopping 1–2 reps further from failure.";
    return;
  }
  const settledCount = countSettledDeloadSlots(deload, appState.database.workoutTemplates, new Date().toISOString());
  deloadCardText.textContent =
    `Deload in progress: ${settledCount} of ${deload.slots.length} exercises done. ` +
    "It ends by itself once each one has had its lighter workout.";
}

// One tap, no confirmation: starting is easy to undo with Cancel, and
// nothing is changed until a workout is actually started.
startDeloadButton.addEventListener("click", () => {
  const deload = buildManualWholeBodyDeload(appState.database.workoutTemplates, new Date().toISOString());
  appState.database.deloads.push(deload);
  saveDatabase(appState.database);
  renderDeloadCard();
});

// Cancelling does ask: unlike starting, it can't be taken back, since a
// new deload would start every exercise over. The sets already done stay
// marked as deload sets, because that's what they were.
cancelDeloadButton.addEventListener("click", () => {
  if (!confirm("Cancel the deload? The rest of your workouts go back to normal.")) {
    return;
  }
  const deload = findActiveDeload(appState.database);
  deload.status = "cancelled";
  deload.cancelledAt = new Date().toISOString();
  saveDatabase(appState.database);
  renderDeloadCard();
});


// ---------------------------------------------------------------------------
// Backstop offer cards (home screen and top of the workout screen)
//
// When 8 weeks pass with no whole-body deload, a deload is offered (rules
// in deload.js). The same offer shows in two places: on the home screen,
// and at the top of a workout that hasn't logged a set yet, where
// accepting makes that very workout a deload one.
// ---------------------------------------------------------------------------

const backstopOfferCard = document.getElementById("backstopOfferCard");
const backstopOfferText = document.getElementById("backstopOfferText");
const workoutBackstopOfferCard = document.getElementById("workoutBackstopOfferCard");
const workoutBackstopOfferText = document.getElementById("workoutBackstopOfferText");

// Saves a new offer when one is due. Runs whenever the home screen is
// shown, since the offer comes from time passing rather than from
// anything being tapped.
function makeBackstopOfferIfDue() {
  const nowIso = new Date().toISOString();
  if (isBackstopOfferDue(appState.database, nowIso)) {
    appState.database.deloads.push(buildBackstopOffer(nowIso));
    saveDatabase(appState.database);
  }
}

// "It's been 9 weeks since your last deload." Before the first deload,
// the clock counts from the first logged workout, so it says that.
function describeBackstopOffer() {
  const clockStart = findBackstopClockStart(appState.database);
  const weeks = Math.floor(daysBetween(clockStart, new Date().toISOString()) / 7);
  const hasHadDeload = appState.database.deloads.some(
    (deload) => deload.scope === "whole" && deload.status === "completed"
  );
  const since = hasHadDeload ? "since your last deload" : "of training with no deload";
  return `It's been ${weeks} weeks ${since}. Take a deload now? ` +
    "Each exercise gets one lighter workout: about a third fewer sets, stopping 1–2 reps further from failure.";
}

function hasActiveWorkoutLoggedSets() {
  return appState.database.sets.some((set) => set.sessionId === appState.activeSessionId);
}

function renderBackstopOfferCards() {
  const hasOffer = findPendingBackstopOffer(appState.database) !== null;
  const isIdle = appState.activeSessionId === null;
  backstopOfferCard.hidden = !(hasOffer && isIdle);
  workoutBackstopOfferCard.hidden = !(hasOffer && !isIdle && !hasActiveWorkoutLoggedSets());
  if (hasOffer) {
    backstopOfferText.textContent = describeBackstopOffer();
    workoutBackstopOfferText.textContent = describeBackstopOffer();
  }
}

// The deload covers the templates as they are now (see buildBackstopOffer
// in deload.js). Accepted at the start of a workout, that workout becomes
// its first deload workout: no sets are logged yet, so nothing done so
// far was trained the normal way.
function acceptBackstopOffer() {
  const offer = findPendingBackstopOffer(appState.database);
  offer.slots = buildWholeBodyDeloadSlots(appState.database.workoutTemplates);
  offer.status = "accepted";
  offer.acceptedAt = new Date().toISOString();
  const session = getActiveSession();
  if (session && !hasActiveWorkoutLoggedSets()) {
    session.deload = chooseSessionDeload(session);
  }
  saveDatabase(appState.database);
}

// "Not now" is kept as a declined record: the two-week wait before the
// next offer counts from it.
function declineBackstopOffer() {
  const offer = findPendingBackstopOffer(appState.database);
  offer.status = "declined";
  offer.declinedAt = new Date().toISOString();
  saveDatabase(appState.database);
}

document.getElementById("acceptBackstopOfferButton").addEventListener("click", () => {
  acceptBackstopOffer();
  renderBackstopOfferCards();
  renderDeloadCard();
});

document.getElementById("declineBackstopOfferButton").addEventListener("click", () => {
  declineBackstopOffer();
  renderBackstopOfferCards();
  renderDeloadCard();
  renderDevelopmentReminders();
});

document.getElementById("acceptWorkoutBackstopOfferButton").addEventListener("click", () => {
  acceptBackstopOffer();
  renderBackstopOfferCards();
  renderExerciseArea();
});

document.getElementById("declineWorkoutBackstopOfferButton").addEventListener("click", () => {
  declineBackstopOffer();
  renderBackstopOfferCards();
});


// ---------------------------------------------------------------------------
// Development reminders (home screen) — TEMPORARY
//
// Notes from the developer to the developer: points where enough real data
// has built up to come back and work on the training engine. Each one
// shows when its data is ready, or on a fallback date, whichever comes
// first. Nothing about them is saved; a reminder is deleted from this list
// once its work has been picked up, and the whole section goes once the
// list is empty.
// ---------------------------------------------------------------------------

const developmentRemindersElement = document.getElementById("developmentReminders");
const developmentReminderListElement = document.getElementById("developmentReminderList");

// True when at least half of the muscles the drop test covers have a test
// actually running ("watching" in the test view on Muscle stats).
function isHalfOfDropTestRunning(analysis) {
  const testedMuscles = analysis.muscles.filter((muscle) => muscle.isDropTested);
  const runningMuscles = testedMuscles.filter((muscle) => muscle.keys.some((key) => key.status === "watching"));
  return testedMuscles.length > 0 && runningMuscles.length * 2 >= testedMuscles.length;
}

// `analysis` is analyzeDropDetection's result, worked out once for all of
// them. Fallback dates are compared as text, which works for ISO dates.
const DEVELOPMENT_REMINDERS = [
  {
    text: "Noise is measured for both pools. Compare σ̂ (Muscle stats test view) with the 3–4% the simulation assumed.",
    isDue: (analysis, todayIso) =>
      (analysis.noiseByPool.standard.sigmaHat !== null && analysis.noiseByPool.highRep.sigmaHat !== null) ||
      todayIso >= "2026-12-10"
  },
  {
    text: "Readiness has run two months. Check how often it's answered 1–2 (the low-readiness rate).",
    isDue: (analysis, todayIso) => todayIso >= "2026-12-24"
  },
  {
    text: "Drop tests are running for most muscles. Review the test view and decide on step 3 (drop-based deload suggestions).",
    isDue: (analysis, todayIso) => isHalfOfDropTestRunning(analysis) || todayIso >= "2027-01-15"
  },
  {
    text: "The first backstop deload offer has been answered. Check how it went (timing, wording, accepted or not).",
    isDue: () => appState.database.deloads.some(
      (deload) => deload.trigger === "backstop" && deload.status !== "suggested"
    )
  }
];

function renderDevelopmentReminders() {
  const todayIso = new Date().toISOString();
  const analysis = analyzeDropDetection(appState.database);
  const dueReminders = DEVELOPMENT_REMINDERS.filter((reminder) => reminder.isDue(analysis, todayIso));
  developmentRemindersElement.hidden = dueReminders.length === 0 || appState.activeSessionId !== null;
  developmentReminderListElement.innerHTML = "";
  for (const reminder of dueReminders) {
    const itemElement = document.createElement("li");
    itemElement.textContent = reminder.text;
    developmentReminderListElement.appendChild(itemElement);
  }
}
