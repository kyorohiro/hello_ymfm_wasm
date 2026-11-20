// SPDX-License-Identifier: BSD-3-Clause
// A browser host, using the installed package. Start from a user gesture.
import {createTetoricaSynth} from 'tetorica-fm2612/tetorica_synth.js';

export async function startTimedExample() {
  const synth = createTetoricaSynth({chip:'segapsg', ym2413:true, masterVolume:.3});
  try {
    await synth.start();
    const psg = synth.psg, opll = synth.opll;
    opll.initialize();
    opll.setVoice(0, {instrument:1, attenuation:5});
    const pulse = psg.build(b => {
      b.atSample(0).setAttenuation(0, 5).noteOn(0, 'E3');
      b.atSeconds(.12).off(0);
      b.atSeconds(.25).noise({type:'periodic', rate:'high', attenuation:9});
      b.atSeconds(.3).noiseOff();
    });
    const bell = opll.build(b => {
      b.atSample(0).noteOn(0, 'B3');
      b.atSeconds(.2).setAttenuation(0, 8);
      b.atSeconds(.35).noteOff(0);
    });
    const [psgWrites, opllWrites] = await Promise.all([
      psg.compile(pulse), opll.compile(bell),
    ]);
    await psg.schedule(pulse, {name:'psg-pulse', repeatSeconds:1});
    await opll.schedule(bell, {name:'opll-bell', repeatSeconds:1});
    return {synth, psgWrites, opllWrites,
      async stop() {
        await Promise.all([psg.clearSchedule('psg-pulse'), opll.clearSchedule('opll-bell')]);
        await synth.close();
      },
    };
  } catch (error) {
    await synth.close();
    throw error;
  }
}

if (typeof document !== 'undefined') {
  let current;
  const start = document.getElementById('start'), stop = document.getElementById('stop');
  const trace = document.getElementById('trace'), status = document.getElementById('status');
  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      current = await startTimedExample();
      trace.textContent = JSON.stringify({psg:current.psgWrites, ym2413:current.opllWrites}, null, 2);
      status.textContent = 'Playing sample-clocked reservations.';
      stop.disabled = false;
    } catch (error) {
      status.textContent = error.message;
      start.disabled = false;
    }
  });
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    try { await current?.stop(); status.textContent = 'Stopped.'; }
    catch (error) { status.textContent = error.message; }
    finally { current = null; start.disabled = false; }
  });
}
