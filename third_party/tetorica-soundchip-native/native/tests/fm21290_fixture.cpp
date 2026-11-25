// SPDX-License-Identifier: BSD-3-Clause
// Offline test driver. Read decimal address/value pairs, or -1/frame-count
// to append a block of native float32 mono samples to stdout.
#include <tetorica/fm21290.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

int main(int argc, char **argv) {
    const bool self_test = argc == 2 && std::string(argv[1]) == "--self-test";
    const unsigned rate = self_test ? 48000 : argc == 2 ? std::stoul(argv[1]) : 0;
    std::unique_ptr<fm21290_chip, decltype(&fm21290_destroy)> chip(fm21290_create(rate), fm21290_destroy);
    if (!chip) return 1;
    if (self_test) {
        if (fm21290_write(chip.get(), 0x3037, 1) || fm21290_write(chip.get(), 0x30f1, 256)) return 1;
        for (unsigned algorithm = 0; algorithm < 32; ++algorithm) {
            fm21290_write(chip.get(), 0x2804, 0x30);
            fm21290_write(chip.get(), 0x2805, algorithm << 3);
            for (unsigned stage = 0; stage < 4; ++stage) {
                fm21290_write(chip.get(), 0x3054 + stage, 63);
                fm21290_write(chip.get(), 0x3074 + stage, stage == 3 ? 63 : 0);
            }
            fm21290_write(chip.get(), 0x30df, 15); // OP1 on the last physical voice
            fm21290_write(chip.get(), 0x301e, 0x5a);
            fm21290_write(chip.get(), 0x301f, 0xa8);
            fm21290_write(chip.get(), 0x302a, 0x23);
            fm21290_write(chip.get(), 0x302b, 0x2c);
            fm21290_write(chip.get(), 0x30f1, 61);
            std::array<float,4096> pcm{};
            if (!fm21290_render(chip.get(), pcm.data(), pcm.size()) ||
                *std::max_element(pcm.begin(), pcm.end()) < 0.001f) return 1;
            fm21290_write(chip.get(), 0x30f1, 62);
            fm21290_render(chip.get(), pcm.data(), pcm.size());
            if (pcm.back() != 0) return 1;
        }
        return 0;
    }
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    int address, value;
    while (std::cin >> address >> value) {
        if (address == -1 && value >= 0 && value <= 384000) {
            std::vector<float> pcm(value);
            if (!fm21290_render(chip.get(), pcm.data(), pcm.size())) return 1;
            std::cout.write(reinterpret_cast<const char*>(pcm.data()), pcm.size() * sizeof(float));
        } else if (!fm21290_write(chip.get(), address, value)) return 1;
    }
    return std::cin.eof() && std::cout ? 0 : 1;
}
