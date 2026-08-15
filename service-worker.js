const CACHE_NAME = "zyntra-ai-v3";
const APP_SHELL = [
    "/",
    "/index.html",
    "/style.css",
    "/script.js",
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

    // Network-first: always try to get the freshest deployed version while
    // online. The cache is only a fallback for when the network request
    // fails (e.g. the user is offline), not the default source of truth.
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
