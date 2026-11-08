// SPDX-License-Identifier: BSD-3-Clause
// Original observation-only probe. The expected 24-bit phase sequence is
// computed independently by the JavaScript checker, not by this chip header.
#define CHIPS_IMPL
#ifndef SID_WAVEOFF_HEADER
#define SID_WAVEOFF_HEADER "../../third_party/chips-m6581/m6581.h"
#endif
#include SID_WAVEOFF_HEADER
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {
unsigned number(const std::string& text, unsigned maximum) {
    if (text.empty()) throw std::runtime_error("Missing unsigned value");
    uint64_t value = 0;
    for (char ch : text) {
        if (ch < '0' || ch > '9') throw std::runtime_error("Expected a decimal unsigned value");
        value = value * 10 + unsigned(ch - '0');
        if (value > maximum) throw std::runtime_error("Value exceeds the probe bound");
    }
    return unsigned(value);
}
void observe(const m6581_t& chip, uint64_t cycles, int read = -1) {
    std::cout << "{\"cycles\":" << cycles << ",\"phase\":[";
    for (unsigned i = 0; i < 3; i++) std::cout << (i ? "," : "") << chip.voice[i].wav_accum;
    std::cout << "],\"rising\":[";
    for (unsigned i = 0; i < 3; i++) std::cout << (i ? "," : "") << (chip.voice[i].sync ? "true" : "false");
    std::cout << "],\"wave\":[";
    for (unsigned i = 0; i < 3; i++) std::cout << (i ? "," : "") << chip.voice[i].wav_output;
    std::cout << "],\"control\":[";
    for (unsigned i = 0; i < 3; i++) std::cout << (i ? "," : "") << unsigned(chip.voice[i].ctrl);
    std::cout << "],\"envelope\":[";
    for (unsigned i = 0; i < 3; i++) std::cout << (i ? "," : "") << chip.voice[i].env_cur_level;
    std::cout << "],\"read\":" << read << "}\n";
}
}

int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::runtime_error("Usage: sid_waveoff_reference RATE CLOCK < commands");
        const auto rate = number(argv[1], 96000), clock = number(argv[2], 1100000);
        if (rate < 8000 || clock < 900000) throw std::runtime_error("Unsupported rate/clock");
        m6581_t chip{};const m6581_desc_t descriptor{int(clock), int(rate), 1};m6581_init(&chip, &descriptor);
        uint64_t cycles = 0;std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream input(line);std::string operation, extra;
            if (!(input >> operation)) continue;
            if (operation == "seed") {
                std::string voice, frequency, phase, control, output;
                if (!(input >> voice >> frequency >> phase >> control >> output) || input >> extra) throw std::runtime_error("Expected seed VOICE FREQUENCY PHASE CONTROL OUTPUT");
                auto& v = chip.voice[number(voice, 2)];v.freq = number(frequency, 65535);v.wav_accum = number(phase, 0xffffff);
                v.ctrl = number(control, 255);v.wav_output = number(output, 4095);v.pulse_width = 2048;v.sync = false;
            } else if (operation == "tick") {
                std::string ticks;if (!(input >> ticks) || input >> extra) throw std::runtime_error("Expected tick CYCLES");
                for (unsigned remaining = number(ticks, 2000000); remaining; --remaining) {m6581_tick(&chip, 0);cycles++;}
            } else if (operation == "write" || operation == "read") {
                std::string reg, value;
                if (!(input >> reg)) throw std::runtime_error("Missing register");
                uint64_t pins = M6581_CS | number(reg, 31);
                if (operation == "write") {
                    if (!(input >> value) || input >> extra) throw std::runtime_error("Expected write REGISTER VALUE");
                    M6581_SET_DATA(pins, number(value, 255));
                } else {
                    if (input >> extra) throw std::runtime_error("Expected read REGISTER");
                    pins |= M6581_RW;
                }
                const uint64_t result = m6581_tick(&chip, pins);cycles++;
                if (operation == "read") observe(chip, cycles, M6581_GET_DATA(result));
            } else if (operation == "observe") {
                if (input >> extra) throw std::runtime_error("observe takes no arguments");observe(chip, cycles);
            } else throw std::runtime_error("Unknown probe command");
        }
        return 0;
    } catch (const std::exception& error) {std::cerr << "SID no-wave probe: " << error.what() << '\n';return 1;}
}
