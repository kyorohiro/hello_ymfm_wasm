// SPDX-License-Identifier: BSD-3-Clause
// Original closed-loop fixture host: real pinned m6502 + candidate SID. Not a C64.
#![allow(dead_code)]
#[path = "lib.rs"]
mod probe;
use probe::Probe;
use std::ffi::c_void;
use std::sync::Mutex;

pub const CLOCK: u64 = 985248;
pub const MAX_RUN: u32 = 32768;
pub const MAX_CYCLES: u64 = 60 * CLOCK;
pub const FIXTURE_COUNT: u32 = 6;
pub const MAX_INSTANCES: usize = 4;
pub const ERROR_RESULT: u32 = u32::MAX;
const LOAD: usize = 0x0800;
const READ_TRACE_CAPACITY: usize = 256;
const RW: u64 = 1 << 24;
const SYNC: u64 = 1 << 25;
extern "C" {
    fn sid8c_size() -> u32;
    fn sid8c_alignment() -> u32;
    fn sid8c_init(storage: *mut c_void);
    fn sid8c_tick(storage: *mut c_void) -> u64;
    fn sid8c_data(storage: *mut c_void, value: u32);
    fn sid8c_register(storage: *mut c_void, index: u32) -> u32;
}
#[repr(C, align(16))]
struct CpuStorage {
    bytes: [u8; 256],
}
#[derive(Clone, Copy, Debug)]
pub struct ReadEvent {
    pub cycle: u64,
    pub address: u32,
    pub value: u32,
    pub error: u32,
}

