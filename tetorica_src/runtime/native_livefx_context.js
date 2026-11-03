/** Portable context transport for the offline Native liveFx probe.
 * JSON carries a bounded object graph, never audio blocks or executable code.
 * Unsupported structured-clone types fail explicitly instead of changing shape.
 */
export function encodeNativeLiveFxContext(context, {maxBytes=8*1024*1024,maxNodes=4096}={}) {
  if(!context||typeof context!=='object'||Array.isArray(context))throw new TypeError('liveFx context must be an object');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxNodes)||maxNodes<1)throw new RangeError('Invalid liveFx context limits');
  const root=structuredClone(context),nodes=[],seen=new Map();let bytes=0;
  const charge=count=>{bytes+=count;if(bytes>maxBytes)throw new RangeError('Native liveFx context exceeds byte limit');};
  const typed=new Set(['Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float16Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array']);
  function value(input,depth=0) {
    if(depth>512)throw new RangeError('Native liveFx context exceeds nesting limit');
    if(input===null||typeof input==='boolean')return input;
    if(typeof input==='string'){charge(input.length*2);return input;}
    if(typeof input==='number')return Number.isFinite(input)&&!Object.is(input,-0)?input:{number:Object.is(input,-0)?'-0':String(input)};
    if(typeof input==='undefined')return {undefined:true};
    if(typeof input==='bigint'){const bigint=String(input);charge(bigint.length*2);return {bigint};}
    if(typeof input!=='object')throw new TypeError('Unsupported Native liveFx context value');
    if(seen.has(input))return {ref:seen.get(input)};
    if(nodes.length>=maxNodes)throw new RangeError('Native liveFx context exceeds node limit');
    charge(32);
    const ref=nodes.length,node={};seen.set(input,ref);nodes.push(node);
    const next=item=>value(item,depth+1);
    if(input instanceof ArrayBuffer) {
      charge(input.byteLength);Object.assign(node,{type:'ArrayBuffer',bytes:Array.from(new Uint8Array(input))});
    } else if(ArrayBuffer.isView(input)) {
      const name=input instanceof DataView?'DataView':input.constructor.name;
      if(name!=='DataView'&&!typed.has(name))throw new TypeError('Unsupported Native liveFx typed array');
      Object.assign(node,{type:name,buffer:next(input.buffer),offset:input.byteOffset,length:input instanceof DataView?input.byteLength:input.length});
    } else if(input instanceof Map) {
      node.type='Map';node.entries=Array.from(input,([key,item])=>[next(key),next(item)]);
    } else if(input instanceof Set) {
      node.type='Set';node.values=Array.from(input,next);
    } else if(input instanceof Date) {
      node.type='Date';node.time=next(input.getTime());
    } else if(input instanceof RegExp) {
      charge((input.source.length+input.flags.length)*2);Object.assign(node,{type:'RegExp',source:input.source,flags:input.flags});
    } else if(Array.isArray(input)||Object.getPrototypeOf(input)===Object.prototype||Object.getPrototypeOf(input)===null) {
      node.type=Array.isArray(input)?'Array':'Object';if(Array.isArray(input)){charge(input.length*8);node.length=input.length;}
      node.entries=Object.keys(input).map(key=>{charge(key.length*2+16);return [key,next(input[key])];});
    } else throw new TypeError(`Unsupported Native liveFx context type: ${input.constructor?.name??'unknown'}`);
    return {ref};
  }
  const graph={version:1,root:value(root),nodes};
  // Bound JSON overhead too, including decimal expansion of byte arrays.
  if(JSON.stringify(graph).length*2>maxBytes)throw new RangeError('Native liveFx context exceeds encoded byte limit');
  return graph;
}

