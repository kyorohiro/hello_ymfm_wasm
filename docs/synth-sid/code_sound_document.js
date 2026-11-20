// SID Files preserves a linked portable voice or channel-setup document's role.
// Selection/migration leaves source bytes alone; only deliberate edits serialize.
import {readChannelSettings,selectedChannelPreset} from './channel_settings.js';

export function serializeSidSoundDocument(settings,source=null){
  const channels=readChannelSettings(settings);
  const original=typeof source==='string'?JSON.parse(source):source;
  let document;
  if(original?.format==='tetorica-sid-voice'){
    document=selectedChannelPreset(channels);
    // A legacy 6581 document can keep its format. A deliberate model change
    // to 8580 requires the model-aware version instead of losing information.
    if(original.version===1&&document.model==='6581'){
      const {model,...legacy}=document;document={...legacy,version:1};
    }
  }else{
    document=channels;
    if(original?.format==='tetorica-sid-channels'&&original.version===1&&channels.keyboardMode==='retrigger'){
      const {keyboardMode,...legacy}=document;document={...legacy,version:1};
    }
  }
  return JSON.stringify(document,null,2)+'\n';
}
