// Only the Playground display/Worker boundary serializes errors. Native consoles
// should keep receiving the original objects (including in Node.js).
export function serializeLogError(value) {
  const tag = Object.prototype.toString.call(value);
  if (tag !== '[object Error]' && tag !== '[object DOMException]') return value;
  const heading = `${value.name || 'Error'}: ${value.message || ''}`;
  const stack = typeof value.stack === 'string' ? value.stack : '';
  return stack ? (stack.startsWith(heading) ? stack : `${heading}\n${stack}`) : heading;
}

export function formatLogArgs(args) {
  return args.map(value => {
    value = serializeLogError(value);
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }).join(' ');
}
