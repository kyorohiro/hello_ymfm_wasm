#include <iostream>

#include "ymfm.h"
#include "ymfm_opn.h"

int main()
{
    // YM2612 master clock for Sega Mega Drive / Genesis
    constexpr uint32_t CLOCK = 7670454; // 7.67 MHz

    // ymfm_interface is the host-side bridge used by ymfm.
    // It mixes callback/notification-style hooks and query-style hooks.
    // In a larger emulator or wrapper, this is where you would connect:
    // - timer
    //   YM2612 internal timers to your host-side timing system
    // - IRQ
    //   YM2612 interrupt notifications to your host-side IRQ handling
    // - busy
    //   the YM2612 busy flag to your host-side time/bus model
    // - external I/O
    //   any external reads/writes that the chip should forward outside
    //
    // This minimal example does not need those integrations, so the default
    // ymfm_interface implementation is enough.
    ymfm::ymfm_interface intf;
    ymfm::ym2612 chip(intf);

    //
    // reset the overall state
    chip.reset();

    //
    // compute the output audio sample rate for the Genesis YM2612 clock
    // sampleRate means how many audio samples the chip outputs per second
    uint32_t sampleRate = chip.sample_rate(CLOCK);

    std::cout << "YM2612 created\n";
    std::cout << "sample rate = " << sampleRate << "\n";

    // --------------------------------
    //
    // YM2612 has 6 FM channels.
    // Each channel is built from 4 operators.
    //
    // --------------------------------

    // --------------------------------
    // DT / MULTI register format:
    // - bits 6-4 = DT
    //   DT (detune) is a small pitch offset for the operator
    // - bits 3-0 = MULTI
    //   MULTI (multiple) is the operator frequency multiplier
    //

    // port 0, channel 1, operator 1
    chip.write(0, 0x30);                // 0x30 + operator offset (0 for operator 1)
    chip.write(1, (0 << 4) | (1 << 0)); // DT = 0, MULTI = 1

    // port 0, channel 1, operator 2
    chip.write(0, 0x34);                // 0x30 + operator offset (4 for operator 2)
    chip.write(1, (0 << 4) | (1 << 0)); // DT = 0, MULTI = 1

    // port 0, channel 1, operator 3
    chip.write(0, 0x38);                // 0x30 + operator offset (8 for operator 3)
    chip.write(1, (0 << 4) | (1 << 0)); // DT = 0, MULTI = 1

    // port 0, channel 1, operator 4
    chip.write(0, 0x3c);                // 0x30 + operator offset (12 for operator 4)
    chip.write(1, (0 << 4) | (1 << 0)); // DT = 0, MULTI = 1

    // [ps]
    // port 0, channel 2, operator 1
    // chip.write(0, 0x31); // 0x31 + operator offset (0 for operator 1)
    // chip.write(1, (0 << 4) | (1 << 0)); // DT = 0, MULTI = 1
    //
    // port 1, channel 4, operator 1
    // chip.write(2, 0x30); // port 1, 0x30 + operator offset (0 for operator 1)
    // chip.write(3, (0 << 4) | (1 << 0)); // DT = 0, MULTI = 1
    // --------------------------------

    // --------------------------------
    // Total Level register format:
    // - bits 6-0 = TL
    //   TL (total level) is the operator output level
    //   0x00 is loud, 0x7f is quiet
    //
    // In this example, operator 4 is used as the audible carrier,
    // so operator 4 is loud and operators 1-3 are kept quiet.
    //

    // port 0, channel 1, operator 1
    chip.write(0, 0x40); // 0x40 + operator offset (0 for operator 1)
    chip.write(1, 0x7f); // TL = 0x7f (quiet)

    // port 0, channel 1, operator 2
    chip.write(0, 0x44); // 0x40 + operator offset (4 for operator 2)
    chip.write(1, 0x7f); // TL = 0x7f (quiet)

    // port 0, channel 1, operator 3
    chip.write(0, 0x48); // 0x40 + operator offset (8 for operator 3)
    chip.write(1, 0x7f); // TL = 0x7f (quiet)

    // port 0, channel 1, operator 4
    chip.write(0, 0x4c); // 0x40 + operator offset (12 for operator 4)
    chip.write(1, 0x00); // TL = 0x00 (loud)

    // examples:
    // port 0, channel 2, operator 1
    // chip.write(0, 0x41); // 0x41 + operator offset (0 for operator 1)
    // chip.write(1, 0x7f); // TL = 0x7f
    //
    // port 1, channel 4, operator 1
    // chip.write(2, 0x40); // port 1, 0x40 + operator offset (0 for operator 1)
    // chip.write(3, 0x7f); // TL = 0x7f
    // --------------------------------

    // --------------------------------
    // Attack Rate register format:
    // - bits 4-0 = AR
    //   AR (attack rate) controls how quickly the operator reaches full level
    //   larger values rise faster
    //
    // 0x1f = fast attack for all 4 operators in channel 1

    // port 0, channel 1, operator 1
    chip.write(0, 0x50); // 0x50 + operator offset (0 for operator 1)
    chip.write(1, 0x1f); // AR = 0x1f

    // port 0, channel 1, operator 2
    chip.write(0, 0x54); // 0x50 + operator offset (4 for operator 2)
    chip.write(1, 0x1f); // AR = 0x1f

    // port 0, channel 1, operator 3
    chip.write(0, 0x58); // 0x50 + operator offset (8 for operator 3)
    chip.write(1, 0x1f); // AR = 0x1f

    // port 0, channel 1, operator 4
    chip.write(0, 0x5c); // 0x50 + operator offset (12 for operator 4)
    chip.write(1, 0x1f); // AR = 0x1f
    // --------------------------------

    // --------------------------------
    // Sustain Level / Release Rate register format:
    // - bits 7-4 = SL
    //   SL (sustain level) is the held level after decay
    // - bits 3-0 = RR
    //   RR (release rate) controls how fast the sound fades after key off
    //
    // 0x0f = SL = 0, RR = 0x0f

    // port 0, channel 1, operator 1
    chip.write(0, 0x80); // 0x80 + operator offset (0 for operator 1)
    chip.write(1, 0x0f); // SL = 0, RR = 0x0f

    // port 0, channel 1, operator 2
    chip.write(0, 0x84); // 0x80 + operator offset (4 for operator 2)
    chip.write(1, 0x0f); // SL = 0, RR = 0x0f

    // port 0, channel 1, operator 3
    chip.write(0, 0x88); // 0x80 + operator offset (8 for operator 3)
    chip.write(1, 0x0f); // SL = 0, RR = 0x0f

    // port 0, channel 1, operator 4
    chip.write(0, 0x8c); // 0x80 + operator offset (12 for operator 4)
    chip.write(1, 0x0f); // SL = 0, RR = 0x0f
    // --------------------------------

    // --------------------------------
    // Algorithm / Feedback register format:
    // - bits 5-3 = FB
    //   FB (feedback) controls self-modulation amount
    // - bits 2-0 = ALG
    //   ALG (algorithm) selects how the 4 operators are connected
    //
    // 0x07 = FB = 0, ALG = 7
    // Algorithm 7 makes all 4 operators act as carriers.
    // That is simple for a first beep because every operator goes directly
    // to the audible output.
    chip.write(0, 0xb0); // channel 1 algorithm/feedback register
    chip.write(1, 0x07); // FB = 0, ALG = 7

    // Output / Pan register format:
    // - bit 7 = left enable
    // - bit 6 = right enable
    //
    // 0xc0 = left on + right on
    chip.write(0, 0xb4); // channel 1 output register
    chip.write(1, 0xc0); // L = 1, R = 1
    // --------------------------------

    // --------------------------------
    // Frequency for channel 1:
    // - 0xa4 holds the upper bits (block + upper frequency bits)
    // - 0xa0 holds the lower 8 bits
    //
    // Together they form the pitch for the note.
    chip.write(0, 0xa4); // channel 1 frequency high
    chip.write(1, 0x22);

    chip.write(0, 0xa0); // channel 1 frequency low
    chip.write(1, 0x69);
    // --------------------------------

    // --------------------------------
    // Key ON / Key OFF register:
    // - 0x28 selects which channel and which operators are triggered
    //
    // 0xf0 means:
    // - high nibble 0xf: operators 1-4 on
    // - low nibble 0x0: channel slot 0 (= channel 1 on port 0 side)
    chip.write(0, 0x28); // key on/off control register
    chip.write(1, 0xf0); // key on channel 1, operators 1-4
    // --------------------------------

    // Generate 3 seconds of stereo audio and save it as a WAV file.
    ymfm::ymfm_wavfile<2> wav(sampleRate);
    wav.set_index(0);

    for (uint32_t i = 0; i < sampleRate * 3; i++)
    {
        ymfm::ym2612::output_data output;
        chip.generate(&output);
        wav.add(output);
    }

    std::cout << "generated wavlog-00.wav\n";

    return 0;
}

/*
From the repository root:
mkdir -p .emcache
EM_CACHE="$PWD/.emcache" em++ -std=c++14 \
    -Isrc \
    examples/cpp/tutorials/ex03_beep.cpp \
    src/ymfm_opn.cpp src/ymfm_adpcm.cpp src/ymfm_ssg.cpp src/ymfm_misc.cpp \
    -sNODERAWFS=1 \
    -o test.js
node ./test.js
*/
