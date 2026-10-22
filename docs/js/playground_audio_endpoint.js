/** Post-ready failures must retire the current owner, including runtime mixer
 * and client/cache wrappers added after an audio factory returns. No polling. */
export function watchAudioEndpoint(endpoint, {context, label, onError} = {}) {
  const {node}=endpoint, cleanup=endpoint.dispose;
  const previousMessage=node.port.onmessage;
  let disposed=false, failed=false;
  const closed=()=>{if(context.state==='closed')fail(new Error(`${label} AudioContext was closed`));};
  function fail(error) {
    if(disposed||failed)return;
    failed=true;
    try {endpoint.dispose();}
    finally {onError?.(error);}
  }
  const message=event=>{
    const data=event.data;
    // RPC rejections belong to their addEventListener callers. The previous
    // readiness handler may dispose on any error, so do not replay them there.
    if(data?.error&&data.id!==undefined&&data.id!==null&&!data.fatal)return;
    // Explicit fatal errors override even the inspector's validation protocol.
    if(data?.fatal||(data?.type!=='chip-inspector-result'&&data?.error)) {
      fail(new Error(data.error??`${label} AudioWorklet failed`));return;
    }
    previousMessage?.call(node.port,event);
  };
  const processorError=()=>fail(new Error(`${label} Worklet processor failed`));
  endpoint.dispose=()=>{
    if(disposed)return;
    disposed=true;
    context.removeEventListener?.('statechange',closed);
    if(node.port.onmessage===message)node.port.onmessage=null;
    if(node.onprocessorerror===processorError)node.onprocessorerror=null;
    cleanup();
  };
  if(context.state==='closed'){endpoint.dispose();throw new Error(`${label} AudioContext was closed`);}
  node.port.onmessage=message;node.onprocessorerror=processorError;
  context.addEventListener?.('statechange',closed);
  return endpoint;
}
