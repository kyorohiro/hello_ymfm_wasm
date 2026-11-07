// SPDX-License-Identifier: BSD-3-Clause
// Native quality diagnostics: identical Probe, explicit warmup/capture windows.
#[path = "lib.rs"]
mod probe;
mod quality;
use quality::{QualityProbe, CLOCK_HZ, MAX_COMMANDS, MAX_REQUESTED_CYCLES};
use std::io::{self, Read, Write};

const MAX_SCRIPT: u64 = 8 * 1024 * 1024;
enum Command {
    Write(u32, u32),
    Read(u32),
    Capture(u64),
    Skip(u64),
    Reset,
    Stop,
}

fn unsigned(text: &str) -> Result<u64, String> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Protocol numbers must contain decimal digits only".into());
    }
    text.parse().map_err(|_| "Protocol integer overflow".into())
}

fn parse(text: &str) -> Result<(u32, u32, Vec<Command>), String> {
    let mut lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'));
    let first = lines.next().ok_or("Missing SID8QUALITY header")?;
    if first.len() > 256 {
        return Err("Quality header is too long".into());
    }
    let header: Vec<_> = first.split_whitespace().collect();
    if header.len() != 4 || header[0] != "SID8QUALITY" || header[1] != "1" {
        return Err("Expected SID8QUALITY 1 RATE MODEL".into());
    }
    let rate = unsigned(header[2])?;
    if !(8000..=96000).contains(&rate) {
        return Err("Sample rate must be 8000..96000".into());
    }
    let model = match header[3] {
        "6581" => 0,
        "8580" => 1,
        _ => return Err("Model must be 6581 or 8580".into()),
    };
    let mut commands = Vec::new();
    let mut total_cycles = 0u64;
    for line in lines {
        if line.len() > 256 || commands.len() >= MAX_COMMANDS {
            return Err("Quality command limit exceeded".into());
        }
        let tokens: Vec<_> = line.split_whitespace().collect();
        let command = match tokens.as_slice() {
            ["w", register, value] => {
                let register = unsigned(register)?;
                let value = unsigned(value)?;
                if register > 31 || value > 255 {
                    return Err("Register/value outside 0..31/0..255".into());
                }
                Command::Write(register as u32, value as u32)
            }
            ["r", register] => {
                let register = unsigned(register)?;
                if register > 31 {
                    return Err("Read register outside 0..31".into());
                }
                if register == 25 || register == 26 {
                    return Err("POTX/POTY reads are unsupported by this probe".into());
                }
                Command::Read(register as u32)
            }
            [kind @ ("c" | "skip"), count] => {
                let cycles = unsigned(count)?;
                total_cycles = total_cycles
                    .checked_add(cycles)
                    .filter(|total| *total <= MAX_REQUESTED_CYCLES)
                    .ok_or("Quality run exceeds 60 seconds of requested cycles")?;
                if *kind == "c" {
                    Command::Capture(cycles)
                } else {
                    Command::Skip(cycles)
                }
            }
            ["reset"] => Command::Reset,
            ["stop"] => Command::Stop,
            _ => return Err("Unknown or malformed quality command".into()),
        };
        commands.push(command);
    }
    Ok((rate as u32, model, commands))
}

fn optional_number(value: Option<u64>) -> String {
    value.map_or_else(|| "null".into(), |number| number.to_string())
}

