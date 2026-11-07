//! Player: drives the 6510 and renders SID audio.

use mos6502::cpu::CPU;
use mos6502::instruction::Nmos6502;
use mos6502::memory::Bus;
use mos6502::registers::StackPointer;
use sidera::{ChipModel, Sid};

use crate::bus::C64;
use crate::psid::Psid;

type Cpu = CPU<C64, Nmos6502>;

/// Upper bound on the multispeed factor. A garbage/tiny CIA latch must not turn
/// into hundreds of play calls per frame; digi-style tunes wanting more than
/// this can't play correctly in a frame-driven model anyway. When the derived
/// factor exceeds this, [`Player::new`] caps it and says so (no silent cap).
const MAX_SPEED: u32 = 16;

pub(crate) struct Player {
    pub(crate) cpu: Cpu,
    play_addr: u16,
    sample_rate: u32,
    refresh: u32,
    /// How many times to call the play routine per video frame (multispeed
    /// approximation; 1 for a normal VBI tune). See [`Player::multispeed_factor`].
    speed: u32,
    /// Bresenham accumulator so the per-frame sample count averages exactly
    /// `sample_rate / refresh` with no long-term drift.
    frac: u64,
}

impl Player {
    pub(crate) fn new(
        psid: &Psid,
        song0: u8,
        model: ChipModel,
        sample_rate: u32,
        refresh: u32,
    ) -> Player {
        let mut sid = Sid::new(sample_rate);
        sid.set_model(model);
        let mut cpu = CPU::new(C64::new(sid), Nmos6502);

        // Load the C64 data into RAM at the load address.
        let base = psid.load_addr;
        for (i, &b) in psid.data.iter().enumerate() {
            let a = base.wrapping_add(i as u16);
            cpu.memory.ram[a as usize] = b;
        }

        // Initialise: A = song number (0-based), then JSR init.
        cpu.registers.stack_pointer = StackPointer(0xff);
        cpu.registers.accumulator = song0;
        cpu.registers.index_x = 0;
        cpu.registers.index_y = 0;
        let mut p = Player {
            cpu,
            play_addr: psid.play_addr,
            sample_rate,
            refresh,
            speed: 1,
            frac: 0,
        };
        p.call(psid.init_addr);
        // PSID tunes with play address 0 install their own interrupt handler at
        // init time and expect to be entered once per frame *as an IRQ* (the
        // minimal player otherwise stays silent — `render_frame` falls back to
        // the installed vector). Real KERNAL `$0314` handlers commonly end with
        // `JMP $EA31`, which pulls Y/X/A off the stack and `RTI`s. Plant that
        // exit stub in RAM (this bus has no ROM) so such a tail returns cleanly:
        //   $EA31: PLA TAY  PLA TAX  PLA  RTI
        for (off, byte) in [0x68u8, 0xA8, 0x68, 0xAA, 0x68, 0x40]
            .into_iter()
            .enumerate()
        {
            p.cpu.memory.ram[0xEA31 + off] = byte;
        }
        // A bare `RTI` at $EA81 covers handlers that exit via the KERNAL's
        // "no register restore" path.
        p.cpu.memory.ram[0xEA81] = 0x40;

        // Multispeed: a CIA-timed tune programs CIA #1 Timer A during init to a
        // period shorter than one frame so its play routine runs several times
        // per frame. Derive that factor now (the tune's init has just run) and
        // cap it, reporting the raw value when the cap bites.
        let ntsc = psid.prefer_ntsc == Some(true);
        let raw = Self::multispeed_factor(&p.cpu, psid.is_cia_timed(song0), ntsc, refresh);
        p.speed = raw.min(MAX_SPEED);
        if raw > MAX_SPEED {
            eprintln!(
                "note: multispeed tune — {raw}× per frame requested, capped to \
                 {MAX_SPEED}× (CIA #1 Timer A programmed at init)."
            );
        } else if p.speed > 1 {
            eprintln!(
                "note: multispeed tune — calling play {}× per frame \
                 (from CIA #1 Timer A programmed at init).",
                p.speed
            );
        }
        p
    }

    /// Raw multispeed factor: how many times the play routine should run per
    /// video frame, `round(frame_cycles / latch)` (minimum 1, *not* yet capped
    /// — [`Player::new`] applies [`MAX_SPEED`]).
    ///
    /// 1 for a normal vertical-blank tune. For a CIA-timed tune (PSID speed bit
    /// set) that programmed CIA #1 Timer A during init, the bus keeps
    /// `$DC04/$DC05` as plain RAM, so the latch value the tune wrote is still
    /// readable there. `frame_cycles = clock / refresh`, with `clock` taken from
    /// the tune's own video standard (`ntsc`) rather than the replay rate, so a
    /// manual `--hz` that differs from the tune's standard doesn't skew it.
    /// Tunes that program the timer only later (in play/IRQ) or not at all fall
    /// back to 1 — an accepted limitation of this approximation.
    fn multispeed_factor(cpu: &Cpu, cia_timed: bool, ntsc: bool, refresh: u32) -> u32 {
        if !cia_timed || refresh == 0 {
            return 1;
        }
        let latch = cpu.memory.ram[0xDC04] as u32 | ((cpu.memory.ram[0xDC05] as u32) << 8);
        if latch == 0 {
            return 1; // timer not programmed at init — can't tell
        }
        let clock = if ntsc { 1_022_727 } else { 985_248u32 };
        let frame_cycles = clock / refresh;
        ((frame_cycles + latch / 2) / latch).max(1)
    }

