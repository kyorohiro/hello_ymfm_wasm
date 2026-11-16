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

/** Small bounded text table for register-write inspection in the Code Console.
 * The API's original data is unchanged; long displays identify omitted rows. */
export function formatLogTable(data, columns) {
  if (!Array.isArray(data)) return formatLogArgs([data]);
  if (!data.length) return '(empty table)';
  const rows=data.slice(0,200);
  const keys=columns===undefined?[...new Set(rows.flatMap(row=>row&&typeof row==='object'?Object.keys(row):['value']))]:columns;
  if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'))throw new TypeError('Console table columns must be strings');
  const selected=keys.slice(0,32),headers=['(index)',...selected];
  const text=value=>formatLogArgs([value]).replace(/[\r\n\t]/g,' ').slice(0,80);
  const cells=[headers,...rows.map((row,index)=>[String(index),...selected.map(key=>text(row&&typeof row==='object'?row[key]:key==='value'?row:undefined))])];
  const widths=headers.map((_,column)=>Math.max(...cells.map(row=>row[column].length)));
  const lines=cells.map(row=>row.map((value,index)=>value.padEnd(widths[index])).join(' | '));
  if(data.length>rows.length)lines.push(`… ${data.length-rows.length} more rows (data remains complete).`);
  if(keys.length>selected.length)lines.push(`… ${keys.length-selected.length} more columns.`);
  return lines.join('\n');
}
