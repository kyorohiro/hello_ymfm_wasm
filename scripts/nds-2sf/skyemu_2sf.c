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
	SYNTH_RAM_BASE = 0x02000000,
	// Same ARM7 clock and 1/64-cycle accumulator as nds_tick_audio().
	AUDIO_CYCLES_64 = 33513982 * 64 / SE_AUDIO_SAMPLE_RATE,
	CHANNEL_WORDS = 5,
	SNAPSHOT_WORDS = 1 + CHANNELS * CHANNEL_WORDS,
	CAPTURE_TICKS = 48,
	CAPTURE_SLOTS = CAPTURE_TICKS * CHANNELS,
	MAX_SAMPLE_BYTES = 1024 * 1024,
	SYNTH_VOICE_RAM_BASE = 0x08000000,
	SYNTH_VOICE_SLOTS = 2 * CHANNELS,
	// Allow a staging cache in addition to sixteen playing host slots.
	SYNTH_ADPCM_CACHE_SLOTS = CHANNELS + 1,
	HOST_ADPCM_STEP_SHIFT = 2,
	MAX_SYNTH_ADPCM_CACHE_BYTES = 2 * SYNTH_ADPCM_CACHE_SLOTS * MAX_SAMPLE_BYTES,
	MAX_ADPCM_PREPARE_FRAMES = 16384,
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
static bool synth_open;
static uint32_t rendered_frames;
static unsigned snapshot_count;
static uint32_t snapshots[1 + MAX_RENDER_TICKS][SNAPSHOT_WORDS];

typedef struct {
	int16_t sample;
	uint8_t index;
} SynthAdpcmStep;

typedef struct {
	SynthAdpcmStep *steps;
	uint32_t address;
	uint32_t frames;
	uint32_t decoded;
	unsigned step_shift;
} SynthAdpcmCache;

static SynthAdpcmCache synth_adpcm_cache[SYNTH_ADPCM_CACHE_SLOTS];
static SynthAdpcmCache *synth_adpcm_voice[CHANNELS];
static size_t synth_adpcm_bytes;
static bool synth_adpcm_enabled;

typedef struct {
	uint8_t *data;
	size_t size;
	size_t capacity;
} SynthVoiceSlot;

typedef struct {
	float left;
	float right;
	unsigned release_frames;
	unsigned release_remaining;
} SynthMix;

static SynthVoiceSlot synth_voice_slots[SYNTH_VOICE_SLOTS];
static SynthMix synth_mix[CHANNELS];
static float *synth_float_output;
static unsigned synth_float_remaining;

static bool synth_voice_address(uint32_t address) {
	return address - (uint32_t)SYNTH_VOICE_RAM_BASE < SYNTH_VOICE_SLOTS * MAX_SAMPLE_BYTES;
}

static const uint8_t *synth_sample_bytes(uint32_t address, size_t size) {
	if (synth_voice_address(address)) {
		const uint32_t slot_address = address - SYNTH_VOICE_RAM_BASE;
		const SynthVoiceSlot *slot = &synth_voice_slots[slot_address / MAX_SAMPLE_BYTES];
		const size_t offset = slot_address % MAX_SAMPLE_BYTES;
		if (offset >= slot->size || size > slot->size - offset) return NULL;
		return slot->data + offset;
	}
	const uint32_t offset = address - (uint32_t)SYNTH_RAM_BASE;
	if (offset >= sizeof console.mem.ram || size > sizeof console.mem.ram - offset) return NULL;
	return console.mem.ram + offset;
}

static uint8_t tetorica_synth_read8(nds_t *nds, uint32_t address) {
	if (!synth_open || !synth_voice_address(address)) return nds7_read8(nds, address);
	const uint8_t *bytes = synth_sample_bytes(address, 1);
	return bytes ? bytes[0] : 0;
}

static uint16_t tetorica_synth_read16(nds_t *nds, uint32_t address) {
	if (!synth_open || !synth_voice_address(address)) return nds7_read16(nds, address);
	const uint8_t *bytes = synth_sample_bytes(address, 2);
	return bytes ? bytes[0] | ((uint16_t)bytes[1] << 8) : 0;
}

