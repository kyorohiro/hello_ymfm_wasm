// Loads Playground iframe/link targets from readable <script type="text/plain">
// code blocks instead of hand-encoded base64 query strings.
//
// Usage:
//   <script type="text/plain" id="example-foo">...source...</script>
//   <iframe data-playground-src="example-foo" ...></iframe>
//   <a data-playground-src="example-foo" ...>Open in full Playground</a>
(function () {
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function sourceFor(id) {
    const node = document.getElementById(id);
    return node ? node.textContent.trim() : "";
  }

  function buildUrl(id, mode) {
    const encoded = encodeURIComponent(toBase64(sourceFor(id)));
    const modeParam = mode ? `mode=${mode}&` : "";
    return `../playground/index.html?${modeParam}src=${encoded}`;
  }

  document.querySelectorAll("iframe[data-playground-src]").forEach((iframe) => {
    iframe.src = buildUrl(iframe.dataset.playgroundSrc, iframe.dataset.playgroundMode || "simple");
  });

  document.querySelectorAll("a[data-playground-src]").forEach((link) => {
    link.href = buildUrl(link.dataset.playgroundSrc, link.dataset.playgroundMode || "");
  });
})();
