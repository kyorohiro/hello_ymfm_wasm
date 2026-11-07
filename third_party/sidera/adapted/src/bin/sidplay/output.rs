//! Audio output: WAV rendering and live cpal playback.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::mpsc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use sidera::ChipModel;

use crate::player::Player;
use crate::psid::Psid;
use crate::Args;

pub(crate) fn render_wav(
    psid: &Psid,
    song0: u8,
    model: ChipModel,
    hz: u32,
    args: &Args,
    path: &PathBuf,
) {
    let sample_rate = 44_100u32;
    let mut player = Player::new(psid, song0, model, sample_rate, hz);
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec).expect("cannot create WAV");
    let seconds = args.seconds.unwrap_or(60.0);
    let frames = (seconds * hz as f64).ceil() as u64;
    for _ in 0..frames {
        for s in player.render_frame() {
            w.write_sample(s).unwrap();
        }
    }
    w.finalize().unwrap();
    eprintln!("wrote {} ({:.1}s)", path.display(), seconds);
}

pub(crate) fn play_live(psid: &Psid, song0: u8, model: ChipModel, hz: u32, args: &Args) {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .expect("no output audio device");
    let config = device.default_output_config().expect("no output config");
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();
    let sample_rate = stream_config.sample_rate;
    let channels = stream_config.channels as usize;

    // Render in a producer thread; the audio callback pulls frames over a
    // bounded channel (back-pressure paces the producer to real time).
    let mut player = Player::new(psid, song0, model, sample_rate, hz);
    let (tx, rx) = mpsc::sync_channel::<Vec<i16>>(16);
    // No --seconds → endless playback (the producer loops until the channel
    // closes, i.e. the process is killed with Ctrl-C).
    let frames = args.seconds.map(|s| (s * hz as f64).ceil() as u64);
    std::thread::spawn(move || {
        let mut i = 0u64;
        loop {
            if let Some(f) = frames {
                if i >= f {
                    break;
                }
            }
            if tx.send(player.render_frame()).is_err() {
                break;
            }
            i += 1;
        }
    });

    let err_fn = |e| eprintln!("audio stream error: {e}");
    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            build_stream::<f32>(&device, stream_config, rx, channels, err_fn)
        }
        cpal::SampleFormat::I16 => {
            build_stream::<i16>(&device, stream_config, rx, channels, err_fn)
        }
        cpal::SampleFormat::U16 => {
            build_stream::<u16>(&device, stream_config, rx, channels, err_fn)
        }
        other => panic!("unsupported sample format {other:?}"),
    };
    stream.play().expect("cannot start stream");
    match args.seconds {
        Some(s) => std::thread::sleep(std::time::Duration::from_secs_f64(s + 0.3)),
        None => {
            eprintln!("playing… (Ctrl-C to stop)");
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    rx: mpsc::Receiver<Vec<i16>>,
    channels: usize,
    err_fn: impl FnMut(cpal::Error) + Send + 'static,
) -> cpal::Stream
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    let mut buf: VecDeque<i16> = VecDeque::new();
    device
        .build_output_stream(
            config,
            move |out: &mut [T], _: &cpal::OutputCallbackInfo| {
                for frame in out.chunks_mut(channels) {
                    if buf.is_empty() {
                        if let Ok(chunk) = rx.try_recv() {
                            buf.extend(chunk);
                        }
                    }
                    let f = buf.pop_front().unwrap_or(0) as f32 / 32768.0;
                    let v = T::from_sample(f);
                    for d in frame.iter_mut() {
                        *d = v;
                    }
                }
            },
            err_fn,
            None,
        )
        .expect("cannot build output stream")
}
