// SPDX-License-Identifier: BSD-3-Clause
// Device-free native front end for the same adapter compiled to WASM.
#[path = "lib.rs"]
mod probe;
use probe::Probe;
use std::io::{self, Read, Write};

const CLOCK: u64 = 985248;
const MAX_CYCLES: u64 = 60 * CLOCK;
const MAX_SCRIPT: u64 = 8 * 1024 * 1024;
const MAX_COMMANDS: usize = 1000000;
enum Command {
    Write(u32, u32),
    Read(u32),
    Clock(u64),
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
    let header: Vec<_> = lines
        .next()
        .ok_or("Missing SID8PROBE header")?
        .split_whitespace()
        .collect();
    if header.len() != 4 || header[0] != "SID8PROBE" || header[1] != "1" {
        return Err("Expected SID8PROBE 1 RATE MODEL".into());
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
    let mut total = 0u64;
    for line in lines {
        if line.len() > 256 || commands.len() >= MAX_COMMANDS {
            return Err("Probe command limit exceeded".into());
        }
        let tokens: Vec<_> = line.split_whitespace().collect();
        let command = match tokens.as_slice() {
            ["w", register, value] => {
                let r = unsigned(register)?;
                let v = unsigned(value)?;
                if r > 31 || v > 255 {
                    return Err("Register/value outside 0..31/0..255".into());
                }
                Command::Write(r as u32, v as u32)
            }
            ["r", register] => {
                let r = unsigned(register)?;
                if r > 31 {
                    return Err("Read register outside 0..31".into());
                }
                if r == 25 || r == 26 {
                    return Err("POTX/POTY reads are unsupported by this probe".into());
                }
                Command::Read(r as u32)
            }
            ["c", cycles] => {
                let n = unsigned(cycles)?;
                total = total.checked_add(n).ok_or("Total cycle overflow")?;
                if total > MAX_CYCLES {
                    return Err("Probe exceeds 60 seconds of requested cycles".into());
                }
                Command::Clock(n)
            }
            ["reset"] => Command::Reset,
            ["stop"] => Command::Stop,
            _ => return Err("Unknown or malformed probe command".into()),
        };
        commands.push(command);
    }
    Ok((rate as u32, model, commands))
}

fn main_run() -> Result<(), String> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_SCRIPT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SCRIPT {
        return Err("Probe script exceeds 8 MiB".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Probe script must be UTF-8")?;
    // Parse every command before producing PCM, so invalid later lines cannot
    // leave a misleading partial successful output stream.
    let (rate, model, commands) = parse(text)?;
    let mut chip = Probe::new(rate, model).ok_or("Probe allocation arguments rejected")?;
    let mut reads = Vec::new();
    let mut total_cycles = 0u64;
    let mut total_frames = 0u64;
    let stdout = io::stdout();
    let mut output = io::BufWriter::new(stdout.lock());
    let mut pcm = [0u8; probe::OUTPUT_CAPACITY * 2];
    for command in commands {
        match command {
            Command::Write(register, value) => {
                if !chip.write(register, value) {
                    return Err("Validated write failed".into());
                }
            }
            Command::Read(register) => reads.push(
                chip.read(register)
                    .map_err(|error| format!("Probe read failed: {error:?}"))?,
            ),
            Command::Reset => chip.reset(),
            Command::Stop => chip.stop(),
            Command::Clock(mut cycles) => {
                if chip.stopped() {
                    continue;
                }
                while cycles != 0 {
                    // Fits 4096 output frames even at 96kHz, without sample
                    // alignment assumptions or a sample-rounded event queue.
                    let chunk = cycles.min(32768) as u32;
                    let before = chip.cycle_count();
                    let frames = chip
                        .run(chunk)
                        .map_err(|error| format!("Probe clock failed: {error:?}"))?;
                    total_cycles += chip.cycle_count() - before;
                    total_frames += frames as u64;
                    for (index, sample) in chip.output().iter().enumerate() {
                        let little = sample.to_le_bytes();
                        pcm[index * 2] = little[0];
                        pcm[index * 2 + 1] = little[1];
                    }
                    output
                        .write_all(&pcm[..frames * 2])
                        .map_err(|error| error.to_string())?;
                    cycles -= u64::from(chunk);
                }
            }
        }
    }
    output.flush().map_err(|error| error.to_string())?;
    let read_text = reads
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let written = chip
        .written()
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",");
    eprintln!("{{\"format\":\"tetorica-sid8580-probe\",\"version\":1,\"sampleRate\":{rate},\"model\":{},\"reads\":[{read_text}],\"cycles\":{total_cycles},\"frames\":{total_frames},\"totalCycles\":{total_cycles},\"totalFrames\":{total_frames},\"epochCycles\":{},\"epochFrames\":{},\"stopped\":{},\"error\":{},\"registers\":[{written}],\"busValue\":{},\"busRemaining\":{},\"busTtlCycles\":{},\"busPolicy\":\"bounded-half-life-approximation\",\"potReads\":\"unsupported\"}}", if model == 0 {6581} else {8580}, chip.cycle_count(), chip.frame_count(), chip.stopped(), chip.error() as u32, chip.bus_value(), chip.bus_remaining(), chip.bus_ttl_cycles());
    Ok(())
}
fn main() {
    if let Err(message) = main_run() {
        eprintln!("SID8PROBE error: {message}");
        std::process::exit(1);
    }
}
