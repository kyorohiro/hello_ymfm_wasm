import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutput} from '../node/output_audify.mjs';
test('Audify ignores process-wide RtAudio warnings but forwards genuine device errors',async()=>{
  const moduleUrl='data:text/javascript,'+encodeURIComponent(`
    export const state={};export const RtAudioFormat={RTAUDIO_FLOAT32:16};
    export class RtAudio{openStream(...args){state.error=args[9];return 512;}
      getDefaultOutputDevice(){return 1;}getStreamSampleRate(){return 48000;}
      isStreamOpen(){return true;}isStreamRunning(){return false;}
      clearOutputQueue(){}closeStream(){} }
  `);
  const {state}=await import(moduleUrl);const errors=[];
  const output=await createOutput({moduleUrl,sampleRate:48000,bufferFrames:512,onDrain(){},onError:error=>errors.push(error.message)});
  state.error(0,'closeStream(): no open stream');state.error(1,'debug warning');assert.deepEqual(errors,[]);
  state.error(9,'device lost');assert.deepEqual(errors,['device lost']);
  output.close();state.error(9,'late error');assert.equal(errors.length,1);
});
