// Globals used by updateChipSupport; each element keeps independent state.
export function chipSupportContext() {
  const node=()=>({disabled:false,hidden:false,title:'',getAttribute:()=> 'false'});
  const elements=new Map();
  const context={currentBuffer:null,midiExportAvailable:false,musicSheet:null,noteishHeader:{},
    OPM_TFI_NOTICE:'OPM to TFI conversion',
    document:{getElementById(id){if(!elements.has(id))elements.set(id,node());return elements.get(id);}}};
  for(const name of ['sheetMusicTab','parsedOutputTab','operatorInfoTab','noteishTab','tfiInfoTab','sampleTab',
    'opnMonitorRoot','opmMonitorRoot','ayMonitorRoot','ym2413MonitorRoot',
    'exportLilyPondButton','exportAllOpmButton','exportOpmButton','exportMidiButton','exportMmlButton',
    'exportSnapshotTfiButton','exportSnapshotVgiButton','exportSnapshotButton','exportAllTfiButton','exportAllVgiButton'])context[name]=node();
  return context;
}
