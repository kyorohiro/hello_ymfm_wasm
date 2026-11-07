// SPDX-License-Identifier: BSD-3-Clause
// Isolated research adapter. Sidera retains its MIT license. No SDK/player use.
#![allow(dead_code)]

use sidera::{ChipModel, Sid, PAL_CLOCK};
use std::sync::Mutex;

pub const OUTPUT_CAPACITY: usize = 4096;
pub const MAX_INSTANCES: usize = 16;
pub const RUN_ERROR: u32 = u32::MAX;
pub const READ_ERROR: u32 = 256;
// Reference-emulator black-box boundaries, not measured hardware constants.
pub const BUS_TTL_6581: u32 = 7424;
pub const BUS_TTL_8580: u32 = 663552;
pub const CALIBRATION_PROFILE: &str = "8580-resonance-logfit-v1";

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    None = 0,
    InvalidHandle = 1,
    InvalidArgument = 2,
    OutputCapacity = 3,
    CounterOverflow = 4,
    UnsupportedRead = 5,
}

/// Each tick is one completed PHI2 period. Writes and reads never tick. For a
/// bus event whose start cycle is T under tick-then-commit timing, complete
/// T+1 ticks before its register access. PCM is sampled after that tick and
/// before the following register write. No event is rounded to an audio frame.
pub struct Probe {
    sid: Sid,
    rate: u32,
    model: u32,
    phase: u32,
    cycles: u64,
    frames: u64,
    stopped: bool,
    error: Error,
    bus_value: u8,
    bus_remaining: u32,
    written: [u8; 32],
    output: [i16; OUTPUT_CAPACITY],
    output_len: usize,
}

