//! C64 bus: 64 KB RAM with the SID mapped at `$D400-$D7FF`.

use mos6502::memory::Bus;
use sidera::registers::{ENV3, OSC3};
use sidera::Sid;

pub(crate) struct C64 {
    pub(crate) ram: Box<[u8; 0x10000]>,
    pub(crate) sid: Sid,
    /// Shadow of the last value written to each SID register ($D400-$D418),
    /// for the `--regdump` diagnostic (the chip itself is write-only).
    pub(crate) regs: [u8; 0x20],
}

impl C64 {
    pub(crate) fn new(sid: Sid) -> C64 {
        // Power-on work RAM is zero-filled. A "realistic" alternating
        // $00/$FF DRAM pattern (e.g. keyed on address bit 6) was tried, but it
        // feeds garbage into tunes that read *uninitialised* work-RAM as an
        // index/pointer: The Last V8's IRQ handler then jumps into a data table,
        // executes a `$12` (JAM) byte, and the 6502 core halts permanently
        // (WaitState::WaitingForReset), freezing the tune after ~1 s. Zero-fill
        // plays the whole local test set cleanly. Bytes the player later
        // initialises (DDR/banking, the loaded tune image, the IRQ stub) are
        // overwritten below.
        let mut ram = Box::new([0u8; 0x10000]);
        ram[0x00] = 0x2f; // data-direction register
        ram[0x01] = 0x37; // default banking (RAM + I/O visible)
        C64 {
            ram,
            sid,
            regs: [0u8; 0x20],
        }
    }
}

impl Bus for C64 {
    fn get_byte(&mut self, addr: u16) -> u8 {
        if (0xd400..=0xd7ff).contains(&addr) {
            // SID register reads (mirrored every 32 bytes). Only OSC3/ENV3 are
            // meaningful; write-only registers read back as a floating bus.
            let reg = ((addr - 0xd400) & 0x1f) as u8;
            return match reg {
                OSC3 | ENV3 => self.sid.read_register(reg),
                _ => 0xff,
            };
        }
        self.ram[addr as usize]
    }

    fn set_byte(&mut self, addr: u16, value: u8) {
        if (0xd400..=0xd7ff).contains(&addr) {
            let reg = ((addr - 0xd400) & 0x1f) as u8;
            self.regs[reg as usize] = value;
            self.sid.write_register(reg, value); // ignores read-only regs
            return;
        }
        self.ram[addr as usize] = value;
    }
}
