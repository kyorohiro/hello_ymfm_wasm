// Offline 32X-style sound configuration: original PWM PCM plus YM2612 and PSG.
// No device, ROM, external asset, application runtime or extra dependency.
#include <tetorica/pwm.hpp>
#include <tetorica/segapsg.hpp>
#include <tetorica/ym2612.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3;
constexpr uint32_t PWM_CLOCK = 23011361, PWM_CYCLE = 960;
constexpr uint32_t FM_CLOCK = 7670454, PSG_CLOCK = 3579545;
constexpr double PI = 3.14159265358979323846;
using Core = std::unique_ptr<void, void (*)(void *)>;

double note_hz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }

void fm_note(void *chip, int midi) {
    const double hz = note_hz(midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        const double unit = FM_CLOCK * std::ldexp(1.0, int(candidate) - 1) / (144.0 * 1048576.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 2047) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (!fnum) throw std::runtime_error("FM note is outside the hardware pitch range");
    native_ym2612_write(chip, 0, 0xa4, uint8_t((block << 3) | (fnum >> 8)));
    native_ym2612_write(chip, 0, 0xa0, uint8_t(fnum));
    native_ym2612_write(chip, 0, 0x28, 0xf0);
}

void psg_tone(void *chip, unsigned channel, int midi, uint8_t attenuation) {
    const long period = std::lround(PSG_CLOCK / (32.0 * note_hz(midi)));
    if (channel > 2 || period < 2 || period > 1023)
        throw std::runtime_error("PSG note is outside the hardware pitch range");
    native_game_gear_write(chip, uint8_t(0x80 | (channel << 5) | (period & 15)));
    native_game_gear_write(chip, uint8_t(period >> 4));
    native_game_gear_write(chip, uint8_t(0x90 | (channel << 5) | attenuation));
}

void configure_fm(void *chip) {
    for (unsigned op = 0; op < 4; ++op) {
        const unsigned offset = op * 4;
        native_ym2612_write(chip, 0, uint8_t(0x30 + offset), 1);
        native_ym2612_write(chip, 0, uint8_t(0x40 + offset), op == 0 ? 12 : 127);
        native_ym2612_write(chip, 0, uint8_t(0x50 + offset), 31);
        native_ym2612_write(chip, 0, uint8_t(0x60 + offset), 4);
        native_ym2612_write(chip, 0, uint8_t(0x70 + offset), 0);
        native_ym2612_write(chip, 0, uint8_t(0x80 + offset), 15);
    }
    native_ym2612_write(chip, 0, 0xb0, 7);    // One independent audible carrier.
    native_ym2612_write(chip, 0, 0xb4, 0xc0); // FM centered, PSG remains mono.
}

// This feeder belongs to this offline host, not to the SDK. The physical FIFOs
// have three entries each and discard the oldest entry if overfilled. Refill
// only free slots; generating PCM from the tick index avoids output-frame jitter.
class PwmFeeder {
 public:
    explicit PwmFeeder(void *chip) : chip_(chip) {
        NativePwmState state{};
        native_pwm_get_state(chip_, &state);
        if (state.clock != PWM_CLOCK) throw std::runtime_error("Unexpected Native PWM default clock");
        native_pwm_write(chip_, 1, PWM_CYCLE);
        native_pwm_write(chip_, 0, 0x05); // Left FIFO -> left; right FIFO -> right.
    }
    void refill() {
        NativePwmState state{};
        native_pwm_get_state(chip_, &state);
        if (state.left_size != state.right_size || state.left_size > 3)
            throw std::runtime_error("Unexpected PWM FIFO occupancy");
        for (uint32_t slot = state.left_size; slot < 3; ++slot, ++tick_) {
            // Cycle 960 means 959 chip clocks/tick, about 23,995.163 ticks/s.
            // A value first becomes audible at this tick, after the initial hold.
            const double t = double(tick_) * (PWM_CYCLE - 1) / PWM_CLOCK;
            const auto pcm = synthesize(t, tick_);
            native_pwm_write(chip_, 2, duty(pcm[0]));
            native_pwm_write(chip_, 3, duty(pcm[1]));
        }
    }
 private:
    static uint32_t duty(double pcm) {
        // Native uses duty mode/gain 1: (raw & 4095)/(cycle/2) - 1.
        // Silence is 480, not raw zero or the DAC-mode midpoint 2048.
        if (!std::isfinite(pcm) || std::abs(pcm) > 0.65)
            throw std::runtime_error("PWM source exceeded its fixed headroom");
        return uint32_t(std::lround((pcm + 1.0) * (PWM_CYCLE / 2.0)));
    }
    static std::array<double, 2> synthesize(double t, uint64_t tick) {
        if (t >= 3.0) return {{0, 0}};
        constexpr std::array<int, 12> notes{{60, 67, 64, 69, 48, 48, 55, 53, 48, 55, 53, 48}};
        const unsigned step = unsigned(t * 4);
        const double age = t - step * 0.25;
        const double fade = std::min(1.0, std::min(age / 0.003, (0.25 - age) / 0.025));
        const double hz = note_hz(notes[step]);
        const double phase = 2 * PI * hz * age;
        const double pluck = 0.26 * std::exp(-age * 11) *
                             (0.8 * std::sin(phase) + 0.2 * std::sin(phase * 2));
        // Original deterministic kick/noise PCM, generated locally at PWM ticks.
        const double kick = step % 2 == 0 ? 0.22 * std::exp(-age * 32) *
                            std::sin(2 * PI * (52 * age + 1.8 * (1 - std::exp(-age * 30)))) : 0;
        uint32_t noise = uint32_t(tick) * 747796405u + 2891336453u;
        noise = ((noise >> ((noise >> 28) + 4)) ^ noise) * 277803737u;
        noise = (noise >> 22) ^ noise;
        const double hat = 0.065 * (double(noise & 65535) / 32767.5 - 1) * std::exp(-age * 85);
        const double signal = fade * (pluck + kick + hat);
        // The first second auditions PWM alone: left for 0.5 s, then right.
        if (t < 0.5) return {{signal, 0}};
        if (t < 1.0) return {{0, signal}};
        // The final phrase keeps PCM bass/percussion on deliberately different sides.
        return {{fade * (pluck + kick + 0.35 * hat), fade * (0.65 * pluck + 0.5 * kick + hat)}};
    }
    void *chip_;
    uint64_t tick_ = 1;
};

void u16(std::vector<uint8_t> &bytes, uint16_t value) {
    bytes.push_back(uint8_t(value)); bytes.push_back(uint8_t(value >> 8));
}
void u32(std::vector<uint8_t> &bytes, uint32_t value) {
    u16(bytes, uint16_t(value)); u16(bytes, uint16_t(value >> 16));
}
void tag(std::vector<uint8_t> &bytes, const char *value) { bytes.insert(bytes.end(), value, value + 4); }
void sample(std::vector<uint8_t> &bytes, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1.0)
        throw std::runtime_error("Generated PCM is non-finite or exceeds the output headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767.0))));
}

std::vector<uint8_t> render() {
    Core pwm(native_pwm_create(RATE), native_pwm_destroy);
    Core fm(native_ym2612_create(RATE), native_ym2612_destroy);
    Core psg(native_game_gear_create(RATE), native_game_gear_destroy);
    if (!pwm || !fm || !psg) throw std::runtime_error("Could not allocate the PWM, FM and PSG cores");
    if (!native_ym2612_set_clock(fm.get(), FM_CLOCK) || !native_game_gear_set_clock(psg.get(), PSG_CLOCK))
        throw std::runtime_error("Could not configure the FM/PSG clocks");
    native_game_gear_set_stereo(psg.get(), 0xff);
    configure_fm(fm.get());
    PwmFeeder feeder(pwm.get());

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    constexpr std::array<int, 8> melody{{72, 76, 79, 77, 76, 79, 74, 72}};
    constexpr std::array<int, 8> harmony{{60, 60, 67, 65, 60, 67, 65, 60}};
    constexpr uint32_t step = RATE / 4;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        if (frame >= RATE) {
            const uint32_t index = (frame - RATE) / step, within = (frame - RATE) % step;
            if (within == 0) {
                fm_note(fm.get(), melody[index]);
                psg_tone(psg.get(), 0, harmony[index], 11);
                psg_tone(psg.get(), 1, harmony[index] + 7, 13);
            }
            if (within == step * 4 / 5) {
                native_ym2612_write(fm.get(), 0, 0x28, 0);
                native_game_gear_key_off(psg.get(), 0);
                native_game_gear_key_off(psg.get(), 1);
            }
        }
        // With fewer than one tick per output frame, priming/refilling to three
        // entries cannot underrun. Both queues remain paired throughout rendering.
        feeder.refill();
        float wl, wr, fl, fr, pl, pr;
        native_pwm_sample(pwm.get(), &wl, &wr);
        native_ym2612_sample(fm.get(), &fl, &fr);
        native_game_gear_sample(psg.get(), &pl, &pr);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 4800.0));
        // Fixed gains and bounded PWM duties provide headroom without normalization.
        const double accompaniment = frame >= RATE ? 1.0 : 0.0;
        sample(wav, fade * (0.65 * wl + accompaniment * (0.22 * fl + 0.15 * pl)));
        sample(wav, fade * (0.65 * wr + accompaniment * (0.22 * fr + 0.15 * pr)));
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_32x_wav <output.wav>\n"; return 2; }
    try {
        const auto wav = render();
        std::ofstream output(argv[1], std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not open the selected output file");
        output.write(reinterpret_cast<const char *>(wav.data()), std::streamsize(wav.size()));
        output.close();
        if (!output) throw std::runtime_error("Could not finish writing the WAV file");
        std::cout << "Wrote 3 seconds of 48 kHz stereo PCM16 to " << argv[1] << '\n';
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "WAV export failed: " << error.what() << '\n';
        return 1;
    }
}