static uint32_t tetorica_synth_read32(nds_t *nds, uint32_t address) {
	if (!synth_open || !synth_voice_address(address)) return nds7_read32(nds, address);
	const uint8_t *bytes = synth_sample_bytes(address, 4);
	return bytes ? bytes[0] | ((uint32_t)bytes[1] << 8) |
	               ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24) : 0;
}

static void stop_synth_voice(nds_t *nds, unsigned channel, uint32_t cnt) {
	nds7_io_store32(nds, NDS7_SOUND0_CNT + channel * 16, cnt & 0x7fffffffu);
	synth_adpcm_voice[channel] = NULL;
	synth_mix[channel].release_remaining = 0;
}

static bool tetorica_synth_mix(nds_t *nds, unsigned channel, uint32_t *cnt,
                              float value, uint32_t volume, float divider, uint32_t pan,
                              float *left, float *right) {
	if (!synth_open) return false;
	SynthMix *mix = &synth_mix[channel];
	const bool floating = synth_float_output != NULL;
	if (!floating && mix->left == 1 && mix->right == 1 && !mix->release_remaining) return false;
	float envelope = 1;
	if (mix->release_remaining) {
		--mix->release_remaining;
		envelope = mix->release_frames > 1 ?
			(float)mix->release_remaining / (mix->release_frames - 1) : 0;
		if (!mix->release_remaining) {
			*cnt &= 0x7fffffffu;
			stop_synth_voice(nds, channel, *cnt);
		}
	}
	const float level = floating && volume == 127 ? 1.0f : volume / 128.0f;
	const float balance = floating && pan == 127 ? 1.0f : pan / 128.0f;
	const float scaled = value * level * divider * envelope;
	*left += scaled * (1 - balance) * mix->left;
	*right += scaled * balance * mix->right;
	return true;
}

static bool tetorica_synth_append_float(float left, float right) {
	if (!synth_float_output) return false;
	if (synth_float_remaining) {
		*synth_float_output++ = left * 0.25f;
		*synth_float_output++ = right * 0.25f;
		--synth_float_remaining;
	}
	return true;
}

static void discard_synth_adpcm(SynthAdpcmCache *cache) {
	for (unsigned channel = 0; channel < CHANNELS; ++channel) {
		if (synth_adpcm_voice[channel] == cache) synth_adpcm_voice[channel] = NULL;
	}
	synth_adpcm_bytes -= (cache->frames >> cache->step_shift) * sizeof(*cache->steps);
	free(cache->steps);
	*cache = (SynthAdpcmCache){0};
}

static bool synth_adpcm_in_use(const SynthAdpcmCache *cache) {
	for (unsigned channel = 0; channel < CHANNELS; ++channel)
		if (synth_adpcm_voice[channel] == cache) return true;
	return false;
}

