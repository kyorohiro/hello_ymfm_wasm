// SPDX-License-Identifier: BSD-3-Clause
// Merge only deliberate document changes into the accepted physical-channel bank.
import {readChannelSettings} from './channel_settings.js';
import {readPreset,waveformBits,waveformFromBits} from './preset.js';

export function applySidDocumentChanges(current,previous,next){
  current=readChannelSettings(current);previous=readChannelSettings(previous);next=readChannelSettings(next);
  const changes=(before,after)=>Object.fromEntries(Object.entries(after).filter(([key,value])=>before[key]!==value));
  const filter=changes(previous.channels[0].filter,next.channels[0].filter);
  const model=previous.channels[0].model!==next.channels[0].model?next.channels[0].model:current.channels[0].model;
  return readChannelSettings({
    ...current,
    target:previous.target!==next.target?next.target:current.target,
    keyboardMode:previous.keyboardMode!==next.keyboardMode?next.keyboardMode:current.keyboardMode,
    channels:current.channels.map((voice,index)=>{
      const before=previous.channels[index],after=next.channels[index];
      const fields=changes(before.voice,after.voice),waves=waveformBits(after.voice.waveform),mask=waveformBits(before.voice.waveform)^waves;
      delete fields.waveform;
      return readPreset({...voice,model,filter:{...voice.filter,...filter},
        name:before.name!==after.name?after.name:voice.name,
        voice:{...voice.voice,...fields,waveform:waveformFromBits((waveformBits(voice.voice.waveform)&~mask)|(waves&mask))},
        modulation:{...voice.modulation,...changes(before.modulation,after.modulation)},
      });
    }),
  });
}