impl Probe {
    pub fn new(rate: u32, model: u32) -> Option<Self> {
        if !(8000..=96000).contains(&rate) || model > 1 {
            return None;
        }
        let mut sid = Sid::new(rate);
        sid.set_chip_clock(PAL_CLOCK);
        sid.set_model(if model == 0 {
            ChipModel::Mos6581
        } else {
            ChipModel::Mos8580
        });
        Some(Self {
            sid,
            rate,
            model,
            phase: 0,
            cycles: 0,
            frames: 0,
            stopped: false,
            error: Error::None,
            bus_value: 0,
            bus_remaining: 0,
            written: [0; 32],
            output: [0; OUTPUT_CAPACITY],
            output_len: 0,
        })
    }
    pub fn reset(&mut self) {
        self.sid.reset();
        self.phase = 0;
        self.cycles = 0;
        self.frames = 0;
        self.stopped = false;
        self.error = Error::None;
        self.clear_bus();
        self.written.fill(0);
        self.clear_output();
    }
    pub fn stop(&mut self) {
        self.sid.reset();
        self.stopped = true;
        self.error = Error::None;
        self.clear_bus();
        self.written.fill(0);
        self.clear_output();
    }
    fn clear_output(&mut self) {
        self.output.fill(0);
        self.output_len = 0;
    }
    fn clear_bus(&mut self) {
        self.bus_value = 0;
        self.bus_remaining = 0;
    }
    pub fn bus_ttl_cycles(&self) -> u32 {
        if self.model == 0 {
            BUS_TTL_6581
        } else {
            BUS_TTL_8580
        }
    }
    fn drive_bus(&mut self, value: u8) {
        self.bus_value = value;
        self.bus_remaining = self.bus_ttl_cycles();
    }
    fn age_bus(&mut self, cycles: u32) {
        self.bus_remaining = self.bus_remaining.saturating_sub(cycles);
        if self.bus_remaining == 0 {
            self.bus_value = 0;
        }
    }
    pub fn write(&mut self, register: u32, value: u32) -> bool {
        if register > 31 || value > 255 {
            self.error = Error::InvalidArgument;
            return false;
        }
        self.sid.write_register(register as u8, value as u8);
        self.written[register as usize] = value as u8;
        // Even writes to read-only/reserved SID offsets drive the data bus.
        self.drive_bus(value as u8);
        self.error = Error::None;
        true
    }
    pub fn read(&mut self, register: u32) -> Result<u8, Error> {
        if register > 31 {
            self.error = Error::InvalidArgument;
            return Err(self.error);
        }
        if register == 25 || register == 26 {
            // No POT converter/input model is available. Reject rather than
            // silently pretending that an external paddle has a known value.
            self.error = Error::UnsupportedRead;
            return Err(self.error);
        }
        self.error = Error::None;
        if register == 27 || register == 28 {
            let value = self.sid.read_register(register as u8);
            self.drive_bus(value);
            return Ok(value);
        }
        let value = self.bus_value;
        if self.bus_remaining > 0 {
            // Explicit bounded approximation: ordinary reads shorten the
            // remaining retention interval, without completing a chip cycle.
            // A nonzero latch always retains one final tick. This deliberately
            // diverges from the reference's residual-TTL-zero sticky edge:
            // repeated zero-clock reads cannot make a value immortal here.
            self.bus_remaining = (self.bus_remaining / 2).max(u32::from(value != 0));
        }
        Ok(value)
    }
    pub fn run(&mut self, cycles: u32) -> Result<usize, Error> {
        // Only output[..output_len] is valid. In particular the CPU bridge
        // calls run(1), so clearing all 4096 slots per PHI2 would add 8 KiB of
        // unrelated memory writes per chip cycle. Reset/Stop still zero-fill.
        self.output_len = 0;
        let produced = (u64::from(self.phase) + u64::from(cycles) * u64::from(self.rate))
            / u64::from(PAL_CLOCK);
        if produced > OUTPUT_CAPACITY as u64 {
            self.error = Error::OutputCapacity;
            return Err(self.error);
        }
        if self.cycles.checked_add(u64::from(cycles)).is_none()
            || self.frames.checked_add(produced).is_none()
        {
            self.error = Error::CounterOverflow;
            return Err(self.error);
        }
        self.error = Error::None;
        if self.stopped {
            return Ok(0);
        }
        for _ in 0..cycles {
            let sample = self.sid.tick_cycle();
            self.cycles += 1;
            self.phase += self.rate;
            if self.phase >= PAL_CLOCK {
                self.phase -= PAL_CLOCK;
                self.output[self.output_len] = sample;
                self.output_len += 1;
                self.frames += 1;
            }
        }
        // No register access occurs inside a run; aging once after its ticks
        // equals per-tick aging, including the CPU bridge's run(1) calls.
        self.age_bus(cycles);
        Ok(self.output_len)
    }
    pub fn output(&self) -> &[i16] {
        &self.output[..self.output_len]
    }
    pub fn cycle_count(&self) -> u64 {
        self.cycles
    }
    pub fn frame_count(&self) -> u64 {
        self.frames
    }
    pub fn rate(&self) -> u32 {
        self.rate
    }
    pub fn model(&self) -> u32 {
        self.model
    }
    pub fn stopped(&self) -> bool {
        self.stopped
    }
    /// Research configuration only: does not clock/reset or drive the bus.
    /// It is preserved by Reset/Stop and is inert on the 6581 model.
    pub fn set_8580_calibration(&mut self, enabled: bool) {
        self.sid.set_8580_resonance_calibration(enabled);
        self.error = Error::None;
    }
    pub fn calibration(&self) -> bool {
        self.sid.resonance_calibration_8580()
    }
    pub fn error(&self) -> Error {
        self.error
    }
    pub fn written(&self) -> &[u8; 32] {
        &self.written
    }
    /// Inspection only: does not perform a SID bus read or shorten retention.
    pub fn bus_value(&self) -> u8 {
        self.bus_value
    }
    pub fn bus_remaining(&self) -> u32 {
        self.bus_remaining
    }
}

struct Slot {
    generation: u32,
    probe: Option<Box<Probe>>,
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
    fn create(&mut self, probe: Probe) -> u32 {
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
        if handle >> 8 == 0 || slot.generation != handle >> 8 || slot.probe.is_none() {
            None
        } else {
            Some(slot)
        }
    }
}
static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);
fn with_registry<T>(operation: impl FnOnce(&mut Registry) -> T) -> Option<T> {
    let mut registry = REGISTRY.lock().ok()?;
    Some(operation(registry.get_or_insert_with(Registry::new)))
}
fn with_probe<T>(handle: u32, operation: impl FnOnce(&mut Probe) -> T) -> Option<T> {
    with_registry(|registry| {
        registry
            .slot(handle)
            .and_then(|slot| slot.probe.as_deref_mut())
            .map(operation)
    })
    .flatten()
}

