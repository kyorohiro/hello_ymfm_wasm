// SPDX-License-Identifier: BSD-3-Clause
// Headless, in-memory Nintendo DS frontend for the pinned SkyEmu core.
#include <limits.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// ROMs cannot open host files. Use a deterministic RTC and omit upstream
// debug output, which can be very noisy while a driver is starting.
static struct tm rtc = {.tm_year = 100, .tm_mon = 0, .tm_mday = 1, .tm_wday = 6};
#define fopen(path, mode) ((FILE *)NULL)
#define printf(...) ((void)0)
#define fprintf(...) ((void)0)
#define time(timer) ((time_t)0)
#define localtime(timer) (&rtc)
#include "shared.h"
#include "sb_types.h"
#include "arm7.h"
#include "nds.h"
#undef localtime
#undef time
#undef fprintf
#undef printf
#undef fopen

enum { MAX_ROM_BYTES = 64 * 1024 * 1024, MAX_RENDER_FRAMES = 2048 };
_Static_assert(SE_AUDIO_SAMPLE_RATE == 48000, "Update the 2SF frontend sample rate");

static sb_emu_state_t emu;
static nds_t console;
static nds_scratch_t scratch;

bool se_load_bios_file(const char *name, const char *path, const char *file,
                      uint8_t *data, size_t size) {
	(void)name;
	(void)path;
	(void)file;
	(void)data;
	(void)size;
	return false; // Use the included BSD-2-Clause FreeBIOS.
}

static uint32_t read_le32(const uint8_t *bytes) {
	return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
	       (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static bool valid_segment(const uint8_t *rom, size_t size, size_t field) {
	const uint32_t offset = read_le32(rom + field);
	const uint32_t length = read_le32(rom + field + 12);
	return offset >= 0x200 && offset < size && length > 0 && length <= size - offset;
}

void nds_2sf_close(void) {
	if (emu.rom_loaded) nds_unload(&console, &scratch);
	free(emu.rom_data);
	memset(&emu, 0, sizeof emu);
}

int nds_2sf_open(const uint8_t *rom, size_t size) {
	if (!rom || emu.rom_loaded || size < 1024 || size > MAX_ROM_BYTES ||
	    !valid_segment(rom, size, 0x20) || !valid_segment(rom, size, 0x30))
		return 0;
	emu.rom_data = malloc(size);
	if (!emu.rom_data) return 0;
	memcpy(emu.rom_data, rom, size);
	emu.rom_size = size;
	emu.system = SYSTEM_NDS;
	emu.joy.touch_pos[0] = 0.5f;
	memcpy(emu.rom_path, "input.nds", sizeof "input.nds");
	memset(&scratch, 0, sizeof scratch);
	emu.rom_loaded = nds_load_rom(&emu, &console, &scratch);
	if (!emu.rom_loaded) nds_2sf_close();
	return emu.rom_loaded;
}

unsigned nds_2sf_render(int16_t *output, unsigned frames) {
	if (!emu.rom_loaded || !output || !frames || frames > MAX_RENDER_FRAMES) return 0;
	sb_ring_buffer_t *ring = &emu.audio_ring_buff;
	const unsigned samples = frames * 2;
	for (unsigned tick = 0; sb_ring_buffer_size(ring) < samples; ++tick) {
		// A DS frame produces about 800 stereo frames. A sleeping driver can
		// return without advancing. Let the host report failure in that case.
		if (tick == 8) return 0;
		nds_tick(&emu, &console, &scratch);
	}
	for (unsigned sample = 0; sample < samples; ++sample)
		output[sample] = ring->data[ring->read_ptr++ % SB_AUDIO_RING_BUFFER_SIZE];
	return frames;
}
