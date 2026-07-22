const CACHE_NAME = "one-ai-v1";

const urlsToCache = [
  "/",
  "/one-ai.html",
  "/manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", event => {

  // 🚫 Never cache Firebase or Google API requests
  if (
    event.request.url.includes("firebase") ||
    event.request.url.includes("googleapis.com") ||
    event.request.url.includes("gstatic.com")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );

});