/** Self-contained so the exact decoder can run inside the embedded engine. */
export function decodeNativeLiveFxContext(graph, {maxBytes=8*1024*1024,maxNodes=4096}={}) {
  const fail=()=>{throw new TypeError('Invalid Native liveFx context graph');};
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const integer=(value,max=0x7fffffff)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
  if(!integer(maxBytes,Number.MAX_SAFE_INTEGER)||maxBytes===0||!integer(maxNodes,Number.MAX_SAFE_INTEGER)||maxNodes===0)fail();
  if(!record(graph)||graph.version!==1||!Array.isArray(graph.nodes)||graph.nodes.length>maxNodes||JSON.stringify(graph).length*2>maxBytes)fail();
  const nodes=graph.nodes,objects=new Array(nodes.length),typed=new Map([
    ['Int8Array',Int8Array],['Uint8Array',Uint8Array],['Uint8ClampedArray',Uint8ClampedArray],
    ['Int16Array',Int16Array],['Uint16Array',Uint16Array],['Int32Array',Int32Array],['Uint32Array',Uint32Array],
    ['Float32Array',Float32Array],['Float64Array',Float64Array],['BigInt64Array',BigInt64Array],['BigUint64Array',BigUint64Array],
  ]);
  if(typeof Float16Array!=='undefined')typed.set('Float16Array',Float16Array);
  function value(token) {
    if(token===null||typeof token==='string'||typeof token==='boolean')return token;
    if(typeof token==='number'){if(!Number.isFinite(token))fail();return token;}
    if(!record(token)||Object.keys(token).length!==1)fail();
    if(own(token,'ref')){if(!integer(token.ref,nodes.length-1))fail();return objects[token.ref];}
    if(own(token,'undefined')&&token.undefined===true)return undefined;
    if(own(token,'bigint')&&typeof token.bigint==='string'&&/^-?(?:0|[1-9][0-9]*)$/.test(token.bigint))return BigInt(token.bigint);
    if(own(token,'number')) {
      if(token.number==='NaN')return NaN;if(token.number==='Infinity')return Infinity;
      if(token.number==='-Infinity')return -Infinity;if(token.number==='-0')return -0;
    }
    fail();
  }
  let storage=0;
  // Allocate buffers before typed views, and all containers before references.
  for(let i=0;i<nodes.length;i++) {
    const node=nodes[i];if(!record(node)||typeof node.type!=='string')fail();
    switch(node.type) {
      case 'Object':objects[i]={};break;
      case 'Array':if(!integer(node.length))fail();storage+=node.length*8;if(storage>maxBytes)fail();objects[i]=new Array(node.length);break;
      case 'Map':objects[i]=new Map();break;
      case 'Set':objects[i]=new Set();break;
      case 'Date':objects[i]=new Date(0);break;
      case 'RegExp':if(typeof node.source!=='string'||typeof node.flags!=='string')fail();objects[i]=new RegExp(node.source,node.flags);break;
      case 'ArrayBuffer':
        if(!Array.isArray(node.bytes))fail();storage+=node.bytes.length;if(storage>maxBytes)fail();
        if(node.bytes.some(byte=>!integer(byte,255)))fail();objects[i]=Uint8Array.from(node.bytes).buffer;break;
      default:if(node.type!=='DataView'&&!typed.has(node.type))fail();
    }
  }
  for(let i=0;i<nodes.length;i++) {
    const node=nodes[i];if(node.type!=='DataView'&&!typed.has(node.type))continue;
    if(!record(node.buffer)||Object.keys(node.buffer).length!==1||!integer(node.buffer.ref,nodes.length-1)||nodes[node.buffer.ref].type!=='ArrayBuffer'||!integer(node.offset)||!integer(node.length))fail();
    const buffer=objects[node.buffer.ref];
    try{objects[i]=node.type==='DataView'?new DataView(buffer,node.offset,node.length):new (typed.get(node.type))(buffer,node.offset,node.length);}catch{fail();}
  }
  for(let i=0;i<nodes.length;i++) {
    const node=nodes[i],object=objects[i];
    if(['Object','Array','Map'].includes(node.type)) {
      if(!Array.isArray(node.entries))fail();const keys=new Set();
      for(const entry of node.entries) {
        if(!Array.isArray(entry)||entry.length!==2)fail();
        if(node.type==='Map')object.set(value(entry[0]),value(entry[1]));
        else {
          const key=entry[0];if(typeof key!=='string'||keys.has(key)||node.type==='Array'&&(key==='length'||/^(?:0|[1-9][0-9]*)$/.test(key)&&Number(key)>=node.length))fail();keys.add(key);
          Object.defineProperty(object,key,{value:value(entry[1]),writable:true,enumerable:true,configurable:true});
        }
      }
    } else if(node.type==='Set') {
      if(!Array.isArray(node.values))fail();for(const token of node.values)object.add(value(token));
    } else if(node.type==='Date') {
      const time=value(node.time);if(typeof time!=='number')fail();object.setTime(time);
    }
  }
  const root=value(graph.root);if(!root||typeof root!=='object'||Array.isArray(root))fail();return root;
}
