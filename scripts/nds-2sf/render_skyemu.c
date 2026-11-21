// SPDX-License-Identifier: BSD-3-Clause
// Headless libretro frontend for local DS audio renders.
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "libretro.h"

static FILE *wave_file;
static uint32_t target_frames;
static uint32_t written_frames;
static bool wave_error;

static void core_log(enum retro_log_level level, const char *format, ...) {
	if (level < RETRO_LOG_WARN) return;
	va_list args;
	va_start(args, format);
	vfprintf(stderr, format, args);
	va_end(args);
}

static bool environment(unsigned command, void *data) {
	switch (command) {
	case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
		((struct retro_log_callback *)data)->log = core_log;
		return true;
	case RETRO_ENVIRONMENT_GET_VARIABLE: {
		struct retro_variable *variable = data;
		// SkyEmu expects all core option queries to return a string.
		variable->value = strcmp(variable->key, "system_core_override") == 0 ? "Nintendo DS" : "OFF";
		return true;
	}
	case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
		*(const char **)data = NULL;
		return true;
	case RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE:
		*(int *)data = 2; // PCM only.
		return true;
	case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
		return true;
	default:
		return false;
	}
}

static void discard_video(const void *data, unsigned width, unsigned height, size_t pitch) {
	(void)data;
	(void)width;
	(void)height;
	(void)pitch;
}

static void no_input_poll(void) {}

static int16_t no_input_state(unsigned port, unsigned device, unsigned index, unsigned id) {
	(void)port;
	(void)device;
	(void)index;
	(void)id;
	return 0;
}

static void put_u16(uint8_t *out, uint16_t value) {
	out[0] = (uint8_t)value;
	out[1] = (uint8_t)(value >> 8);
}

static void put_u32(uint8_t *out, uint32_t value) {
	put_u16(out, (uint16_t)value);
	put_u16(out + 2, (uint16_t)(value >> 16));
}