// Every instruction below is original test code. Labels are resolved without
// ROM, game bytes, host-side reads or replacement CPU instruction handlers.
struct Program {
    bytes: Vec<u8>,
    labels: Vec<(&'static str, usize)>,
    refs: Vec<(usize, &'static str, bool)>,
}
impl Program {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            labels: Vec::new(),
            refs: Vec::new(),
        }
    }
    fn emit(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }
    fn label(&mut self, name: &'static str) {
        self.labels.push((name, self.bytes.len()));
    }
    fn absolute(&mut self, opcode: u8, address: u16) {
        self.emit(&[opcode, address as u8, (address >> 8) as u8]);
    }
    fn target(&mut self, opcode: u8, name: &'static str, relative: bool) {
        self.emit(&[opcode]);
        self.refs.push((self.bytes.len(), name, relative));
        self.emit(if relative { &[0] } else { &[0, 0] });
    }
    fn store(&mut self, address: u16, value: u8) {
        self.emit(&[0xa9, value]);
        self.absolute(0x8d, address);
    }
    fn delay(&mut self, count: u8, outer: &'static str, inner: &'static str) {
        self.emit(&[0xa0, count]);
        self.label(outer);
        self.emit(&[0xa2, 0]);
        self.label(inner);
        self.emit(&[0xca]);
        self.target(0xd0, inner, true);
        self.emit(&[0x88]);
        self.target(0xd0, outer, true);
    }
    fn done(&mut self) {
        self.label("done");
        self.store(0x020f, 0xa5);
        self.label("idle");
        self.target(0x4c, "idle", false);
    }
    fn failed(&mut self) {
        self.store(0x020e, 0xee);
        self.target(0x4c, "done", false);
    }
    fn check_a(&mut self, value: u8, next: &'static str) {
        self.emit(&[0xc9, value]);
        self.target(0xf0, next, true);
        self.failed();
        self.label(next);
    }
    fn audio(&mut self) {
        for (address, value) in [
            (0xd418, 8),
            (0xd400, 37),
            (0xd401, 20),
            (0xd402, 0),
            (0xd403, 8),
            (0xd405, 0),
            (0xd406, 0xf0),
            (0xd404, 0x21),
        ] {
            self.store(address, value);
        }
    }
    fn finish(mut self) -> Option<Vec<u8>> {
        for (offset, name, relative) in self.refs {
            let position = self.labels.iter().find(|(label, _)| *label == name)?.1;
            if relative {
                let delta = position as isize - offset as isize - 1;
                if !(-128..=127).contains(&delta) {
                    return None;
                }
                self.bytes[offset] = delta as i8 as u8;
            } else {
                let address = LOAD + position;
                self.bytes[offset] = address as u8;
                self.bytes[offset + 1] = (address >> 8) as u8;
            }
        }
        Some(self.bytes)
    }
}
pub fn fixture_program(fixture: u32) -> Option<Vec<u8>> {
    let mut p = Program::new();
    p.emit(&[0x78]); // SEI; no host IRQ/ROM environment.
    match fixture {
        0 => {
            p.audio();
            p.store(0xd400, 0xa5);
            p.absolute(0xad, 0xd400);
            p.absolute(0x8d, 0x0200);
            p.check_a(0xa5, "bus-ok");
            p.store(0x0201, 0x11);
            p.store(0xd400, 0x40);
            p.done();
        }
        1 => {
            p.audio();
            p.store(0xd400, 0xa5);
            p.delay(32, "delay-outer", "delay-inner");
            p.absolute(0xad, 0xd400);
            p.absolute(0x8d, 0x0200);
            p.emit(&[0xc9, 0]);
            p.target(0xf0, "zero", true);
            p.emit(&[0xc9, 0xa5]);
            p.target(0xf0, "held", true);
            p.failed();
            p.label("zero");
            p.store(0x0201, 0x32);
            p.store(0xd400, 0x40);
            p.target(0x4c, "done", false);
            p.label("held");
            p.store(0x0201, 0x31);
            p.store(0xd400, 0x80);
            p.done();
        }
        2 => {
            p.audio();
            for (address, value) in [
                (0xd40e, 0x45),
                (0xd40f, 0x23),
                (0xd413, 0),
                (0xd414, 0xf0),
                (0xd412, 0x29),
            ] {
                p.store(address, value);
            }
            p.delay(6, "test-outer", "test-inner");
            p.absolute(0xad, 0xd41b);
            p.absolute(0x8d, 0x0200);
            p.check_a(0, "test-ok");
            p.absolute(0xad, 0xd41c);
            p.absolute(0x8d, 0x0201);
            p.check_a(255, "env-ok");
            p.store(0xd412, 0x21);
            p.delay(1, "osc-outer", "osc-inner");
            p.absolute(0xad, 0xd41b);
            p.absolute(0x8d, 0x0202);
            p.target(0xd0, "osc-ok", true);
            p.failed();
            p.label("osc-ok");
            p.absolute(0xad, 0xd41c);
            p.absolute(0x8d, 0x0203);
            p.check_a(255, "env-held");
            p.absolute(0xad, 0x0202);
            p.absolute(0x8d, 0xd400);
            p.store(0x020e, 0x51);
            p.done();
        }
        3 => {
            p.absolute(0xad, 0xd419);
            p.absolute(0x8d, 0x0200);
            p.done();
        }
        4 => {
            p.store(0x0200, 0x4a);
            p.emit(&[0x02]);
        }
        5 => {
            p.absolute(0xad, 0xe000);
            p.absolute(0x8d, 0x0200);
            p.done();
        }
        _ => return None,
    }
    p.finish()
}

