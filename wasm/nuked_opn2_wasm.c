#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "ym3438.h"

/*
 * This mirrors the exported C ABI of wasm/ym2612_wasm.cpp (the ymfm-backed
 * build) exactly, so web/ym2612.js can load either WASM module unmodified.
 */

typedef struct
{
    ym3438_t chip;
} ym2612_handle;

static float normalize_sample(int32_t value)
{
    if (value < -32768)
        value = -32768;
    if (value > 32767)
        value = 32767;
    return (float)value / 32768.0f;
}

/*
 * OPN2_Clock() advances the chip by 1 internal clock (6 master clocks) and
 * writes one raw MOL/MOR pair. The real YM2612 time-multiplexes its 6
 * channels onto a single analog output pin across 24 of these internal
 * clocks, so producing one final audio sample means clocking 24 times and
 * reconstructing the mixed signal. Summing the 24 raw samples and scaling
 * by 11 is the same approach used by Genesis Plus GX's ym3438-backed sound
 * core (core/sound/sound.c), which is the reference this was checked
 * against.
 */
static void generate_one_frame(ym3438_t *chip, float *left, float *right)
{
    int32_t sum_l = 0;
    int32_t sum_r = 0;
    int cycle;

    for (cycle = 0; cycle < 24; cycle++)
    {
        int16_t buffer[2];
        OPN2_Clock(chip, buffer);
        sum_l += buffer[0];
        sum_r += buffer[1];
    }

    *left = normalize_sample(sum_l * 11);
    *right = normalize_sample(sum_r * 11);
}

void *ym2612_create(void)
{
    ym2612_handle *handle = (ym2612_handle *)malloc(sizeof(ym2612_handle));
    if (handle == NULL)
        return NULL;

    memset(handle, 0, sizeof(*handle));
    OPN2_SetChipType(ym3438_mode_ym2612);
    OPN2_Reset(&handle->chip);
    return handle;
}

void ym2612_destroy(void *ptr)
{
    free(ptr);
}

void ym2612_reset(void *ptr)
{
    ym2612_handle *handle = (ym2612_handle *)ptr;
    OPN2_Reset(&handle->chip);
}

void ym2612_write(void *ptr, uint32_t offset, uint8_t data)
{
    ym2612_handle *handle = (ym2612_handle *)ptr;
    int16_t discard[2];
    int cycle;

    OPN2_Write(&handle->chip, offset, data);

    /*
     * OPN2_Write() only sets a pending write_a/write_d flag; the internal
     * state machine (OPN2_DoIO / OPN2_DoRegWrite, both run from
     * OPN2_Clock()) needs to actually latch it. Per-operator and per-channel
     * FM registers are only applied once the chip's internal cycle counter
     * (slot = cycles % 12, channel = cycles % 6) rotates around to match the
     * target operator/channel, and that pending write is cancelled by the
     * *next* address write. Clocking a full 24-cycle rotation after every
     * raw write() call guarantees that rotation completes -- covering both
     * the address and data write of web/ym2612.js's writeRegister() pattern
     * -- before the caller can issue the next register's address write.
     */
    for (cycle = 0; cycle < 24; cycle++)
    {
        OPN2_Clock(&handle->chip, discard);
    }
}

uint8_t ym2612_read(void *ptr, uint32_t offset)
{
    ym2612_handle *handle = (ym2612_handle *)ptr;
    return OPN2_Read(&handle->chip, offset);
}

uint8_t ym2612_read_status(void *ptr)
{
    ym2612_handle *handle = (ym2612_handle *)ptr;
    return OPN2_Read(&handle->chip, 0);
}

uint8_t ym2612_get_irq(void *ptr)
{
    ym2612_handle *handle = (ym2612_handle *)ptr;
    return OPN2_ReadIRQPin(&handle->chip) ? 1 : 0;
}

uint32_t ym2612_sample_rate(void *ptr, uint32_t clock)
{
    (void)ptr;
    /* 6 master clocks per OPN2_Clock() call, 24 calls per output sample. */
    return clock / 144;
}

void ym2612_generate(void *ptr, float *left, float *right, uint32_t frames)
{
    ym2612_handle *handle = (ym2612_handle *)ptr;
    uint32_t index;

    for (index = 0; index < frames; index++)
    {
        generate_one_frame(&handle->chip, &left[index], &right[index]);
    }
}

/*
 * Per-operator envelope introspection is not implemented for this backend
 * (Nuked-OPN2's internal slot ordering doesn't map onto channel/operator
 * indices as directly as ymfm's debug API does). Envelope outputs are
 * always 0; audio output is unaffected.
 */
void ym2612_generate_with_internal_envelope(
    void *ptr,
    float *left,
    float *right,
    float *env0,
    float *env1,
    float *env2,
    float *env3,
    uint32_t frames,
    uint32_t channel_index)
{
    ym2612_handle *handle = (ym2612_handle *)ptr;
    uint32_t index;
    (void)channel_index;

    for (index = 0; index < frames; index++)
    {
        generate_one_frame(&handle->chip, &left[index], &right[index]);
        env0[index] = 0.0f;
        env1[index] = 0.0f;
        env2[index] = 0.0f;
        env3[index] = 0.0f;
    }
}
