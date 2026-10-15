/** Bytes in the supplied view only are read; byteOffset and byteLength are respected. */
export type SysexBytes = ArrayBuffer | ArrayBufferView;

export interface DX7Voice {
  /** Up to ten ASCII characters; controls displayed as spaces and trailing spaces removed. */
  name: string;
  /** Independent 155-byte VCED copy. Operators are stored OP6 through OP1. */
  data: Uint8Array;
  /** Independent 128-byte VMEM copy, preserving every legal packed parameter and name byte. */
  packedData: Uint8Array;
}

export interface DX7Sysex {
  voices: DX7Voice[];
  format: 'voice' | 'bank';
  /** Yamaha device/channel nibble, zero based: 0 through 15. */
  channel: number;
}

export interface SysexOptions {
  /** Zero-based Yamaha device/channel nibble, 0 through 15. Default: 0. */
  channel?: number;
}

/**
 * Parse exactly one 163-byte voice dump or 4104-byte bank dump.
 * Throws on invalid framing, length, checksum, parameter range, or reserved packed bits.
 * Concatenated dumps and MIDI parameter-change messages are not supported.
 */
export function parseSysex(input: SysexBytes): DX7Sysex;
/** Validate and unpack one 128-byte VMEM voice into a new 155-byte VCED array. */
export function unpackVoice(packedData: SysexBytes): Uint8Array;
/** Validate and pack one 155-byte VCED voice into a new 128-byte VMEM array. */
export function packVoice(data: SysexBytes): Uint8Array;
/** Encode one 155-byte VCED voice; input bytes are not modified. */
export function createVoiceSysex(data: SysexBytes, options?: SysexOptions): Uint8Array;
/** Encode exactly 32 155-byte VCED voices; input bytes are not modified. */
export function createBankSysex(voices: readonly SysexBytes[], options?: SysexOptions): Uint8Array;
/** Create an original, one-carrier sine voice with up to ten printable ASCII name characters. */
export function createInitVoice(name?: string): Uint8Array;
