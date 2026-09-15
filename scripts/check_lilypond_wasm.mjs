// Execute the shipped browser worker with a Node file-backed fetch/self shim.
// This checks the real WASM/runtime, not browser UI or HTTP deployment.
// Optional argv[2]: a local .ly file (never copied into the repository).
import { readFile } from 'node:fs/promises';
const url = new URL('../docs/vgm_analyzer/vendor/lilypond/lilypond.worker.js', import.meta.url);
let handler;
let finish;
const done = new Promise(resolve => { finish = resolve; });
globalThis.self = {
  location: { href: url.href },
  addEventListener(type, fn) { if (type === 'message') handler = fn; },
  postMessage(data) {
    if (data.type === 'error') { console.error(data.stack || data.message); process.exitCode = 1; finish(); }
    if (data.type === 'result') {
      const ok = data.exitCode === 0 && data.svgs?.length > 0 && data.svgs.every(svg => svg.includes('<svg'));
      console.log(`LilyPond WASM: exit=${data.exitCode}, SVG pages=${data.svgs?.length || 0}`);
      if (!ok) process.exitCode = 1;
      finish();
    }
  },
};
globalThis.fetch = async input => new Response(await readFile(new URL(input)), {
  headers: { 'Content-Type': new URL(input).pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
});
await import(url.href);
await handler({ data: { type: 'render', requestId: 1,
  source: process.argv[2] ? await readFile(process.argv[2], 'utf8') : '\\version "2.24.3" { c\'4 d\' e\' f\' }',
} });
await done;