static SynthAdpcmCache *reserve_synth_adpcm(uint32_t address, uint32_t frames, bool *pending) {
	const uint8_t *bytes = synth_sample_bytes(address, frames / 2);
	if (!bytes) return NULL;
	const unsigned step_shift = synth_voice_address(address) ? HOST_ADPCM_STEP_SHIFT : 0;
	const size_t size = (frames >> step_shift) * sizeof(SynthAdpcmStep);
	SynthAdpcmCache *slot = NULL;
	for (unsigned index = 0; index < SYNTH_ADPCM_CACHE_SLOTS; ++index) {
		SynthAdpcmCache *cache = &synth_adpcm_cache[index];
		if (cache->address == address && cache->frames >= frames) return cache;
		if (!cache->steps && !slot) slot = cache;
	}
	for (unsigned index = 0; index < SYNTH_ADPCM_CACHE_SLOTS &&
	     (!slot || size > MAX_SYNTH_ADPCM_CACHE_BYTES - synth_adpcm_bytes); ++index) {
		SynthAdpcmCache *cache = &synth_adpcm_cache[index];
		// Partial host work is interleaved with other pending attacks.
		// Evicting it here could prevent multiple preparations from finishing.
		const bool preparing = synth_voice_address(cache->address) && cache->decoded < cache->frames;
		if (!cache->steps || preparing || synth_adpcm_in_use(cache)) continue;
		discard_synth_adpcm(cache);
		if (!slot) slot = cache;
	}
	if (!slot || size > MAX_SYNTH_ADPCM_CACHE_BYTES - synth_adpcm_bytes) {
		if (pending) *pending = true;
		return NULL;
	}
	SynthAdpcmStep *steps = malloc(size);
	if (!steps) return NULL;
	const int16_t sample = (int16_t)(bytes[0] | (bytes[1] << 8));
	uint8_t index = bytes[2] & 127;
	if (index > 88) index = 88;
	for (unsigned position = 0; position < (8u >> step_shift); ++position)
		steps[position] = (SynthAdpcmStep){sample, index};
	*slot = (SynthAdpcmCache){
		.steps = steps, .address = address, .frames = frames, .decoded = 8, .step_shift = step_shift,
	};
	synth_adpcm_bytes += size;
	return slot;
}

static uint8_t synth_adpcm_code(const uint8_t *bytes, uint32_t position) {
	return (bytes[position / 2] >> ((position & 1) * 4)) & 15;
}

static SynthAdpcmStep synth_adpcm_step_at(const SynthAdpcmCache *cache, uint32_t position) {
	const uint32_t checkpoint = position >> cache->step_shift;
	const SynthAdpcmStep step = cache->steps[checkpoint];
	const uint32_t base = checkpoint << cache->step_shift;
	if (position == base || position < 8) return step;

	// The host bank keeps every fourth predictor state, so even a timer
	// advancing hundreds of samples needs at most three decode steps here.
	const uint8_t *bytes = synth_sample_bytes(cache->address, cache->frames / 2);
	int32_t sample = step.sample, index = step.index;
	for (uint32_t current = base + 1; current <= position; ++current)
		nds_adpcm_decode_code(&sample, &index, synth_adpcm_code(bytes, current));
	return (SynthAdpcmStep){sample, index};
}

static void decode_synth_adpcm(SynthAdpcmCache *cache, uint32_t end) {
	if (end <= cache->decoded) return;
	const uint8_t *bytes = synth_sample_bytes(cache->address, cache->frames / 2);
	const SynthAdpcmStep last = synth_adpcm_step_at(cache, cache->decoded - 1);
	const unsigned step_mask = (1u << cache->step_shift) - 1;
	int32_t sample = last.sample, index = last.index;
	for (uint32_t position = cache->decoded; position < end; ++position) {
		nds_adpcm_decode_code(&sample, &index, synth_adpcm_code(bytes, position));
		if (!(position & step_mask))
			cache->steps[position >> cache->step_shift] = (SynthAdpcmStep){sample, index};
	}
	cache->decoded = end;
}

static void prepare_synth_adpcm(unsigned channel, uint32_t address, uint32_t words, bool loop, uint32_t pnt) {
	synth_adpcm_voice[channel] = NULL;
	if (!synth_adpcm_enabled || words > MAX_SAMPLE_BYTES / 4 || (loop && !pnt)) return;
	const uint32_t frames = words * 8;
	if (synth_voice_address(address)) {
		// Host slots are prepared in bounded chunks before key-on. If no
		// decoded copy is available, use SkyEmu's incremental decoder.
		for (unsigned index = 0; index < SYNTH_ADPCM_CACHE_SLOTS; ++index) {
			SynthAdpcmCache *cache = &synth_adpcm_cache[index];
			if (cache->address == address && cache->decoded >= frames) {
				synth_adpcm_voice[channel] = cache;
				return;
			}
		}
		return;
	}
	SynthAdpcmCache *cache = reserve_synth_adpcm(address, frames, NULL);
	if (!cache) return;
	decode_synth_adpcm(cache, frames);
	synth_adpcm_voice[channel] = cache;
}

