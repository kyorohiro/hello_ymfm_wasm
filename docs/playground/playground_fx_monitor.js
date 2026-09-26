/** Browser UI. FFT and drawing run outside the audio thread. */
export function spectrum(samples) {
 const n=samples.length,re=new Float64Array(n),im=new Float64Array(n);
 for(let i=0;i<n;i++)re[i]=samples[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[re[i],re[j]]=[re[j],re[i]];}
 for(let len=2;len<=n;len*=2)for(let start=0;start<n;start+=len)for(let j=0;j<len/2;j++){
  const a=-2*Math.PI*j/len,c=Math.cos(a),s=Math.sin(a),u=start+j,v=u+len/2;
  const r=re[v]*c-im[v]*s,t=re[v]*s+im[v]*c;
  re[v]=re[u]-r;im[v]=im[u]-t;re[u]+=r;im[u]+=t;
 }
 return Float64Array.from({length:n/2},(_,i)=>Math.max(-100,20*Math.log10(Math.max(1e-10,Math.hypot(re[i],im[i])*4/n))));
}
export function createFXMonitor(getRack) {
 const select=document.getElementById('fxMonitorTarget'),channel=document.getElementById('fxMonitorChannel');
 const status=document.getElementById('fxMonitorStatus');
 let visible=false,timer=null,rack=null,pending=false,id=0;
 let displayedNames=[],latestNames=[];
 function updateTargets(){
  // Replacing options while a native select is open disrupts its popup.
  // Keep DOM nodes stable between audio snapshots, and defer list changes
  // until the user leaves the selector.
  if(document.activeElement===select)return;
  if(latestNames.length===displayedNames.length&&latestNames.every((name,i)=>name===displayedNames[i]))return;
  const value=select.value;
  select.replaceChildren(...latestNames.map(name=>{
   const option=document.createElement('option');option.value=name;option.textContent=name;return option;
  }));
  select.value=latestNames.includes(value)?value:(latestNames[0]??'');
  displayedNames=latestNames.slice();
 }
 select.onblur=updateTargets;
 function plot(canvas,sets,isSpectrum,rate){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,left=48,top=14,right=w-12,bottom=h-28;
  ctx.fillStyle='#101820';ctx.fillRect(0,0,w,h);ctx.font='12px sans-serif';
  for(let j=0;j<=4;j++){
   const y=top+(bottom-top)*j/4;ctx.strokeStyle='#33424e';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
   ctx.fillStyle='#bcc8d2';ctx.fillText(isSpectrum?String(-25*j):String(1-j*.5),3,y+4);
  }
  ctx.fillStyle='#bcc8d2';ctx.fillText(isSpectrum?'dBFS':'amplitude',3,h-7);
  for(let j=0;j<=4;j++){
   const x=left+(right-left)*j/4;
   const label=isSpectrum?Math.round(rate/2*j/4)+' Hz':(sets[0].length/rate*1000*j/4).toFixed(1)+' ms';
   ctx.fillText(label,Math.min(right-55,x),h-7);
  }
  sets.forEach((values,k)=>{
   ctx.strokeStyle=k?'#ffba69':'#69cfff';ctx.beginPath();
   for(let i=0;i<values.length;i++){
    const x=left+i/(values.length-1)*(right-left),v=isSpectrum?Math.max(0,Math.min(1,-values[i]/100)):(1-Math.max(-1,Math.min(1,values[i])))/2;
    const y=top+v*(bottom-top);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
   }ctx.stroke();
  });
 }
 function receive(data){
  if(!visible||document.hidden||data.id!==id)return;
  pending=false;
  const names=data.names??[];
  latestNames=names.slice();updateTargets();
  if(data.input){
   plot(document.getElementById('fxMonitorWave'),[data.input,data.output],false,data.rate);
   plot(document.getElementById('fxMonitorFFT'),[spectrum(data.input),spectrum(data.output)],true,data.rate);
   status.textContent=data.name+' · '+data.rate+' Hz · 2048 samples · input blue / output orange';
  }else {
   status.textContent=names.length?'Waiting for audio…':'Run code containing liveFx to begin.';
   for(const id of ['fxMonitorWave','fxMonitorFFT']){
    const canvas=document.getElementById(id);
    canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
   }
  }
 }
 function cancel(){
  id++;pending=false;rack?.node.port.postMessage({op:'fx-monitor',enabled:false});
 }
 function tick(){
  if(!visible||document.hidden)return;
  const next=getRack();
  if(next!==rack){cancel();if(rack)rack.onMonitor=null;rack=next;if(rack)rack.onMonitor=receive;}
  if(!rack){status.textContent='Run code containing liveFx to begin.';return;}
  if(pending)return;
  pending=true;
  rack.node.port.postMessage({op:'fx-monitor',enabled:true,id:++id,name:select.value,channel:Number(channel.value)});
 }
 select.onchange=channel.onchange=()=>{cancel();tick();};
 document.addEventListener('visibilitychange',()=>{cancel();tick();});
 return {setVisible(value){
  visible=value;clearInterval(timer);timer=null;cancel();
  if(value){tick();timer=setInterval(tick,100);}
 }};
}
