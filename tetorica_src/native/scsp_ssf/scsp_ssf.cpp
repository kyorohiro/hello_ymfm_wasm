// SPDX-License-Identifier: BSD-3-Clause
#include "scsp_ssf.h"
#include "m68kops.h"
#include "scsp_instrument.h"

#include <cstdlib>
#include <memory>
#include <new>

namespace {
constexpr uint32_t kRamBytes = 512 * 1024;
constexpr uint32_t kRegisterBase = 0x100000;
constexpr uint32_t kRegisterBytes = 0x1000;
constexpr uint32_t kAddressMask = 0x00ffffff;
constexpr uint32_t kNoFault = UINT32_MAX;
// Nominal Saturn sound clock of 11.2896 MHz at 44.1 kHz output.
constexpr int kCpuCyclesPerFrame = 256;

class SoundBoard {
public:
    ~SoundBoard() { scsp_destroy(chip); }

    bool start(const uint8_t *ram) {
        if (!chip || !scsp_load_ram(chip, 0, ram, kRamBytes))
            return false;
        cpu.SetUserData(this);
        cpu.m68k_set_cpu_type(M68K_CPU_TYPE_68000);
        cpu.m68k_pulse_reset();
        const uint32_t pc = cpu.m68k_get_reg(M68K_REG_PC) & kAddressMask;
        const uint32_t stack = cpu.m68k_get_reg(M68K_REG_SP);
        if (pc >= kRamBytes || ((pc | stack) & 1))
            return false;

        // The pinned core returns reset clocks separately when the requested
        // slice ends at reset. Charge them before running the first instruction.
        const int resetCycles = cpu.m68ki_cpu.reset_cycles;
        if (resetCycles > 0)
            cyclesAhead = cpu.Execute(resetCycles);
        return true;
    }

    bool render(float *left, float *right, uint32_t frames) {
        if (fault != kNoFault)
            return false;
        for (uint32_t frame = 0; frame < frames; ++frame) {
            // An instruction can run past the slice. Carry those clocks into
            // the next sample, including when the caller changes block sizes.
            cyclesAhead -= kCpuCyclesPerFrame;
            if (cyclesAhead < 0)
                cyclesAhead += cpu.Execute(-cyclesAhead);
            if (fault != kNoFault || !scsp_render(chip, left + frame, right + frame, 1))
                return false;
        }
        return true;
    }

    uint16_t read(uint32_t address, bool byteAccess) {
        if (fault != kNoFault)
            return UINT16_MAX;
        address &= kAddressMask;
        if ((address & 1) && !byteAccess)
            return reportFault(address);
        if (address < kRamBytes) {
            uint8_t bytes[2]{};
            scsp_read_ram(chip, address, bytes, byteAccess ? 1 : 2);
            return byteAccess ? bytes[0] : (uint16_t(bytes[0]) << 8) | bytes[1];
        }
        if (!isRegister(address))
            return reportFault(address);
        const uint32_t value = scsp_read(chip, (address - kRegisterBase) & ~1u);
        if (value == UINT32_MAX)
            return reportFault(address);
        if (!byteAccess)
            return uint16_t(value);
        return uint8_t(value >> ((address & 1) ? 0 : 8));
    }

    void write(uint32_t address, uint16_t value, bool byteAccess) {
        if (fault != kNoFault)
            return;
        address &= kAddressMask;
        if (!(address & 1) || byteAccess) {
            if (address < kRamBytes) {
                const uint8_t bytes[] = {uint8_t(byteAccess ? value : value >> 8), uint8_t(value)};
                scsp_load_ram(chip, address, bytes, byteAccess ? 1 : 2);
                return;
            }
            if (isRegister(address)) {
                const uint32_t offset = (address - kRegisterBase) & ~1u;
                const unsigned shift = byteAccess && !(address & 1) ? 8 : 0;
                const uint16_t mask = byteAccess ? 0xffu << shift : 0xffff;
                if (scsp_write(chip, offset, uint16_t(value << shift), mask))
                    return;
            }
        }
        reportFault(address);
    }

    uint32_t faultAddress() const { return fault; }

private:
    static bool isRegister(uint32_t address) {
        return address >= kRegisterBase && address < kRegisterBase + kRegisterBytes;
    }

    uint16_t reportFault(uint32_t address) {
        fault = address;
        cpu.m68k_end_timeslice();
        return UINT16_MAX;
    }

    // CPU accesses, sample fetches and DSP all use this chip's sound RAM.
    void *chip = scsp_create();
    M68k cpu;
    int cyclesAhead = 0;
    uint32_t fault = kNoFault;
};
}

// These hooks link only into the dedicated SSF renderer. The Atari ST
// player uses its own machine and bus hooks for the same pinned CPU sources.
void *AtariAudioMalloc(size_t size) { return std::malloc(size); }
void AtariAudioFree(void *pointer) { std::free(pointer); }

unsigned int M68k_Read8(void *user, unsigned int address) {
    return uint8_t(static_cast<SoundBoard *>(user)->read(address, true));
}
unsigned int M68k_Read16(void *user, unsigned int address) {
    return static_cast<SoundBoard *>(user)->read(address, false);
}
unsigned int M68k_Read32(void *user, unsigned int address) {
    const uint32_t high = M68k_Read16(user, address);
    return (high << 16) | M68k_Read16(user, address + 2);
}
void M68k_Write8(void *user, unsigned int address, unsigned int value) {
    static_cast<SoundBoard *>(user)->write(address, uint8_t(value), true);
}
void M68k_Write16(void *user, unsigned int address, unsigned int value) {
    static_cast<SoundBoard *>(user)->write(address, uint16_t(value), false);
}
void M68k_Write32(void *user, unsigned int address, unsigned int value) {
    M68k_Write16(user, address, value >> 16);
    M68k_Write16(user, address + 2, value);
}

// Processor RESET does not reset the Saturn sound board. Leave TRAP and
// illegal-instruction dispatch to the CPU's normal exception vectors.
void M68k_Reset_Callback(void *) {}
int M68k_TrapN_Callback(void *, int) { return 0; }
int M68k_Illegal_Callback(void *, int) { return 0; }

void *scsp_ssf_create(const uint8_t *ram, uint32_t size) {
    if (!ram || size != kRamBytes || !m68kTablesValid())
        return nullptr;
    std::unique_ptr<SoundBoard> board(new (std::nothrow) SoundBoard);
    return board && board->start(ram) ? board.release() : nullptr;
}

void scsp_ssf_destroy(void *handle) { delete static_cast<SoundBoard *>(handle); }

int scsp_ssf_render(void *handle, float *left, float *right, uint32_t frames) {
    if (!handle || frames > 1048576 || (frames && (!left || !right)))
        return 0;
    const uintptr_t l = reinterpret_cast<uintptr_t>(left), r = reinterpret_cast<uintptr_t>(right);
    const uintptr_t distance = l < r ? r - l : l - r;
    if (distance < uintptr_t(frames) * sizeof(float))
        return 0;
    return static_cast<SoundBoard *>(handle)->render(left, right, frames);
}

uint32_t scsp_ssf_fault_address(const void *handle) {
    return handle ? static_cast<const SoundBoard *>(handle)->faultAddress() : kNoFault;
}
