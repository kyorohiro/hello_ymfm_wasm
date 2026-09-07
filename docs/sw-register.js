(function () {
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
