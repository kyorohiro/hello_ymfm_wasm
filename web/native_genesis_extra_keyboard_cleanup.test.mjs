import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifecycleFixture,installCreationEnvironment,until} from './native_genesis_extra_creation_fixture.mjs';

test('Native Stop lets awaited Keyboard cleanup finish after the rack retires without touching a replacement',async t=>{
  const env=installCreationEnvironment(t),f=createLifecycleFixture(t,env);
  await f.runtime.playSource(`
    const voice=await createSoundChip('ym2612',{id:'keyboard-voice'});
    context.voice=voice;
    keyboard.bind('Native cleanup',{
      noteOn({midi}){voice.noteOn(0,midi);},noteOff(){voice.keyOff(0);},
      async allNotesOff(){
        log('cleanup-start');await voice.keyOff(0);
        log('cleanup-middle');await Promise.resolve();await voice.keyOff(1);
        log('cleanup-finished');
      },
    });
  `);
  const old=f.runtime.context.voice,instance=[...f.synth.extraDevices.keys()][0];
  await f.runtime.getKeyboardTarget().noteOn({id:'held',midi:60});
  await f.synth.flush();const before=f.commands().length;
  await f.runtime.stopWithFade();
  assert(f.logs.includes('cleanup-finished'),'all awaited cleanup stages finish');
  assert(!f.logs.some(line=>line.includes('[keyboard]')),'Stop produces no Keyboard error');
  assert(!f.commands().slice(before).some(command=>command.instance===instance),'retired cleanup sends no stale chip commands');
  assert.equal(f.synth.extraDevices.size,0);
  await f.runtime.playSource(`context.next=await createSoundChip('ym2612',{id:'keyboard-voice'});context.next.noteOn(0,64);`);
  const replacement=[...f.synth.extraDevices.keys()][0];assert.notEqual(replacement,instance);
  assert.throws(()=>old.keyOff(0),/not ready|disposed|cancelled/i,'ordinary disposed access remains an error');
  assert.equal(f.synth.extraDevices.size,1);assert(f.rack.has(replacement));
  await until(()=>!f.pendingIPC.size,'replacement operations settled');
  assert.deepEqual(f.errors,[]);
});