pub struct CpuProbe {
    cpu: CpuStorage,
    sid: Probe,
    ram: Box<[u8]>,
    fixture: u32,
    program_len: usize,
    stopped: bool,
    error: u32,
    address: u32,
    instructions: u32,
    reads: Vec<ReadEvent>,
    read_overflow: u32,
    write_count: u32,
    write_hash: u32,
    written: [u8; 32],
    output: [i16; 4096],
    output_len: usize,
}
impl CpuProbe {
    pub fn new(rate: u32, model: u32, fixture: u32) -> Option<Self> {
        if unsafe { sid8c_size() } > 256 || unsafe { sid8c_alignment() } > 16 {
            return None;
        }
        let program = fixture_program(fixture)?;
        let mut result = Self {
            cpu: CpuStorage { bytes: [0; 256] },
            sid: Probe::new(rate, model)?,
            ram: vec![0; 65536].into_boxed_slice(),
            fixture,
            program_len: program.len(),
            stopped: false,
            error: 0,
            address: 0,
            instructions: 0,
            reads: Vec::new(),
            read_overflow: 0,
            write_count: 0,
            write_hash: 0x811c9dc5,
            written: [0; 32],
            output: [0; 4096],
            output_len: 0,
        };
        result.load_program(&program);
        Some(result)
    }
    fn pointer(&mut self) -> *mut c_void {
        self.cpu.bytes.as_mut_ptr().cast()
    }
    fn load_program(&mut self, program: &[u8]) {
        self.ram.fill(0);
        self.ram[LOAD..LOAD + program.len()].copy_from_slice(program);
        for address in [0xfffa, 0xfffc, 0xfffe] {
            self.ram[address] = LOAD as u8;
            self.ram[address + 1] = (LOAD >> 8) as u8;
        }
        unsafe {
            sid8c_init(self.pointer());
        }
    }
    pub fn reset(&mut self) {
        let program = fixture_program(self.fixture).expect("Previously valid authored fixture");
        self.sid.reset();
        self.load_program(&program);
        self.stopped = false;
        self.error = 0;
        self.address = 0;
        self.instructions = 0;
        self.reads.clear();
        self.read_overflow = 0;
        self.write_count = 0;
        self.write_hash = 0x811c9dc5;
        self.written.fill(0);
        self.output.fill(0);
        self.output_len = 0;
    }
    pub fn stop(&mut self) {
        self.sid.stop();
        self.stopped = true;
        self.output.fill(0);
        self.output_len = 0;
    }
    fn fault(&mut self, code: u32, address: u32) {
        self.error = code;
        self.address = address;
        self.stopped = true;
    }
    fn record_read(&mut self, address: u32, value: u32, error: u32) {
        let event = ReadEvent {
            cycle: self.cycles(),
            address,
            value,
            error,
        };
        if self.reads.len() < READ_TRACE_CAPACITY {
            self.reads.push(event);
        } else {
            self.read_overflow += 1;
        }
    }
    fn record_write(&mut self, address: u32, value: u8) {
        self.write_count += 1;
        for byte in self
            .cycles()
            .to_le_bytes()
            .into_iter()
            .chain((address as u16).to_le_bytes())
            .chain([value])
        {
            self.write_hash = (self.write_hash ^ u32::from(byte)).wrapping_mul(0x01000193);
        }
        self.written[(address & 31) as usize] = value;
    }
    pub fn run(&mut self, cycles: u32) -> Result<usize, u32> {
        self.output_len = 0;
        self.output.fill(0);
        if cycles > MAX_RUN {
            if !self.stopped {
                self.error = 2;
            }
            return Err(2);
        }
        if self.stopped {
            return Ok(0);
        }
        self.error = 0;
        if self
            .cycles()
            .checked_add(u64::from(cycles))
            .map_or(true, |sum| sum > MAX_CYCLES)
        {
            let pc = self.cpu_register(0);
            self.fault(11, pc);
            return Ok(0);
        }
        for _ in 0..cycles {
            let pins = unsafe { sid8c_tick(self.pointer()) };
            let address = (pins & 65535) as u32;
            let count = self.sid.run(1).map_err(|_| 6u32)?;
            for &sample in self.sid.output().iter().take(count) {
                self.output[self.output_len] = sample;
                self.output_len += 1;
            }
            let reading = pins & RW != 0;
            if (0xd400..0xd800).contains(&address) {
                if pins & SYNC != 0 {
                    self.fault(3, address);
                    break;
                }
                if reading {
                    match self.sid.read(address & 31) {
                        Ok(value) => {
                            self.record_read(address, u32::from(value), 0);
                            unsafe {
                                sid8c_data(self.pointer(), u32::from(value));
                            }
                        }
                        Err(error) => {
                            let code = error as u32;
                            self.record_read(address, 256, code);
                            self.fault(code, address);
                            break;
                        }
                    }
                } else {
                    let value = ((pins >> 16) & 255) as u8;
                    if !self.sid.write(address & 31, u32::from(value)) {
                        self.fault(6, address);
                        break;
                    }
                    self.record_write(address, value);
                }
            } else if address < 0xd000 || (reading && address >= 0xfffa) {
                if reading {
                    let value = self.ram[address as usize];
                    if pins & SYNC != 0 {
                        self.instructions += 1;
                        if matches!(
                            value,
                            0x02 | 0x12
                                | 0x22
                                | 0x32
                                | 0x42
                                | 0x52
                                | 0x62
                                | 0x72
                                | 0x92
                                | 0xb2
                                | 0xd2
                                | 0xf2
                        ) {
                            self.fault(10, address);
                            break;
                        }
                    }
                    unsafe {
                        sid8c_data(self.pointer(), u32::from(value));
                    }
                } else {
                    self.ram[address as usize] = ((pins >> 16) & 255) as u8;
                }
            } else {
                self.fault(3, address);
                break;
            }
        }
        Ok(self.output_len)
    }
    pub fn cpu_register(&mut self, index: u32) -> u32 {
        unsafe { sid8c_register(self.pointer(), index) }
    }
    pub fn cycles(&self) -> u64 {
        self.sid.cycle_count()
    }
    pub fn frames(&self) -> u64 {
        self.sid.frame_count()
    }
    pub fn output(&self) -> &[i16] {
        &self.output[..self.output_len]
    }
    pub fn signature(&self, index: u32) -> u32 {
        if index < 16 {
            u32::from(self.ram[0x0200 + index as usize])
        } else {
            256
        }
    }
    pub fn reads(&self) -> &[ReadEvent] {
        &self.reads
    }
    pub fn program(&self) -> &[u8] {
        &self.ram[LOAD..LOAD + self.program_len]
    }
    pub fn write_count(&self) -> u32 {
        self.write_count
    }
    pub fn write_hash(&self) -> u32 {
        self.write_hash
    }
    pub fn written(&self, reg: u32) -> u32 {
        self.written
            .get(reg as usize)
            .map_or(256, |value| u32::from(*value))
    }
    pub fn state(&mut self, field: u32) -> u32 {
        match field {
            0 => self.error,
            1 => u32::from(self.stopped),
            2 => self.fixture,
            3 => self.sid.rate(),
            4 => self.sid.model(),
            5..=10 => self.cpu_register(field - 5),
            11 => u32::from(self.signature(15) == 0xa5),
            12 => self.address,
            13 => self.read_overflow,
            14 => self.instructions,
            _ => ERROR_RESULT,
        }
    }
}
struct Slot {
    generation: u32,
    probe: Option<Box<CpuProbe>>,
}
struct Registry {
    slots: Vec<Slot>,
}
impl Registry {
    fn new() -> Self {
        Self {
            slots: (0..MAX_INSTANCES)
                .map(|_| Slot {
                    generation: 0,
                    probe: None,
                })
                .collect(),
        }
    }
    fn create(&mut self, probe: CpuProbe) -> u32 {
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.probe.is_none() {
                slot.generation = (slot.generation + 1) & 0x00ff_ffff;
                if slot.generation == 0 {
                    slot.generation = 1;
                }
                slot.probe = Some(Box::new(probe));
                return (slot.generation << 8) | (index as u32 + 1);
            }
        }
        0
    }
    fn slot(&mut self, handle: u32) -> Option<&mut Slot> {
        let index = (handle & 255).checked_sub(1)? as usize;
        let slot = self.slots.get_mut(index)?;
        if handle >> 8 == 0 || handle >> 8 != slot.generation || slot.probe.is_none() {
            None
        } else {
            Some(slot)
        }
    }
}
static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);
fn registry<T>(operation: impl FnOnce(&mut Registry) -> T) -> Option<T> {
    let mut guard = REGISTRY.lock().ok()?;
    Some(operation(guard.get_or_insert_with(Registry::new)))
}
fn with_probe<T>(handle: u32, operation: impl FnOnce(&mut CpuProbe) -> T) -> Option<T> {
    registry(|registry| {
        registry
            .slot(handle)
            .and_then(|slot| slot.probe.as_deref_mut())
            .map(operation)
    })
    .flatten()
}
#[no_mangle]
pub extern "C" fn sid8cpu_create(rate: u32, model: u32, fixture: u32) -> u32 {
    let Some(probe) = CpuProbe::new(rate, model, fixture) else {
        return 0;
    };
    registry(|r| r.create(probe)).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_destroy(h: u32) -> u32 {
    registry(|r| {
        let Some(slot) = r.slot(h) else {
            return 0;
        };
        slot.probe = None;
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_run(h: u32, n: u32) -> u32 {
    with_probe(h, |p| p.run(n).map(|v| v as u32).unwrap_or(ERROR_RESULT)).unwrap_or(ERROR_RESULT)
}
#[no_mangle]
pub extern "C" fn sid8cpu_stop(h: u32) -> u32 {
    with_probe(h, |p| {
        p.stop();
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_reset(h: u32) -> u32 {
    with_probe(h, |p| {
        p.reset();
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_output(h: u32) -> *const i16 {
    with_probe(h, |p| p.output.as_ptr()).unwrap_or(std::ptr::null())
}
#[no_mangle]
pub extern "C" fn sid8cpu_output_frames(h: u32) -> u32 {
    with_probe(h, |p| p.output_len as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_state(h: u32, f: u32) -> u32 {
    with_probe(h, |p| p.state(f)).unwrap_or(ERROR_RESULT)
}
#[no_mangle]
pub extern "C" fn sid8cpu_cycles_lo(h: u32) -> u32 {
    with_probe(h, |p| p.cycles() as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_cycles_hi(h: u32) -> u32 {
    with_probe(h, |p| (p.cycles() >> 32) as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_frames_lo(h: u32) -> u32 {
    with_probe(h, |p| p.frames() as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_frames_hi(h: u32) -> u32 {
    with_probe(h, |p| (p.frames() >> 32) as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_signature(h: u32, i: u32) -> u32 {
    with_probe(h, |p| p.signature(i)).unwrap_or(256)
}
#[no_mangle]
pub extern "C" fn sid8cpu_written(h: u32, r: u32) -> u32 {
    with_probe(h, |p| p.written(r)).unwrap_or(256)
}
#[no_mangle]
pub extern "C" fn sid8cpu_read_count(h: u32) -> u32 {
    with_probe(h, |p| p.reads.len() as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_read_event(h: u32, i: u32, f: u32) -> u32 {
    with_probe(h, |p| {
        p.reads.get(i as usize).map_or(ERROR_RESULT, |v| match f {
            0 => v.cycle as u32,
            1 => (v.cycle >> 32) as u32,
            2 => v.address,
            3 => v.value,
            4 => v.error,
            _ => ERROR_RESULT,
        })
    })
    .unwrap_or(ERROR_RESULT)
}
#[no_mangle]
pub extern "C" fn sid8cpu_write_count(h: u32) -> u32 {
    with_probe(h, |p| p.write_count).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_write_hash(h: u32) -> u32 {
    with_probe(h, |p| p.write_hash).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8cpu_program(h: u32) -> *const u8 {
    with_probe(h, |p| p.program().as_ptr()).unwrap_or(std::ptr::null())
}
#[no_mangle]
pub extern "C" fn sid8cpu_program_len(h: u32) -> u32 {
    with_probe(h, |p| p.program_len as u32).unwrap_or(0)
}