static uint32_t read_u32(const uint8_t *bytes) {
	return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
	       (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static bool write_header(FILE *file, uint32_t rate, uint32_t frames) {
	uint8_t header[44] = {0};
	uint32_t data_size = frames * 4;
	memcpy(header, "RIFF", 4);
	put_u32(header + 4, data_size + 36);
	memcpy(header + 8, "WAVEfmt ", 8);
	put_u32(header + 16, 16);
	put_u16(header + 20, 1); // PCM
	put_u16(header + 22, 2); // stereo
	put_u32(header + 24, rate);
	put_u32(header + 28, rate * 4);
	put_u16(header + 32, 4); // bytes per frame
	put_u16(header + 34, 16);
	memcpy(header + 36, "data", 4);
	put_u32(header + 40, data_size);
	return fwrite(header, 1, sizeof header, file) == sizeof header;
}

static size_t write_audio(const int16_t *samples, size_t frames) {
	uint8_t pcm[4096];
	size_t keep = target_frames - written_frames;
	if (keep > frames) keep = frames;
	while (keep && !wave_error) {
		size_t count = keep > sizeof pcm / 4 ? sizeof pcm / 4 : keep;
		for (size_t sample = 0; sample < count * 2; ++sample) {
			put_u16(pcm + sample * 2, (uint16_t)samples[sample]);
		}
		if (fwrite(pcm, 4, count, wave_file) != count) {
			wave_error = true;
			break;
		}
		samples += count * 2;
		written_frames += (uint32_t)count;
		keep -= count;
	}
	return frames;
}

static uint8_t *read_rom(const char *path, size_t *size) {
	FILE *file = fopen(path, "rb");
	if (!file) {
		perror(path);
		return NULL;
	}
	long length = fseek(file, 0, SEEK_END) == 0 ? ftell(file) : -1;
	if (length < 1024 || length > 512L * 1024 * 1024 || fseek(file, 0, SEEK_SET) != 0) {
		fprintf(stderr, "NDS ROM must be between 1024 bytes and 512 MiB\n");
		fclose(file);
		return NULL;
	}
	*size = (size_t)length;
	uint8_t *rom = malloc(*size);
	if (!rom || fread(rom, 1, *size, file) != *size) {
		fprintf(stderr, "Failed to read complete NDS ROM\n");
		free(rom);
		rom = NULL;
	}
	fclose(file);
	return rom;
}

static bool valid_segment(const uint8_t *rom, size_t rom_size, unsigned field) {
	uint32_t offset = read_u32(rom + field);
	uint32_t size = read_u32(rom + field + 12);
	return offset >= 0x200 && offset < rom_size && size > 0 && size <= rom_size - offset;
}

int main(int argc, char **argv) {
	if (argc < 3 || argc > 4) {
		fprintf(stderr, "Usage: %s INPUT.nds OUTPUT.wav [SECONDS, 1–60]\n", argv[0]);
		return 2;
	}
	long seconds = 3;
	if (argc == 4) {
		char *end;
		errno = 0;
		seconds = strtol(argv[3], &end, 10);
		if (errno || *end || seconds < 1 || seconds > 60) {
			fprintf(stderr, "SECONDS must be an integer from 1 through 60\n");
			return 2;
		}
	}
	size_t path_length = strlen(argv[2]);
	if (path_length <= 4 || strcmp(argv[2] + path_length - 4, ".wav") != 0 || strcmp(argv[1], argv[2]) == 0) {
		fprintf(stderr, "Choose a separate output path ending in .wav\n");
		return 2;
	}
	size_t image_size;
	uint8_t *image = read_rom(argv[1], &image_size);
	if (!image) return 1;
	if (!valid_segment(image, image_size, 0x20) || !valid_segment(image, image_size, 0x30)) {
		fprintf(stderr, "NDS ROM header has an invalid ARM7 or ARM9 executable range\n");
		free(image);
		return 1;
	}

	retro_set_environment(environment);
	retro_set_video_refresh(discard_video);
	retro_set_input_poll(no_input_poll);
	retro_set_input_state(no_input_state);
	retro_set_audio_sample_batch(write_audio);
	retro_init();
	struct retro_game_info game = {.path = "input.nds", .data = image, .size = image_size, .meta = ""};
	bool loaded = retro_load_game(&game);
	free(image); // The pinned libretro core copies the supplied ROM bytes.
	if (!loaded) {
		fprintf(stderr, "SkyEmu could not load the NDS ROM\n");
		retro_unload_game();
		retro_deinit();
		return 1;
	}

	struct retro_system_av_info av = {0};
	retro_get_system_av_info(&av);
	if (!isfinite(av.timing.sample_rate) || av.timing.sample_rate < 8000 || av.timing.sample_rate > 192000) {
		fprintf(stderr, "SkyEmu returned an invalid sample rate\n");
		retro_unload_game();
		retro_deinit();
		return 1;
	}
	uint32_t rate = (uint32_t)lround(av.timing.sample_rate);
	target_frames = rate * (uint32_t)seconds;
	char *temp = malloc(path_length + sizeof ".tmp.XXXXXX");
	if (!temp) {
		fprintf(stderr, "Could not allocate a temporary filename\n");
		retro_unload_game();
		retro_deinit();
		return 1;
	}
	sprintf(temp, "%s.tmp.XXXXXX", argv[2]);
	int fd = mkstemp(temp);
	bool success = false;
	if (fd < 0) {
		perror("Creating temporary WAV");
	} else if ((wave_file = fdopen(fd, "wb")) == NULL) {
		perror("Opening temporary WAV");
		close(fd);
	} else {
		wave_error = !write_header(wave_file, rate, target_frames);
		// The caller can impose a wall-clock deadline. This bound also catches
		// a core that returns from retro_run without producing PCM frames.
		unsigned video_frames = 0;
		unsigned limit = ((unsigned)seconds + 2) * 120;
		while (!wave_error && written_frames < target_frames && video_frames < limit) {
			retro_run();
			++video_frames;
		}
		if (fclose(wave_file) != 0) wave_error = true;
		if (wave_error || written_frames != target_frames) {
			fprintf(stderr, "WAV render incomplete (%u of %u PCM frames)\n", written_frames, target_frames);
		} else if (rename(temp, argv[2]) != 0) {
			perror("Renaming completed WAV");
		} else {
			printf("Rendered %u stereo PCM frames at %u Hz\n", written_frames, rate);
			success = true;
		}
	}
	if (fd >= 0 && !success) unlink(temp);
	free(temp);
	retro_unload_game();
	retro_deinit();
	return success ? 0 : 1;
}
