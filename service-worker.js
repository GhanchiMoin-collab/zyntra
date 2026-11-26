const CACHE_NAME = "zyntra-ai-v9";
const APP_SHELL = [
    "/",
    "/index.html",
    "/style.css",
    "/script.js",
    "/creations.js",
    "/skills.js",
    "/actions.js",
    "/favicon.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);

    // Never intercept API calls — those must always hit the network live.
    if (url.pathname.startsWith("/api/")) return;

    // Never intercept video/audio streaming or Range requests (Zyntra Moments plays videos from
    // Cloud Storage). Caching those would fill the browser's storage quota with partial video data.
    if (event.request.headers.has("range")) return;
    if (event.request.destination === "video" || event.request.destination === "audio") return;
    if (url.hostname === "storage.googleapis.com" || url.hostname.endsWith(".firebasestorage.app")) return;

    // Network-first: always try to get the freshest deployed version while
    // online. The cache is only a fallback for when the network request
    // fails (e.g. the user is offline), not the default source of truth.
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Only keep complete, successful responses (never partial 206s or errors).
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
