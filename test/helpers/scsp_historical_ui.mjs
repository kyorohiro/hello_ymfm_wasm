// Historical UI evidence used by the earlier exact-hash audit tests. Current
// shipped source freshness is covered by the new measurement reports instead.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export async function readHistoricalScspUi(path) {
 const {sources}=JSON.parse(await readFile(new URL('../fixtures/scsp_pre_pcm_file_ui_sources.json',import.meta.url),'utf8'));
 const item=sources[path];if(!item)throw new Error('Missing historical SCSP UI fixture: '+path);
 const bytes=gunzipSync(Buffer.from(item.gzip,'base64'));
 if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Historical SCSP UI fixture hash mismatch');
 return bytes;
}
