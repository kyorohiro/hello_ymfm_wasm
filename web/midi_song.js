/** Replay editable beat-based event generators on one absolute timeline. */
export function createMidiSongPlayer(midi, {channels, tempos = [{beat:0, bpm:120}], endBeat = 0}) {
  let running = false;
  if (!Number.isFinite(endBeat) || endBeat < 0) throw new Error('Invalid song end beat');
  let seconds = 0, previousBeat = 0, bpm = 120;
  const clock = [{beat:0, seconds:0, bpm}];
  for (const tempo of tempos) {
    if (!Number.isFinite(tempo.beat) || tempo.beat < previousBeat || !Number.isFinite(tempo.bpm) || tempo.bpm <= 0)
      throw new Error('Invalid song tempo map');
    seconds += (tempo.beat - previousBeat) * 60 / bpm;
    previousBeat = tempo.beat; bpm = tempo.bpm;
    clock.push({beat:previousBeat, seconds, bpm});
  }
  function time(beat) {
    let lo=0, hi=clock.length;
    while(lo+1<hi) {const mid=(lo+hi)>>1;if(clock[mid].beat<=beat)lo=mid;else hi=mid;}
    const entry=clock[lo];return entry.seconds+(beat-entry.beat)*60/entry.bpm;
  }
  return {
    get running() { return running; },
    async runChannels(numbers, replacements = {}) {
      if (!Array.isArray(numbers) || numbers.some(ch => !Number.isInteger(ch) || !Object.prototype.hasOwnProperty.call(channels,ch)))
        throw new Error('Unknown channel selection');
      if (running) throw new Error('This song is already playing');
      const selected=[...new Set(numbers)];if(!selected.length)return;
      const resolved=new Map(selected.map(ch=>{
        const defaults=channels[ch].outputs;
        const replacement=replacements[ch];
        const outputs=replacement===undefined?defaults:Array.isArray(replacement)?replacement:[replacement];
        if(outputs.length!==defaults.length || outputs.some(output=>!output || ['noteOn','noteOff','cc'].some(method=>typeof output[method]!=='function')))
          throw new Error('Supply one output per generated channel destination');
        return [ch,outputs];
      }));
      running=true;
      const outputs=[...new Set([...resolved.values()].flat())];
      let failure;
      try {
        const timeline=midi.createTimeline();
        const streams=selected.map(ch=>({iterator:channels[ch].events(...resolved.get(ch)), previous:-1}));
        function advance(stream) {
          const next=stream.iterator.next();stream.next=next;
          if(next.done)return;
          const e=next.value;
          if(!e || !Number.isFinite(e.at) || e.at<0 || e.at<stream.previous)throw new Error('Song events must have nondecreasing nonnegative beats');
          if(!outputs.includes(e.output))throw new Error('Song event uses an unregistered output');
          if(e.order!==undefined && !Number.isFinite(e.order))throw new Error('Invalid song event order');
          if(e.play!==undefined && (!Number.isFinite(e.duration) || e.duration<0))throw new Error('Invalid note duration');
          if(e.offOrder!==undefined && !Number.isFinite(e.offOrder))throw new Error('Invalid note-off order');
          stream.previous=e.at;
        }
        for(const stream of streams)advance(stream);
        // Only upcoming generator events and outstanding note-offs are retained.
        const offs=[];
        // Beat sums may differ by floating-point rounding at a shared tick.
        const before=(a,b)=>Math.abs(a.at-b.at)>1e-10 ? a.at<b.at : (a.order??0)<(b.order??0);
        function pushOff(event) {
          let i=offs.length;offs.push(event);
          while(i) {const parent=(i-1)>>1;if(!before(event,offs[parent]))break;offs[i]=offs[parent];i=parent;}
          offs[i]=event;
        }
        function popOff() {
          const result=offs[0],last=offs.pop();
          if(offs.length) {
            let i=0;
            while(i*2+1<offs.length) {
              let child=i*2+1;if(child+1<offs.length&&before(offs[child+1],offs[child]))child++;
              if(!before(offs[child],last))break;
              offs[i]=offs[child];i=child;
            }
            offs[i]=last;
          }
          return result;
        }
        let previous=-1,lastBeat=0;
        while(true) {
          let first;
          for(const stream of streams)if(!stream.next.done && (!first || before(stream.next.value,first.next.value)))first=stream;
          let event=first?.next.value;
          const off=offs[0];
          const isOff=off && (!event || !before(event,off));
          if(isOff)event=popOff();
          if(!event)break;
          const target=Math.max(previous,time(event.at));
          if(target!==previous) {await timeline.waitUntil(target);previous=target;}
          lastBeat=event.at;
          if(event.play!==undefined) {
            await event.output.noteOn(event.play,{velocity:event.velocity??100});
            pushOff({at:event.at+event.duration,order:event.offOrder??event.order,output:event.output,noteOff:event.play});
          } else if(event.noteOn!==undefined)await event.output.noteOn(event.noteOn,{velocity:event.velocity??100});
          else if(event.noteOff!==undefined)await event.output.noteOff(event.noteOff);
          else if(event.cc!==undefined)await event.output.cc(...event.cc);
          else if(event.pitchBend!==undefined)await event.output.pitchBend(event.pitchBend);
          else throw new Error('Unknown song event');
          if(!isOff)advance(first);
        }
        if(endBeat>lastBeat)await timeline.waitUntil(time(endBeat));
      } catch(error) {failure=error;throw error;}
      finally {
        try {
          const results=await Promise.allSettled(outputs.map(output=>Promise.resolve().then(()=>output.cc(120,0))));
          const rejected=results.find(result=>result.status==='rejected');
          if(!failure && rejected)throw rejected.reason;
        } finally {running=false;}
      }
    },
  };
}
