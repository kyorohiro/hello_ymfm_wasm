import {timelineScrollWidth,timelinePlaybackPosition} from './note_timeline.js';
const rate=44100, colors=['#e77f67','#f2b15c','#7fdc86','#72a8ff','#bd86ff','#62d7dd','#25794b','#a85520','#506fbd'];
const name=n=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((n%12)+12)%12]+(Math.floor(n/12)-1);
export function createNoteTimeline(root,{onSelect, onPlay,onPause,onCancel}) {
  root.innerHTML=`<div class="timeline-controls">
    <button data-action="play" disabled>Play from cursor</button><button data-action="pause">Pause</button>
    <button data-action="cancel" hidden>Cancel seek</button>
    <label>Zoom <select data-role="zoom"><option value="40">40 px/s</option><option value="100" selected>100 px/s</option><option value="250">250 px/s</option><option value="600">600 px/s</option></select></label>
    <label><input type="checkbox" data-role="follow" checked> Follow playback</label>
    <label>Position (seconds) <input type="number" data-role="position" min="0" step="0.1" value="0"></label>
    <span data-role="status" role="status">Load a file to inspect notes.</span></div>
    <div data-role="scroll" class="timeline-scroll" tabindex="0" aria-label="Song pitch timeline. Scroll horizontally; click to select a playback position.">
      <div data-role="spacer" class="timeline-spacer"></div><canvas aria-label="Pitch by song time"></canvas>
    </div><p data-role="legend" class="noteish-help"></p>`;
  const el=role=>root.querySelector(`[data-role="${role}"]`);
  const canvas=root.querySelector('canvas'),scroll=el('scroll'),status=el('status');
  const play=root.querySelector('[data-action="play"]'),cancel=root.querySelector('[data-action="cancel"]');
  let loopSamples=0;
  let worker=null,duration=0,start=0,cursor=0,pps=100,width=700,height=230,detailed=false,ready=false;
  let request=0,channels=[],names=[],frame=0,busy=false;
  const span=()=>Math.max(1,width-48)/pps*rate;
  function resize(){
    width=Math.max(260,scroll.clientWidth);height=detailed?1810:230;
    canvas.style.width=width+'px';canvas.style.height=height+'px';scroll.style.height=height+'px';
    const dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
    el('spacer').style.width=timelineScrollWidth(duration,pps,width)+'px';
    view();
  }
  function view(){
    start=(scroll.scrollLeft/Math.max(1,scroll.scrollWidth-width))*Math.max(0,duration-span());
    if(worker&&ready)worker.postMessage({type:'view',id:++request,start,end:start+span(),limit:Math.max(1000,Math.floor(width*4))});
    draw();
  }
  function draw(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;
      const ctx=canvas.getContext('2d'),bottom=height-30;
      ctx.clearRect(0,0,width,height);ctx.fillStyle='#fffdf7';ctx.fillRect(0,0,width,height);
      const y=p=>24+(96-p)/72*(bottom-24),x=s=>48+(s-start)/rate*pps;
      for(let n=24;n<=96;n++){
        if(detailed){
          ctx.fillStyle=[1,3,6,8,10].includes(n%12)?'#e4dcd1':'#fffdf7';
          ctx.fillRect(48,y(n)-(bottom-24)/144,width-48,(bottom-24)/72);
        }
        if(detailed||n%12===0){
          ctx.strokeStyle='#d9d0c6';ctx.beginPath();ctx.moveTo(48,y(n));ctx.lineTo(width,y(n));ctx.stroke();
          ctx.fillStyle='#705d47';ctx.font='11px sans-serif';ctx.fillText(name(n),4,y(n)+4);
        }
      }
      const secondsStep=Math.max(0.1,Math.pow(10,Math.ceil(Math.log10(70/pps))));
      for(let s=Math.ceil(start/rate/secondsStep)*secondsStep;s<=(start+span())/rate;s+=secondsStep){
        ctx.strokeStyle='#ddd';ctx.beginPath();ctx.moveTo(x(s*rate),18);ctx.lineTo(x(s*rate),bottom);ctx.stroke();
        ctx.fillStyle='#705d47';ctx.fillText(s.toFixed(secondsStep<1?1:0)+'s',x(s*rate)+3,height-8);
      }
      ctx.save();ctx.beginPath();ctx.rect(48,0,width-48,bottom+1);ctx.clip();
      channels.forEach((ch,i)=>{
        ctx.strokeStyle=ctx.fillStyle=colors[i%colors.length];
        for(const [a,b,pitch] of ch.rows){
          if(pitch<24||pitch>96)continue;
          const left=Math.max(48,x(a)),right=Math.min(width,x(b));
          ctx.globalAlpha=.65;ctx.lineWidth=detailed?5:2;
          ctx.beginPath();ctx.moveTo(left,y(pitch));ctx.lineTo(right,y(pitch));ctx.stroke();
          ctx.globalAlpha=1;if(x(a)>=48){ctx.beginPath();ctx.arc(x(a),y(pitch),detailed?3:2,0,Math.PI*2);ctx.fill();}
          if(detailed && right-left>40){ctx.font='11px sans-serif';ctx.fillText(name(Math.round(pitch)),left+4,y(pitch)-6);}
        }
      });
      ctx.globalAlpha=1;ctx.strokeStyle='#a32929';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(x(cursor),0);ctx.lineTo(x(cursor),bottom);ctx.stroke();ctx.restore();
    });
  }
  function setPosition(sample,notify=true){
    cursor=Math.max(0,Math.min(duration,sample||0));el('position').value=(cursor/rate).toFixed(3);
    if(notify)onSelect(cursor);draw();
  }
  function clear(){
    worker?.terminate();worker=null;ready=false;duration=0;channels=[];names=[];cursor=0;scroll.scrollLeft=0;
    el('legend').textContent='';status.textContent='Load a file to inspect notes.';play.disabled=true;resize();
  }
  scroll.addEventListener('scroll',view);
  scroll.addEventListener('wheel',e=>{
    if(e.shiftKey || Math.abs(e.deltaX)>Math.abs(e.deltaY))el('follow').checked=false;
  },{passive:true});
  scroll.addEventListener('pointerdown',()=>{el('follow').checked=false;});
  canvas.addEventListener('click',e=>{if(!ready||busy)return;setPosition(start+Math.max(0,e.clientX-canvas.getBoundingClientRect().left-48)/pps*rate);});
  el('position').addEventListener('change',()=>setPosition(Number(el('position').value)*rate));
  el('zoom').addEventListener('change',()=>{
    const previous=start;pps=Number(el('zoom').value);resize();
    scroll.scrollLeft=previous/Math.max(1,duration-span())*(scroll.scrollWidth-width);view();
  });
  play.addEventListener('click',()=>onPlay(cursor));
  root.querySelector('[data-action="pause"]').addEventListener('click',onPause);
  cancel.addEventListener('click',onCancel);
  new ResizeObserver(resize).observe(scroll);
  return {
    clear, selected:()=>cursor,
    load(buffer){
      clear();status.textContent='Analyzing notes in background…';
      worker=new Worker(new URL('./note_timeline_worker.js',import.meta.url),{type:'module'});
      worker.onerror=()=>{status.textContent='Note analysis failed. Reload the file to retry.';};
      worker.onmessage=({data})=>{
        if(data.type==='error'){status.textContent=data.message;return;}
        if(data.type==='ready'){
          duration=data.duration;loopSamples=data.loopSamples||0;names=data.names;ready=true;play.disabled=false;
          status.textContent=`${(duration/rate).toFixed(2)} seconds · click to set cursor`;
          el('legend').replaceChildren(...names.map((n,i)=>{const s=document.createElement('span');s.textContent=n+'  ';s.style.color=colors[i%colors.length];return s;}));
          el('position').max=duration/rate;resize();
        }else if(data.type==='view'&&data.id===request){
          channels=data.channels;
          status.textContent=channels.some(ch=>ch.dense)?'Dense region: zoom in to see all pitch changes.':`${(duration/rate).toFixed(2)} seconds · click to set cursor`;
          draw();
        }
      };
      const copy=buffer instanceof ArrayBuffer?buffer.slice(0):buffer.slice().buffer;
      worker.postMessage({type:'load',buffer:copy},[copy]);
    },
    mode(value){if(detailed!==(value==='detail')){detailed=value==='detail';resize();}},
    cursor(sample,playing,looping=false){
      if(!ready||busy)return;
      setPosition(timelinePlaybackPosition(sample,duration,loopSamples,looping),false);
      if(playing&&el('follow').checked&&(cursor<start||cursor>start+span()*.9)){
        scroll.scrollLeft=Math.max(0,cursor-span()*.15)/Math.max(1,duration-span())*(scroll.scrollWidth-width);
      }
    },
    busy(value,message){busy=value;play.disabled=value||!ready;cancel.hidden=!value;if(message)status.textContent=message;},
  };
}
