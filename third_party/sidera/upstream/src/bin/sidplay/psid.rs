//! PSID/RSID header parsing.

/// The parsed parts of a PSID/RSID header we need (all multi-byte fields are
/// big-endian on disk).
pub(crate) struct Psid {
    pub(crate) is_rsid: bool,
    pub(crate) load_addr: u16,
    pub(crate) init_addr: u16,
    pub(crate) play_addr: u16,
    pub(crate) songs: u16,
    pub(crate) start_song: u16,
    /// The 32-bit PSID `speed` field: one bit per sub-song, 0 = vertical-blank
    /// (VBI) timing, 1 = CIA #1 Timer A timing. Drives the multispeed heuristic.
    pub(crate) speed_bits: u32,
    pub(crate) name: String,
    pub(crate) author: String,
    /// Preferred video standard from the PSID v2+ flags word: `Some(true)` =
    /// NTSC, `Some(false)` = PAL, `None` = unspecified (v1 header, or the
    /// "unknown"/"both" encodings). Drives the default replay rate.
    pub(crate) prefer_ntsc: Option<bool>,
    /// Preferred SID model from the PSID v2+ flags word: `Some(true)` = 8580,
    /// `Some(false)` = 6581, `None` = unspecified.
    pub(crate) prefer_8580: Option<bool>,
    /// C64 data (the bytes that get loaded into RAM at `load_addr`).
    pub(crate) data: Vec<u8>,
}

impl Psid {
    pub(crate) fn parse(raw: &[u8]) -> Result<Psid, String> {
        if raw.len() < 0x80 {
            return Err("file too short to be a PSID".into());
        }
        let magic = &raw[0..4];
        let is_rsid = match magic {
            b"PSID" => false,
            b"RSID" => true,
            _ => return Err(format!("not a PSID/RSID file (magic {magic:?})")),
        };
        let be16 = |o: usize| u16::from_be_bytes([raw[o], raw[o + 1]]);
        let version = be16(0x04);
        let data_offset = be16(0x06) as usize;
        let mut load_addr = be16(0x08);
        let init_addr = be16(0x0a);
        let play_addr = be16(0x0c);
        let songs = be16(0x0e);
        let start_song = be16(0x10);
        let speed_bits = u32::from_be_bytes([raw[0x12], raw[0x13], raw[0x14], raw[0x15]]);
        let read_str = |o: usize| {
            String::from_utf8_lossy(&raw[o..o + 32])
                .trim_end_matches('\0')
                .trim()
                .to_string()
        };
        let name = read_str(0x16);
        let author = read_str(0x36);

        // PSID v2NG+ carries clock/model hints in the flags word at $76. A v1
        // header ends at $76 (that offset is already tune data), so only trust
        // the flags from version 2 onward; the file is guaranteed >= 0x80 bytes.
        let (prefer_ntsc, prefer_8580) = if version >= 2 {
            let flags = be16(0x76);
            let ntsc = match (flags >> 2) & 0b11 {
                0b01 => Some(false), // PAL
                0b10 => Some(true),  // NTSC
                _ => None,           // unknown / both
            };
            let is8580 = match (flags >> 4) & 0b11 {
                0b01 => Some(false), // 6581
                0b10 => Some(true),  // 8580
                _ => None,           // unknown / both
            };
            (ntsc, is8580)
        } else {
            (None, None)
        };

        if data_offset >= raw.len() {
            return Err("dataOffset past end of file".into());
        }
        let mut data = &raw[data_offset..];
        // loadAddress == 0 → the real load address is the first two bytes of the
        // C64 data (little-endian), and the payload follows.
        if load_addr == 0 {
            if data.len() < 2 {
                return Err("missing inline load address".into());
            }
            load_addr = u16::from_le_bytes([data[0], data[1]]);
            data = &data[2..];
        }
        Ok(Psid {
            is_rsid,
            load_addr,
            init_addr,
            play_addr,
            songs,
            start_song,
            speed_bits,
            name,
            author,
            prefer_ntsc,
            prefer_8580,
            data: data.to_vec(),
        })
    }

    /// True if the PSID `speed` field marks this (0-based) sub-song as CIA-timed
    /// (bit set) rather than vertical-blank timed. Sub-songs past 32 reuse the
    /// top bit, per the PSID spec.
    pub(crate) fn is_cia_timed(&self, song0: u8) -> bool {
        let bit = song0.min(31);
        self.speed_bits & (1u32 << bit) != 0
    }
}
