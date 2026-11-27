// SPDX-License-Identifier: BSD-3-Clause
const names=['ROM bank','Sample address','Rate','Phase','Loop length','End','Volume','Pan','Echo send'];

export function pcmRegisterAddresses(channel) {
  const base=channel*8;
  return [((channel+15)%16)*8,base+1,base+2,base+3,base+4,base+5,base+6,0x80+channel,0xba+channel];
}

const hex=(value,width)=>value==null || value<0?'—':'0x'+value.toString(16).toUpperCase().padStart(width,'0');

export function createRegisterTable(body,position) {
  const rows=names.map(name=>{
    const row=body.insertRow();
    const heading=document.createElement('th');
    heading.scope='row';heading.textContent=name;row.append(heading);
    return {address:row.insertCell(),word:row.insertCell()};
  });
  let previousChannel=null;
  return (channel,words,pointer)=>{
    const changedChannel=channel!==previousChannel;
    if(changedChannel){
      pcmRegisterAddresses(channel).forEach((address,i)=>{rows[i].address.textContent=hex(address,2);});
      previousChannel=channel;
    }
    rows.forEach(({word},i)=>{
      const text=hex(words?.[i],4);
      if(text===word.textContent)return;
      if(!changedChannel && words && !matchMedia('(prefers-reduced-motion: reduce)').matches)
        word.animate([{backgroundColor:'#ffdf82'},{backgroundColor:'transparent'}],{duration:250});
      word.textContent=text;
    });
    const text=hex(pointer,4);
    if(text!==position.textContent)position.textContent=text;
  };
}
