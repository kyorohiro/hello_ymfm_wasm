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

  function buildUrl(id, mode, expanded = false) {
    const encoded = encodeURIComponent(toBase64(sourceFor(id)));
    const modeParam = mode ? `mode=${mode}&` : "";
    return `../playground/index.html?${modeParam}${expanded ? "expanded=1&" : ""}src=${encoded}`;
  }

  document.querySelectorAll("iframe[data-playground-src]").forEach((iframe) => {
    const mode = iframe.dataset.playgroundMode || "simple";
    // Keep all tabs available while using the iframe area for the editor.
    iframe.src = buildUrl(iframe.dataset.playgroundSrc, mode, mode === "full");
  });

  document.querySelectorAll("a[data-playground-src]").forEach((link) => {
    link.href = buildUrl(link.dataset.playgroundSrc, link.dataset.playgroundMode || "");
  });
})();