#[no_mangle]
pub extern "C" fn sid8p_create(rate: u32, model: u32) -> u32 {
    let Some(probe) = Probe::new(rate, model) else {
        return 0;
    };
    with_registry(|registry| registry.create(probe)).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_destroy(handle: u32) -> u32 {
    with_registry(|registry| {
        let Some(slot) = registry.slot(handle) else {
            return 0;
        };
        slot.probe = None;
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_reset(handle: u32) -> u32 {
    with_probe(handle, |probe| {
        probe.reset();
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_stop(handle: u32) -> u32 {
    with_probe(handle, |probe| {
        probe.stop();
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_write(handle: u32, register: u32, value: u32) -> u32 {
    with_probe(handle, |probe| u32::from(probe.write(register, value))).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_read(handle: u32, register: u32) -> u32 {
    with_probe(handle, |probe| {
        probe.read(register).map(u32::from).unwrap_or(READ_ERROR)
    })
    .unwrap_or(READ_ERROR)
}
#[no_mangle]
pub extern "C" fn sid8p_run(handle: u32, cycles: u32) -> u32 {
    with_probe(handle, |probe| {
        probe
            .run(cycles)
            .map(|frames| frames as u32)
            .unwrap_or(RUN_ERROR)
    })
    .unwrap_or(RUN_ERROR)
}
/// Copy output before another call mutates or destroys this handle. The boxed
/// storage is stable across registry changes, but it is not a permanent lease.
#[no_mangle]
pub extern "C" fn sid8p_output(handle: u32) -> *const i16 {
    with_probe(handle, |probe| probe.output.as_ptr()).unwrap_or(std::ptr::null())
}
#[no_mangle]
pub extern "C" fn sid8p_output_frames(handle: u32) -> u32 {
    with_probe(handle, |probe| probe.output_len as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_error(handle: u32) -> u32 {
    with_probe(handle, |probe| probe.error() as u32).unwrap_or(Error::InvalidHandle as u32)
}
#[no_mangle]
pub extern "C" fn sid8p_bus_value(handle: u32) -> u32 {
    with_probe(handle, |probe| u32::from(probe.bus_value())).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_bus_remaining(handle: u32) -> u32 {
    with_probe(handle, |probe| probe.bus_remaining()).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_rate(handle: u32) -> u32 {
    with_probe(handle, |probe| probe.rate()).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_model(handle: u32) -> u32 {
    with_probe(handle, |probe| probe.model()).unwrap_or(u32::MAX)
}
#[no_mangle]
pub extern "C" fn sid8p_stopped(handle: u32) -> u32 {
    with_probe(handle, |probe| u32::from(probe.stopped())).unwrap_or(1)
}
#[no_mangle]
pub extern "C" fn sid8p_set_8580_calibration(handle: u32, enabled: u32) -> u32 {
    with_probe(handle, |probe| {
        if enabled > 1 {
            probe.error = Error::InvalidArgument;
            return 0;
        }
        probe.set_8580_calibration(enabled != 0);
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_calibration(handle: u32) -> u32 {
    with_probe(handle, |probe| u32::from(probe.calibration())).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_written(handle: u32, register: u32) -> u32 {
    with_probe(handle, |probe| {
        probe
            .written
            .get(register as usize)
            .map(|value| u32::from(*value))
            .unwrap_or(READ_ERROR)
    })
    .unwrap_or(READ_ERROR)
}
#[no_mangle]
pub extern "C" fn sid8p_cycles_lo(handle: u32) -> u32 {
    with_probe(handle, |probe| probe.cycle_count() as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_cycles_hi(handle: u32) -> u32 {
    with_probe(handle, |probe| (probe.cycle_count() >> 32) as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_frames_lo(handle: u32) -> u32 {
    with_probe(handle, |probe| probe.frame_count() as u32).unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8p_frames_hi(handle: u32) -> u32 {
    with_probe(handle, |probe| (probe.frame_count() >> 32) as u32).unwrap_or(0)
}