fn main_run() -> Result<(), String> {
    let mut calibration = false;
    let mut cutoff_calibration = false;
    for argument in std::env::args().skip(1) {
        match argument.as_str() {
            "--8580-calibration" if !calibration => calibration = true,
            "--8580-cutoff-calibration" if !cutoff_calibration => cutoff_calibration = true,
            _ => return Err("Unknown or duplicate quality calibration flag".into()),
        }
    }
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_SCRIPT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SCRIPT {
        return Err("Quality script exceeds 8 MiB".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Quality script must be UTF-8")?;
    // Reject every malformed command before any capture reaches stdout.
    let (rate, model, commands) = parse(text)?;
    let mut engine = QualityProbe::new(rate, model).ok_or("Quality arguments rejected")?;
    engine.set_8580_calibration(calibration);
    engine.set_8580_cutoff_calibration(cutoff_calibration);
    let stdout = io::stdout();
    let mut output = io::BufWriter::new(stdout.lock());
    let mut pcm = [0u8; probe::OUTPUT_CAPACITY * 2];
    for command in commands {
        match command {
            Command::Write(register, value) => engine
                .write(register, value)
                .map_err(|error| format!("Quality write failed: {error:?}"))?,
            Command::Read(register) => {
                engine.read(register)?;
            }
            Command::Capture(cycles) => engine.advance(cycles, true, |samples| {
                for (index, sample) in samples.iter().enumerate() {
                    let little = sample.to_le_bytes();
                    pcm[index * 2] = little[0];
                    pcm[index * 2 + 1] = little[1];
                }
                output
                    .write_all(&pcm[..samples.len() * 2])
                    .map_err(|error| error.to_string())
            })?,
            Command::Skip(cycles) => engine.advance(cycles, false, |_| Ok(()))?,
            Command::Reset => engine.reset(),
            Command::Stop => engine.stop(),
        }
    }
    output.flush().map_err(|error| error.to_string())?;
    let reads = engine
        .read_events()
        .iter()
        .map(|event| event.value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let events = engine
        .read_events()
        .iter()
        .map(|event| {
            format!(
                "{{\"cycle\":{},\"register\":{},\"value\":{}}}",
                event.cycle, event.register, event.value
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let ranges = engine
        .capture_ranges()
        .iter()
        .map(|range| {
            format!("{{\"startCycle\":{},\"endCycle\":{},\"startFrame\":{},\"endFrame\":{},\"captureOffset\":{},\"frames\":{},\"firstSampleCycle\":{},\"lastSampleCycle\":{}}}",
                range.start_cycle, range.end_cycle, range.start_frame,
                range.end_frame, range.capture_offset, range.frames,
                optional_number(range.first_sample_cycle), optional_number(range.last_sample_cycle))
        })
        .collect::<Vec<_>>()
        .join(",");
    let chip = engine.probe();
    let calibration_profile = if chip.calibration() {
        probe::CALIBRATION_PROFILE
    } else {
        "upstream"
    };
    let cutoff_profile = if chip.cutoff_calibration() {
        probe::CUTOFF_CALIBRATION_PROFILE
    } else {
        "upstream"
    };
    let written = chip
        .written()
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",");
    eprintln!("{{\"format\":\"tetorica-sid8580-quality\",\"version\":1,\"sampleRate\":{rate},\"model\":{},\"clockHz\":{CLOCK_HZ},\"cycles\":{},\"frames\":{},\"globalCycles\":{},\"globalFrames\":{},\"generatedFrames\":{},\"allSampleFrames\":{},\"epochCycles\":{},\"epochFrames\":{},\"requestedCycles\":{},\"captureCycles\":{},\"skippedCycles\":{},\"capturedFrames\":{},\"discardedFrames\":{},\"reads\":[{reads}],\"readEvents\":[{events}],\"captureRanges\":[{ranges}],\"stopped\":{},\"error\":{},\"registers\":[{written}],\"busValue\":{},\"busRemaining\":{},\"calibrationEnabled\":{},\"calibrationEffective\":{},\"calibrationProfile\":\"{calibration_profile}\",\"cutoffCalibrationEnabled\":{},\"cutoffCalibrationEffective\":{},\"cutoffCalibrationProfile\":\"{cutoff_profile}\"}}",
        if model == 0 {6581} else {8580}, engine.global_cycles(), engine.captured_frames(),
        engine.global_cycles(), engine.global_frames(), engine.global_frames(), engine.global_frames(), chip.cycle_count(), chip.frame_count(),
        engine.requested_cycles(), engine.capture_cycles(), engine.skipped_cycles(),
        engine.captured_frames(), engine.discarded_frames(), chip.stopped(), chip.error() as u32,
        chip.bus_value(), chip.bus_remaining(), chip.calibration(), chip.calibration() && model == 1,
        chip.cutoff_calibration(), chip.cutoff_calibration() && model == 1);
    Ok(())
}

fn main() {
    if let Err(message) = main_run() {
        eprintln!("SID8QUALITY error: {message}");
        std::process::exit(1);
    }
}