    /// Invoke the tune once: its `play` routine, or the installed IRQ handler
    /// when the PSID play address is 0.
    fn step_play(&mut self) {
        if self.play_addr != 0 {
            self.call(self.play_addr);
        } else {
            self.call_irq();
        }
    }

    /// Drive the tune's installed interrupt handler once (for PSID `play == 0`).
    /// Resolves the handler each call (a tune may re-install it): the KERNAL
    /// vector `$0314/$0315` when set (entered the KERNAL way — hardware frame +
    /// A/X/Y, matching a `JMP $EA31` tail), else the hardware vector
    /// `$FFFE/$FFFF` (entered bare — hardware frame only, self-contained `RTI`
    /// tail). Returns `false` if no handler is installed.
    fn call_irq(&mut self) -> bool {
        let rb = |m: &mut Cpu, a: u16| m.memory.ram[a as usize];
        let kernal = (rb(&mut self.cpu, 0x0314) as u16) | ((rb(&mut self.cpu, 0x0315) as u16) << 8);
        let hw = (rb(&mut self.cpu, 0xfffe) as u16) | ((rb(&mut self.cpu, 0xffff) as u16) << 8);
        let (vector, push_axy) = if kernal != 0 {
            (kernal, true)
        } else if hw != 0 {
            (hw, false)
        } else {
            return false;
        };

        let sp0 = self.cpu.registers.stack_pointer.0;
        // Snapshot the registers the pushes need (read before the &mut borrow).
        let (a, x, y) = (
            self.cpu.registers.accumulator,
            self.cpu.registers.index_x,
            self.cpu.registers.index_y,
        );
        // Pushed status: B clear, unused + I set (a real IRQ entry).
        let p_byte = (self.cpu.registers.status.bits() & !0x10) | 0x24;
        let push = |cpu: &mut Cpu, v: u8| {
            let sp = cpu.registers.stack_pointer.0;
            cpu.memory.set_byte(0x0100 + sp as u16, v);
            cpu.registers.stack_pointer = StackPointer(sp.wrapping_sub(1));
        };
        // Hardware IRQ frame: PCH, PCL, P (return PC = $0000 sentinel).
        push(&mut self.cpu, 0x00);
        push(&mut self.cpu, 0x00);
        push(&mut self.cpu, p_byte);
        if push_axy {
            // KERNAL $FF48 then pushes A, X, Y (Y ends on top, matching the
            // `JMP $EA31` exit's PLA-TAY / PLA-TAX / PLA order).
            push(&mut self.cpu, a);
            push(&mut self.cpu, x);
            push(&mut self.cpu, y);
        }
        self.cpu.registers.program_counter = vector;

        let mut guard: u32 = 0;
        while self.cpu.registers.stack_pointer.0 != sp0 {
            if !self.cpu.single_step() {
                break;
            }
            guard += 1;
            if guard > 5_000_000 {
                break;
            }
        }
        true
    }

    /// Execute a subroutine to completion: push a 2-byte sentinel return, set PC,
    /// then single-step until the matching RTS pops it (stack pointer back to its
    /// pre-call value), bounded by a runaway guard.
    fn call(&mut self, addr: u16) {
        let sp0 = self.cpu.registers.stack_pointer.0;
        let mut sp = sp0;
        self.cpu.memory.set_byte(0x0100 + sp as u16, 0x00);
        sp = sp.wrapping_sub(1);
        self.cpu.memory.set_byte(0x0100 + sp as u16, 0x00);
        sp = sp.wrapping_sub(1);
        self.cpu.registers.stack_pointer = StackPointer(sp);
        self.cpu.registers.program_counter = addr;

        let mut guard: u32 = 0;
        while self.cpu.registers.stack_pointer.0 != sp0 {
            if !self.cpu.single_step() {
                // The NMOS core decodes the documented set, BCD, and the stable
                // illegal opcodes (LAX/SAX/DCP/ISC/SLO/SRE/RLA/RRA…). Only the
                // unstable illegals (SHA/SHX/SHY/TAS/LXA/ANE) and JAM halt it —
                // bail out of the routine if a tune hits one.
                break;
            }
            guard += 1;
            if guard > 5_000_000 {
                break; // runaway routine
            }
        }
    }

    /// Render one video frame: call `play` (`self.speed` times for a multispeed
    /// tune), producing the frame's samples interleaved between the calls so
    /// sub-frame register writes land at roughly the right time. Identical to a
    /// single `play` + full-frame render when `speed == 1`.
    pub(crate) fn render_frame(&mut self) -> Vec<i16> {
        self.frac += self.sample_rate as u64;
        let n = (self.frac / self.refresh as u64) as usize;
        self.frac %= self.refresh as u64;

        let mut out = Vec::with_capacity(n);
        let speed = self.speed as u64;
        for k in 0..speed {
            self.step_play();
            // Sample slice [lo, hi) for this call, distributing `n` evenly.
            let lo = (n as u64 * k / speed) as usize;
            let hi = (n as u64 * (k + 1) / speed) as usize;
            for _ in lo..hi {
                out.push(self.cpu.memory.sid.clock());
            }
        }
        out
    }
}
