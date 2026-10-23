/** Applied SSG registers. Opening or refreshing this view never writes to audio. */
export function createPlaygroundOpnSsgEditor({root,onEdit,onTargetChange=()=>{}}) {
  const doc=root.ownerDocument;let channel=0,disposed=false;
  root.dataset.extraSsgEditor='';root.className='chip-section';
  const make=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  root.append(make('h3','SSG · 3 channels · mono'));
  const fields=make('div');fields.className='chip-fields';root.append(fields);
  const select=make('select');select.dataset.ssgControl='channel';
  for(let i=0;i<3;i++){const option=make('option',`SSG ${i+1}`);option.value=String(i);select.append(option);}
  function field(label,node){const wrapper=make('label');wrapper.className='chip-field';wrapper.append(make('span',label),node);fields.append(wrapper);return node;}
  field('Channel / Keyboard target',select);
  let snapshot=null;
  const send=(method,args)=>{if(!disposed){onTargetChange();onEdit(`ssg.${method}`,args);}};
  function number(label,name,max,change){const node=field(label,make('input'));node.type='number';node.min='0';node.max=String(max);node.step='1';node.dataset.ssgControl=name;
    node.addEventListener('change',()=>{const value=Number(node.value);if(!node.value.trim()||!Number.isInteger(value)||value<0||value>max){node.setCustomValidity?.(`Enter 0–${max}.`);node.reportValidity?.();return;}node.setCustomValidity?.('');change(value);});return node;}
  function checkbox(label,name,change){const node=field(label,make('input'));node.type='checkbox';node.dataset.ssgControl=name;node.addEventListener('change',change);return node;}
  const tone=checkbox('Tone','tone',()=>sendMixer()),noise=checkbox('Noise','noise',()=>sendMixer());
  const period=number('Tone period (12-bit)','period',4095,value=>send('setTonePeriod',[channel,value]));
  const volume=number('Retained fixed volume','volume',15,value=>send('setVolume',[channel,value,envelope.checked]));
  const envelope=checkbox('Use shared envelope','envelope',()=>send('setVolume',[channel,Number(volume.value),envelope.checked]));
  const noisePeriod=number('Shared noise period','noise-period',31,value=>send('write',[6,value]));
  const envelopePeriod=number('Shared envelope period','envelope-period',65535,value=>{send('write',[11,value&255]);send('write',[12,value>>8]);});
  const shape=number('Shared envelope shape / retrigger','envelope-shape',15,value=>send('setEnvelope',[{period:Number(envelopePeriod.value),shape:value}]));
  const applied=make('p');applied.className='subtext';applied.dataset.ssgOutput='applied';root.append(applied);
  root.append(make('p','Noise and envelope are shared by all three SSG channels. Changing Shape retriggers the shared envelope; changing Period preserves its phase.'));
  function sendMixer(){send('setMixer',[channel,{tone:!!tone.checked,noise:!!noise.checked}]);}
  function value(node,next){if(doc.activeElement!==node)node.value=String(next);}
  function checked(node,next){if(doc.activeElement!==node)node.checked=!!next;}
  function update(data){if(disposed||!data)return;snapshot=data;const r=data.registers?.[0];if(!r)return;
    const retained=data.ssgLevels?.[channel]??r[8+channel];
    value(select,channel);value(period,r[channel*2]|(r[channel*2+1]&15)<<8);value(volume,retained&15);
    checked(tone,!(r[7]&(1<<channel)));checked(noise,!(r[7]&(8<<channel)));checked(envelope,retained&16);
    value(noisePeriod,r[6]&31);value(envelopePeriod,r[11]|r[12]<<8);value(shape,r[13]&15);
    applied.textContent=`SSG ${channel+1} · applied level ${r[8+channel]&31}${data.held?.includes(`ssg:${channel}`)?' · Keyboard held':''}`;
  }
  select.addEventListener('change',()=>{if(disposed)return;channel=Number(select.value);update(snapshot);onTargetChange();});
  return {update,getSelectedChannel:()=>channel,dispose(){disposed=true;}};
}
