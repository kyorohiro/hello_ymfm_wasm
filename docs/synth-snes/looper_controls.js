// SPDX-License-Identifier: BSD-3-Clause
export function setupSnesLooperControls({looper,document:doc=globalThis.document,isBlocked=()=>false,onError=()=>{}}) {
  const $=id=>doc.getElementById(id),cleanups=[];
  function update(){
    const s=looper.read(),blocked=isBlocked();
    $('looperStartButton').textContent=s.running?'Looper Stop':'Looper Start';
    $('looperStartButton').disabled=!s.running&&blocked;
    $('looperRecordButton').hidden=!s.running;$('looperRecordButton').disabled=s.busy||blocked;
    $('looperRecordButton').textContent=s.recording?'Stop recording [Space]':'Record [Space]';
    $('looperUndoButton').disabled=!s.canUndo;$('looperClearButton').disabled=!s.canUndo&&!s.running;
    const value=s.error||(s.busy?'Preparing loop…':s.recording?'Recording…':s.running?`${s.unitCount} layers · ${s.loopLength?s.loopLength.toFixed(2)+' s':'Record the first loop.'}`:s.unitCount?`Stopped · ${s.unitCount} layers retained`:'Looper idle.');
    if($('looperState').textContent!==value)$('looperState').textContent=value;
    $('looperState').dataset.error=String(Boolean(s.error));
  }
  for(const [id,action]of [['looperStartButton',()=>looper.read().running?looper.stop():looper.start()],['looperRecordButton',()=>looper.record()],['looperUndoButton',()=>looper.undo()],['looperClearButton',()=>looper.clear()]]) {
    const node=$(id),listener=()=>{node.blur();void Promise.resolve().then(action).catch(onError).finally(update);};
    node.addEventListener('click',listener);cleanups.push(()=>node.removeEventListener('click',listener));
  }
  const space=event=>{
    if(event.code!=='Space'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||!looper.read().running||isBlocked())return;
    if(event.target?.closest?.('input,textarea,select,button,summary,[contenteditable="true"],.monaco-editor,#snesFilesPanel,#synthMenu[open]'))return;
    event.preventDefault();void looper.record().catch(onError);
  };
  doc.addEventListener('keydown',space);cleanups.push(()=>doc.removeEventListener('keydown',space));update();
  return{update,dispose(){for(const cleanup of cleanups)cleanup();}};
}
