import {normalizePsgRecording} from './synth_psg_recording.js?v=psg-event-rec-1';
import {normalizeSynthPsgSettings} from './synth_psg.js?v=psg-event-rec-1';

const sessionNumber=value=>{
  if(!Number.isSafeInteger(value)||value<1)throw new RangeError('PSG playback session must be a positive integer');
  return value;
};

/** Sample-clock event playback, independent of browser timers and UI frames.
 * beginCycle resets the dedicated chip and returns a fresh PSG voice adapter.
 * The renderer advances that chip and its software envelopes for each slice.
 */
export function createSynthPsgRecordingPlayer({sampleRate,beginCycle,onEnded=()=>{}}={}) {
  if(!Number.isFinite(sampleRate)||sampleRate<=0||sampleRate>768000)throw new RangeError('Invalid PSG recording sample rate');
  if(typeof beginCycle!=='function'||typeof onEnded!=='function')throw new TypeError('PSG playback needs cycle and completion callbacks');
  let latestSession=0,playing=false,recording=null,options=null,voice=null,events=[],head=0,frame=0,cycle=0,cycleFrames=0;
  const owners=new Map();
  function silence() {voice?.stop();voice=null;owners.clear();}
  function startCycle() {
    silence();head=0;frame=0;cycle++;
    voice=beginCycle(options.ignorePatch?options.settings:recording.initialState.settings,
      options.ignorePatch?options.pitchClock:recording.initialState.pitchClock);
    if(!voice||typeof voice.noteOn!=='function'||typeof voice.stop!=='function')throw new TypeError('PSG playback needs a voice adapter');
  }
  function physical(channel) {
    if(!options.ignorePatch)return channel;
    return options.settings.source==='noise'?3:channel===3?0:channel;
  }
  function apply(command) {
    if(command.type==='stop'){voice.stop();owners.clear();return;}
    if(command.type==='setSettings') {
      if(options.ignorePatch)return;
      const previous=voice.getSettings();
      voice.setSettings(command.settings);
      if(previous.source!==command.settings.source||previous.envelope.enabled!==command.settings.envelope.enabled)owners.clear();
      return;
    }
    const channel=physical(command.channel);
    if(command.type==='noteOn') {
      owners.set(channel,command.channel);
      voice.noteOn(channel,command.block,command.fnum);
    } else if(!options.ignorePatch||owners.get(channel)===command.channel) {
      if(command.type==='noteOff')voice.noteOff(channel);
      else voice.setFrequency(channel,command.block,command.fnum);
    }
  }
  function stop(session) {
    if(session!==undefined){sessionNumber(session);if(session<latestSession)return false;latestSession=session;}
    playing=false;silence();recording=null;events=[];head=frame=0;return true;
  }
  return {
    play(value,configuration={}) {
      // Validate completely before retiring the previous sound or timeline.
      const next=normalizePsgRecording(value),session=sessionNumber(configuration.session);
      if(typeof configuration.loop!=='boolean'&&configuration.loop!==undefined)throw new TypeError('PSG loop must be a boolean');
      if(typeof configuration.ignorePatch!=='boolean'&&configuration.ignorePatch!==undefined)throw new TypeError('PSG ignore patch must be a boolean');
      const ignorePatch=configuration.ignorePatch===true;
      const settings=ignorePatch?normalizeSynthPsgSettings(configuration.settings):null;
      const pitchClock=ignorePatch?configuration.pitchClock:next.initialState.pitchClock;
      if(!Number.isFinite(pitchClock)||pitchClock<=0)throw new RangeError('PSG playback pitch clock must be positive');
      if(!next.commands.length)throw new Error('PSG recording contains no events');
      if(session<=latestSession)return false;
      const nextEvents=next.commands.map(command=>({command,frame:Math.round(command.time*sampleRate)}));
      silence();latestSession=session;recording=next;options={loop:configuration.loop===true,ignorePatch,settings,pitchClock};
      events=nextEvents;cycleFrames=Math.max(1,Math.round(next.durationSeconds*sampleRate))+Math.max(1,Math.round(.01*sampleRate));
      playing=true;cycle=0;startCycle();return true;
    },
    stop,
    render(left,right,renderAudio) {
      if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length||typeof renderAudio!=='function')throw new TypeError('PSG playback needs stereo arrays and a renderer');
      let offset=0;
      while(offset<left.length) {
        if(!playing){renderAudio(left.subarray(offset),right.subarray(offset));return;}
        while(head<events.length&&events[head].frame<=frame)apply(events[head++].command);
        if(frame>=cycleFrames) {
          if(options.loop){startCycle();continue;}
          const ended=latestSession;stop(ended);onEnded(ended);continue;
        }
        const next=head<events.length?Math.min(cycleFrames,events[head].frame):cycleFrames;
        const count=Math.min(left.length-offset,next-frame);
        renderAudio(left.subarray(offset,offset+count),right.subarray(offset,offset+count));
        frame+=count;offset+=count;
      }
    },
    snapshot:()=>({playing,session:latestSession,frame,cycle,cycleFrames,pendingEvents:events.length-head}),
  };
}
