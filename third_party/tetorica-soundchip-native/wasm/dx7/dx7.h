// Copyright 2026 Tetorica contributors. SPDX-License-Identifier: Apache-2.0
#pragma once
#include <stdint.h>

extern "C" {
void* dx7_create();
void dx7_destroy(void* handle);
uint8_t* dx7_voice_ptr(void* handle);
float* dx7_output_ptr(void* handle);
void dx7_set_voice(void* handle);
// Consume voice_ptr's 155 bytes. IDs identify the notes created from a bank slot;
// selection replaces future notes only; editing refreshes supported live fields.
void dx7_select_voice(void* handle, uint32_t voice_id);
void dx7_edit_voice(void* handle, uint32_t voice_id);
void dx7_note_on(void* handle, int note, int velocity);
void dx7_note_off(void* handle, int note);
void dx7_all_notes_off(void* handle);
void dx7_panic(void* handle);
void dx7_render(void* handle, int frames);
}
