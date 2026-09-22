// ---------------------------------------------------------------------------
// App logic for the workout logger.
//
// All reading and writing of saved data happens through the functions in
// schema.js (loadDatabase, saveDatabase, exportDatabase, importDatabase).
// This file only holds UI behaviour: what's on screen and what happens when
// the user taps something.
// ---------------------------------------------------------------------------

// The one piece of state this file keeps track of: whatever database is
// currently loaded. Everything else works off this variable instead of
// re-reading localStorage in the middle of unrelated functions.
let database = loadDatabase();

// On a brand-new install the exercise library is empty. Fill it with the
// starter list once, and save immediately so a page refresh doesn't lose it
// (loadDatabase() would otherwise just return an empty list again).
if (database.exercises.length === 0) {
  database.exercises = STARTER_EXERCISES;
  saveDatabase(database);
}

// Rebuild the on-screen exercise list from whatever is currently in
// `database`. Called once on load, and again after a successful import,
// since import can replace the whole list.
function renderExerciseList() {
  const listElement = document.getElementById("exerciseList");

  // Clear out whatever was there before rebuilding it.
  listElement.innerHTML = "";

  for (const exercise of database.exercises) {
    const itemElement = document.createElement("li");
    itemElement.textContent = exercise.name;
    listElement.appendChild(itemElement);
  }
}

renderExerciseList();

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
      database = importDatabase(fileText);
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
