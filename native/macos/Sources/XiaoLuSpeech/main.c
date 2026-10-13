#include "c-api.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

// Mono 16 kHz little-endian float PCM from our FFmpeg. Server mode keeps the
// recognizer in this local process between utterances; no audio leaves the Mac.
static const SherpaOnnxOfflineRecognizer *open_recognizer(const char *model, const char *tokens) {
  SherpaOnnxOfflineRecognizerConfig config = {0};
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.tokens = tokens;
  config.model_config.num_threads = 4;
  config.model_config.provider = "cpu";
  config.model_config.sense_voice.model = model;
  config.model_config.sense_voice.language = "zh";
  config.model_config.sense_voice.use_itn = 1;
  return SherpaOnnxCreateOfflineRecognizer(&config);
}

static int recognize(const SherpaOnnxOfflineRecognizer *recognizer, const char *path, const char **text,
                     const SherpaOnnxOfflineRecognizerResult **result_out) {
  struct stat meta;
  if (stat(path, &meta) || meta.st_size < 1600 || meta.st_size > 16000 * 4 * 31 || meta.st_size % 4) return 3;
  FILE *file = fopen(path, "rb");
  if (!file) return 3;
  float *samples = malloc((size_t)meta.st_size);
  if (!samples) { fclose(file); return 3; }
  size_t count = (size_t)meta.st_size / sizeof(float);
  if (fread(samples, sizeof(float), count, file) != count) {
    fclose(file); free(samples); return 3;
  }
  fclose(file);
  double power = 0;
  for (size_t i = 0; i < count; i++) power += (double)samples[i] * samples[i];
  if (sqrt(power / count) < 0.0012) { free(samples); return 6; }
  const SherpaOnnxOfflineStream *stream = SherpaOnnxCreateOfflineStream(recognizer);
  if (!stream) { free(samples); return 4; }
  SherpaOnnxAcceptWaveformOffline(stream, 16000, samples, (int32_t)count);
  SherpaOnnxDecodeOfflineStream(recognizer, stream);
  const SherpaOnnxOfflineRecognizerResult *result = SherpaOnnxGetOfflineStreamResult(stream);
  int code = result && result->text ? 0 : 5;
  if (!code) { *text = result->text; *result_out = result; }
  else if (result) SherpaOnnxDestroyOfflineRecognizerResult(result);
  SherpaOnnxDestroyOfflineStream(stream);
  free(samples);
  return code;
}

static void json_text(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}

int main(int argc, char **argv) {
  int server = argc == 4 && strcmp(argv[1], "--server") == 0;
  if (!server && argc != 4) {
    fprintf(stderr, "usage: XiaoLu.Speech MODEL TOKENS PCM | --server MODEL TOKENS\n"); return 2;
  }
  const SherpaOnnxOfflineRecognizer *recognizer = open_recognizer(argv[server ? 2 : 1], argv[server ? 3 : 2]);
  if (!recognizer) { fprintf(stderr, "recognizer initialization failed\n"); return 4; }
  if (server) {
    puts("{\"ready\":true}"); fflush(stdout);
    char *path = NULL; size_t capacity = 0;
    while (getline(&path, &capacity, stdin) >= 0) {
      size_t length = strlen(path);
      if (length && path[length - 1] == '\n') path[--length] = '\0';
      const char *text = NULL;
      const SherpaOnnxOfflineRecognizerResult *result = NULL;
      int code = length && length < 4096 ? recognize(recognizer, path, &text, &result) : 3;
      if (code) printf("{\"ok\":false,\"code\":%d}\n", code);
      else { fputs("{\"ok\":true,\"text\":", stdout); json_text(text); puts("}"); }
      fflush(stdout);
      if (result) SherpaOnnxDestroyOfflineRecognizerResult(result);
    }
    free(path);
  } else {
    const char *text = NULL;
    const SherpaOnnxOfflineRecognizerResult *result = NULL;
    int code = recognize(recognizer, argv[3], &text, &result);
    if (code == 6) fprintf(stderr, "no speech detected\n");
    else if (code) fprintf(stderr, "recognition failed\n");
    else puts(text);
    if (result) SherpaOnnxDestroyOfflineRecognizerResult(result);
    SherpaOnnxDestroyOfflineRecognizer(recognizer);
    return code;
  }
  SherpaOnnxDestroyOfflineRecognizer(recognizer);
  return 0;
}