static bool tetorica_synth_advance_adpcm(nds_t *nds, int channel, uint32_t cnt,
                                        uint32_t sad, uint32_t timer, uint32_t pnt, uint32_t end) {
	// 2SF programs can rewrite sample RAM at any time. Only direct Synth
	// uploads have an immutable, host-invalidated cache.
	if (!synth_open) return false;
	const SynthAdpcmCache *cache = synth_adpcm_voice[channel];
	if (!cache) return false;
	__typeof__(nds->audio.channel[0]) *voice = &nds->audio.channel[channel];
	const bool repeats = ((cnt >> 27) & 3) == 1;
	if (cache->address != sad || end > cache->decoded || voice->sample >= end || (repeats && !pnt)) {
		synth_adpcm_voice[channel] = NULL;
		return false;
	}
	const uint32_t period = 0x20000 - timer;
	const uint32_t overflow = voice->timer - 0x20000;
	uint32_t position = voice->sample + 1 + overflow / period;
	if (pnt && voice->sample < pnt && position >= pnt) {
		const SynthAdpcmStep latch = synth_adpcm_step_at(cache, pnt - 1);
		voice->adpcm_sample_latch = latch.sample;
		voice->adpcm_index_latch = latch.index;
	}
	if (position >= end && !repeats) {
		// SkyEmu stops at the first out-of-range tick without consuming the
		// remaining timer overflows in this output sample.
		voice->timer -= (end - voice->sample) * period;
		voice->sample = 0;
		const SynthAdpcmStep last = synth_adpcm_step_at(cache, end - 1);
		voice->adpcm_sample = last.sample;
		voice->adpcm_index = last.index;
		synth_adpcm_voice[channel] = NULL;
		nds7_io_store32(nds, NDS7_SOUND0_CNT + channel * 16, cnt & 0x7fffffffu);
		return true;
	}
	if (position >= end) position = pnt + (position - end) % (end - pnt);
	const SynthAdpcmStep step = synth_adpcm_step_at(cache, position);
	voice->sample = position;
	voice->timer = timer + overflow % period;
	voice->adpcm_sample = step.sample;
	voice->adpcm_index = step.index;
	return true;
}

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
	if (synth_open) return;
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
	if (!rom || emu.rom_loaded || synth_open || size < 1024 || size > MAX_ROM_BYTES ||
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

// Run the same DS audio unit with a host program instead of the ARM CPUs.
// Each WASM instance has one console, with either a cartridge or host writes.
int nds_synth_open(void) {
	if (synth_open || emu.rom_loaded) return 0;
	memset(&emu, 0, sizeof emu);
	memset(&console, 0, sizeof console);
	synth_open = true;
	synth_adpcm_enabled = true;
	for (unsigned channel = 0; channel < CHANNELS; ++channel)
		synth_mix[channel] = (SynthMix){.left = 1, .right = 1};
	return 1;
}

int nds_synth_set_adpcm_cache(unsigned enabled) {
	if (!synth_open || enabled > 1) return 0;
	synth_adpcm_enabled = enabled != 0;
	if (!enabled) {
		for (unsigned index = 0; index < SYNTH_ADPCM_CACHE_SLOTS; ++index)
			discard_synth_adpcm(&synth_adpcm_cache[index]);
	}
	return 1;
}

static void invalidate_synth_adpcm(uint32_t address, size_t size) {
	for (unsigned index = 0; index < SYNTH_ADPCM_CACHE_SLOTS; ++index) {
		SynthAdpcmCache *cache = &synth_adpcm_cache[index];
		if (!cache->steps) continue;
		if (address < cache->address + cache->frames / 2 && cache->address < address + size)
			discard_synth_adpcm(cache);
	}
}

int nds_synth_upload(size_t offset, const uint8_t *data, size_t size) {
	if (!synth_open || !data || !size || offset >= sizeof console.mem.ram ||
	    size > sizeof console.mem.ram - offset) return 0;
	memmove(console.mem.ram + offset, data, size);
	invalidate_synth_adpcm(SYNTH_RAM_BASE + offset, size);
	return 1;
}

int nds_synth_upload_voice(unsigned slot, size_t offset, const uint8_t *data, size_t size) {
	if (!synth_open || slot >= SYNTH_VOICE_SLOTS || !data || !size ||
	    offset >= MAX_SAMPLE_BYTES || size > MAX_SAMPLE_BYTES - offset) return 0;
	SynthVoiceSlot *voice = &synth_voice_slots[slot];
	const size_t end = offset + size;
	if (end > voice->capacity) {
		size_t capacity = voice->capacity ? voice->capacity : 16;
		while (capacity < end) capacity *= 2;
		uint8_t *storage = realloc(voice->data, capacity);
		if (!storage) return 0;
		memset(storage + voice->capacity, 0, capacity - voice->capacity);
		voice->data = storage;
		voice->capacity = capacity;
	}
	memmove(voice->data + offset, data, size);
	if (end > voice->size) voice->size = end;
	invalidate_synth_adpcm(SYNTH_VOICE_RAM_BASE + slot * MAX_SAMPLE_BYTES + offset, size);
	return 1;
}

// Returns 1 when ready, 2 while staging is occupied or decoding, 0 for invalid input, and
// -1 when this sample must use the incremental decoder.
static int prepare_synth_adpcm_range(uint32_t address, size_t size, uint32_t budget_frames) {
	if (!synth_open || (address & 3) || (size & 3) || size < 16 || size > MAX_SAMPLE_BYTES ||
	    !budget_frames || budget_frames > MAX_ADPCM_PREPARE_FRAMES ||
	    !synth_sample_bytes(address, size)) return 0;
	if (!synth_adpcm_enabled) return -1;
	const uint32_t frames = size * 2;
	bool pending = false;
	SynthAdpcmCache *cache = reserve_synth_adpcm(address, frames, &pending);
	if (!cache) return pending && synth_voice_address(address) ? 2 : -1;
	const uint32_t end = cache->decoded + budget_frames;
	decode_synth_adpcm(cache, end < frames ? end : frames);
	return cache->decoded >= frames ? 1 : 2;
}

int nds_synth_prepare_adpcm(size_t offset, size_t size, uint32_t budget_frames) {
	if (offset >= sizeof console.mem.ram || size > sizeof console.mem.ram - offset) return 0;
	const int result = prepare_synth_adpcm_range(SYNTH_RAM_BASE + offset, size, budget_frames);
	return result < 0 ? 0 : result;
}

int nds_synth_prepare_voice_adpcm(unsigned slot, size_t size, uint32_t budget_frames) {
	if (slot >= SYNTH_VOICE_SLOTS) return 0;
	return prepare_synth_adpcm_range(SYNTH_VOICE_RAM_BASE + slot * MAX_SAMPLE_BYTES, size, budget_frames);
}

int nds_synth_cancel_voice_adpcm(unsigned slot) {
	if (!synth_open || slot >= SYNTH_VOICE_SLOTS) return 0;
	const uint32_t address = SYNTH_VOICE_RAM_BASE + slot * MAX_SAMPLE_BYTES;
	for (unsigned index = 0; index < SYNTH_ADPCM_CACHE_SLOTS; ++index) {
		SynthAdpcmCache *cache = &synth_adpcm_cache[index];
		if (cache->address == address && cache->decoded < cache->frames)
			discard_synth_adpcm(cache);
	}
	return 1;
}

static bool synth_register_offset(unsigned offset) {
	return synth_open && !(offset & 3) && offset < CHANNELS * 16;
}

static bool synth_sample_address(uint32_t address) {
	return !(address & 3) &&
	       (address - (uint32_t)SYNTH_RAM_BASE < sizeof console.mem.ram || synth_voice_address(address));
}

static bool synth_sample_range(uint32_t address, uint32_t pnt, uint32_t len) {
	const size_t size = (pnt + len) * (size_t)4;
	return synth_sample_address(address) && len && size >= 16 && synth_sample_bytes(address, size);
}

uint32_t nds_synth_read(unsigned offset) {
	if (!synth_register_offset(offset)) return 0;
	return nds7_io_read32(&console, NDS7_SOUND0_CNT + offset);
}

// The raw cursor includes the header in ADPCM mode.
int32_t nds_synth_position(unsigned channel) {
	if (!synth_open || channel >= CHANNELS) return -1;
	return (int32_t)console.audio.channel[channel].sample;
}

int nds_synth_write(unsigned offset, uint32_t value) {
	if (!synth_register_offset(offset)) return 0;
	const unsigned base = NDS7_SOUND0_CNT + (offset & ~15u);
	const unsigned field = offset & 15;
	const uint32_t previous = nds7_io_read32(&console, base + field);
	const uint32_t cnt = field == 0 ? value : nds7_io_read32(&console, base);
	const uint32_t sad = field == 4 ? value : nds7_io_read32(&console, base + 4);
	const uint32_t tmr_pnt = field == 8 ? value : nds7_io_read32(&console, base + 8);
	const uint32_t len = (field == 12 ? value : nds7_io_read32(&console, base + 12)) & 0x3fffff;
	if (field == 4 && !synth_sample_address(sad)) return 0;
	if ((cnt >> 31) && ((cnt >> 29) & 3) != 3 && !synth_sample_range(sad, tmr_pnt >> 16, len)) return 0;
	nds7_write32(&console, NDS7_SOUND0_CNT + offset, value);
	const unsigned channel = offset / 16;
	if (field == 0) {
		if (!(cnt >> 31) || !(previous >> 31))
			synth_mix[channel].release_remaining = 0;
		if (!(previous >> 31) && (cnt >> 31) && ((cnt >> 29) & 3) == 2) {
			const uint32_t pnt = tmr_pnt >> 16;
			prepare_synth_adpcm(channel, sad, pnt + len, ((cnt >> 27) & 3) == 1, pnt);
		} else if (!(cnt >> 31) || ((previous ^ cnt) & 0x78000000u)) {
			synth_adpcm_voice[channel] = NULL;
		}
	} else if ((previous ^ value) & (field == 8 ? 0xffff0000u : UINT32_MAX)) {
		// Raw source and loop changes leave the decoder in its current state.
		// Use the incremental path unless the atomic range API sets the latch.
		synth_adpcm_voice[channel] = NULL;
	}
	return 1;
}

int nds_synth_range(unsigned channel, uint32_t pnt, uint32_t len) {
	if (!synth_open || channel >= CHANNELS || pnt > UINT16_MAX || len > 0x3fffff) return 0;
	const unsigned base = NDS7_SOUND0_CNT + channel * 16;
	const uint32_t cnt = nds7_io_read32(&console, base);
	const unsigned format = (cnt >> 29) & 3;
	const uint32_t sad = nds7_io_read32(&console, base + 4);
	if (!(cnt >> 31) || format == 3 || !synth_sample_range(sad, pnt, len)) return 0;
	const uint32_t tmr_pnt = nds7_io_read32(&console, base + 8);
	const unsigned repeat = (cnt >> 27) & 3;
	const unsigned frames_per_word[] = {4, 2, 8};
	const uint32_t end = (pnt + len) * frames_per_word[format];
	__typeof__(console.audio.channel[0]) *voice = &console.audio.channel[channel];
	uint32_t *position = &voice->sample;
	bool stop = false;

	const SynthAdpcmCache *cache = synth_adpcm_voice[channel];
	const bool can_restore_adpcm = format == 2 && cache && cache->address == sad &&
		end <= cache->decoded && (repeat != 1 || pnt);
	if (format == 2 && !can_restore_adpcm &&
	    (pnt != (tmr_pnt >> 16) || (repeat == 1 && *position >= end))) return 0;
	if (*position >= end) {
		if (repeat == 1)
			*position = pnt * frames_per_word[format] + (*position - end) % (len * frames_per_word[format]);
		else {
			*position = 0;
			stop = true;
		}
	}
	nds7_io_store32(&console, base + 8, (tmr_pnt & 0xffff) | (pnt << 16));
	nds7_io_store32(&console, base + 12, len);
	if (stop) nds7_io_store32(&console, base, cnt & 0x7fffffffu);
	if (format == 2) {
		if (!can_restore_adpcm || stop) {
			synth_adpcm_voice[channel] = NULL;
		} else {
			const SynthAdpcmStep step = synth_adpcm_step_at(cache, *position);
			voice->adpcm_sample = step.sample;
			voice->adpcm_index = step.index;
			if (pnt) {
				const SynthAdpcmStep latch = synth_adpcm_step_at(cache, pnt * frames_per_word[format] - 1);
				voice->adpcm_sample_latch = latch.sample;
				voice->adpcm_index_latch = latch.index;
			}
		}
	}
	return 1;
}

int nds_synth_set_mix(unsigned channel, float left, float right) {
	if (!synth_open || channel >= CHANNELS || !isfinite(left) || !isfinite(right) ||
	    left < 0 || right < 0 || left > 2 || right > 2) return 0;
	synth_mix[channel].left = left;
	synth_mix[channel].right = right;
	return 1;
}

int nds_synth_release(unsigned channel, unsigned frames) {
	if (!synth_open || channel >= CHANNELS || frames > SE_AUDIO_SAMPLE_RATE) return 0;
	const uint32_t cnt = nds7_io_read32(&console, NDS7_SOUND0_CNT + channel * 16);
	if (!(cnt >> 31)) return 1;
	SynthMix *mix = &synth_mix[channel];
	if (!frames) stop_synth_voice(&console, channel, cnt);
	else if (!mix->release_remaining) {
		mix->release_frames = frames;
		mix->release_remaining = frames;
	}
	return 1;
}

int nds_synth_releasing(unsigned channel) {
	return synth_open && channel < CHANNELS && synth_mix[channel].release_remaining &&
	       (nds7_io_read32(&console, NDS7_SOUND0_CNT + channel * 16) >> 31);
}

static void render_synth_audio(unsigned frames) {
	// nds_tick_audio() emits the pending sample before current_clock.
	// Advance to the first whole clock strictly after the requested last sample.
	const uint64_t last_sample_time =
		console.audio.current_sample_generated_time + (uint64_t)(frames - 1) * AUDIO_CYCLES_64;
	console.current_clock = last_sample_time / 64 + 1;
	nds_tick_audio(&console, &emu);
}

unsigned nds_synth_render(int16_t *output, unsigned frames) {
	if (!synth_open || !output || !frames || frames > MAX_RENDER_FRAMES) return 0;
	render_synth_audio(frames);
	sb_ring_buffer_t *ring = &emu.audio_ring_buff;
	const unsigned samples = frames * 2;
	if (sb_ring_buffer_size(ring) != samples) return 0;
	for (unsigned sample = 0; sample < samples; ++sample)
		output[sample] = ring->data[ring->read_ptr++ % SB_AUDIO_RING_BUFFER_SIZE];
	return frames;
}

unsigned nds_synth_render_float(float *output, unsigned frames) {
	if (!synth_open || !output || !frames || frames > MAX_RENDER_FRAMES) return 0;
	synth_float_output = output;
	synth_float_remaining = frames;
	render_synth_audio(frames);
	synth_float_output = NULL;
	return frames - synth_float_remaining;
}

void nds_synth_close(void) {
	if (!synth_open) return;
	for (unsigned index = 0; index < SYNTH_ADPCM_CACHE_SLOTS; ++index)
		discard_synth_adpcm(&synth_adpcm_cache[index]);
	for (unsigned slot = 0; slot < SYNTH_VOICE_SLOTS; ++slot) {
		free(synth_voice_slots[slot].data);
		synth_voice_slots[slot] = (SynthVoiceSlot){0};
	}
	synth_open = false;
}
