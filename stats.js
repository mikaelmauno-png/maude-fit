// ---------------------------------------------------------------------------
// Stats: the weekly summary, sets per muscle and the muscle diagram, exercise
// and muscle charts, personal bests, the monthly recap, and the weekly
// check-in.
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
// Week boundaries — shared by the weekly workout template summary and the per-exercise
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
// Chart time range — the "6 wk / 12 wk / 24 wk / All" buttons above every
// trend chart (exercise, muscle, bodyweight). One shared setting, so
// choosing a range on one chart carries over to the next one you open. It
// lives in database.preferences (schema.js), so it also survives closing
// the app.
// ---------------------------------------------------------------------------

const CHART_RANGES = [
  { label: "6 wk", weeks: 6 },
  { label: "12 wk", weeks: 12 },
  { label: "24 wk", weeks: 24 },
  { label: "All", weeks: null }
];

// The earliest moment the selected range includes, or null for all-time.
// Counted in whole Monday-to-Monday weeks with this week as the last one, so
// "6 wk" means this week plus the five before it — the same weeks the chart
// points are grouped into.
function getChartRangeStart() {
  if (appState.database.preferences.chartRangeWeeks === null) {
    return null;
  }
  const start = getCurrentWeekRange().start;
  start.setDate(start.getDate() - (appState.database.preferences.chartRangeWeeks - 1) * 7);
  return start;
}

function isWithinChartRange(isoString) {
  const rangeStart = getChartRangeStart();
  return rangeStart === null || new Date(isoString) >= rangeStart;
}

// Fills `containerElement` with one toggle button per range. `onChange` is
// the screen's own render function, called after the choice is saved in
// appState so the screen can redraw its charts (and these buttons) with it.
function renderChartRangePicker(containerElement, onChange) {
  containerElement.innerHTML = "";
  for (const range of CHART_RANGES) {
    const rangeButton = document.createElement("button");
    rangeButton.type = "button";
    rangeButton.className = "day-status-option";
    rangeButton.textContent = range.label;
    rangeButton.classList.toggle("day-status-option-selected", range.weeks === appState.database.preferences.chartRangeWeeks);
    rangeButton.addEventListener("click", () => {
      // Saved with the rest of the data, so the chosen range is still
      // there the next time the app is opened.
      appState.database.preferences.chartRangeWeeks = range.weeks;
      saveDatabase(appState.database);
      onChange();
    });
    containerElement.appendChild(rangeButton);
  }
}

// What an empty chart says when there is older data, just none in the
// chosen range — so it doesn't look as if the history has vanished.
function describeEmptyChartRange() {
  return `Nothing logged in the last ${appState.database.preferences.chartRangeWeeks} weeks. Try a longer range.`;
}


// ---------------------------------------------------------------------------
// Weekly workout template completion summary (main screen, only when idle)
//
// Completion % for a workout template this week = total reps actually logged across
// its exercises this week, divided by total reps planned (using the
// midpoint of each exercise's rep range, since a plan is a range not a
// single number), capped at 100.
// ---------------------------------------------------------------------------

