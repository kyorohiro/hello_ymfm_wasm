const CACHE_NAME = "hello-ymfm-docs-v1";
const APP_ROOTS = ["/playground/", "/synth/", "/vgm_analyzer/"];

function isAppRequest(url) {
  return APP_ROOTS.some((root) => url.pathname.includes(root));
}

self.addEventListener("install", () => {});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("hello-ymfm-docs-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !isAppRequest(url)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
