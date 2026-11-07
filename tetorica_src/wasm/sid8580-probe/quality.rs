// SPDX-License-Identifier: BSD-3-Clause
// Measurement-only capture windows around the unchanged cycle-access Probe.
use crate::probe::{Error, Probe};

pub const CLOCK_HZ: u64 = 985248;
pub const MAX_REQUESTED_CYCLES: u64 = 60 * CLOCK_HZ;
pub const MAX_COMMANDS: usize = 1_000_000;
const CHUNK_CYCLES: u32 = 32768;

#[derive(Clone, Debug)]
pub struct ReadEvent {
    /// Number of completed chip ticks before this non-clocking read.
    pub cycle: u64,
    pub register: u32,
    pub value: u8,
}

#[derive(Clone, Debug)]
pub struct CaptureRange {
    pub start_cycle: u64,
    pub end_cycle: u64,
    /// Global frames include discarded warmup samples.
    pub start_frame: u64,
    pub end_frame: u64,
    /// Offset within the emitted PCM stream, excluding discarded samples.
    pub capture_offset: u64,
    pub frames: u64,
    /// Completed global tick numbers at which the first/last samples occurred.
    pub first_sample_cycle: Option<u64>,
    pub last_sample_cycle: Option<u64>,
}

pub struct QualityProbe {
    probe: Probe,
    global_cycles: u64,
    global_frames: u64,
    requested_cycles: u64,
    capture_cycles: u64,
    skipped_cycles: u64,
    captured_frames: u64,
    discarded_frames: u64,
    read_events: Vec<ReadEvent>,
    capture_ranges: Vec<CaptureRange>,
}

impl QualityProbe {
    pub fn new(rate: u32, model: u32) -> Option<Self> {
        Some(Self {
            probe: Probe::new(rate, model)?,
            global_cycles: 0,
            global_frames: 0,
            requested_cycles: 0,
            capture_cycles: 0,
            skipped_cycles: 0,
            captured_frames: 0,
            discarded_frames: 0,
            read_events: Vec::new(),
            capture_ranges: Vec::new(),
        })
    }

    pub fn write(&mut self, register: u32, value: u32) -> Result<(), Error> {
        if self.probe.write(register, value) {
            Ok(())
        } else {
            Err(self.probe.error())
        }
    }

    pub fn read(&mut self, register: u32) -> Result<u8, String> {
        if self.read_events.len() >= MAX_COMMANDS {
            return Err("Quality read-event limit exceeded".into());
        }
        let value = self
            .probe
            .read(register)
            .map_err(|error| format!("Quality read failed: {error:?}"))?;
        self.read_events.push(ReadEvent {
            cycle: self.global_cycles,
            register,
            value,
        });
        Ok(value)
    }

    /// Reset the chip/sample phase, retaining monotonic measurement counters.
    /// TEST/GATE warmup should instead be expressed with writes plus skip.
    pub fn reset(&mut self) {
        self.probe.reset();
    }

    pub fn stop(&mut self) {
        self.probe.stop();
    }

    pub fn set_8580_calibration(&mut self, enabled: bool) {
        self.probe.set_8580_calibration(enabled);
    }

    /// Clock exact completed cycles. Discarding samples never changes the
    /// Probe, sampler phase, bus aging or global frame accounting. The sink is
    /// called only for capture commands and only with the valid output slice.
    pub fn advance<F>(&mut self, cycles: u64, capture: bool, mut sink: F) -> Result<(), String>
    where
        F: FnMut(&[i16]) -> Result<(), String>,
    {
        let requested = self
            .requested_cycles
            .checked_add(cycles)
            .filter(|total| *total <= MAX_REQUESTED_CYCLES)
            .ok_or("Quality run exceeds 60 seconds of requested cycles")?;
        if capture && self.capture_ranges.len() >= MAX_COMMANDS {
            return Err("Quality capture-range limit exceeded".into());
        }
        self.requested_cycles = requested;
        let start_cycle = self.global_cycles;
        let start_frame = self.global_frames;
        let start_epoch_cycle = self.probe.cycle_count();
        let start_epoch_frame = self.probe.frame_count();
        let capture_offset = self.captured_frames;
        let mut remaining = cycles;
        while remaining != 0 {
            // Always fits Probe's 4096-frame output at every supported rate.
            let chunk = remaining.min(u64::from(CHUNK_CYCLES)) as u32;
            let before = self.probe.cycle_count();
            let frames = self
                .probe
                .run(chunk)
                .map_err(|error| format!("Quality clock failed: {error:?}"))?;
            let completed = self.probe.cycle_count() - before;
            self.global_cycles += completed;
            self.global_frames += frames as u64;
            if capture {
                self.capture_cycles += completed;
                self.captured_frames += frames as u64;
                sink(self.probe.output())?;
            } else {
                self.skipped_cycles += completed;
                self.discarded_frames += frames as u64;
            }
            remaining -= u64::from(chunk);
        }
        if capture {
            let frames = self.global_frames - start_frame;
            let (first_sample_cycle, last_sample_cycle) = if frames == 0 {
                (None, None)
            } else {
                let rate = u64::from(self.probe.rate());
                // Epoch sample n is taken at ceil(n * clock / sample_rate).
                // Add the current global/epoch offset to survive reset.
                let first_tick = ((start_epoch_frame + 1) * CLOCK_HZ + rate - 1) / rate;
                let last_tick = (self.probe.frame_count() * CLOCK_HZ + rate - 1) / rate;
                (
                    Some(start_cycle + first_tick - start_epoch_cycle),
                    Some(start_cycle + last_tick - start_epoch_cycle),
                )
            };
            self.capture_ranges.push(CaptureRange {
                start_cycle,
                end_cycle: self.global_cycles,
                start_frame,
                end_frame: self.global_frames,
                capture_offset,
                frames,
                first_sample_cycle,
                last_sample_cycle,
            });
        }
        Ok(())
    }

    pub fn probe(&self) -> &Probe {
        &self.probe
    }
    pub fn global_cycles(&self) -> u64 {
        self.global_cycles
    }
    pub fn global_frames(&self) -> u64 {
        self.global_frames
    }
    pub fn requested_cycles(&self) -> u64 {
        self.requested_cycles
    }
    pub fn capture_cycles(&self) -> u64 {
        self.capture_cycles
    }
    pub fn skipped_cycles(&self) -> u64 {
        self.skipped_cycles
    }
    pub fn captured_frames(&self) -> u64 {
        self.captured_frames
    }
    pub fn discarded_frames(&self) -> u64 {
        self.discarded_frames
    }
    pub fn read_events(&self) -> &[ReadEvent] {
        &self.read_events
    }
    pub fn capture_ranges(&self) -> &[CaptureRange] {
        &self.capture_ranges
    }
}
