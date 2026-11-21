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

enum {
	MAX_ROM_BYTES = 64 * 1024 * 1024,
	MAX_RENDER_FRAMES = 2048,
	MAX_RENDER_TICKS = 8,
	CHANNELS = 16,
	CHANNEL_WORDS = 5,
	SNAPSHOT_WORDS = 1 + CHANNELS * CHANNEL_WORDS,
	CAPTURE_TICKS = 48,
	CAPTURE_SLOTS = CAPTURE_TICKS * CHANNELS,
	MAX_SAMPLE_BYTES = 1024 * 1024,
	MAX_CAPTURE_BYTES = 8 * MAX_SAMPLE_BYTES,
	CAPTURE_MISSING = -1,
	CAPTURE_INACTIVE = -2,
	CAPTURE_UNSUPPORTED = -3,
	CAPTURE_BUDGET = -4,
};
_Static_assert(SE_AUDIO_SAMPLE_RATE == 48000, "Update the 2SF frontend sample rate");

static sb_emu_state_t emu;
static nds_t console;
static nds_scratch_t scratch;
static uint32_t rendered_frames;
static unsigned snapshot_count;
static uint32_t snapshots[1 + MAX_RENDER_TICKS][SNAPSHOT_WORDS];

typedef struct {
	const uint8_t *source;
	uint8_t *bytes;
	size_t length;
	uint32_t frame;
	unsigned references;
} CaptureSample;

typedef struct {
	bool valid;
	uint32_t frame;
	int samples[CHANNELS];
} CaptureTick;

static CaptureSample capture_samples[CAPTURE_SLOTS];
static CaptureTick capture_ticks[CAPTURE_TICKS];
static size_t capture_bytes;
static unsigned capture_next;
static const uint8_t *capture_result;

static void release_capture_tick(CaptureTick *tick) {
	if (!tick->valid) return;
	for (unsigned channel = 0; channel < CHANNELS; ++channel) {
		const int index = tick->samples[channel];
		if (index < 0) continue;
		CaptureSample *sample = &capture_samples[index];
		if (!--sample->references) {
			capture_bytes -= sample->length;
			free(sample->bytes);
			*sample = (CaptureSample){0};
		}
	}
	tick->valid = false;
}

// Read only contiguous samples from the main RAM or private ARM7 WRAM mirror.
// The song controls SAD; arbitrary bus reads can reach side-effectful MMIO.
static const uint8_t *capture_source(uint32_t address, size_t length) {
	if (address & 3) return NULL;
	if (address >> 24 == 2) {
		const size_t offset = address & (sizeof console.mem.ram - 1);
		if (length <= sizeof console.mem.ram - offset) return console.mem.ram + offset;
	}
	if (address >= 0x03800000 && address < 0x04000000) {
		const size_t offset = (address - 0x03800000) & (64 * 1024 - 1);
		if (length <= 64 * 1024 - offset) return console.mem.wram + 32 * 1024 + offset;
	}
	return NULL;
}

static int retain_sample(uint32_t frame, uint32_t cnt, uint32_t sad, uint32_t tmr_pnt, uint32_t len) {
	if (!(cnt >> 31)) return CAPTURE_INACTIVE;
	const unsigned format = (cnt >> 29) & 3;
	const unsigned repeat = (cnt >> 27) & 3;
	const uint32_t start = tmr_pnt >> 16;
	const uint32_t words = len & 0x3fffff;
	const size_t length = (start + words) * 4;
	if (format == 3 || (repeat != 1 && repeat != 2) || !words || length < 16 || length > MAX_SAMPLE_BYTES)
		return CAPTURE_UNSUPPORTED;
	const uint8_t *source = capture_source(sad, length);
	if (!source) return CAPTURE_UNSUPPORTED;
	if (format == 2 && ((repeat == 1 && !start) || source[2] > 88 || source[3] ||
	                    (source[0] == 0 && source[1] == 0x80)))
		return CAPTURE_UNSUPPORTED;

	CaptureSample *newest = NULL, *free_slot = NULL;
	for (unsigned index = 0; index < CAPTURE_SLOTS; ++index) {
		CaptureSample *sample = &capture_samples[index];
		if (!sample->references) {
			if (!free_slot) free_slot = sample;
		} else if (sample->source == source && sample->length == length &&
		           (!newest || sample->frame > newest->frame)) {
			newest = sample;
		}
	}
	// RAM can be rewritten in place while a driver's register settings stay
	// constant. Reuse only if the contents still match the retained bytes.
	if (newest && (newest->frame == frame || !memcmp(newest->bytes, source, length))) {
		newest->frame = frame;
		newest->references++;
		return (int)(newest - capture_samples);
	}
	if (!free_slot || length > MAX_CAPTURE_BYTES - capture_bytes) return CAPTURE_BUDGET;
	uint8_t *bytes = malloc(length);
	if (!bytes) return CAPTURE_BUDGET;
	memcpy(bytes, source, length);
	*free_slot = (CaptureSample){ .source = source, .bytes = bytes, .length = length, .frame = frame, .references = 1 };
	capture_bytes += length;
	return (int)(free_slot - capture_samples);
}

