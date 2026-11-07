//! `sidplay` — a minimal PSID player built on `sidera`.
//!
//! Emulates a 6510 (via the `mos6502` core, NMOS variant) with 64 KB of RAM and
//! traps writes to `$D400-$D7FF` into a `sidera::Sid`. It runs the tune's `init`
//! routine once, then calls `play` at the refresh rate — taken from the PSID
//! flags (PAL 50 Hz / NTSC 60 Hz) unless `--hz` overrides — rendering audio
//! between calls. The SID model likewise defaults from the flags (6581/8580)
//! unless `--model` overrides. Output goes to the default audio device (cpal)
//! or to a WAV file (`--wav`).
//!
//! Scope: **PSID** only (the init/play model). RSID tunes that need real CIA
//! timers / VIC raster IRQs are out of scope and may misbehave or stall — that
//! is expected for this test tool.
//!
//! The tool is split into modules: [`psid`] (header parsing), [`bus`] (the C64
//! memory map), [`player`] (driving the 6510 + rendering), [`output`] (WAV /
//! live audio) and [`diag`] (the `--regdump` / `--statedump` CSV dumps).
//!
//! Build/run: `cargo run --release --features player --bin sidplay -- <file.sid>`
//! Install:   `cargo install sidera --features player`

// The crate's `rust-version = 1.60` MSRV targets the no_std core lib; the
// `player` feature pulls clap/cpal/hound, which already require a much newer
// toolchain, so the MSRV does not bind this binary.
#![allow(clippy::incompatible_msrv)]

mod bus;
mod diag;
mod output;
mod player;
mod psid;

use std::path::PathBuf;

use clap::Parser;
use sidera::ChipModel;

use crate::psid::Psid;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(about = "Minimal PSID player on the sidera SID engine")]
struct Args {
    /// Path to a .sid (PSID) file.
    file: PathBuf,
    /// Sub-song to play (1-based). 0 = the file's default.
    #[arg(long, default_value_t = 0)]
    song: u16,
    /// Seconds to play / render. Omit for endless live playback (Ctrl-C to
    /// stop); WAV output defaults to 60 s when omitted.
    #[arg(long)]
    seconds: Option<f64>,
    /// Chip model. Default: taken from the PSID flags, else 6581.
    #[arg(long, value_parser = ["6581", "8580"])]
    model: Option<String>,
    /// Replay rate in Hz (50 = PAL, 60 = NTSC). Default: taken from the PSID
    /// flags (NTSC → 60), else 50 (PAL).
    #[arg(long)]
    hz: Option<u32>,
    /// Write a WAV file instead of playing live.
    #[arg(long)]
    wav: Option<PathBuf>,
    /// Diagnostic: dump the 25 SID registers ($D400-$D418) once per replay
    /// frame to this file as CSV (`frame,d400,d401,...`), instead of audio.
    #[arg(long)]
    regdump: Option<PathBuf>,
    /// Diagnostic: dump per-voice replayer work-RAM each frame as CSV. Takes a
    /// comma-separated list of hex base addresses; for each, bytes at base+0,
    /// base+1, base+2 (voices 0/1/2) are logged. Probes WHY a voice is silent
    /// (order index, lengthleft, gate mask, ctrl, ...) — the runtime-state
    /// counterpart of `--regdump`.
    #[arg(long)]
    statedump: Option<PathBuf>,
    /// Comma-separated hex base addresses for `--statedump` (per-voice arrays).
    /// Default = Delta's set: c2ec(order) c2ef(phrasebyte) c2f2(lenleft)
    /// c2f5(flags) c2f8(ctrl) c301(gatemask) c2fb(note) c2fe(instr) c354(rept).
    #[arg(long, default_value = "c2ec,c2ef,c2f2,c2f5,c2f8,c301,c2fb,c2fe,c354")]
    stateaddrs: String,
}

fn main() {
    let args = Args::parse();
    let raw = std::fs::read(&args.file).unwrap_or_else(|e| {
        eprintln!("error reading {}: {e}", args.file.display());
        std::process::exit(1);
    });
    let psid = Psid::parse(&raw).unwrap_or_else(|e| {
        eprintln!("error: {e}");
        std::process::exit(1);
    });

    // Resolve model/rate: explicit CLI override wins, else the PSID flags, else
    // the PAL/6581 fallback.
    let auto_model = args.model.is_none();
    let model_str = args.model.clone().unwrap_or_else(|| {
        match psid.prefer_8580 {
            Some(true) => "8580",
            _ => "6581",
        }
        .to_string()
    });
    let model = if model_str == "8580" {
        ChipModel::Mos8580
    } else {
        ChipModel::Mos6581
    };
    let auto_hz = args.hz.is_none();
    let hz = args.hz.unwrap_or(match psid.prefer_ntsc {
        Some(true) => 60,
        _ => 50,
    });

    let song1 = if args.song > 0 {
        args.song
    } else {
        psid.start_song.max(1)
    };
    let song0 = (song1 - 1) as u8;

    eprintln!(
        "{} — {}  [{}{} | song {}/{} | {}{} | {} Hz{}]",
        psid.name,
        psid.author,
        if psid.is_rsid { "RSID" } else { "PSID" },
        if psid.is_rsid { " (best-effort)" } else { "" },
        song1,
        psid.songs,
        model_str,
        if auto_model { " (auto)" } else { "" },
        hz,
        if auto_hz { " (auto)" } else { "" },
    );
    if psid.play_addr == 0 {
        eprintln!(
            "note: play address is 0 — driving the tune's installed interrupt \
             handler ($0314 KERNAL vector, else $FFFE) once per frame as an IRQ."
        );
    }

    if let Some(path) = &args.regdump {
        diag::dump_registers(&psid, song0, model, hz, &args, path);
        return;
    }
    if let Some(path) = &args.statedump {
        diag::dump_state(&psid, song0, model, hz, &args, path);
        return;
    }
    match &args.wav {
        Some(path) => output::render_wav(&psid, song0, model, hz, &args, path),
        None => output::play_live(&psid, song0, model, hz, &args),
    }
}