function computeWorkoutTemplateCompletionPercent(template, session) {
  const sessionWorkingSets = appState.database.sets.filter(
    (set) => set.sessionId === session.id && !set.isWarmup
  );

  let plannedReps = 0;
  let actualReps = 0;

  // That session's own exercise list, so skipping an exercise for the day
  // doesn't count against it, and an added one counts towards it.
  for (const planned of getSessionPlannedExercises(session, template)) {
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

// The most recent finished session this week that followed this workout
// template, or null if it hasn't been done yet this week. Picks one
// representative session when a template was somehow done more than once
// in a week, rather than trying to combine them. Shared by the weekly bars
// below and the workout tiles at the top of the home screen, so both always
// agree on what "done this week" means.
function findMostRecentFinishedSessionThisWeek(templateId) {
  const { start, end } = getCurrentWeekRange();
  const sessionsThisWeek = appState.database.sessions
    .filter((session) => {
      if (session.templateId !== templateId || session.endedAt === null) {
        return false;
      }
      const startedAt = new Date(session.startedAt);
      return startedAt >= start && startedAt < end;
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return sessionsThisWeek[0] || null;
}


// ---------------------------------------------------------------------------
// Sets-per-muscle counter (main screen, only when idle)
//
// "Completed" sums each working set's muscle weight (1.0 for its main
// muscle, 0.5 for each secondary) across this week's logged sets, whatever
// exercise or session they came from. "Projected" sums targetSets x muscle
// weight across every active workout template — the same "each workout template once this
// week" assumption the weekly workout template summary above already makes.
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

  // Most-planned muscles first, so the muscles this week's workout templates actually
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
// it's normally visible from. This is a schematic (hand-drawn curves placed
// by eye), not an anatomical illustration — good enough to show "which
// muscles have I been neglecting", not to teach anatomy.
//
// Only the LEFT half of the body (x from 0 to 100, in a 200 x 390 drawing
// area) is described below. buildBodyDiagramSVG draws that half, then draws
// it again flipped across the centre line (x = 100) to get the right half.
// That keeps the body perfectly symmetric and halves the number of shapes
// to maintain. It also means a bilateral muscle like biceps is listed once
// but appears on both arms, both colored from its one tracked value.
//
// Each `path` is SVG path data: "M x,y" moves the pen, "C" draws a smooth
// curve (two control points, then the end point), "L" a straight line, and
// "Z" closes the shape back to where it started.
// ---------------------------------------------------------------------------

// Left half of the whole body outline, head to foot, closed along the
// centre line. Shared by both views: from this far away the front and back
// silhouettes look the same — only which muscles are drawn on top differs.
const BODY_DIAGRAM_SILHOUETTE_PATH =
  "M100,8 C89,8 82,16 82,29 C82,41 87,50 92,54 L92,62 " +                      // head, neck
  "C84,66 72,67 62,70 C51,73 45,82 43,95 " +                                  // shoulder
  "C41,112 39,132 38,150 C36,170 34,190 34,208 " +                            // outer arm
  "C31,218 30,232 33,240 C36,246 42,246 44,240 " +                            // hand
  "C45,230 46,220 47,210 C50,192 55,172 57,154 " +                            // inner forearm
  "C59,138 60,120 62,106 C62,102 63,100 64,100 " +                            // inner upper arm, armpit
  "C66,120 69,142 72,160 C72,172 68,184 66,196 " +                            // side of torso, hip
  "C63,214 62,236 66,258 C68,268 70,276 70,284 " +                            // outer thigh, knee
  "C66,298 63,312 65,326 C69,340 73,352 75,362 " +                            // outer calf, ankle
  "C72,368 68,374 70,378 C74,382 84,382 88,378 C89,372 89,366 88,360 " +      // foot
  "C90,346 93,332 94,318 C95,304 92,294 92,284 " +                            // inner calf
  "C94,266 97,244 98,224 C99,214 99,208 100,206 Z";                           // inner thigh

// Muscle shapes for the left half. Order matters where shapes touch:
// later ones are drawn on top of earlier ones.
const BODY_DIAGRAM_REGIONS = {
  front: [
    { muscle: "chest", path: "M98,76 C86,73 74,73 66,78 C62,86 62,98 66,106 C76,116 90,117 98,113 Z" },
    // Front delt is the part of the shoulder cap nearer the chest, side
    // delt the outer rim — drawn as two neighbouring slices so both stay
    // tappable.
    { muscle: "frontDelt", path: "M65,77 C58,76 53,80 51,88 C50,96 52,104 57,110 C60,100 62,88 65,77 Z" },
    { muscle: "sideDelt", path: "M62,71 C52,74 46,82 45,94 C45,102 47,108 50,112 C49,100 50,86 58,76 Z" },
    { muscle: "biceps", path: "M49,112 C44,122 43,138 45,148 C49,152 54,150 56,142 C58,130 59,118 58,110 C55,108 52,108 49,112 Z" },
    { muscle: "forearms", path: "M41,156 C38,172 36,190 36,204 C39,207 43,207 46,204 C49,188 53,172 55,158 C50,152 44,152 41,156 Z" },
    { muscle: "abs", path: "M98,120 C90,119 83,121 79,126 L79,168 C81,182 89,194 98,198 Z" },
    { muscle: "obliques", path: "M76,120 C71,123 68,130 69,140 C71,152 73,164 71,178 C73,184 75,188 77,190 L77,126 Z" },
    { muscle: "quads", path: "M68,204 C63,226 63,252 69,274 C75,281 85,281 90,274 C95,254 95,230 91,212 C85,206 76,204 68,204 Z" },
    { muscle: "adductors", path: "M92,210 C95,212 97,216 98,222 C97,236 95,250 92,262 C93,244 93,226 92,210 Z" }
  ],
  back: [
    { muscle: "traps", path: "M100,56 C97,60 94,62 92,63 C84,66 72,68 63,71 C74,76 85,84 91,96 C95,106 98,116 100,124 Z" },
    { muscle: "rearDelt", path: "M61,72 C51,74 45,83 44,95 C45,103 48,108 53,110 C55,98 59,86 66,78 Z" },
    { muscle: "upperBack", path: "M68,80 C78,85 86,92 89,102 C90,107 90,110 88,113 C80,113 72,110 66,104 C63,96 64,86 68,80 Z" },
    { muscle: "lats", path: "M64,104 C72,112 82,116 90,117 C93,130 92,146 88,162 C82,164 76,162 72,158 C70,140 67,122 64,104 Z" },
    { muscle: "lowerBack", path: "M98,128 C95,132 93,142 92,158 C91,170 91,180 93,188 L98,188 Z" },
    { muscle: "triceps", path: "M45,110 C42,122 42,138 44,148 C48,152 54,150 56,144 C58,130 59,118 59,108 C54,111 49,111 45,110 Z" },
    { muscle: "glutes", path: "M99,182 C88,179 75,183 69,193 C65,206 66,221 74,228 C84,233 94,231 99,225 Z" },
    { muscle: "hamstrings", path: "M70,236 C66,250 68,264 73,276 C79,281 86,281 90,276 C94,262 96,248 95,236 C88,239 78,239 70,236 Z" },
    { muscle: "calves", path: "M69,292 C63,304 63,318 69,332 C76,337 84,335 88,328 C93,316 93,302 90,292 C84,287 76,287 70,292 Z" }
  ]
};

// Purely decorative lines drawn over the muscles (the "six-pack" divisions
// across the abs). Not tappable, and they don't carry any data.
const BODY_DIAGRAM_DETAIL_PATHS = {
  front: "M80,138 L98,138 M80,153 L98,153 M80,168 L98,168",
  back: ""
};

// Colors for the parts of the drawing that aren't data. The muscle
// separation lines use the chart's own background color, so they read as
// thin gaps between muscles rather than as drawn outlines.
const BODY_DIAGRAM_SILHOUETTE_COLOR = "#242424";
const BODY_DIAGRAM_GAP_COLOR = "#1e1e1e";

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

// Builds the SVG for one half of the body — the silhouette, the muscles
// colored by this week's completion, and the decorative detail lines.
function buildBodyDiagramHalfSVG(view, rowsByMuscle) {
  const silhouetteSVG = `<path d="${BODY_DIAGRAM_SILHOUETTE_PATH}" fill="${BODY_DIAGRAM_SILHOUETTE_COLOR}" />`;

  // data-muscle plus a shared class is how the single click listener
  // below (added once, not per-shape) figures out which muscle a tap
  // landed on.
  const musclesSVG = BODY_DIAGRAM_REGIONS[view]
    .map((region) => {
      const fill = colorForMuscleCompletion(rowsByMuscle[region.muscle]);
      return `<path d="${region.path}" fill="${fill}" stroke="${BODY_DIAGRAM_GAP_COLOR}" stroke-width="1.5" stroke-linejoin="round" class="body-diagram-region" data-muscle="${region.muscle}" />`;
    })
    .join("");

  const detailPath = BODY_DIAGRAM_DETAIL_PATHS[view];
  // pointer-events="none" so a tap on a detail line still reaches the
  // muscle underneath it.
  const detailSVG = detailPath
    ? `<path d="${detailPath}" fill="none" stroke="${BODY_DIAGRAM_GAP_COLOR}" stroke-width="1.5" pointer-events="none" />`
    : "";

  return silhouetteSVG + musclesSVG + detailSVG;
}

function buildBodyDiagramSVG(view, muscleRows) {
  const rowsByMuscle = {};
  for (const row of muscleRows) {
    rowsByMuscle[row.muscle] = row;
  }

  const halfSVG = buildBodyDiagramHalfSVG(view, rowsByMuscle);

  // The second copy is flipped horizontally around x = 100: "scale x by -1"
  // mirrors it around x = 0, then "shift right by 200" moves it back into
  // view, landing each point at 200 - x.
  return `<svg viewBox="0 0 200 390" xmlns="http://www.w3.org/2000/svg">` +
    `<g>${halfSVG}</g>` +
    `<g transform="matrix(-1 0 0 1 200 0)">${halfSVG}</g>` +
    `</svg>`;
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

// One point per week that has data within the selected chart range (see
// getChartRangeStart), each the heaviest non-warmup set logged that week
// for this exercise.
// `gymId` (optional) restricts this to sets from sessions at that gym —
// used for a gym-specific exercise, so the chart doesn't mix load numbers
// that aren't comparable between locations.
function getWeeklyBestSets(exerciseId, gymId = null) {
  let workingSets = appState.database.sets.filter(
    (set) => set.exerciseId === exerciseId && !set.isWarmup && isWithinChartRange(set.performedAt)
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
  return sortedWeekKeys.map((weekKey) => bestByWeekKey.get(weekKey));
}

// Which points get a value and date written next to them. Points are now
// spaced by date, so they can bunch up anywhere; instead of a fixed count,
// a point is labelled when it's at least MINIMUM_LABEL_GAP away from the
// last labelled one. 85 is a little more than the widest date, like
// "30.12.2025", so neighbouring labels never touch. The newest point is always labelled,
// since it's the one people look at; if it's too close to the label before
// it, that earlier label makes way.
const MINIMUM_LABEL_GAP = 85;

function chooseLabelledPoints(points) {
  const labelledPoints = [points[0]];
  for (const point of points.slice(1)) {
    const previousLabelled = labelledPoints[labelledPoints.length - 1];
    if (point.x - previousLabelled.x >= MINIMUM_LABEL_GAP) {
      labelledPoints.push(point);
    }
  }

  const newestPoint = points[points.length - 1];
  const lastLabelled = labelledPoints[labelledPoints.length - 1];
  if (lastLabelled !== newestPoint) {
    if (newestPoint.x - lastLabelled.x < MINIMUM_LABEL_GAP && labelledPoints.length > 1) {
      labelledPoints.pop();
    }
    labelledPoints.push(newestPoint);
  }
  return labelledPoints;
}

// Builds a small hand-drawn line chart as an SVG string (no charting
// library — nothing can load from a CDN, per CLAUDE.md). `dataPoints` is
// `[{ label, value, date }]` from oldest to newest, `date` being an ISO
// string. Points are placed by date, not one step apart: a month without
// data shows as a long stretch of line with no dots, instead of looking
// just like one week.
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

  const firstTime = new Date(dataPoints[0].date).getTime();
  const lastTime = new Date(dataPoints[dataPoints.length - 1].date).getTime();
  // A single point (or several on the same moment) has no time span to
  // spread over, which would divide by zero; they sit at the left edge.
  const timeSpan = lastTime - firstTime;
  const points = dataPoints.map((point, index) => {
    const timeFraction = timeSpan > 0 ? (new Date(point.date).getTime() - firstTime) / timeSpan : 0;
    const x = padding.left + timeFraction * plotWidth;
    const y = padding.top + plotHeight - ((point.value - minValue) / valueRange) * plotHeight;
    return { x, y, point, index };
  });

  const pathData = points
    .map((p, index) => `${index === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  // Smaller dots once there are many, so they don't merge into a solid bar.
  const dotRadius = points.length > 30 ? 2 : 3.5;
  const circlesSVG = points
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotRadius}" fill="#2a6df4" />`)
    .join("");

  const labelledPoints = chooseLabelledPoints(points);

  // A label centered ("middle") on the first or last point would extend
  // past the chart's left/right edge and get clipped by the viewBox — so
  // edge points anchor to their own side instead, and only interior points
  // stay centered on their dot.
  function anchorFor(index) {
    if (index === 0) return "start";
    if (index === points.length - 1) return "end";
    return "middle";
  }

  const valueLabelsSVG = labelledPoints
    .map((p) => {
      // Clamps the label near the top of the chart instead of letting it
      // run off the edge when the point itself is close to the top.
      const labelY = Math.max(p.y - 8, 12);
      return `<text x="${p.x.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="11" fill="#f0f0f0" text-anchor="${anchorFor(p.index)}">${valueFormatter(p.point.value)}</text>`;
    })
    .join("");

  const axisLabelsSVG = labelledPoints
    .map((p) => `<text x="${p.x.toFixed(1)}" y="${height - 6}" font-size="10" fill="#9a9a9a" text-anchor="${anchorFor(p.index)}">${p.point.label}</text>`)
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
    // Same tags the exercise library uses — otherwise it's not obvious why
    // only some exercises' detail screens show a gym picker.
    buttonElement.append(buildExerciseNameWithTags(exercise));
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

  renderChartRangePicker(
    document.getElementById("exerciseStatsRangePicker"),
    () => renderExerciseStatsDetail(exerciseId)
  );

  const weeklyBestSets = getWeeklyBestSets(exerciseId, appState.exerciseStatsSelectedGymId);
  const emptyMessage = document.getElementById("exerciseStatsEmptyMessage");
  const chartsContainer = document.getElementById("exerciseStatsCharts");

  if (weeklyBestSets.length === 0) {
    // This screen is only reachable for an exercise with logged sets, so
    // an empty chart here always means "none in this range".
    emptyMessage.textContent = describeEmptyChartRange();
    emptyMessage.hidden = false;
    chartsContainer.hidden = true;
    return;
  }
  emptyMessage.hidden = true;
  chartsContainer.hidden = false;

  const weightPoints = weeklyBestSets.map((set) => ({
    label: formatSessionDate(set.performedAt),
    value: set.load,
    date: set.performedAt
  }));
  const repsPoints = weeklyBestSets.map((set) => ({
    label: formatSessionDate(set.performedAt),
    value: set.reps,
    date: set.performedAt
  }));

  document.getElementById("exerciseStatsWeightChart").innerHTML =
    buildLineChartSVG(weightPoints, (value) => `${value} kg`);
  document.getElementById("exerciseStatsRepsChart").innerHTML =
    buildLineChartSVG(repsPoints, (value) => `${value}`);
}

document.getElementById("viewExerciseStatsButton").addEventListener("click", showExerciseStatsListScreen);
document.getElementById("backFromExerciseStatsListButton").addEventListener("click", showStatsScreen);
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
document.getElementById("backFromPersonalBestsButton").addEventListener("click", showStatsScreen);


// ---------------------------------------------------------------------------
// Monthly recap — one calendar month summed up, a card per topic. Everything
// is worked out from data already stored; nothing new is saved.
// ---------------------------------------------------------------------------

function showMonthlyRecapScreen() {
  hideAllScreens();
  // Opens on the current month the first time, then remembers whichever
  // month was last looked at while the app stays open.
  if (appState.recapMonth === null) {
    const today = new Date();
    appState.recapMonth = { year: today.getFullYear(), monthIndex: today.getMonth() };
  }
  monthlyRecapScreen.hidden = false;
  renderMonthlyRecap();
}

// `start` is the first moment of the month (local time) and `end` the first
// moment of the next, so "in the month" is `start <= x && x < end`. new Date()
// rolls a monthIndex of 12 over into January of the next year by itself.
function getMonthRange(year, monthIndex) {
  return { start: new Date(year, monthIndex, 1), end: new Date(year, monthIndex + 1, 1) };
}

function isInRange(isoString, range) {
  const moment = new Date(isoString);
  return range.start <= moment && moment < range.end;
}

function findFinishedSessionsInRange(range) {
  return appState.database.sessions.filter(
    (session) => session.endedAt !== null && isInRange(session.startedAt, range)
  );
}

function findWorkingSetsOfSessions(sessions) {
  const sessionIds = new Set(sessions.map((session) => session.id));
  return appState.database.sets.filter((set) => sessionIds.has(set.sessionId) && !set.isWarmup);
}

// "+2 vs Aug", "−1 vs Aug", "same as Aug". Uses a real minus sign (−)
// rather than a hyphen, which reads better next to a number.
function describeChangeFromPreviousMonth(current, previous, previousMonthName) {
  const difference = current - previous;
  if (difference === 0) {
    return `same as ${previousMonthName}`;
  }
  const sign = difference > 0 ? "+" : "−";
  return `${sign}${formatSetCount(Math.abs(difference))} vs ${previousMonthName}`;
}

// "1 h 25 min" or "45 min".
function formatMinutes(totalMinutes) {
  const roundedMinutes = Math.round(totalMinutes);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

// Session length the same way the duration estimate measures it (start to
// last logged set), so ending a workout late doesn't count as training.
function getSessionMinutes(session) {
  return (new Date(findLastActivityTime(session)) - new Date(session.startedAt)) / 60000;
}

// One card: a title, an optional big headline, then plain lines of text.
function buildRecapCard(title, headline, lines) {
  const cardElement = document.createElement("div");
  cardElement.className = "history-card";

  const titleElement = document.createElement("div");
  titleElement.className = "history-card-header";
  titleElement.textContent = title;
  cardElement.appendChild(titleElement);

  if (headline) {
    const headlineElement = document.createElement("div");
    headlineElement.className = "recap-headline";
    headlineElement.textContent = headline;
    cardElement.appendChild(headlineElement);
  }

  for (const line of lines) {
    const lineElement = document.createElement("div");
    lineElement.className = "history-card-line";
    lineElement.textContent = line;
    cardElement.appendChild(lineElement);
  }
  return cardElement;
}

// How many times each workout template was done: ["Weekly workout 1 × 4", ...].
function describeWorkoutsByTemplate(sessions) {
  const countByName = new Map();
  for (const session of sessions) {
    const template = appState.database.workoutTemplates.find((candidate) => candidate.id === session.templateId);
    const name = describeWorkoutKind(session, template);
    countByName.set(name, (countByName.get(name) || 0) + 1);
  }
  return Array.from(countByName.entries()).map(([name, count]) => `${name} × ${count}`);
}

function buildWorkoutsRecapCard(sessions, previousSessions, previousMonthName) {
  const headline = `${sessions.length} workout${sessions.length === 1 ? "" : "s"}`;
  const lines = [describeChangeFromPreviousMonth(sessions.length, previousSessions.length, previousMonthName)];
  return buildRecapCard("Workouts", headline, lines.concat(describeWorkoutsByTemplate(sessions)));
}

function buildTimeRecapCard(sessions) {
  const totalMinutes = sessions.reduce((sum, session) => sum + getSessionMinutes(session), 0);
  return buildRecapCard("Time training", formatMinutes(totalMinutes), [
    `${formatMinutes(totalMinutes / sessions.length)} per workout on average`
  ]);
}

function buildSetsRecapCard(workingSets, previousWorkingSets, previousMonthName) {
  return buildRecapCard("Working sets", `${workingSets.length} sets`, [
    describeChangeFromPreviousMonth(workingSets.length, previousWorkingSets.length, previousMonthName)
  ]);
}

// Weighted the same way as the muscle counters: 1 set for the main muscle,
// 0.5 for each secondary one. Busiest muscle first.
function buildMusclesRecapCard(workingSets) {
  const setsByMuscle = {};
  for (const set of workingSets) {
    const exercise = appState.database.exercises.find((candidate) => candidate.id === set.exerciseId);
    for (const [muscle, weight] of Object.entries(exercise.muscles)) {
      setsByMuscle[muscle] = (setsByMuscle[muscle] || 0) + weight;
    }
  }
  const lines = Object.entries(setsByMuscle)
    .sort((a, b) => b[1] - a[1])
    .map(([muscle, count]) => `${MUSCLE_GROUP_LABELS[muscle]}: ${formatSetCount(count)}`);
  return lines.length > 0 ? buildRecapCard("Sets per muscle", null, lines) : null;
}

// Exercises whose heaviest-ever working load was beaten during the month,
// as "Barbell bench press: 85 kg (was 82.5 kg)". Walks each exercise's sets
// in the order they happened, keeping the best load seen so far, so "was"
// is the record as it stood when the month began. The very first time an
// exercise is ever done isn't a record: there was nothing to beat. A
// gym-specific exercise keeps a separate best per gym, for the same reason
// as its stats charts: machine numbers aren't comparable between gyms.
function findWeightRecordsInRange(range) {
  const gymIdBySessionId = new Map(appState.database.sessions.map((session) => [session.id, session.gymId]));
  const records = [];

  for (const exercise of appState.database.exercises) {
    const exerciseSets = appState.database.sets
      .filter((set) => set.exerciseId === exercise.id && !set.isWarmup)
      .sort((a, b) => a.performedAt.localeCompare(b.performedAt));

    const bestLoadByGym = new Map();
    let monthRecord = null;
    for (const set of exerciseSets) {
      const gymKey = exercise.isGymSpecific ? gymIdBySessionId.get(set.sessionId) : "anyGym";
      const bestSoFar = bestLoadByGym.get(gymKey);
      const beatsRecord = bestSoFar !== undefined && set.load > bestSoFar;
      if (beatsRecord && isInRange(set.performedAt, range)) {
        // Several records in one month: keep the heaviest, but remember
        // the record from before the first of them.
        const previousRecord = monthRecord ? monthRecord.previousRecord : bestSoFar;
        if (!monthRecord || set.load > monthRecord.load) {
          monthRecord = { exerciseName: exercise.name, load: set.load, previousRecord };
        }
      }
      if (bestSoFar === undefined || set.load > bestSoFar) {
        bestLoadByGym.set(gymKey, set.load);
      }
    }
    if (monthRecord) {
      records.push(monthRecord);
    }
  }
  return records;
}

function buildWeightRecordsRecapCard(range) {
  const records = findWeightRecordsInRange(range);
  if (records.length === 0) {
    return null;
  }
  const lines = records.map(
    (record) => `${record.exerciseName}: ${record.load} kg (was ${record.previousRecord} kg)`
  );
  return buildRecapCard("Weight records", `${records.length} new`, lines);
}

function buildBodyweightRecapCard(range) {
  const entries = appState.database.bodyweightEntries
    .filter((entry) => isInRange(entry.loggedAt, range))
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  if (entries.length === 0) {
    return null;
  }
  const first = entries[0].weightKg;
  const last = entries[entries.length - 1].weightKg;
  if (entries.length === 1) {
    return buildRecapCard("Bodyweight", `${last.toFixed(1)} kg`, ["One weigh-in this month"]);
  }
  // toFixed(1) also tidies floating-point leftovers like 0.29999999.
  const change = last - first;
  const changeText = change === 0 ? "no change" : `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)} kg`;
  return buildRecapCard("Bodyweight", `${first.toFixed(1)} → ${last.toFixed(1)} kg`, [
    `${changeText} over ${entries.length} weigh-ins`
  ]);
}

// Average readiness as the headline, then only the reasons that say
// something (not "Normal"), plus how many workouts never got a readiness
// answer, so a quiet card isn't mistaken for "all fine". A missing reason
// isn't counted: since version 14 no reason is the usual case, not a gap.
function buildDayStatusRecapCard(sessions) {
  const answeredReadiness = sessions
    .filter((session) => session.readiness !== null)
    .map((session) => session.readiness);
  const averageReadinessText = answeredReadiness.length > 0
    ? `Readiness ${formatAverage(answeredReadiness)}/${CHECK_IN_SCALE_MAX}`
    : null;
  const lines = [];
  for (const status of DAY_STATUSES) {
    if (status === "normal") {
      continue;
    }
    const count = sessions.filter((session) => session.dayStatus === status).length;
    if (count > 0) {
      lines.push(`${DAY_STATUS_LABELS[status]}: ${count}`);
    }
  }
  const unansweredCount = sessions.length - answeredReadiness.length;
  if (unansweredCount > 0) {
    lines.push(`Readiness not answered: ${unansweredCount}`);
  }
  if (lines.length === 0) {
    lines.push("No poor-sleep, ill or stressed days logged");
  }
  return buildRecapCard("Day status", averageReadinessText, lines);
}

// One decimal place, e.g. 3.6; enough to see a month-to-month change
// without pretending to more precision than 1-5 answers have.
function formatAverage(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(1);
}

function renderMonthlyRecapMonthPicker() {
  const { year, monthIndex } = appState.recapMonth;
  document.getElementById("recapMonthName").textContent =
    new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  // No stepping into the future: there's nothing to recap there yet.
  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && monthIndex === today.getMonth();
  document.getElementById("nextRecapMonthButton").disabled = isCurrentMonth;
}

function renderMonthlyRecap() {
  renderMonthlyRecapMonthPicker();
  const cardsElement = document.getElementById("monthlyRecapCards");
  cardsElement.innerHTML = "";

  const { year, monthIndex } = appState.recapMonth;
  const range = getMonthRange(year, monthIndex);
  const previousRange = getMonthRange(year, monthIndex - 1);
  const previousMonthName = previousRange.start.toLocaleDateString(undefined, { month: "short" });

  const sessions = findFinishedSessionsInRange(range);
  const previousSessions = findFinishedSessionsInRange(previousRange);
  const workingSets = findWorkingSetsOfSessions(sessions);
  const previousWorkingSets = findWorkingSetsOfSessions(previousSessions);

  const cards = [];
  if (sessions.length === 0) {
    cards.push(buildRecapCard("Workouts", "No workouts", [
      describeChangeFromPreviousMonth(0, previousSessions.length, previousMonthName)
    ]));
  } else {
    cards.push(buildWorkoutsRecapCard(sessions, previousSessions, previousMonthName));
    cards.push(buildTimeRecapCard(sessions));
    cards.push(buildSetsRecapCard(workingSets, previousWorkingSets, previousMonthName));
    cards.push(buildMusclesRecapCard(workingSets));
    cards.push(buildWeightRecordsRecapCard(range));
    cards.push(buildDayStatusRecapCard(sessions));
  }
  cards.push(buildCardioRecapCard(range));
  cards.push(buildCheckInRecapCard(range));
  cards.push(buildBodyweightRecapCard(range));

  // Builders return null for a card with nothing to show.
  for (const card of cards.filter((candidate) => candidate !== null)) {
    cardsElement.appendChild(card);
  }
}

// Steps the recap one month back (-1) or forward (+1). Going through a Date
// lets it handle the year boundary (January back to December) by itself.
function stepRecapMonth(monthStep) {
  const { year, monthIndex } = appState.recapMonth;
  const steppedMonth = new Date(year, monthIndex + monthStep, 1);
  appState.recapMonth = { year: steppedMonth.getFullYear(), monthIndex: steppedMonth.getMonth() };
  renderMonthlyRecap();
}

// "Rower: 3 sessions · 1 h 45 min · 15.9 km" for one activity in the month.
// Distance only counts the sessions where it was recorded, and is left out
// entirely when none of them have it.
function describeCardioActivityForMonth(activity, cardioSessions) {
  const totalMinutes = cardioSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const parts = [
    `${cardioSessions.length} session${cardioSessions.length === 1 ? "" : "s"}`,
    formatMinutes(totalMinutes)
  ];
  const sessionsWithDistance = cardioSessions.filter((session) => session.distanceKm !== null);
  if (sessionsWithDistance.length > 0) {
    const totalKm = sessionsWithDistance.reduce((sum, session) => sum + session.distanceKm, 0);
    // toFixed(1) also tidies floating-point leftovers from adding decimals.
    parts.push(`${totalKm.toFixed(1)} km`);
  }
  return `${activity.name}: ${parts.join(" · ")}`;
}

// Cardio for the month: how many sessions and how long in total, then one
// line per activity, most-done first.
function buildCardioRecapCard(range) {
  const monthSessions = appState.database.cardioSessions.filter((session) => isInRange(session.performedAt, range));
  if (monthSessions.length === 0) {
    return null;
  }

  const lines = [];
  for (const activity of appState.database.cardioActivities) {
    const activitySessions = monthSessions.filter((session) => session.activityId === activity.id);
    if (activitySessions.length > 0) {
      lines.push({ count: activitySessions.length, text: describeCardioActivityForMonth(activity, activitySessions) });
    }
  }
  lines.sort((a, b) => b.count - a.count);

  const totalMinutes = monthSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const headline = `${monthSessions.length} session${monthSessions.length === 1 ? "" : "s"} · ${formatMinutes(totalMinutes)}`;
  return buildRecapCard("Cardio", headline, lines.map((line) => line.text));
}

// The average of each rating over the check-ins for weeks starting in this
// month. "Fatigue 3.2" means more to the eye than a list of weeks.
function buildCheckInRecapCard(range) {
  const checkIns = appState.database.weeklyCheckIns.filter((checkIn) => {
    const weekStart = parseLocalDateKey(checkIn.weekStart);
    return range.start <= weekStart && weekStart < range.end;
  });
  if (checkIns.length === 0) {
    return null;
  }
  const lines = CHECK_IN_RATINGS.map((rating) => {
    const total = checkIns.reduce((sum, checkIn) => sum + checkIn[rating], 0);
    return `${CHECK_IN_RATING_LABELS[rating]}: ${(total / checkIns.length).toFixed(1)} on average`;
  });
  const headline = `${checkIns.length} check-in${checkIns.length === 1 ? "" : "s"}`;
  return buildRecapCard("Weekly check-ins", headline, lines);
}

document.getElementById("viewMonthlyRecapButton").addEventListener("click", showMonthlyRecapScreen);
document.getElementById("backFromMonthlyRecapButton").addEventListener("click", showStatsScreen);
document.getElementById("previousRecapMonthButton").addEventListener("click", () => stepRecapMonth(-1));
document.getElementById("nextRecapMonthButton").addEventListener("click", () => stepRecapMonth(1));


// ---------------------------------------------------------------------------
// Weekly check-in — fatigue, stress, motivation and recovery, 1 to 5, once
// a week (see WeeklyCheckIn in schema.js). The home screen shows a reminder
// every day until this week's is answered.
// ---------------------------------------------------------------------------

const CHECK_IN_RATING_LABELS = {
  fatigue: "Fatigue",
  stress: "Stress",
  motivation: "Motivation",
  recovery: "Recovery"
};

const weeklyCheckInHeading = document.getElementById("weeklyCheckInHeading");
const checkInRatingRowsElement = document.getElementById("checkInRatingRows");
const checkInNotesInput = document.getElementById("checkInNotesInput");
const saveWeeklyCheckInButton = document.getElementById("saveWeeklyCheckInButton");
const cancelCheckInEditButton = document.getElementById("cancelCheckInEditButton");

// This week's Monday as "YYYY-MM-DD" in local time. getLocalDateKey rather
// than getWeekKey: getWeekKey goes through UTC, which in Finland turns
// Monday midnight into Sunday's date. Fine as an internal key, but this one
// is saved in the data and should say the actual Monday.
function getCurrentWeekStartKey() {
  return getLocalDateKey(getCurrentWeekRange().start);
}

// The reverse of getLocalDateKey. Splitting the string by hand instead of
// new Date("2026-09-21"), which JavaScript reads as UTC midnight and can
// land on the previous day in local time.
function parseLocalDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// "21.9.–27.9." (in the phone's own date style).
function describeWeek(weekStart) {
  const monday = parseLocalDateKey(weekStart);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const format = (date) => date.toLocaleDateString(undefined, { day: "numeric", month: "numeric" });
  return `${format(monday)}–${format(sunday)}`;
}

function findCheckInForWeek(weekStart) {
  return appState.database.weeklyCheckIns.find((checkIn) => checkIn.weekStart === weekStart);
}

function renderWeeklyCheckInPrompt() {
  document.getElementById("weeklyCheckInPrompt").hidden = findCheckInForWeek(getCurrentWeekStartKey()) !== undefined;
}

// Loads a week into the form: its saved answers if it has a check-in
// already, otherwise blank ratings waiting to be tapped.
function startCheckInDraft(weekStart) {
  const existing = findCheckInForWeek(weekStart);
  appState.checkInDraft = { weekStart, notes: existing ? existing.notes : "" };
  for (const rating of CHECK_IN_RATINGS) {
    appState.checkInDraft[rating] = existing ? existing[rating] : null;
  }
}

function showWeeklyCheckInScreen(isOpenedFromStats) {
  hideAllScreens();
  appState.isCheckInOpenedFromStats = isOpenedFromStats;
  startCheckInDraft(getCurrentWeekStartKey());
  weeklyCheckInScreen.hidden = false;
  renderWeeklyCheckInScreen();
}

function leaveWeeklyCheckInScreen() {
  appState.checkInDraft = null;
  if (appState.isCheckInOpenedFromStats) {
    showStatsScreen();
  } else {
    showMainScreen();
  }
}

// Built once from CHECK_IN_RATINGS (schema.js), same reasoning as the
// day-status options: the screen can't drift from the schema's own list.
for (const rating of CHECK_IN_RATINGS) {
  const rowElement = document.createElement("div");
  rowElement.className = "check-in-rating-row";

  const labelElement = document.createElement("span");
  labelElement.className = "check-in-rating-label";
  labelElement.textContent = CHECK_IN_RATING_LABELS[rating];
  rowElement.appendChild(labelElement);

  const buttonsElement = document.createElement("div");
  buttonsElement.className = "check-in-rating-buttons";
  for (let value = CHECK_IN_SCALE_MIN; value <= CHECK_IN_SCALE_MAX; value++) {
    const valueButton = document.createElement("button");
    valueButton.type = "button";
    valueButton.className = "day-status-option";
    valueButton.textContent = value;
    valueButton.dataset.rating = rating;
    valueButton.dataset.value = value;
    valueButton.addEventListener("click", () => {
      appState.checkInDraft[rating] = value;
      renderWeeklyCheckInScreen();
    });
    buttonsElement.appendChild(valueButton);
  }
  rowElement.appendChild(buttonsElement);
  checkInRatingRowsElement.appendChild(rowElement);
}

function isCheckInDraftComplete() {
  return CHECK_IN_RATINGS.every((rating) => appState.checkInDraft[rating] !== null);
}

function renderWeeklyCheckInScreen() {
  const draft = appState.checkInDraft;
  const isThisWeek = draft.weekStart === getCurrentWeekStartKey();
  weeklyCheckInHeading.textContent = isThisWeek
    ? `This week · ${describeWeek(draft.weekStart)}`
    : `Week of ${describeWeek(draft.weekStart)}`;

  for (const valueButton of checkInRatingRowsElement.querySelectorAll("button")) {
    // dataset values are always strings, hence Number() before comparing.
    const isSelected = draft[valueButton.dataset.rating] === Number(valueButton.dataset.value);
    valueButton.classList.toggle("day-status-option-selected", isSelected);
  }

  checkInNotesInput.value = draft.notes;
  saveWeeklyCheckInButton.disabled = !isCheckInDraftComplete();
  cancelCheckInEditButton.hidden = isThisWeek;
  renderWeeklyCheckInList();
}

// "Fatigue 3 · Stress 2 · Motivation 4 · Recovery 3"
function describeCheckInRatings(checkIn) {
  return CHECK_IN_RATINGS.map((rating) => `${CHECK_IN_RATING_LABELS[rating]} ${checkIn[rating]}`).join(" · ");
}

function renderWeeklyCheckInList() {
  const listElement = document.getElementById("weeklyCheckInList");
  listElement.innerHTML = "";

  if (appState.database.weeklyCheckIns.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "No check-ins yet.";
    listElement.appendChild(emptyMessage);
    return;
  }

  // "YYYY-MM-DD" strings sort by date as plain text; reversed for newest first.
  const newestFirst = appState.database.weeklyCheckIns
    .slice()
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  for (const checkIn of newestFirst) {
    const itemElement = document.createElement("li");
    const buttonElement = document.createElement("button");
    buttonElement.type = "button";
    buttonElement.className = "check-in-list-item";
    buttonElement.textContent = describeWeek(checkIn.weekStart);

    const detailElement = document.createElement("span");
    detailElement.textContent = describeCheckInRatings(checkIn) + (checkIn.notes ? ` — ${checkIn.notes}` : "");
    buttonElement.appendChild(detailElement);

    // Tapping loads that week into the form above, to correct it.
    buttonElement.addEventListener("click", () => {
      startCheckInDraft(checkIn.weekStart);
      renderWeeklyCheckInScreen();
      window.scrollTo(0, 0);
    });
    itemElement.appendChild(buttonElement);
    listElement.appendChild(itemElement);
  }
}

// One check-in per week: saving over a week that already has one updates
// it in place (keeping its id), rather than adding a second.
function saveCheckInDraft() {
  const draft = appState.checkInDraft;
  const ratings = {};
  for (const rating of CHECK_IN_RATINGS) {
    ratings[rating] = draft[rating];
  }

  const existing = findCheckInForWeek(draft.weekStart);
  if (existing) {
    Object.assign(existing, ratings, { notes: draft.notes, loggedAt: new Date().toISOString() });
  } else {
    appState.database.weeklyCheckIns.push({
      id: crypto.randomUUID(),
      weekStart: draft.weekStart,
      loggedAt: new Date().toISOString(),
      ...ratings,
      notes: draft.notes
    });
  }
  saveDatabase(appState.database);
}

checkInNotesInput.addEventListener("input", () => {
  appState.checkInDraft.notes = checkInNotesInput.value;
});

// From the home screen's reminder, saving is the end of the errand, so it
// goes straight back home (where the reminder is now gone). From Stats,
// it stays here with the list updated, back on this week's form.
saveWeeklyCheckInButton.addEventListener("click", () => {
  saveCheckInDraft();
  if (!appState.isCheckInOpenedFromStats) {
    leaveWeeklyCheckInScreen();
    return;
  }
  startCheckInDraft(getCurrentWeekStartKey());
  renderWeeklyCheckInScreen();
});

cancelCheckInEditButton.addEventListener("click", () => {
  startCheckInDraft(getCurrentWeekStartKey());
  renderWeeklyCheckInScreen();
});

document.getElementById("openWeeklyCheckInButton").addEventListener("click", () => showWeeklyCheckInScreen(false));
document.getElementById("viewWeeklyCheckInsButton").addEventListener("click", () => showWeeklyCheckInScreen(true));
document.getElementById("backFromWeeklyCheckInButton").addEventListener("click", leaveWeeklyCheckInScreen);


// ---------------------------------------------------------------------------
// Muscle stats — a per-muscle trend chart extending the main screen's
// "this week" counter across the last several weeks, same weighted-sets
// computation (1.0 main muscle, 0.5 secondary) applied per week instead of
// just the current one.
// ---------------------------------------------------------------------------

// One point per week that has data (most recent `weekCount` such weeks):
// the total weighted sets for `muscle` across every exercise that has it,
// summed from that week's non-warmup sets.
function getWeeklyMuscleSetCounts(muscle) {
  const countsByWeekKey = new Map();

  for (const set of appState.database.sets) {
    if (set.isWarmup || !isWithinChartRange(set.performedAt)) {
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
  return sortedWeekKeys.map((weekKey) => ({
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

  renderChartRangePicker(
    document.getElementById("muscleStatsRangePicker"),
    () => renderMuscleStatsDetail(muscle)
  );

  const weeklyCounts = getWeeklyMuscleSetCounts(muscle);
  const emptyMessage = document.getElementById("muscleStatsEmptyMessage");
  const chartContainer = document.getElementById("muscleStatsChartContainer");

  if (weeklyCounts.length === 0) {
    // Only muscles with logged sets are listed, so empty means "none in
    // this range".
    emptyMessage.textContent = describeEmptyChartRange();
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
    value: entry.value,
    date: entry.weekKey
  }));

  document.getElementById("muscleStatsChart").innerHTML =
    buildLineChartSVG(points, (value) => formatSetCount(value));
}

document.getElementById("viewMuscleStatsButton").addEventListener("click", showMuscleStatsListScreen);
document.getElementById("backFromMuscleStatsListButton").addEventListener("click", showStatsScreen);
document.getElementById("backFromMuscleStatsDetailButton").addEventListener("click", showMuscleStatsListScreen);


// ---------------------------------------------------------------------------
// TEMPORARY (deload step 2): drop-detection test view on Muscle stats.
//
// Shows what deload.js sees, one line per muscle, so the rules can be
// checked against real training before they suggest anything. Remove this
// section, and #dropDetectionReadout in index.html, when suggestions ship.
// ---------------------------------------------------------------------------

function describeSlotForReadout(templateId, exerciseId) {
  const template = appState.database.workoutTemplates.find((candidate) => candidate.id === templateId);
  const exercise = findExerciseById(exerciseId);
  return `${template ? template.name : "?"} · ${exercise ? exercise.name : "?"}`;
}

const NOISE_POOL_LABELS = { standard: "standard slots", highRep: "high-rep slots" };

function describeNoisePoolForReadout(pool, noise) {
  if (noise.sigmaHat === null) {
    return `Noise, ${NOISE_POOL_LABELS[pool]}: not active yet, ${noise.pairCount} of ${DROP_MIN_NOISE_PAIRS} session pairs.`;
  }
  return `Noise, ${NOISE_POOL_LABELS[pool]}: ${(noise.sigmaHat * 100).toFixed(1)}% from ${noise.pairCount} session pairs.`;
}

const KEY_STATUS_TEXTS = {
  noRecentData: () => "no usable sets lately",
  collecting: (usableSessions) => `collecting data (${Math.min(usableSessions, DROP_SESSIONS_NEEDED)}/${DROP_SESSIONS_NEEDED} sessions)`,
  waitingForNoise: () => "enough sessions, waiting for the noise estimate",
  watching: () => "watching"
};

// "Treeni 1 · Bench: watching" for each of a muscle's exercises. A gym
// swap or a second gym's machine shows as its own line, since it keeps
// its own history.
function describeKeyForReadout(key) {
  if (key.timeline === null) {
    const slotText = describeSlotForReadout(key.slot.templateId, key.slot.exerciseId);
    return `${slotText}: ${KEY_STATUS_TEXTS[key.status](key.usableSessions)}`;
  }
  const slotText = describeSlotForReadout(key.timeline.templateId, key.timeline.performedExerciseId);
  const gym = appState.database.gyms.find((candidate) => candidate.id === key.timeline.gymId);
  const gymText = key.timeline.gymId === null ? "" : ` (${gym ? gym.name : "no gym recorded"})`;
  return `${slotText}${gymText}: ${KEY_STATUS_TEXTS[key.status](key.usableSessions)}`;
}

function describeMuscleForReadout(analysis) {
  const name = MUSCLE_GROUP_LABELS[analysis.muscle];
  if (analysis.mainSlotCount === 0) {
    return `${name}: no exercise gives a usable strength estimate, so only whole-body deloads apply.`;
  }
  if (!analysis.isDropTested) {
    return `${name}: one main exercise slot, so only whole-body deloads apply.`;
  }
  const parts = analysis.keys.map(describeKeyForReadout);
  for (const flag of analysis.pendingFlags) {
    const slotText = describeSlotForReadout(flag.timeline.templateId, flag.timeline.performedExerciseId);
    parts.push(`flagged ${formatShortDate(flag.at)} (${slotText}), waiting for ${DROP_PERSISTENCE_SESSIONS} more sessions`);
  }
  const latestConfirmation = analysis.confirmations[analysis.confirmations.length - 1];
  if (latestConfirmation) {
    parts.push(`drop confirmed ${formatShortDate(latestConfirmation.at)} (${latestConfirmation.route}, ${analysis.confirmations.length} in all)`);
  }
  return `${name}: ${parts.join("; ")}.`;
}

function renderDropDetectionReadout() {
  const listElement = document.getElementById("dropDetectionReadoutList");
  listElement.innerHTML = "";
  const { noiseByPool, muscles } = analyzeDropDetection(appState.database);
  const lines = [
    `e1RM from sets with reps + RIR ≤ ${DROP_E1RM_MAX_REPS_PLUS_RIR}.`,
    describeNoisePoolForReadout("standard", noiseByPool.standard),
    describeNoisePoolForReadout("highRep", noiseByPool.highRep)
  ];
  const sortedMuscles = muscles.sort((a, b) =>
    MUSCLE_GROUP_LABELS[a.muscle].localeCompare(MUSCLE_GROUP_LABELS[b.muscle])
  );
  for (const analysis of sortedMuscles) {
    lines.push(describeMuscleForReadout(analysis));
  }
  for (const line of lines) {
    const itemElement = document.createElement("li");
    itemElement.textContent = line;
    listElement.appendChild(itemElement);
  }
}

workoutTemplateNameInput.addEventListener("input", () => {
  appState.workoutTemplateDraft.name = workoutTemplateNameInput.value;
});

document.getElementById("addPlannedExerciseButton").addEventListener("click", () => {
  appState.exercisePickerPurpose = "workoutTemplate";
  exercisePickerScreen.hidden = false;
  workoutTemplateEditorScreen.hidden = true;
  renderExercisePicker();
});

document.getElementById("saveWorkoutTemplateButton").addEventListener("click", () => {
  const draft = appState.workoutTemplateDraft;

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
  appState.workoutTemplateDraft = null;
  renderStartWorkoutChoices();
  showWorkoutTemplatesScreen();
});

document.getElementById("cancelWorkoutTemplateEditButton").addEventListener("click", () => {
  appState.workoutTemplateDraft = null;
  showWorkoutTemplatesScreen();
});
