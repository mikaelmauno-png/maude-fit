// Service worker: caches the app's own files so it still loads with no
// signal, which matters since this is meant to be used mid-workout at a
// gym. This app has no build step and no external dependencies, so "the
// app" is just this fixed list of files — nothing dynamic to cache
// selectively.
//
// Bump this version whenever any cached file below changes. The cache name
// is how a returning visitor's stale copy gets replaced with the new one —
// without bumping it, "install" below sees the old cache already exists and
// never re-fetches anything, so a code change would never actually reach a
// phone that already has the app installed.
const CACHE_NAME = "treeniappi-v4";

const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./schema.js",
  "./progression.js",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  // Take over immediately instead of waiting for every open tab to close —
  // a workout logger someone is relying on right now shouldn't need a full
  // browser restart just to pick up a new version.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Old cache versions are useless once a new one is installed, and would
  // otherwise just sit there taking up phone storage indefinitely.
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Cache-first: serve straight from the cache when a file is there, and only
// hit the network for anything that isn't (there shouldn't be anything —
// the app has no other files). A gym's signal is unreliable enough that
// "loads instantly, might be a version behind until the cache is bumped"
// beats "always latest, sometimes doesn't load at all".
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request))
  );
});
