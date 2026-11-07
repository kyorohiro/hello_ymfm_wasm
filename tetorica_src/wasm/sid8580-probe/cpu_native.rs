// SPDX-License-Identifier: BSD-3-Clause
// Device-free front end for the exact same real-6502/SID bridge compiled to WASM.
#[path = "cpu.rs"]
mod cpu;
use std::io::{self, Read, Write};

const MAX_SCRIPT: u64 = 1024 * 1024;
enum Command {
    Clock(u64),
    Stop,
    Reset,
}
fn unsigned(value: &str) -> Result<u64, String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Expected unsigned decimal integer".into());
    }
    value.parse().map_err(|_| "Integer overflow".into())
}
fn parse(text: &str) -> Result<(u32, u32, u32, Vec<Command>), String> {
    let mut lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'));
    let header: Vec<_> = lines
        .next()
        .ok_or("Missing SID8CPU header")?
        .split_whitespace()
        .collect();
    if header.len() != 5 || header[0] != "SID8CPU" || header[1] != "1" {
        return Err("Expected SID8CPU 1 RATE MODEL FIXTURE".into());
    }
    let rate = unsigned(header[2])?;
    if !(8000..=96000).contains(&rate) {
        return Err("Unsupported sample rate".into());
    }
    let model = match header[3] {
        "6581" => 0,
        "8580" => 1,
        _ => return Err("Unsupported model".into()),
    };
    let fixture = unsigned(header[4])?;
    if fixture >= u64::from(cpu::FIXTURE_COUNT) {
        return Err("Unsupported authored fixture".into());
    }
    let mut commands = Vec::new();
    let mut requested = 0u64;
    for line in lines {
        if line.len() > 128 {
            return Err("Command line exceeds 128 bytes".into());
        }
        let tokens: Vec<_> = line.split_whitespace().collect();
        commands.push(match tokens.as_slice() {
            ["c", cycles] => {
                let n = unsigned(cycles)?;
                requested = requested.checked_add(n).ok_or("Duration overflow")?;
                if requested > cpu::MAX_CYCLES {
                    return Err("Requested duration exceeds 60 PAL seconds".into());
                }
                Command::Clock(n)
            }
            ["stop"] => Command::Stop,
            ["reset"] => Command::Reset,
            _ => return Err("Unknown or malformed CPU command".into()),
        });
    }
    Ok((rate as u32, model, fixture as u32, commands))
}
fn execute() -> Result<(), String> {
    if std::env::args_os().len() != 1 {
        return Err("CPU probe accepts its protocol on stdin only".into());
    }
    let mut bytes = Vec::new();
    io::stdin()
        .take(MAX_SCRIPT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_SCRIPT {
        return Err("CPU protocol exceeds one MiB".into());
    }
    if !bytes
        .iter()
        .all(|&byte| (32..=126).contains(&byte) || matches!(byte, b'\n' | b'\r' | b'\t'))
    {
        return Err("CPU protocol must be ASCII".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid protocol")?;
    // Full validation precedes allocation and any PCM output.
    let (rate, model, fixture, commands) = parse(text)?;
    let mut probe =
        cpu::CpuProbe::new(rate, model, fixture).ok_or("CPU allocation/storage rejected")?;
    let stdout = io::stdout();
    let mut output = io::BufWriter::new(stdout.lock());
    let mut pcm = [0u8; 8192];
    let mut total_cycles = 0u64;
    let mut total_frames = 0u64;
    for command in commands {
        match command {
            Command::Stop => probe.stop(),
            Command::Reset => probe.reset(),
            Command::Clock(mut cycles) => {
                while cycles != 0 && probe.state(1) == 0 {
                    let n = cycles.min(u64::from(cpu::MAX_RUN)) as u32;
                    let before = probe.cycles();
                    let frames = probe
                        .run(n)
                        .map_err(|code| format!("CPU run argument rejected: {code}"))?;
                    total_cycles += probe.cycles() - before;
                    total_frames += frames as u64;
                    for (index, sample) in probe.output().iter().enumerate() {
                        let value = sample.to_le_bytes();
                        pcm[index * 2] = value[0];
                        pcm[index * 2 + 1] = value[1];
                    }
                    output
                        .write_all(&pcm[..frames * 2])
                        .map_err(|e| e.to_string())?;
                    cycles -= u64::from(n);
                }
            }
        }
    }
    output.flush().map_err(|e| e.to_string())?;
    let state = (0..15)
        .map(|field| probe.state(field).to_string())
        .collect::<Vec<_>>()
        .join(",");
    let signature = (0..16)
        .map(|index| probe.signature(index).to_string())
        .collect::<Vec<_>>()
        .join(",");
    let written = (0..32)
        .map(|register| probe.written(register).to_string())
        .collect::<Vec<_>>()
        .join(",");
    let program = probe
        .program()
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let reads = probe
        .reads()
        .iter()
        .map(|event| {
            format!(
                "{{\"cycle\":{},\"address\":{},\"value\":{},\"error\":{}}}",
                event.cycle, event.address, event.value, event.error
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    eprintln!("{{\"format\":\"tetorica-sid8580-cpu-probe\",\"version\":1,\"sampleRate\":{rate},\"model\":{},\"fixture\":{fixture},\"cycles\":{total_cycles},\"frames\":{total_frames},\"epochCycles\":{},\"epochFrames\":{},\"state\":[{state}],\"signature\":[{signature}],\"registers\":[{written}],\"program\":[{program}],\"reads\":[{reads}],\"writeCount\":{},\"writeHash\":{},\"writeHashFormat\":\"FNV1a32 over cycle-u64le/address-u16le/value-u8 per SID write\",\"pcmFormat\":\"signed16le\",\"timing\":\"CPU tick, SID tick/sample, bus access; real reads return to next CPU tick\",\"environment\":\"authored RAM fixture, no ROM/CIA/VIC or C64 banking\"}}",
        if model==0 {6581}else {8580},probe.cycles(),probe.frames(),probe.write_count(),probe.write_hash());
    Ok(())
}
fn main() {
    if let Err(message) = execute() {
        eprintln!("SID8CPU error: {message}");
        std::process::exit(1);
    }
}
