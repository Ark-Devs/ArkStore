// The C interface of ArkStore's installer (sideload/src/ffi.rs), built as ios/lib/libark_sideload.a.
#pragma once
#include <stdint.h>

uint64_t ark_start(const char *command, const char *request_json);
char *ark_next(uint64_t job);
void ark_answer(uint64_t job, const char *answer_json);
void ark_cancel(uint64_t job);
void ark_free(char *s);
