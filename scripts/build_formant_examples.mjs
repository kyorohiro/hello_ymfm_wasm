import {readFile, writeFile} from 'node:fs/promises';
import {createFormantExample} from '../docs/introductions/formant-examples.js';

// Keep both languages' editable code identical to the DSP exercised by tests.
for (const kind of ['vowels', 'voice', 'pitch']) for (const locale of ['', '_ja']) {
  const path = new URL(`../docs/introductions/tetorica-fx-formant-${kind}${locale}.html`, import.meta.url);
  const html = await readFile(path, 'utf8');
  const pattern = new RegExp(`(<script type="text/plain" id="formant-${kind}">)[\\s\\S]*?(</script>)`);
  if (!pattern.test(html)) throw new Error(`Missing formant-${kind} code block in ${path.pathname}`);
  const updated = html.replace(pattern, (_all, start, end) => `${start}\n${createFormantExample(kind)}${end}`);
  if (process.argv.includes('--check')) {
    if (updated !== html) throw new Error(`Formant lesson code is stale: ${path.pathname}`);
  } else await writeFile(path, updated);
}