// Return the retained byte count or a negative Capture status. The returned
// pointer is valid until the next capture, render or close. Never fall back to
// present RAM when looking up an earlier, potentially overwritten sample.
int nds_2sf_capture(uint32_t frame, unsigned channel) {
	capture_result = NULL;
	if (!emu.rom_loaded || channel >= CHANNELS) return CAPTURE_MISSING;
	for (unsigned age = 1; age <= CAPTURE_TICKS; ++age) {
		const CaptureTick *tick = &capture_ticks[(capture_next + CAPTURE_TICKS - age) % CAPTURE_TICKS];
		if (!tick->valid || tick->frame != frame) continue;
		const int index = tick->samples[channel];
		if (index < 0) return index;
		const CaptureSample *sample = &capture_samples[index];
		capture_result = sample->bytes;
		return (int)sample->length;
	}
	return CAPTURE_MISSING;
}

const uint8_t *nds_2sf_capture_data(void) {
	return capture_result;
}

// A row carries the absolute stereo PCM frame, then each channel's CNT, SAD,
// packed TMR/PNT, LEN and running decoder position. CNT bit 31 is cleared by
// SkyEmu when a one-shot ends. Reading register mirrors does not invoke MMIO.
static void take_snapshot(uint32_t frame) {
	CaptureTick *tick = &capture_ticks[capture_next];
	release_capture_tick(tick);
	tick->valid = true;
	tick->frame = frame;
	capture_next = (capture_next + 1) % CAPTURE_TICKS;
	uint32_t *row = snapshots[snapshot_count++];
	*row++ = frame;
	for (unsigned channel = 0; channel < CHANNELS; ++channel) {
		const unsigned offset = channel * 16;
		const uint32_t cnt = nds7_io_read32(&console, NDS7_SOUND0_CNT + offset);
		const uint32_t sad = nds7_io_read32(&console, NDS7_SOUND0_SAD + offset);
		const uint32_t tmr_pnt = nds7_io_read32(&console, NDS7_SOUND0_TMR + offset);
		const uint32_t len = nds7_io_read32(&console, NDS7_SOUND0_LEN + offset);
		*row++ = cnt;
		*row++ = sad;
		*row++ = tmr_pnt;
		*row++ = len;
		*row++ = console.audio.channel[channel].sample;
		tick->samples[channel] = retain_sample(frame, cnt, sad, tmr_pnt, len);
	}
}

// Rows belong to the most recent successful render and stay valid through the
// next render or close. The final tick's state may follow the current block.
const uint32_t *nds_2sf_snapshots(void) {
	return snapshots[0];
}

unsigned nds_2sf_snapshot_count(void) {
	return snapshot_count;
}

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
	rendered_frames = 0;
	snapshot_count = 0;
	for (unsigned index = 0; index < CAPTURE_TICKS; ++index)
		release_capture_tick(&capture_ticks[index]);
	capture_next = 0;
	capture_result = NULL;
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
	snapshot_count = 0;
	capture_result = NULL;
	if (!emu.rom_loaded || !output || !frames || frames > MAX_RENDER_FRAMES) return 0;
	sb_ring_buffer_t *ring = &emu.audio_ring_buff;
	const unsigned samples = frames * 2;
	if (!rendered_frames) take_snapshot(0);
	unsigned buffered = sb_ring_buffer_size(ring);
	for (unsigned tick = 0; buffered < samples; ++tick) {
		// A DS frame produces about 800 stereo frames. A sleeping driver can
		// return without advancing. Let the host report failure in that case.
		if (tick == MAX_RENDER_TICKS) {
			snapshot_count = 0;
			return 0;
		}
		nds_tick(&emu, &console, &scratch);
		const unsigned available = sb_ring_buffer_size(ring);
		// Use the ring's queued PCM count. Its read/write cursors periodically
		// wrap into range, and prior renders can leave part of a tick queued.
		if (available > buffered) take_snapshot(rendered_frames + available / 2);
		buffered = available;
	}
	for (unsigned sample = 0; sample < samples; ++sample)
		output[sample] = ring->data[ring->read_ptr++ % SB_AUDIO_RING_BUFFER_SIZE];
	rendered_frames += frames;
	return frames;
}
