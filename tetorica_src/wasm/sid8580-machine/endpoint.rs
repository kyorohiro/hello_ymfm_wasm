// SPDX-License-Identifier: BSD-3-Clause
// Isolated scalar endpoint. No C64 pointers cross the two WASM memories.
#[path = "../sid8580-probe/lib.rs"]
mod probe;
use probe::Probe;
use std::sync::Mutex;

struct Endpoint {
    chip: Probe,
    sample: i32,
    error: u32,
    profiles: u32,
}
struct Slot {
    generation: u32,
    endpoint: Option<Box<Endpoint>>,
}
static ENDPOINTS: Mutex<Vec<Slot>> = Mutex::new(Vec::new());
fn with<T>(handle: u32, operation: impl FnOnce(&mut Endpoint) -> T) -> Option<T> {
    let mut slots = ENDPOINTS.lock().ok()?;
    let index = (handle & 255).checked_sub(1)? as usize;
    let slot = slots.get_mut(index)?;
    if handle >> 8 == 0 || slot.generation != handle >> 8 {
        return None;
    }
    slot.endpoint.as_deref_mut().map(operation)
}
fn profile(endpoint: &mut Endpoint, bits: u32) {
    endpoint.chip.set_8580_calibration(bits & 1 != 0);
    endpoint.chip.set_8580_cutoff_calibration(bits & 2 != 0);
    endpoint.profiles = bits;
}
#[no_mangle]
pub extern "C" fn sid8e_create(rate: u32, profiles: u32) -> u32 {
    if profiles > 3 {
        return 0;
    }
    let Some(chip) = Probe::new(rate, 1) else {
        return 0;
    };
    let mut endpoint = Endpoint {
        chip,
        sample: 0,
        error: 0,
        profiles: 0,
    };
    profile(&mut endpoint, profiles);
    let Ok(mut slots) = ENDPOINTS.lock() else {
        return 0;
    };
    if slots.is_empty() {
        slots.extend((0..16).map(|_| Slot {
            generation: 0,
            endpoint: None,
        }));
    }
    for (index, slot) in slots.iter_mut().enumerate() {
        if slot.endpoint.is_none() {
            slot.generation = (slot.generation + 1) & 0x00ff_ffff;
            if slot.generation == 0 {
                slot.generation = 1;
            }
            slot.endpoint = Some(Box::new(endpoint));
            return (slot.generation << 8) | (index as u32 + 1);
        }
    }
    0
}
#[no_mangle]
pub extern "C" fn sid8e_destroy(handle: u32) -> u32 {
    let Ok(mut slots) = ENDPOINTS.lock() else {
        return 0;
    };
    let Some(index) = (handle & 255).checked_sub(1) else {
        return 0;
    };
    let Some(slot) = slots.get_mut(index as usize) else {
        return 0;
    };
    if handle >> 8 == 0 || slot.generation != handle >> 8 || slot.endpoint.is_none() {
        return 0;
    }
    slot.endpoint = None;
    1
}
#[no_mangle]
pub extern "C" fn sid8e_reset(handle: u32) -> u32 {
    with(handle, |e| {
        e.chip.reset();
        e.sample = 0;
        e.error = 0;
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8e_stop(handle: u32) -> u32 {
    // Preserve elapsed cycles and the fault diagnosis; only reset releases it.
    with(handle, |e| {
        e.chip.stop();
        e.sample = 0;
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8e_set_profiles(handle: u32, bits: u32) -> u32 {
    with(handle, |e| {
        if bits > 3 {
            return 0;
        }
        profile(e, bits);
        1
    })
    .unwrap_or(0)
}
#[no_mangle]
pub extern "C" fn sid8e_error(handle: u32) -> u32 {
    with(handle, |e| e.error).unwrap_or(1)
}
#[no_mangle]
pub extern "C" fn sid8e_sample(handle: u32) -> i32 {
    with(handle, |e| e.sample).unwrap_or(0)
}
/// Front-panel access between machine ticks. No oscillator/CPU tick is added.
#[no_mangle]
pub extern "C" fn sid8e_write(handle: u32, register: u32, value: u32) -> u32 {
    with(handle, |e| {
        if e.error != 0 || register > 24 || value > 255 { return 0; }
        u32::from(e.chip.write(register, value))
    }).unwrap_or(0)
}
/// One completed chip tick, then the selected bus access. Result: read data
/// bits0..7, sample-ready8, completed-tick9, error10..15, signed PCM16 bits16..31.
#[no_mangle]
pub extern "C" fn sid8e_tick(handle: u32, access: u32, register: u32, value: u32) -> u32 {
    with(handle, |e| {
        if e.error != 0 {
            return e.error << 10;
        }
        if access > 2 || register > 31 || value > 255 {
            e.error = 2;
            return 2 << 10;
        }
        if e.chip.stopped() {
            return 0;
        }
        let frames = match e.chip.run(1) {
            Ok(frames) => frames,
            Err(error) => {
                e.error = error as u32;
                return e.error << 10;
            }
        };
        let mut result = 1 << 9;
        if frames == 1 {
            e.sample = i32::from(e.chip.output()[0]);
            result |= (1 << 8) | ((e.sample as u16 as u32) << 16);
        }
        if access == 1 {
            if !e.chip.write(register, value) {
                e.error = e.chip.error() as u32;
            }
        } else if access == 2 {
            match e.chip.read(register) {
                Ok(byte) => result |= u32::from(byte),
                Err(error) => e.error = error as u32,
            }
        }
        result | (e.error << 10)
    })
    .unwrap_or(1 << 10)
}
