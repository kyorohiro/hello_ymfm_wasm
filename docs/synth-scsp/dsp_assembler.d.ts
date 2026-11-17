/** Provisional field assembly in physical step order.
 * Decimal step numbers range from 0 through 127 and must increase strictly.
 * A line such as `003: EWT=1 COEF=1` describes one physical microstep.
 * Fields accept unsigned decimal / hexadecimal integers. Semicolons begin
 * comments. Missing fields and omitted step positions contain zero.
 * Returns a fresh 512-word image in logical SCSP MPRO order.
 */
export declare function assembleScspDsp(source: string): Uint16Array;

/** Convert a complete 512-word image into editable field assembly.
 * Compact output includes every step through the last nonzero instruction.
 * An all-zero image produces an empty string. The full form includes 128 lines.
 * RAW0 through RAW3 preserve bits uninterpreted by the pinned SCSP DSP core.
 * The supplied image is read without modification.
 */
export declare function disassembleScspDsp(
  words: Uint16Array | readonly number[],
  options?: {includeTrailingZeros?: boolean},
): string;
