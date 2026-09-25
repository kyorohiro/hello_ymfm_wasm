// UI metadata and parameter ABI. DSP runs entirely in extra_fx.c.
export const extraControls = [
  {name:'filter',kind:7,title:'Filter',description:'LP / HP / BP。Cutoffは出力レートの45%以下に制限。',params:[
    ['Cutoff / Hz',20,20000,10,1200],['Q',0.2,12,0.1,0.707],['Type (0 LP / 1 HP / 2 BP)',0,2,1,0]]},
  {name:'delay',kind:8,title:'Delay',description:'時間変更ではピッチが変化します。最大2秒、Feedbackは最大0.9。',params:[
    ['Time / ms',1,2000,1,250],['Feedback',0,0.9,0.01,0.35]]},
  {name:'distortion',kind:9,title:'Distortion',description:'tanhのソフトクリップ。4サブステップ補間と簡易ローパス。Web Audio版と同一の音ではありません。',params:[
    ['Drive',1,20,0.1,4]]},
  {name:'bitcrusher',kind:10,title:'Bitcrusher',description:'量子化＋サンプル保持。意図的に折り返し成分を作ります。',params:[
    ['Bits',2,16,1,8],['Hold sample rate / Hz',100,48000,100,8000]]},
  {name:'wobble',kind:11,title:'Wobble',description:'サインLFOでローパスの周波数を変化。Depthは±octave。',params:[
    ['Center / Hz',20,10000,10,800],['Depth / octaves',0,4,0.1,2],['Rate / Hz',0.05,20,0.05,2],['Q',0.2,8,0.1,0.707]]},
  {name:'flanger',kind:12,title:'Flanger',description:'短い可変遅延＋フィードバック。遅延の下限は1サンプル。',params:[
    ['Base / ms',1,15,0.1,3],['Depth / ms',0,10,0.1,2],['Rate / Hz',0.05,10,0.05,0.3],['Feedback',0,0.9,0.01,0.3]]},
  {name:'slicer',kind:13,title:'Slicer',description:'周期的な音量ゲート。開閉は2msで平滑化。',params:[
    ['Rate / Hz',0.05,30,0.05,2],['Duty',0.05,0.95,0.01,0.5],['Minimum gain',0,1,0.01,0]]},
  {name:'chorus',kind:14,title:'Chorus',description:'左右でLFO位相をずらした可変遅延。フィードバックなし。',params:[
    ['Base / ms',10,40,0.1,20],['Depth / ms',0,10,0.1,5],['Rate / Hz',0.05,10,0.05,0.8]]},
];
export function mountExtraControls(container, send) {
  const panels=[];
  for (const fx of extraControls) {
    const section=document.createElement('section');
    const title=document.createElement('h2');title.textContent=fx.title;section.append(title);
    const description=document.createElement('p');description.textContent=fx.description;section.append(description);
    const controls=[];
    const add=(parameter,label,min,max,step,value)=>{
      const id=`extra-${fx.name}-${parameter}`;
      const labelNode=document.createElement('label');labelNode.htmlFor=id;labelNode.textContent=label;
      const output=document.createElement('output');output.textContent=String(value);
      const input=document.createElement('input');Object.assign(input,{id,type:'range',min:String(min),max:String(max),step:String(step),value:String(value)});
      input.oninput=()=>{output.textContent=input.value;send({type:'extra',kind:fx.kind,parameter,value:Number(input.value)});};
      section.append(labelNode,output,document.createElement('br'),input,document.createElement('br'));
      controls.push({parameter,input,output});
    };
    fx.params.forEach((row,i)=>add(i,...row));
    add(6,'Mix (Dry → Wet)',0,1,0.01,['filter','wobble','slicer'].includes(fx.name)?1:fx.name==='delay'?0.3:0.5);
    const bypass=document.createElement('input');bypass.type='checkbox';bypass.checked=true;
    const label=document.createElement('label');label.append(bypass,document.createTextNode(' Bypass'));
    bypass.onchange=()=>send({type:'extra',kind:fx.kind,parameter:7,value:bypass.checked?1:0});
    section.append(label);container.append(section);
    panels.push({fx,controls,bypass});
  }
  return {
    sync(sampleRate) {
      for (const {fx,controls,bypass} of panels) {
        for (const {parameter,input,output} of controls) {
          if(fx.name==='bitcrusher'&&parameter===1) {
            input.max=String(sampleRate);input.value=String(Math.min(sampleRate,Number(input.value)));output.textContent=input.value;
          }
          send({type:'extra',kind:fx.kind,parameter,value:Number(input.value)});
        }
        send({type:'extra',kind:fx.kind,parameter:7,value:bypass.checked?1:0});
      }
    },
  };
}
