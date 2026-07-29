const LEGACY_CACHE_PREFIX = "dreamhome-";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(LEGACY_CACHE_PREFIX))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Static caching is handled by the hosting edge. This worker intentionally
// avoids intercepting requests so an old app shell cannot pin stale bundles.
