// SPDX-License-Identifier: BSD-3-Clause
// Renders a prepared sound-RAM image to interleaved little-endian Float32 PCM.
#include "scsp_ssf.h"

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <string_view>
#include <system_error>
#include <vector>

namespace {
constexpr uint32_t ram_size = 512 * 1024;
constexpr uint32_t max_frames = 1048576;

bool parse_frames(std::string_view value, uint32_t& frames) {
    const auto end = value.data() + value.size();
    const auto result = std::from_chars(value.data(), end, frames);
    return result.ec == std::errc{} && result.ptr == end && frames > 0 && frames <= max_frames;
}

void write_sample(uint8_t* output, float sample) {
    static_assert(sizeof(float) == sizeof(uint32_t) && std::numeric_limits<float>::is_iec559);
    uint32_t bits;
    std::memcpy(&bits, &sample, sizeof(bits));
    for (unsigned byte = 0; byte < sizeof(bits); ++byte) {
        output[byte] = static_cast<uint8_t>(bits >> (8 * byte));
    }
}
} // namespace

int main(int argc, char** argv) {
    uint32_t frames, block_frames;
    if (argc != 5 || !parse_frames(argv[3], frames) || !parse_frames(argv[4], block_frames)) {
        std::cerr << "Usage: scsp-ssf-fixture INPUT.ram OUTPUT.f32 FRAME_COUNT BLOCK_FRAMES\n";
        return 2;
    }

    std::ifstream input(argv[1], std::ios::binary);
    if (!input) {
        std::cerr << "Could not open the sound RAM image\n";
        return 1;
    }
    std::vector<uint8_t> ram(ram_size + 1);
    input.read(reinterpret_cast<char*>(ram.data()), ram.size());
    if (input.bad()) {
        std::cerr << "Could not read the sound RAM image\n";
        return 1;
    }
    const auto bytes_read = static_cast<uint32_t>(input.gcount());

    std::unique_ptr<void, decltype(&scsp_ssf_destroy)> board(
        scsp_ssf_create(ram.data(), bytes_read), scsp_ssf_destroy);
    if (!board) {
        std::cerr << "SCSP rejected the " << bytes_read << "-byte sound RAM image\n";
        return 1;
    }

    std::ofstream output(argv[2], std::ios::binary);
    if (!output) {
        std::cerr << "Could not open the PCM output file\n";
        return 1;
    }
    std::vector<float> left(block_frames), right(block_frames);
    std::vector<uint8_t> pcm(block_frames * 2 * sizeof(float));
    for (uint32_t offset = 0; offset < frames;) {
        const uint32_t count = std::min(block_frames, frames - offset);
        if (!scsp_ssf_render(board.get(), left.data(), right.data(), count)) {
            std::cerr << "SCSP render failed at frame " << offset;
            const auto address = scsp_ssf_fault_address(board.get());
            if (address != UINT32_MAX) {
                std::cerr << ": unsupported sound board access at 0x" << std::hex << address;
            }
            std::cerr << '\n';
            return 1;
        }
        for (uint32_t frame = 0; frame < count; ++frame) {
            write_sample(&pcm[frame * 8], left[frame]);
            write_sample(&pcm[frame * 8 + 4], right[frame]);
        }
        output.write(reinterpret_cast<const char*>(pcm.data()), count * 2 * sizeof(float));
        offset += count;
    }
    output.close();
    if (!output) {
        std::cerr << "Could not write the PCM output file\n";
        return 1;
    }
}
