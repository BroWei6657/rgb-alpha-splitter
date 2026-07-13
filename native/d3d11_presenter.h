#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

enum class GpuPixelFormat : uint32_t {
  rgba = 0, bgra = 1, uyvy = 2, uyva = 3, nv12 = 4,
  i420 = 5, yv12 = 6, p216 = 7, pa16 = 8
};

struct GpuFramePlane {
  const uint8_t* data = nullptr;
  int32_t stride = 0;
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t bytes_per_pixel = 1;
};

struct GpuFrameDesc {
  GpuPixelFormat format = GpuPixelFormat::rgba;
  uint32_t width = 0;
  uint32_t height = 0;
  GpuFramePlane planes[4];
  uint32_t plane_count = 0;
  bool has_alpha = false;
  bool interlaced = false;
  int field_order = 0;
  int64_t timecode = 0;
  int64_t timestamp = 0;
};

struct GpuPresenterConfig {
  uint32_t output_width = 1920;
  uint32_t output_height = 1080;
  int scaling_mode = 0;
  float crop_x = 0.0f;
  float crop_y = 0.0f;
  float crop_width = 1.0f;
  float crop_height = 1.0f;
  int source_limited = 0;
  int output_limited = 1;
  int primaries_mode = 0;
  int matrix_mode = 0;
  uint32_t frame_rate_n = 30;
  uint32_t frame_rate_d = 1;
  float alpha_gain = 1.0f;
  int invert_alpha = 0;
  int scan_mode = 0;
  int field_order = 0;
  int preview_policy = 1;
};

struct GpuAdapterInfo {
  std::string name;
  std::string luid;
  uint64_t dedicated_memory = 0;
  uint64_t shared_memory = 0;
  bool software = false;
};

struct GpuPresenterStatus {
  bool available = false;
  bool rgb_attached = false;
  bool alpha_attached = false;
  uint64_t submitted_frames = 0;
  uint64_t received_frames = 0;
  uint64_t overwritten_frames = 0;
  uint64_t presentation_failures = 0;
  uint32_t consecutive_failures = 0;
  uint32_t queue_depth = 0;
  double upload_ms = 0.0;
  double render_ms = 0.0;
  double present_ms = 0.0;
  double p95_frame_ms = 0.0;
  double tick_jitter_us = 0.0;
  double paired_present_skew_us = 0.0;
  uint64_t repeated_frames = 0;
  bool clock_locked = false;
  std::string clock_source = "host-monotonic";
  std::string adapter_name;
  std::string adapter_luid;
  uint64_t dedicated_memory = 0;
  std::string device_removed_reason;
  std::string last_error;
};

bool GpuPresenterInitialize(std::string& reason);
void GpuPresenterShutdown();
bool GpuPresenterRecover(std::string& reason);
void GpuPresenterSetAdapterPreference(const std::string& preference, const std::string& luid);
std::vector<GpuAdapterInfo> GpuPresenterGetAdapters();
bool GpuPresenterAttach(const char* kind, const void* native_handle, size_t handle_size, std::string& reason);
void GpuPresenterDetach(const char* kind);
bool GpuPresenterResize(const char* kind, std::string& reason);
void GpuPresenterConfigure(const GpuPresenterConfig& config);
bool GpuPresenterSubmitFrame(const GpuFrameDesc& frame, std::string& reason);
bool GpuPresenterSubmitRgba(const uint8_t* rgba, uint32_t width, uint32_t height, std::string& reason);
bool GpuPresenterSubmitP216(const uint8_t* data, uint32_t width, uint32_t height, uint32_t stride, bool has_alpha, std::string& reason);
bool GpuPresenterSubmitSharedTexture(const void* handle, size_t handle_size, std::string& reason);
bool GpuPresenterIsAvailable();
bool GpuPresenterHasOutputs();
GpuPresenterStatus GpuPresenterGetStatus();
