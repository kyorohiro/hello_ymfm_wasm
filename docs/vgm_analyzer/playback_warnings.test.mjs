import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('stream warnings remain visible across status changes, deduplicate and clear for next song',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const panel={hidden:true,textContent:''},status={};
 const context=vm.createContext({document:{getElementById:()=>panel},status,console});
 vm.runInContext(source.slice(source.indexOf('const playbackWarnings ='),source.indexOf('function currentStatusSuffix')),context);
 const warning='Unsupported DAC stream skipped: AY (0x12), instance=0, stream=0. Playback continues without this stream.';
 context.reportPlaybackWarning(warning);context.reportPlaybackWarning(warning);
 context.setStatus('Streaming VGM...');
 assert.equal(panel.textContent,warning);assert.equal(panel.hidden,false);
 context.clearPlaybackWarnings();assert.equal(panel.hidden,true);assert.equal(panel.textContent,'');
 context.reportPlaybackWarning(warning);assert.equal(panel.hidden,false);
});
