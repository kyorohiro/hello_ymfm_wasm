//! Diagnostic CSV dumps (`--regdump` / `--statedump`).

use std::path::PathBuf;

use sidera::ChipModel;

use crate::player::Player;
use crate::psid::Psid;
use crate::Args;

/// Diagnostic: dump per-voice replayer work-RAM each frame (see `--statedump`).
pub(crate) fn dump_state(
    psid: &Psid,
    song0: u8,
    model: ChipModel,
    hz: u32,
    args: &Args,
    path: &PathBuf,
) {
    let bases: Vec<u16> = args
        .stateaddrs
        .split(',')
        .map(|s| u16::from_str_radix(s.trim(), 16).expect("bad hex addr"))
        .collect();
    let mut player = Player::new(psid, song0, model, 44_100, hz);
    let seconds = args.seconds.unwrap_or(12.0);
    let frames = (seconds * hz as f64).ceil() as u64;
    let mut out = String::from("frame");
    for &b in &bases {
        for v in 0..3 {
            out.push_str(&format!(",{b:04x}_{v}"));
        }
    }
    out.push('\n');
    for f in 0..frames {
        player.render_frame();
        out.push_str(&f.to_string());
        for &b in &bases {
            for v in 0..3u16 {
                out.push_str(&format!(",{:02x}", player.cpu.memory.ram[(b + v) as usize]));
            }
        }
        out.push('\n');
    }
    std::fs::write(path, &out).unwrap();
    eprintln!("wrote {frames} state frames to {}", path.display());
}

/// Diagnostic: run `play` once per replay frame and dump the 25 SID registers
/// ($D400-$D418) each frame as CSV. The ground-truth register timeline for
/// comparing a reimplemented replayer against the real 6502 routine.
pub(crate) fn dump_registers(
    psid: &Psid,
    song0: u8,
    model: ChipModel,
    hz: u32,
    args: &Args,
    path: &PathBuf,
) {
    let mut player = Player::new(psid, song0, model, 44_100, hz);
    let seconds = args.seconds.unwrap_or(12.0);
    let frames = (seconds * hz as f64).ceil() as u64;
    let mut out = String::from("frame");
    for r in 0..=0x18 {
        out.push_str(&format!(",d4{r:02x}"));
    }
    out.push('\n');
    for f in 0..frames {
        player.render_frame(); // calls play() once; updates the reg shadow
        let regs = player.cpu.memory.regs;
        out.push_str(&f.to_string());
        for byte in &regs[0..=0x18] {
            out.push_str(&format!(",{byte:02x}"));
        }
        out.push('\n');
    }
    std::fs::write(path, &out).unwrap();
    eprintln!("wrote {frames} register frames to {}", path.display());
}
