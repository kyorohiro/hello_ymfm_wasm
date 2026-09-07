(function () {
  async function resetOfflineCache() {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("hello-ymfm-docs-")).map((key) => caches.delete(key))
    );
    const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    window.location.reload();
  }

  window.resetOfflineCache = resetOfflineCache;
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-reset-offline-cache]");
    if (!button || !window.confirm("Clear the offline cache and reload this app?")) return;
    button.disabled = true;
    resetOfflineCache().catch((error) => {
      button.disabled = false;
      console.error("Failed to reset offline cache:", error);
    });
  });

  if (!("serviceWorker" in navigator)) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("no-sw") === "1") {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("../sw.js", { scope: "../" })
      .catch((error) => console.warn("Service Worker registration failed; continuing online:", error));
  });
})();
