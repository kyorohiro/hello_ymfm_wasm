// Hosts may serve .gz assets already decompressed. Inspect the response bytes.
export async function decodeRuntimePack(response, expectedBytes) {
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack the LilyPond run-time data.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes.byteLength !== expectedBytes) throw new Error(`The run-time pack is ${bytes.byteLength} bytes; expected ${expectedBytes}.`);
  return bytes;
}
