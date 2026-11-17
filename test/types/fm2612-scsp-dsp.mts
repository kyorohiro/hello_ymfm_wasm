// Installed consumer coverage under NodeNext, Bundler and browser DOM types.
import {assembleScspDsp, disassembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';
import {assembleScspDsp as assembleBare, disassembleScspDsp as disassembleBare} from 'tetorica-fm2612/scsp_dsp_assembler';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type WordsAreTyped = Assert<IsAny<ReturnType<typeof assembleScspDsp>> extends false ? true : false>;
type SourceIsTyped = Assert<IsAny<ReturnType<typeof disassembleScspDsp>> extends false ? true : false>;

const source = '003: EWT=1 COEF=1';
const words:Uint16Array = assembleScspDsp(source);
const sameAssembly:typeof assembleScspDsp = assembleBare;
const sameDisassembly:typeof disassembleScspDsp = disassembleBare;
const listing:string = disassembleScspDsp(words);
const full:string = disassembleBare(words, {includeTrailingZeros:true});
const readonlyWords:readonly number[] = Array.from(words);
const fromReadonly:string = disassembleScspDsp(readonlyWords, {includeTrailingZeros:false});
const fromNumbers:string = disassembleBare(Array.from(words));
void [sameAssembly, sameDisassembly, listing, full, fromReadonly, fromNumbers];

// @ts-expect-error Assembly source is text.
assembleScspDsp(new Uint8Array(512));
// @ts-expect-error Assembly does not accept an object through string coercion.
assembleBare({toString:() => source});
// @ts-expect-error Assembly is synchronous and returns an owned word image.
const pending:Promise<Uint16Array> = assembleScspDsp(source);
// @ts-expect-error Disassembly reads 16-bit words or numeric arrays.
disassembleScspDsp(new Uint8Array(1024));
// @ts-expect-error A raw byte buffer must first be decoded into logical words.
disassembleBare(new ArrayBuffer(1024));
// @ts-expect-error DataView is not the logical MPRO word representation.
disassembleScspDsp(new DataView(new ArrayBuffer(1024)));
// @ts-expect-error The trailing-zero option is boolean.
disassembleScspDsp(words, {includeTrailingZeros:'all'});
// @ts-expect-error Options retain their public spelling.
disassembleBare(words, {trailingZeros:true});
// @ts-expect-error Disassembly options are optional objects.
disassembleScspDsp(words, null);
// @ts-expect-error A listing is text.
const numericListing:number = disassembleBare(words);
void [pending, numericListing];
