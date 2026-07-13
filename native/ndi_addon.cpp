#include <node_api.h>

#include <Processing.NDI.Lib.h>
#include "d3d11_presenter.h"

#ifdef _WIN32
#include <Windows.h>
#include <d3d11.h>
#include <d3d11_1.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr uint32_t kSharedMagic = 0x4E444941;
constexpr uint32_t kSharedVersion = 1;
constexpr size_t kSharedFrameCapacity = 4096ull * 2160ull * 4ull;
#ifdef _WIN32
constexpr wchar_t kSharedMappingName[] = L"Local\\NDIAlphaSplitter.Frame.v1";
#else
constexpr char kSharedMappingName[] = "/NDIAlphaSplitter.Frame.v1";
#endif

struct alignas(64) SharedFrameHeader {
  uint32_t magic;
  uint32_t version;
  uint64_t capacity;
  volatile int32_t active_slot;
  volatile int64_t sequence;
  uint32_t width;
  uint32_t height;
  uint32_t frame_rate_n;
  uint32_t frame_rate_d;
  uint32_t data_size;
  uint32_t has_alpha;
};

struct SourceInfo {
  std::string name;
  std::string url;
};

struct LatestFrame {
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t frame_rate_n = 0;
  uint32_t frame_rate_d = 1;
  int64_t timecode = 0;
  int64_t timestamp = NDIlib_recv_timestamp_undefined;
  uint64_t sequence = 0;
  bool has_alpha = false;
  std::string pixel_format = "unknown";
  std::string metadata;
  std::string scan_mode = "progressive";
  std::string field_order = "none";
  float picture_aspect_ratio = 0.0f;
};

std::mutex g_state_mutex;
std::mutex g_frame_mutex;
std::mutex g_publish_mutex;
std::vector<SourceInfo> g_sources;
LatestFrame g_frame;
NDIlib_find_instance_t g_finder = nullptr;
NDIlib_recv_instance_t g_receiver = nullptr;
NDIlib_framesync_instance_t g_framesync = nullptr;
std::thread g_capture_thread;
std::atomic<bool> g_running{false};
std::atomic<int64_t> g_last_frame_millis{0};
std::atomic<int> g_preview_policy{1};
std::atomic<int> g_sync_mode{1};
std::atomic<uint32_t> g_sync_frame_rate_n{30};
std::atomic<uint32_t> g_sync_frame_rate_d{1};
std::atomic<uint64_t> g_framesync_repeated{0};
std::atomic<uint64_t> g_framesync_dropped{0};
std::atomic<double> g_framesync_jitter_us{0.0};
std::atomic<bool> g_ndi_timestamp_available{false};
bool g_initialized = false;
std::string g_connected_name;
#ifdef _WIN32
HANDLE g_shared_mapping = nullptr;
#else
int g_shared_mapping = -1;
#endif
uint8_t* g_shared_view = nullptr;
SharedFrameHeader* g_shared_header = nullptr;
bool g_shared_writable = false;
#ifndef _WIN32
bool g_shared_owner = false;
#endif

void Throw(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
}

napi_value String(napi_env env, const std::string& value) {
  napi_value result;
  napi_create_string_utf8(env, value.c_str(), value.size(), &result);
  return result;
}

void Set(napi_env env, napi_value object, const char* key, napi_value value) {
  napi_set_named_property(env, object, key, value);
}

napi_value Boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value UInt32(napi_env env, uint32_t value) {
  napi_value result;
  napi_create_uint32(env, value, &result);
  return result;
}

napi_value UInt64(napi_env env, uint64_t value) {
  napi_value result;
  napi_create_bigint_uint64(env, value, &result);
  return result;
}

napi_value Int64(napi_env env, int64_t value) {
  napi_value result;
  napi_create_int64(env, value, &result);
  return result;
}

napi_value Double(napi_env env, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  return result;
}

int64_t NowMillis() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

void CloseSharedMapping() {
#ifdef _WIN32
  if (g_shared_view) UnmapViewOfFile(g_shared_view);
  if (g_shared_mapping) CloseHandle(g_shared_mapping);
#else
  if (g_shared_view) munmap(g_shared_view, sizeof(SharedFrameHeader) + kSharedFrameCapacity * 2);
  if (g_shared_mapping >= 0) close(g_shared_mapping);
#endif
  g_shared_view = nullptr;
  g_shared_header = nullptr;
#ifdef _WIN32
  g_shared_mapping = nullptr;
#else
  g_shared_mapping = -1;
#endif
  g_shared_writable = false;
}

void SharedMemoryBarrier() {
#ifdef _WIN32
  MemoryBarrier();
#else
  __atomic_thread_fence(__ATOMIC_SEQ_CST);
#endif
}

int32_t LoadActiveSlot() {
#ifdef _WIN32
  return static_cast<int32_t>(g_shared_header->active_slot);
#else
  return __atomic_load_n(&g_shared_header->active_slot, __ATOMIC_ACQUIRE);
#endif
}

uint64_t LoadSharedSequence() {
#ifdef _WIN32
  return static_cast<uint64_t>(g_shared_header->sequence);
#else
  return static_cast<uint64_t>(__atomic_load_n(&g_shared_header->sequence, __ATOMIC_ACQUIRE));
#endif
}

void CommitSharedFrame(int32_t next_slot) {
#ifdef _WIN32
  InterlockedExchange(reinterpret_cast<volatile LONG*>(&g_shared_header->active_slot),
                      static_cast<LONG>(next_slot));
  InterlockedIncrement64(reinterpret_cast<volatile LONG64*>(&g_shared_header->sequence));
#else
  __atomic_store_n(&g_shared_header->active_slot, next_slot, __ATOMIC_RELEASE);
  __atomic_add_fetch(&g_shared_header->sequence, 1, __ATOMIC_RELEASE);
#endif
}

bool EnsureSharedMapping(bool create) {
  if (g_shared_header && (!create || g_shared_writable)) return true;
  if (g_shared_header) CloseSharedMapping();
  const size_t mapping_size = sizeof(SharedFrameHeader) + kSharedFrameCapacity * 2;
#ifdef _WIN32
  g_shared_mapping = create
      ? CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
                           static_cast<DWORD>(mapping_size >> 32),
                           static_cast<DWORD>(mapping_size & 0xffffffff),
                           kSharedMappingName)
      : OpenFileMappingW(FILE_MAP_READ, FALSE, kSharedMappingName);
  if (!g_shared_mapping) return false;

  const DWORD access = create ? FILE_MAP_ALL_ACCESS : FILE_MAP_READ;
  g_shared_view = static_cast<uint8_t*>(MapViewOfFile(g_shared_mapping, access, 0, 0, mapping_size));
  if (!g_shared_view) {
    CloseHandle(g_shared_mapping);
    g_shared_mapping = nullptr;
    return false;
  }
#else
  const int flags = create ? O_CREAT | O_RDWR : O_RDONLY;
  g_shared_mapping = shm_open(kSharedMappingName, flags, 0600);
  if (g_shared_mapping < 0) return false;
  if (create && ftruncate(g_shared_mapping, static_cast<off_t>(mapping_size)) != 0) {
    close(g_shared_mapping);
    g_shared_mapping = -1;
    return false;
  }
  const int protection = create ? PROT_READ | PROT_WRITE : PROT_READ;
  void* view = mmap(nullptr, mapping_size, protection, MAP_SHARED, g_shared_mapping, 0);
  if (view == MAP_FAILED) {
    close(g_shared_mapping);
    g_shared_mapping = -1;
    return false;
  }
  g_shared_view = static_cast<uint8_t*>(view);
#endif
  g_shared_header = reinterpret_cast<SharedFrameHeader*>(g_shared_view);
  g_shared_writable = create;
#ifndef _WIN32
  if (create) g_shared_owner = true;
#endif
  if (create && (g_shared_header->magic != kSharedMagic ||
                 g_shared_header->version != kSharedVersion ||
                 g_shared_header->capacity != kSharedFrameCapacity)) {
    std::memset(g_shared_view, 0, sizeof(SharedFrameHeader));
    g_shared_header->magic = kSharedMagic;
    g_shared_header->version = kSharedVersion;
    g_shared_header->capacity = kSharedFrameCapacity;
  }
  return g_shared_header->magic == kSharedMagic &&
         g_shared_header->version == kSharedVersion;
}

void PublishSharedBytes(const uint8_t* rgba, size_t data_size, uint32_t width, uint32_t height,
                        uint32_t frame_rate_n, uint32_t frame_rate_d, bool has_alpha, bool submit_gpu = true) {
  std::lock_guard<std::mutex> publish_lock(g_publish_mutex);
  if (!rgba || data_size == 0 || data_size > kSharedFrameCapacity || !EnsureSharedMapping(true)) return;
  const int32_t next_slot = LoadActiveSlot() == 0 ? 1 : 0;
  uint8_t* destination = g_shared_view + sizeof(SharedFrameHeader) +
                         static_cast<size_t>(next_slot) * kSharedFrameCapacity;
  std::memcpy(destination, rgba, data_size);
  g_shared_header->width = width;
  g_shared_header->height = height;
  g_shared_header->frame_rate_n = frame_rate_n;
  g_shared_header->frame_rate_d = frame_rate_d;
  g_shared_header->data_size = static_cast<uint32_t>(data_size);
  g_shared_header->has_alpha = has_alpha ? 1u : 0u;
  SharedMemoryBarrier();
  CommitSharedFrame(next_slot);
  std::string gpu_reason;
  if (submit_gpu) GpuPresenterSubmitRgba(rgba, width, height, gpu_reason);
}

void PublishSharedFrame(const std::vector<uint8_t>& rgba, uint32_t width, uint32_t height,
                        uint32_t frame_rate_n, uint32_t frame_rate_d, bool has_alpha, bool submit_gpu = true) {
  PublishSharedBytes(rgba.data(), rgba.size(), width, height, frame_rate_n, frame_rate_d, has_alpha, submit_gpu);
}

bool EnsureInitialized(napi_env env) {
  if (g_initialized) return true;
  if (!NDIlib_initialize()) {
    Throw(env, "NDI Runtime initialization failed.");
    return false;
  }
  g_initialized = true;
  return true;
}

uint8_t ClampByte(float value) {
  return static_cast<uint8_t>(std::max(0.0f, std::min(255.0f, value)));
}

void WriteYuvPixel(uint8_t y, uint8_t cb, uint8_t cr, uint8_t alpha, uint8_t* destination) {
  const float luminance = 1.164383f * (static_cast<float>(y) - 16.0f);
  const float blue_difference = static_cast<float>(cb) - 128.0f;
  const float red_difference = static_cast<float>(cr) - 128.0f;
  destination[0] = ClampByte(luminance + 1.792741f * red_difference);
  destination[1] = ClampByte(luminance - 0.213249f * blue_difference - 0.532909f * red_difference);
  destination[2] = ClampByte(luminance + 2.112402f * blue_difference);
  destination[3] = alpha;
}

std::string FourCCName(NDIlib_FourCC_video_type_e value) {
  char name[5] = { static_cast<char>(value & 0xff), static_cast<char>((value >> 8) & 0xff),
                   static_cast<char>((value >> 16) & 0xff), static_cast<char>((value >> 24) & 0xff), 0 };
  return std::string(name);
}

struct DetectedColor {
  std::string primaries;
  std::string range;
  std::string transfer;
  std::string matrix;
  std::string source;
  std::string confidence;
};

DetectedColor DetectColorMetadata(const std::string& metadata, bool yuv) {
  std::string normalized = metadata;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(),
      [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
  const bool rec2020 = normalized.find("rec.2020") != std::string::npos ||
      normalized.find("rec2020") != std::string::npos || normalized.find("bt.2020") != std::string::npos ||
      normalized.find("bt2020") != std::string::npos;
  const bool rec709 = normalized.find("rec.709") != std::string::npos ||
      normalized.find("rec709") != std::string::npos || normalized.find("bt.709") != std::string::npos ||
      normalized.find("bt709") != std::string::npos;
  const bool full = normalized.find("range=\"full\"") != std::string::npos ||
      normalized.find("range='full'") != std::string::npos || normalized.find(">full<") != std::string::npos ||
      normalized.find("full_range") != std::string::npos;
  const bool limited = normalized.find("range=\"limited\"") != std::string::npos ||
      normalized.find("range='limited'") != std::string::npos || normalized.find(">limited<") != std::string::npos ||
      normalized.find("legal_range") != std::string::npos;
  const bool metadata_detected = rec2020 || rec709 || full || limited;
  return {
    rec2020 ? "rec2020" : "rec709",
    full ? "full" : limited ? "limited" : yuv ? "limited" : "full",
    "gamma24",
    rec2020 ? "bt2020-ncl" : "bt709",
    metadata_detected ? "NDI metadata" : "pixel-format",
    metadata_detected ? "high" : "low"
  };
}

bool ConvertVideoFrame(const NDIlib_video_frame_v2_t& video, std::vector<uint8_t>& rgba, bool& has_alpha) {
  const uint32_t width = static_cast<uint32_t>(video.xres);
  const uint32_t height = static_cast<uint32_t>(video.yres);
  if (!video.p_data || width == 0 || height == 0) return false;
  rgba.resize(static_cast<size_t>(width) * height * 4);
  const size_t stride = static_cast<size_t>(std::abs(video.line_stride_in_bytes));
  has_alpha = video.FourCC == NDIlib_FourCC_type_RGBA || video.FourCC == NDIlib_FourCC_type_BGRA ||
              video.FourCC == NDIlib_FourCC_type_UYVA || video.FourCC == NDIlib_FourCC_type_PA16;

  for (uint32_t y = 0; y < height; ++y) {
    const uint8_t* source = video.p_data + static_cast<size_t>(y) * stride;
    uint8_t* destination = rgba.data() + static_cast<size_t>(y) * width * 4;
    if (video.FourCC == NDIlib_FourCC_type_RGBA || video.FourCC == NDIlib_FourCC_type_RGBX) {
      std::memcpy(destination, source, static_cast<size_t>(width) * 4);
      if (!has_alpha) for (uint32_t x = 0; x < width; ++x) destination[x * 4 + 3] = 255;
    } else if (video.FourCC == NDIlib_FourCC_type_BGRA || video.FourCC == NDIlib_FourCC_type_BGRX) {
      for (uint32_t x = 0; x < width; ++x) {
        destination[x * 4] = source[x * 4 + 2]; destination[x * 4 + 1] = source[x * 4 + 1];
        destination[x * 4 + 2] = source[x * 4]; destination[x * 4 + 3] = has_alpha ? source[x * 4 + 3] : 255;
      }
    } else if (video.FourCC == NDIlib_FourCC_type_UYVY || video.FourCC == NDIlib_FourCC_type_UYVA) {
      const uint8_t* alpha_plane = has_alpha ? video.p_data + stride * height : nullptr;
      for (uint32_t x = 0; x < width; x += 2) {
        const uint8_t cb = source[x * 2], y0 = source[x * 2 + 1], cr = source[x * 2 + 2], y1 = source[x * 2 + 3];
        WriteYuvPixel(y0, cb, cr, alpha_plane ? alpha_plane[static_cast<size_t>(y) * width + x] : 255, destination + x * 4);
        if (x + 1 < width) WriteYuvPixel(y1, cb, cr, alpha_plane ? alpha_plane[static_cast<size_t>(y) * width + x + 1] : 255, destination + (x + 1) * 4);
      }
    } else if (video.FourCC == NDIlib_FourCC_type_P216 || video.FourCC == NDIlib_FourCC_type_PA16) {
      const uint16_t* luma = reinterpret_cast<const uint16_t*>(source);
      const uint16_t* chroma = reinterpret_cast<const uint16_t*>(video.p_data + stride * height + static_cast<size_t>(y) * stride);
      const uint16_t* alpha_plane = has_alpha ? reinterpret_cast<const uint16_t*>(video.p_data + stride * height * 2 + static_cast<size_t>(y) * width * 2) : nullptr;
      for (uint32_t x = 0; x < width; x += 2) {
        const uint8_t cb = static_cast<uint8_t>(chroma[x] >> 8), cr = static_cast<uint8_t>(chroma[x + 1] >> 8);
        WriteYuvPixel(static_cast<uint8_t>(luma[x] >> 8), cb, cr, alpha_plane ? static_cast<uint8_t>(alpha_plane[x] >> 8) : 255, destination + x * 4);
        if (x + 1 < width) WriteYuvPixel(static_cast<uint8_t>(luma[x + 1] >> 8), cb, cr, alpha_plane ? static_cast<uint8_t>(alpha_plane[x + 1] >> 8) : 255, destination + (x + 1) * 4);
      }
    } else if (video.FourCC == NDIlib_FourCC_type_NV12 || video.FourCC == NDIlib_FourCC_type_I420 || video.FourCC == NDIlib_FourCC_type_YV12) {
      const uint8_t* chroma_base = video.p_data + stride * height;
      const size_t chroma_stride = stride / 2;
      for (uint32_t x = 0; x < width; ++x) {
        uint8_t cb = 128, cr = 128;
        if (video.FourCC == NDIlib_FourCC_type_NV12) {
          const uint8_t* uv = chroma_base + static_cast<size_t>(y / 2) * stride;
          cb = uv[(x / 2) * 2]; cr = uv[(x / 2) * 2 + 1];
        } else {
          const size_t plane_size = chroma_stride * ((height + 1) / 2);
          const uint8_t* first = chroma_base + static_cast<size_t>(y / 2) * chroma_stride;
          const uint8_t* second = chroma_base + plane_size + static_cast<size_t>(y / 2) * chroma_stride;
          cb = video.FourCC == NDIlib_FourCC_type_I420 ? first[x / 2] : second[x / 2];
          cr = video.FourCC == NDIlib_FourCC_type_I420 ? second[x / 2] : first[x / 2];
        }
        WriteYuvPixel(source[x], cb, cr, 255, destination + x * 4);
      }
    } else {
      return false;
    }
  }
  return true;
}

bool SubmitGpuVideoFrame(const NDIlib_video_frame_v2_t& video, std::string& reason) {
  if (!video.p_data || video.xres <= 0 || video.yres <= 0 || video.line_stride_in_bytes == 0) return false;
  const uint32_t width = static_cast<uint32_t>(video.xres);
  const uint32_t height = static_cast<uint32_t>(video.yres);
  const int32_t stride = video.line_stride_in_bytes;
  const uint32_t stride_abs = static_cast<uint32_t>(std::abs(stride));
  GpuFrameDesc frame;
  frame.width = width;
  frame.height = height;
  frame.interlaced = video.frame_format_type != NDIlib_frame_format_type_progressive;
  frame.field_order = video.frame_format_type == NDIlib_frame_format_type_field_1 ? 1 : 0;
  frame.timecode = video.timecode;
  frame.timestamp = video.timestamp;

  switch (video.FourCC) {
    case NDIlib_FourCC_type_RGBA:
    case NDIlib_FourCC_type_RGBX:
      frame.format = GpuPixelFormat::rgba;
      frame.plane_count = 1;
      frame.has_alpha = video.FourCC == NDIlib_FourCC_type_RGBA;
      frame.planes[0] = {video.p_data, stride, width, height, 4};
      break;
    case NDIlib_FourCC_type_BGRA:
    case NDIlib_FourCC_type_BGRX:
      frame.format = GpuPixelFormat::bgra;
      frame.plane_count = 1;
      frame.has_alpha = video.FourCC == NDIlib_FourCC_type_BGRA;
      frame.planes[0] = {video.p_data, stride, width, height, 4};
      break;
    case NDIlib_FourCC_type_UYVY:
    case NDIlib_FourCC_type_UYVA:
      frame.format = video.FourCC == NDIlib_FourCC_type_UYVA ? GpuPixelFormat::uyva : GpuPixelFormat::uyvy;
      frame.plane_count = video.FourCC == NDIlib_FourCC_type_UYVA ? 2 : 1;
      frame.has_alpha = frame.plane_count == 2;
      frame.planes[0] = {video.p_data, stride, (width + 1) / 2, height, 4};
      if (frame.has_alpha) {
        frame.planes[1] = {video.p_data + static_cast<size_t>(stride_abs) * height,
                           static_cast<int32_t>(width), width, height, 1};
      }
      break;
    case NDIlib_FourCC_type_P216:
    case NDIlib_FourCC_type_PA16:
      frame.format = video.FourCC == NDIlib_FourCC_type_PA16 ? GpuPixelFormat::pa16 : GpuPixelFormat::p216;
      frame.plane_count = video.FourCC == NDIlib_FourCC_type_PA16 ? 3 : 2;
      frame.has_alpha = frame.plane_count == 3;
      frame.planes[0] = {video.p_data, stride, width, height, 2};
      frame.planes[1] = {video.p_data + static_cast<size_t>(stride_abs) * height,
                         static_cast<int32_t>(stride_abs), (width + 1) / 2, height, 4};
      if (frame.has_alpha) {
        frame.planes[2] = {video.p_data + static_cast<size_t>(stride_abs) * height * 2,
                           static_cast<int32_t>(width * 2), width, height, 2};
      }
      break;
    case NDIlib_FourCC_type_NV12:
      frame.format = GpuPixelFormat::nv12;
      frame.plane_count = 2;
      frame.planes[0] = {video.p_data, stride, width, height, 1};
      frame.planes[1] = {video.p_data + static_cast<size_t>(stride_abs) * height,
                         static_cast<int32_t>(stride_abs), (width + 1) / 2, (height + 1) / 2, 2};
      break;
    case NDIlib_FourCC_type_I420:
    case NDIlib_FourCC_type_YV12: {
      frame.format = video.FourCC == NDIlib_FourCC_type_I420 ? GpuPixelFormat::i420 : GpuPixelFormat::yv12;
      frame.plane_count = 3;
      const uint32_t chroma_stride = std::max(1u, stride_abs / 2);
      const uint32_t chroma_height = (height + 1) / 2;
      const uint8_t* first = video.p_data + static_cast<size_t>(stride_abs) * height;
      const uint8_t* second = first + static_cast<size_t>(chroma_stride) * chroma_height;
      frame.planes[0] = {video.p_data, stride, width, height, 1};
      frame.planes[1] = {video.FourCC == NDIlib_FourCC_type_I420 ? first : second,
                         static_cast<int32_t>(chroma_stride), (width + 1) / 2, chroma_height, 1};
      frame.planes[2] = {video.FourCC == NDIlib_FourCC_type_I420 ? second : first,
                         static_cast<int32_t>(chroma_stride), (width + 1) / 2, chroma_height, 1};
      break;
    }
    default:
      reason = "Unsupported NDI GPU pixel format.";
      return false;
  }
  return GpuPresenterSubmitFrame(frame, reason);
}

void DownsamplePreview(const std::vector<uint8_t>& source, uint32_t source_width, uint32_t source_height,
                       std::vector<uint8_t>& destination, uint32_t& width, uint32_t& height) {
  const double scale = std::min(854.0 / std::max(1u, source_width), 480.0 / std::max(1u, source_height));
  width = std::max(1u, static_cast<uint32_t>(std::round(source_width * std::min(1.0, scale))));
  height = std::max(1u, static_cast<uint32_t>(std::round(source_height * std::min(1.0, scale))));
  destination.resize(static_cast<size_t>(width) * height * 4);
  for (uint32_t y = 0; y < height; ++y) {
    const uint32_t source_y = std::min(source_height - 1, static_cast<uint32_t>(static_cast<uint64_t>(y) * source_height / height));
    for (uint32_t x = 0; x < width; ++x) {
      const uint32_t source_x = std::min(source_width - 1, static_cast<uint32_t>(static_cast<uint64_t>(x) * source_width / width));
      std::memcpy(destination.data() + (static_cast<size_t>(y) * width + x) * 4,
                  source.data() + (static_cast<size_t>(source_y) * source_width + source_x) * 4, 4);
    }
  }
}

void CaptureLoop() {
  std::vector<uint8_t> rgba;
  std::vector<uint8_t> preview;
  uint64_t preview_counter = 0;
  int64_t previous_timestamp = NDIlib_recv_timestamp_undefined;
  auto next_sync_tick = std::chrono::steady_clock::now();
  while (g_running.load()) {
    NDIlib_video_frame_v2_t video{};
    const bool stable_sync = g_sync_mode.load() == 1 && g_framesync;
    if (stable_sync) {
      const uint64_t interval_ns = 1000000000ull * std::max(1u, g_sync_frame_rate_d.load()) /
          std::max(1u, g_sync_frame_rate_n.load());
      next_sync_tick += std::chrono::nanoseconds(interval_ns);
      std::this_thread::sleep_until(next_sync_tick);
      const auto after_sleep = std::chrono::steady_clock::now();
      if (next_sync_tick + std::chrono::nanoseconds(interval_ns) < after_sleep) next_sync_tick = after_sleep;
      if (!g_running.load()) break;
      const auto capture_started = std::chrono::steady_clock::now();
      NDIlib_framesync_capture_video(g_framesync, &video, NDIlib_frame_format_type_progressive);
      const double jitter = std::abs(std::chrono::duration<double, std::micro>(capture_started - next_sync_tick).count());
      g_framesync_jitter_us.store(g_framesync_jitter_us.load() * 0.9 + jitter * 0.1);
      if (!video.p_data) continue;
    } else {
      const auto type = NDIlib_recv_capture_v2(g_receiver, &video, nullptr, nullptr, 100);
      if (type != NDIlib_frame_type_video) continue;
      next_sync_tick = std::chrono::steady_clock::now();
    }

    const uint32_t width = static_cast<uint32_t>(video.xres);
    const uint32_t height = static_cast<uint32_t>(video.yres);
    const bool has_alpha = video.FourCC == NDIlib_FourCC_type_RGBA || video.FourCC == NDIlib_FourCC_type_BGRA ||
                           video.FourCC == NDIlib_FourCC_type_UYVA || video.FourCC == NDIlib_FourCC_type_PA16;
    std::string gpu_reason;
    const bool gpu_submitted = SubmitGpuVideoFrame(video, gpu_reason);

    {
      std::lock_guard<std::mutex> lock(g_frame_mutex);
      g_frame.width = width;
      g_frame.height = height;
      g_frame.frame_rate_n = static_cast<uint32_t>(video.frame_rate_N);
      g_frame.frame_rate_d = static_cast<uint32_t>(video.frame_rate_D);
      g_frame.timecode = video.timecode;
      g_frame.timestamp = video.timestamp;
      g_frame.has_alpha = has_alpha;
      g_frame.pixel_format = FourCCName(video.FourCC);
      g_frame.metadata = video.p_metadata ? std::string(video.p_metadata).substr(0, 65536) : "";
      g_frame.scan_mode = video.frame_format_type == NDIlib_frame_format_type_progressive ? "progressive" : "interlaced";
      g_frame.field_order = video.frame_format_type == NDIlib_frame_format_type_field_1 ? "bff" :
                            video.frame_format_type == NDIlib_frame_format_type_progressive ? "none" : "tff";
      g_frame.picture_aspect_ratio = video.picture_aspect_ratio;
      ++g_frame.sequence;
      g_last_frame_millis.store(NowMillis());
    }
    g_ndi_timestamp_available.store(video.timestamp != NDIlib_recv_timestamp_undefined);
    if (stable_sync && video.timestamp != NDIlib_recv_timestamp_undefined) {
      if (previous_timestamp == video.timestamp) {
        ++g_framesync_repeated;
      } else if (previous_timestamp != NDIlib_recv_timestamp_undefined) {
        const int64_t expected = static_cast<int64_t>(10000000ull * std::max(1u, g_sync_frame_rate_d.load()) /
            std::max(1u, g_sync_frame_rate_n.load()));
        if (video.timestamp - previous_timestamp > expected + expected / 2) {
          g_framesync_dropped.fetch_add(static_cast<uint64_t>(std::max<int64_t>(1, (video.timestamp - previous_timestamp) / expected - 1)));
        }
      }
      previous_timestamp = video.timestamp;
    }

    const bool gpu_outputs = gpu_submitted && GpuPresenterHasOutputs();
    const int preview_policy = g_preview_policy.load();
    const double source_fps = static_cast<double>(std::max(1, video.frame_rate_N)) /
        std::max(1, video.frame_rate_D);
    const uint64_t preview_divisor = std::max<uint64_t>(1, static_cast<uint64_t>(std::round(source_fps / 15.0)));
    const bool preview_due = !gpu_outputs || preview_policy == 0 ||
        (preview_policy == 1 && (++preview_counter % preview_divisor == 0));
    if (preview_due || !gpu_submitted) {
      bool converted_alpha = false;
      if (ConvertVideoFrame(video, rgba, converted_alpha)) {
        if (gpu_outputs && preview_policy == 1) {
          uint32_t preview_width = width;
          uint32_t preview_height = height;
          DownsamplePreview(rgba, width, height, preview, preview_width, preview_height);
          PublishSharedFrame(preview, preview_width, preview_height,
              static_cast<uint32_t>(video.frame_rate_N), static_cast<uint32_t>(video.frame_rate_D),
              converted_alpha, false);
        } else {
          PublishSharedFrame(rgba, width, height,
              static_cast<uint32_t>(video.frame_rate_N), static_cast<uint32_t>(video.frame_rate_D),
              converted_alpha, !gpu_submitted);
        }
      }
    }
    if (stable_sync) NDIlib_framesync_free_video(g_framesync, &video);
    else NDIlib_recv_free_video_v2(g_receiver, &video);
  }
}

void StopReceiver() {
  g_running.store(false);
  if (g_capture_thread.joinable()) g_capture_thread.join();
  if (g_framesync) {
    NDIlib_framesync_destroy(g_framesync);
    g_framesync = nullptr;
  }
  if (g_receiver) {
    NDIlib_recv_destroy(g_receiver);
    g_receiver = nullptr;
  }
  g_connected_name.clear();
  g_last_frame_millis.store(0);
  std::lock_guard<std::mutex> lock(g_frame_mutex);
  g_frame = LatestFrame{};
}

napi_value GetStatus(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_object(env, &result);
  Set(env, result, "initialized", Boolean(env, g_initialized));
  Set(env, result, "connected", Boolean(env, g_receiver != nullptr));
  Set(env, result, "source", String(env, g_connected_name));
  int connections = 0;
  NDIlib_recv_performance_t total{};
  NDIlib_recv_performance_t dropped{};
  NDIlib_recv_queue_t queue{};
  if (g_receiver) {
    connections = NDIlib_recv_get_no_connections(g_receiver);
    NDIlib_recv_get_performance(g_receiver, &total, &dropped);
    NDIlib_recv_get_queue(g_receiver, &queue);
  }
  Set(env, result, "connections", UInt32(env, static_cast<uint32_t>(connections)));
  Set(env, result, "receivedVideoFrames", Int64(env, total.video_frames));
  Set(env, result, "droppedVideoFrames", Int64(env, dropped.video_frames));
  Set(env, result, "queuedVideoFrames", UInt32(env, static_cast<uint32_t>(queue.video_frames)));
  const int64_t last_frame = g_last_frame_millis.load();
  Set(env, result, "lastFrameAgeMs", Int64(env, last_frame ? NowMillis() - last_frame : -1));
  Set(env, result, "frameSyncActive", Boolean(env, g_sync_mode.load() == 1 && g_framesync));
  Set(env, result, "frameSyncRepeated", UInt64(env, g_framesync_repeated.load()));
  Set(env, result, "frameSyncDropped", UInt64(env, g_framesync_dropped.load()));
  Set(env, result, "ndiTimestampAvailable", Boolean(env, g_ndi_timestamp_available.load()));
  {
    std::lock_guard<std::mutex> lock(g_frame_mutex);
    Set(env, result, "sequence", UInt64(env, g_frame.sequence));
  }
  return result;
}

struct FindSourcesWork {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  std::vector<SourceInfo> sources;
  std::string error;
};

void ExecuteFindSources(napi_env, void* raw_data) {
  auto* data = static_cast<FindSourcesWork*>(raw_data);
  std::lock_guard<std::mutex> state_lock(g_state_mutex);
  if (!g_finder) {
    NDIlib_find_create_t settings{};
    settings.show_local_sources = true;
    g_finder = NDIlib_find_create_v2(&settings);
  }
  if (!g_finder) {
    data->error = "Unable to create the NDI source finder.";
    return;
  }
  NDIlib_find_wait_for_sources(g_finder, 750);
  uint32_t count = 0;
  const NDIlib_source_t* sources = NDIlib_find_get_current_sources(g_finder, &count);
  data->sources.reserve(count);
  for (uint32_t i = 0; i < count; ++i) {
    SourceInfo info;
    if (sources[i].p_ndi_name) info.name = sources[i].p_ndi_name;
    if (sources[i].p_url_address) info.url = sources[i].p_url_address;
    data->sources.push_back(std::move(info));
  }
  g_sources = data->sources;
}

void CompleteFindSources(napi_env env, napi_status status, void* raw_data) {
  auto* data = static_cast<FindSourcesWork*>(raw_data);
  if (status != napi_ok || !data->error.empty()) {
    napi_value message;
    napi_value error;
    const std::string text = data->error.empty() ? "NDI source discovery failed." : data->error;
    napi_create_string_utf8(env, text.c_str(), text.size(), &message);
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, data->deferred, error);
  } else {
    napi_value result;
    napi_create_array_with_length(env, data->sources.size(), &result);
    for (uint32_t i = 0; i < data->sources.size(); ++i) {
      napi_value item;
      napi_create_object(env, &item);
      Set(env, item, "id", String(env, data->sources[i].name));
      Set(env, item, "name", String(env, data->sources[i].name));
      napi_set_element(env, result, i, item);
    }
    napi_resolve_deferred(env, data->deferred, result);
  }
  napi_delete_async_work(env, data->work);
  delete data;
}

napi_value FindSources(napi_env env, napi_callback_info) {
  if (!EnsureInitialized(env)) return nullptr;
  auto* data = new FindSourcesWork();
  napi_value promise;
  napi_value resource_name;
  napi_create_promise(env, &data->deferred, &promise);
  napi_create_string_utf8(env, "NDI source discovery", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, nullptr, resource_name, ExecuteFindSources, CompleteFindSources, data, &data->work);
  napi_queue_async_work(env, data->work);
  return promise;
}

napi_value Connect(napi_env env, napi_callback_info info) {
  if (!EnsureInitialized(env)) return nullptr;
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1) {
    Throw(env, "connect(sourceId) requires an NDI source id.");
    return nullptr;
  }

  size_t length = 0;
  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length);
  std::string source_id(length + 1, '\0');
  napi_get_value_string_utf8(env, argv[0], source_id.data(), length + 1, &length);
  source_id.resize(length);

  std::lock_guard<std::mutex> state_lock(g_state_mutex);
  SourceInfo selected;
  bool found = false;
  for (const auto& source : g_sources) {
    if (source.name == source_id) {
      selected = source;
      found = true;
      break;
    }
  }
  // Preserve recovery when discovery temporarily loses an offline source.
  // NDI can reconnect by source name when the sender returns.
  if (!found && source_id == g_connected_name) {
    selected.name = source_id;
    found = true;
  }
  if (!found) {
    Throw(env, "The selected NDI source is no longer available. Refresh the source list.");
    return nullptr;
  }

  StopReceiver();
  NDIlib_source_t source{};
  source.p_ndi_name = selected.name.c_str();
  source.p_url_address = selected.url.empty() ? nullptr : selected.url.c_str();
  NDIlib_recv_create_v3_t settings{};
  settings.source_to_connect_to = source;
  // Request browser-native channel order so the capture thread can copy rows
  // directly instead of swapping R/B for every pixel on the CPU.
  settings.color_format = NDIlib_recv_color_format_best;
  settings.bandwidth = NDIlib_recv_bandwidth_highest;
  settings.allow_video_fields = true;
  settings.p_ndi_recv_name = "RGB Alpha Splitter";
  g_receiver = NDIlib_recv_create_v3(&settings);
  if (!g_receiver) {
    Throw(env, "Unable to create the NDI receiver.");
    return nullptr;
  }

  g_connected_name = selected.name;
  if (g_sync_mode.load() == 1) g_framesync = NDIlib_framesync_create(g_receiver);
  g_running.store(true);
  g_capture_thread = std::thread(CaptureLoop);

  napi_value result;
  napi_create_object(env, &result);
  Set(env, result, "id", String(env, selected.name));
  Set(env, result, "name", String(env, selected.name));
  return result;
}

napi_value Disconnect(napi_env env, napi_callback_info) {
  std::lock_guard<std::mutex> state_lock(g_state_mutex);
  StopReceiver();
  return Boolean(env, true);
}

napi_value GetSharedFrame(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint64_t after_sequence = 0;
  if (argc == 1) {
    bool lossless = false;
    napi_get_value_bigint_uint64(env, argv[0], &after_sequence, &lossless);
  }
  if (!EnsureSharedMapping(false)) {
    napi_value null_value;
    napi_get_null(env, &null_value);
    return null_value;
  }

  for (int attempt = 0; attempt < 3; ++attempt) {
    const uint64_t sequence_before = LoadSharedSequence();
    if (sequence_before == 0 || sequence_before <= after_sequence) {
      napi_value null_value;
      napi_get_null(env, &null_value);
      return null_value;
    }
    const int32_t slot = LoadActiveSlot();
    const uint32_t width = g_shared_header->width;
    const uint32_t height = g_shared_header->height;
    const uint32_t frame_rate_n = g_shared_header->frame_rate_n;
    const uint32_t frame_rate_d = g_shared_header->frame_rate_d;
    const uint32_t data_size = g_shared_header->data_size;
    const bool has_alpha = g_shared_header->has_alpha != 0;
    if (slot < 0 || slot > 1 || data_size == 0 || data_size > kSharedFrameCapacity) continue;

    napi_value data;
    void* destination = nullptr;
    napi_create_buffer(env, data_size, &destination, &data);
    const uint8_t* source = g_shared_view + sizeof(SharedFrameHeader) +
                            static_cast<size_t>(slot) * kSharedFrameCapacity;
    std::memcpy(destination, source, data_size);
    SharedMemoryBarrier();
    const uint64_t sequence_after = LoadSharedSequence();
    if (sequence_before != sequence_after) continue;

    napi_value result;
    napi_create_object(env, &result);
    Set(env, result, "width", UInt32(env, width));
    Set(env, result, "height", UInt32(env, height));
    Set(env, result, "frameRateN", UInt32(env, frame_rate_n));
    Set(env, result, "frameRateD", UInt32(env, frame_rate_d));
    Set(env, result, "sequence", UInt64(env, sequence_before));
    Set(env, result, "hasAlpha", Boolean(env, has_alpha));
    Set(env, result, "data", data);
    LatestFrame detected;
    {
      std::lock_guard<std::mutex> lock(g_frame_mutex);
      detected = g_frame;
    }
    napi_value detected_signal;
    napi_create_object(env, &detected_signal);
    Set(env, detected_signal, "width", UInt32(env, detected.width ? detected.width : width));
    Set(env, detected_signal, "height", UInt32(env, detected.height ? detected.height : height));
    Set(env, detected_signal, "frameRateN", UInt32(env, frame_rate_n));
    Set(env, detected_signal, "frameRateD", UInt32(env, frame_rate_d));
    Set(env, detected_signal, "pixelFormat", String(env, detected.pixel_format));
    Set(env, detected_signal, "metadata", String(env, detected.metadata));
    Set(env, detected_signal, "scanMode", String(env, detected.scan_mode));
    Set(env, detected_signal, "fieldOrder", String(env, detected.field_order));
    Set(env, detected_signal, "pictureAspectRatio", Double(env, detected.picture_aspect_ratio));
    Set(env, detected_signal, "timecode", Int64(env, detected.timecode));
    Set(env, detected_signal, "timestamp", Int64(env, detected.timestamp));
    const bool yuv = detected.pixel_format == "UYVY" || detected.pixel_format == "UYVA" ||
                     detected.pixel_format == "P216" || detected.pixel_format == "PA16" ||
                     detected.pixel_format == "NV12" || detected.pixel_format == "I420" || detected.pixel_format == "YV12";
    const auto color = DetectColorMetadata(detected.metadata, yuv);
    Set(env, detected_signal, "primaries", String(env, color.primaries));
    Set(env, detected_signal, "range", String(env, color.range));
    Set(env, detected_signal, "transfer", String(env, color.transfer));
    Set(env, detected_signal, "matrix", String(env, color.matrix));
    Set(env, detected_signal, "detectionSource", String(env, color.source));
    Set(env, detected_signal, "confidence", String(env, color.confidence));
    Set(env, result, "detectedSignal", detected_signal);
    return result;
  }

  napi_value null_value;
  napi_get_null(env, &null_value);
  return null_value;
}

napi_value GetFrame(napi_env env, napi_callback_info info) {
  return GetSharedFrame(env, info);
}

napi_value PublishTestFrame(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t width = 320;
  uint32_t height = 180;
  if (argc > 0) napi_get_value_uint32(env, argv[0], &width);
  if (argc > 1) napi_get_value_uint32(env, argv[1], &height);
  if (width == 0 || height == 0 || static_cast<size_t>(width) * height * 4 > kSharedFrameCapacity) {
    Throw(env, "Invalid shared-memory test frame dimensions.");
    return nullptr;
  }
  static std::vector<uint8_t> rgba;
  static uint32_t cached_width = 0;
  static uint32_t cached_height = 0;
  if (cached_width != width || cached_height != height) {
    rgba.resize(static_cast<size_t>(width) * height * 4);
    for (uint32_t y = 0; y < height; ++y) {
      for (uint32_t x = 0; x < width; ++x) {
        const size_t offset = (static_cast<size_t>(y) * width + x) * 4;
        rgba[offset] = static_cast<uint8_t>((x * 255) / width);
        rgba[offset + 1] = static_cast<uint8_t>((y * 255) / height);
        rgba[offset + 2] = 96;
        rgba[offset + 3] = static_cast<uint8_t>(((x + y) * 255) / (width + height));
      }
    }
    cached_width = width;
    cached_height = height;
  }
  PublishSharedFrame(rgba, width, height, 60, 1, true);
  return Boolean(env, true);
}

napi_value PublishFrame(napi_env env, napi_callback_info info) {
  size_t argc = 6;
  napi_value argv[6];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 4) {
    Throw(env, "publishFrame(data, width, height, hasAlpha) requires four arguments.");
    return nullptr;
  }
  void* data = nullptr;
  size_t data_size = 0;
  if (napi_get_buffer_info(env, argv[0], &data, &data_size) != napi_ok) {
    Throw(env, "publishFrame data must be a Node.js Buffer.");
    return nullptr;
  }
  uint32_t width = 0;
  uint32_t height = 0;
  bool has_alpha = false;
  uint32_t frame_rate_n = 30;
  uint32_t frame_rate_d = 1;
  napi_get_value_uint32(env, argv[1], &width);
  napi_get_value_uint32(env, argv[2], &height);
  napi_get_value_bool(env, argv[3], &has_alpha);
  if (argc > 4) napi_get_value_uint32(env, argv[4], &frame_rate_n);
  if (argc > 5) napi_get_value_uint32(env, argv[5], &frame_rate_d);
  const size_t expected_size = static_cast<size_t>(width) * height * 4;
  if (width == 0 || height == 0 || expected_size != data_size || data_size > kSharedFrameCapacity) {
    Throw(env, "publishFrame received invalid RGBA dimensions or buffer length.");
    return nullptr;
  }
  const uint8_t* rgba = static_cast<const uint8_t*>(data);
  if (!has_alpha) {
    for (size_t offset = 3; offset < data_size; offset += 4) {
      if (rgba[offset] < 255) {
        has_alpha = true;
        break;
      }
    }
  }
  PublishSharedBytes(rgba, data_size, width, height, frame_rate_n, frame_rate_d ? frame_rate_d : 1, has_alpha);
  return Boolean(env, true);
}

napi_value GetEngineCapabilities(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_object(env, &result);
  std::string reason;
  const bool gpu_available = GpuPresenterInitialize(reason);
  Set(env, result, "sharedMemory", Boolean(env, true));
  Set(env, result, "gpuSharedTexture", Boolean(env, gpu_available));
#ifdef _WIN32
  Set(env, result, "platformBackend", String(env, gpu_available ? "d3d11" : "d3d11-unavailable"));
#else
  Set(env, result, "platformBackend", String(env, "metal-unavailable"));
#endif
  Set(env, result, "reason", String(env, reason));
  return result;
}

napi_value AttachGpuOutput(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value argv[2]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) { Throw(env, "attachGpuOutput(kind, nativeHandle) requires two arguments."); return nullptr; }
  size_t length = 0; napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length); std::string kind(length + 1, '\0');
  napi_get_value_string_utf8(env, argv[0], kind.data(), length + 1, &length);
  kind.resize(length);
  void* handle = nullptr; size_t handle_size = 0;
  if (napi_get_buffer_info(env, argv[1], &handle, &handle_size) != napi_ok) { Throw(env, "nativeHandle must be a Buffer."); return nullptr; }
  std::string reason; const bool attached = GpuPresenterAttach(kind.c_str(), handle, handle_size, reason);
  napi_value result; napi_create_object(env, &result); Set(env, result, "success", Boolean(env, attached)); Set(env, result, "reason", String(env, reason)); return result;
}

napi_value DetachGpuOutput(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  size_t length = 0; if (argc) napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length); std::string kind(length + 1, '\0');
  if (argc) napi_get_value_string_utf8(env, argv[0], kind.data(), length + 1, &length); kind.resize(length); GpuPresenterDetach(kind.c_str()); return Boolean(env, true);
}

napi_value ResizeGpuOutput(napi_env env, napi_callback_info info) {
  size_t argc=1;napi_value argv[1];napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr);size_t length=0;if(argc)napi_get_value_string_utf8(env,argv[0],nullptr,0,&length);std::string kind(length+1,'\0');if(argc)napi_get_value_string_utf8(env,argv[0],kind.data(),length+1,&length);kind.resize(length);std::string reason;const bool resized=GpuPresenterResize(kind.c_str(),reason);napi_value result;napi_create_object(env,&result);Set(env,result,"success",Boolean(env,resized));Set(env,result,"reason",String(env,reason));return result;
}

double GetNumberProperty(napi_env env, napi_value object, const char* key, double fallback) {
  napi_value value; if (napi_get_named_property(env, object, key, &value) != napi_ok) return fallback;
  double result = fallback; napi_get_value_double(env, value, &result); return result;
}

std::string GetStringProperty(napi_env env, napi_value object, const char* key, const std::string& fallback) {
  napi_value value;
  if (napi_get_named_property(env, object, key, &value) != napi_ok) return fallback;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return fallback;
  std::string result(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, result.data(), length + 1, &length) != napi_ok) return fallback;
  result.resize(length);
  return result;
}

napi_value ConfigureGpuPresenter(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (!argc) return Boolean(env, false);
  GpuPresenterConfig config;
  config.output_width = static_cast<uint32_t>(GetNumberProperty(env, argv[0], "outputWidth", 1920));
  config.output_height = static_cast<uint32_t>(GetNumberProperty(env, argv[0], "outputHeight", 1080));
  config.scaling_mode = static_cast<int>(GetNumberProperty(env, argv[0], "scalingMode", 0));
  config.source_limited = static_cast<int>(GetNumberProperty(env, argv[0], "sourceLimited", 0));
  config.output_limited = static_cast<int>(GetNumberProperty(env, argv[0], "outputLimited", 1));
  config.primaries_mode = static_cast<int>(GetNumberProperty(env, argv[0], "primariesMode", 0));
  config.matrix_mode = static_cast<int>(GetNumberProperty(env, argv[0], "matrixMode", 0));
  config.frame_rate_n = static_cast<uint32_t>(GetNumberProperty(env, argv[0], "frameRateN", 30));
  config.frame_rate_d = static_cast<uint32_t>(GetNumberProperty(env, argv[0], "frameRateD", 1));
  config.alpha_gain = static_cast<float>(std::max(0.0, std::min(3.0, GetNumberProperty(env, argv[0], "alphaGain", 1))));
  config.invert_alpha = static_cast<int>(GetNumberProperty(env, argv[0], "invertAlpha", 0));
  config.scan_mode = static_cast<int>(GetNumberProperty(env, argv[0], "scanMode", 0));
  config.field_order = static_cast<int>(GetNumberProperty(env, argv[0], "fieldOrder", 0));
  config.preview_policy = static_cast<int>(GetNumberProperty(env, argv[0], "previewPolicy", 1));
  g_preview_policy.store(config.preview_policy);
  napi_value crop; if (napi_get_named_property(env, argv[0], "cropRect", &crop) == napi_ok) {
    config.crop_x = static_cast<float>(GetNumberProperty(env, crop, "x", 0)); config.crop_y = static_cast<float>(GetNumberProperty(env, crop, "y", 0));
    config.crop_width = static_cast<float>(GetNumberProperty(env, crop, "width", 1)); config.crop_height = static_cast<float>(GetNumberProperty(env, crop, "height", 1));
  }
  GpuPresenterConfigure(config); return Boolean(env, true);
}

napi_value ConfigureSync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (!argc) return Boolean(env, false);
  const std::string mode = GetStringProperty(env, argv[0], "mode", "stable");
  const int requested_mode = mode == "low-latency" ? 0 : 1;
  g_sync_frame_rate_n.store(static_cast<uint32_t>(std::max(1.0, GetNumberProperty(env, argv[0], "frameRateN", 30))));
  g_sync_frame_rate_d.store(static_cast<uint32_t>(std::max(1.0, GetNumberProperty(env, argv[0], "frameRateD", 1))));
  std::lock_guard<std::mutex> state_lock(g_state_mutex);
  if (g_sync_mode.load() == requested_mode) return Boolean(env, true);
  if (!g_receiver) {
    g_sync_mode.store(requested_mode);
    return Boolean(env, true);
  }
  g_running.store(false);
  if (g_capture_thread.joinable()) g_capture_thread.join();
  if (g_framesync) {
    NDIlib_framesync_destroy(g_framesync);
    g_framesync = nullptr;
  }
  g_sync_mode.store(requested_mode);
  if (requested_mode == 1) g_framesync = NDIlib_framesync_create(g_receiver);
  g_running.store(true);
  g_capture_thread = std::thread(CaptureLoop);
  return Boolean(env, requested_mode == 0 || g_framesync != nullptr);
}

napi_value SubmitGpuSharedTexture(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  void* handle = nullptr; size_t handle_size = 0;
  if (!argc || napi_get_buffer_info(env, argv[0], &handle, &handle_size) != napi_ok) return Boolean(env, false);
  std::string reason; const bool submitted = GpuPresenterSubmitSharedTexture(handle, handle_size, reason);
  napi_value result; napi_create_object(env, &result); Set(env, result, "success", Boolean(env, submitted)); Set(env, result, "reason", String(env, reason)); return result;
}

napi_value GetGpuPresenterStatus(napi_env env, napi_callback_info) {
  const auto status = GpuPresenterGetStatus(); napi_value result; napi_create_object(env, &result);
  Set(env, result, "available", Boolean(env, status.available)); Set(env, result, "rgbAttached", Boolean(env, status.rgb_attached));
  Set(env, result, "alphaAttached", Boolean(env, status.alpha_attached)); Set(env, result, "submittedFrames", UInt64(env, status.submitted_frames));
  Set(env, result, "receivedFrames", UInt64(env, status.received_frames));
  Set(env, result, "overwrittenFrames", UInt64(env, status.overwritten_frames));
  Set(env, result, "presentationFailures", UInt64(env, status.presentation_failures));
  Set(env, result, "consecutiveFailures", UInt32(env, status.consecutive_failures));
  Set(env, result, "queueDepth", UInt32(env, status.queue_depth));
  Set(env, result, "uploadMs", Double(env, status.upload_ms));
  Set(env, result, "renderMs", Double(env, status.render_ms));
  Set(env, result, "presentMs", Double(env, status.present_ms));
  Set(env, result, "p95FrameMs", Double(env, status.p95_frame_ms));
  Set(env, result, "tickJitterUs", Double(env, status.tick_jitter_us));
  Set(env, result, "pairedPresentSkewUs", Double(env, status.paired_present_skew_us));
  Set(env, result, "clockLocked", Boolean(env, status.clock_locked));
  Set(env, result, "clockSource", String(env, status.clock_source));
  Set(env, result, "frameSyncActive", Boolean(env, g_sync_mode.load() == 1 && g_framesync));
  Set(env, result, "ndiTimestampAvailable", Boolean(env, g_ndi_timestamp_available.load()));
  Set(env, result, "repeatedFrames", UInt64(env, status.repeated_frames + g_framesync_repeated.load()));
  Set(env, result, "droppedFrames", UInt64(env, g_framesync_dropped.load() + status.overwritten_frames));
  const int64_t last_frame = g_last_frame_millis.load();
  Set(env, result, "sourceAgeUs", Int64(env, last_frame ? (NowMillis() - last_frame) * 1000 : -1));
  Set(env, result, "adapterName", String(env, status.adapter_name));
  Set(env, result, "adapterLuid", String(env, status.adapter_luid));
  Set(env, result, "dedicatedMemory", UInt64(env, status.dedicated_memory));
  Set(env, result, "deviceRemovedReason", String(env, status.device_removed_reason));
  Set(env, result, "lastError", String(env, status.last_error));
  return result;
}

napi_value GetGpuAdapters(napi_env env, napi_callback_info) {
  const auto adapters = GpuPresenterGetAdapters();
  napi_value result;
  napi_create_array_with_length(env, adapters.size(), &result);
  for (size_t index = 0; index < adapters.size(); ++index) {
    napi_value item;
    napi_create_object(env, &item);
    Set(env, item, "name", String(env, adapters[index].name));
    Set(env, item, "luid", String(env, adapters[index].luid));
    Set(env, item, "dedicatedMemory", UInt64(env, adapters[index].dedicated_memory));
    Set(env, item, "sharedMemory", UInt64(env, adapters[index].shared_memory));
    Set(env, item, "software", Boolean(env, adapters[index].software));
    napi_set_element(env, result, index, item);
  }
  return result;
}

napi_value SetGpuAdapterPreference(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (!argc) return Boolean(env, false);
  GpuPresenterSetAdapterPreference(GetStringProperty(env, argv[0], "preference", "high-performance"),
                                   GetStringProperty(env, argv[0], "luid", ""));
  return Boolean(env, true);
}

napi_value RecoverGpuPresenter(napi_env env, napi_callback_info) {
  std::string reason;
  const bool recovered = GpuPresenterRecover(reason);
  napi_value result;
  napi_create_object(env, &result);
  Set(env, result, "success", Boolean(env, recovered));
  Set(env, result, "reason", String(env, reason));
  return result;
}

napi_value TestVideoConverters(napi_env env, napi_callback_info) {
  const NDIlib_FourCC_video_type_e formats[] = { NDIlib_FourCC_type_RGBA, NDIlib_FourCC_type_RGBX,
    NDIlib_FourCC_type_BGRA, NDIlib_FourCC_type_BGRX, NDIlib_FourCC_type_UYVY, NDIlib_FourCC_type_UYVA,
    NDIlib_FourCC_type_P216, NDIlib_FourCC_type_PA16, NDIlib_FourCC_type_NV12, NDIlib_FourCC_type_I420, NDIlib_FourCC_type_YV12 };
  uint32_t passed = 0;
  uint32_t gpu_passed = 0;
  for (const auto format : formats) {
    NDIlib_video_frame_v2_t frame{}; frame.xres=2; frame.yres=2; frame.FourCC=format;
    size_t size = 16;
    if (format==NDIlib_FourCC_type_RGBA||format==NDIlib_FourCC_type_RGBX||format==NDIlib_FourCC_type_BGRA||format==NDIlib_FourCC_type_BGRX) frame.line_stride_in_bytes=8;
    else if(format==NDIlib_FourCC_type_P216||format==NDIlib_FourCC_type_PA16){frame.line_stride_in_bytes=4;size=format==NDIlib_FourCC_type_PA16?24:16;}
    else if(format==NDIlib_FourCC_type_UYVA){frame.line_stride_in_bytes=4;size=12;}
    else if(format==NDIlib_FourCC_type_UYVY){frame.line_stride_in_bytes=4;size=8;}
    else {frame.line_stride_in_bytes=2;size=6;}
    std::vector<uint8_t> bytes(size,128); frame.p_data=bytes.data();
    if(format==NDIlib_FourCC_type_P216||format==NDIlib_FourCC_type_PA16){auto* values=reinterpret_cast<uint16_t*>(bytes.data());for(size_t i=0;i<size/2;++i)values[i]=i<4?32768:32768;}
    std::vector<uint8_t> rgba; bool alpha=false;
    if(ConvertVideoFrame(frame,rgba,alpha)&&rgba.size()==16)++passed;
    std::string direct_reason;
    if (SubmitGpuVideoFrame(frame, direct_reason)) ++gpu_passed;
  }
  std::vector<uint16_t> p216(2*2*3,32768);std::string gpu_reason;const bool gpu_queued=GpuPresenterSubmitP216(reinterpret_cast<const uint8_t*>(p216.data()),2,2,4,true,gpu_reason);
  napi_value result;napi_create_object(env,&result);Set(env,result,"passed",UInt32(env,passed));Set(env,result,"total",UInt32(env,sizeof(formats)/sizeof(formats[0])));Set(env,result,"gpuPassed",UInt32(env,gpu_passed));Set(env,result,"gpuP216Queued",Boolean(env,gpu_queued));Set(env,result,"gpuReason",String(env,gpu_reason));return result;
}

napi_value ShutdownGpuPresenter(napi_env env, napi_callback_info) { GpuPresenterShutdown(); return Boolean(env, true); }

napi_value ProbeSharedTexture(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_object(env, &result);
#ifdef _WIN32
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  void* bytes = nullptr;
  size_t size = 0;
  if (argc != 1 || napi_get_buffer_info(env, argv[0], &bytes, &size) != napi_ok || size < sizeof(HANDLE)) {
    Set(env, result, "success", Boolean(env, false));
    Set(env, result, "reason", String(env, "Invalid Windows shared texture handle buffer."));
    return result;
  }
  HANDLE handle = nullptr;
  std::memcpy(&handle, bytes, sizeof(HANDLE));
  ID3D11Device* device = nullptr;
  ID3D11DeviceContext* context = nullptr;
  D3D_FEATURE_LEVEL feature_level{};
  const HRESULT create_result = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
      D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, &device, &feature_level, &context);
  if (FAILED(create_result)) {
    Set(env, result, "success", Boolean(env, false));
    Set(env, result, "reason", String(env, "D3D11CreateDevice failed."));
    return result;
  }
  ID3D11Texture2D* texture = nullptr;
  HRESULT open_result = device->OpenSharedResource(handle, __uuidof(ID3D11Texture2D),
      reinterpret_cast<void**>(&texture));
  if (FAILED(open_result)) {
    ID3D11Device1* device1 = nullptr;
    if (SUCCEEDED(device->QueryInterface(__uuidof(ID3D11Device1), reinterpret_cast<void**>(&device1)))) {
      open_result = device1->OpenSharedResource1(handle, __uuidof(ID3D11Texture2D),
          reinterpret_cast<void**>(&texture));
      device1->Release();
    }
  }
  if (SUCCEEDED(open_result) && texture) {
    D3D11_TEXTURE2D_DESC description{};
    texture->GetDesc(&description);
    Set(env, result, "success", Boolean(env, true));
    Set(env, result, "width", UInt32(env, description.Width));
    Set(env, result, "height", UInt32(env, description.Height));
    Set(env, result, "format", UInt32(env, static_cast<uint32_t>(description.Format)));
    texture->Release();
  } else {
    Set(env, result, "success", Boolean(env, false));
    Set(env, result, "reason", String(env, "D3D11 OpenSharedResource rejected the Electron texture handle."));
  }
  context->Release();
  device->Release();
#else
  Set(env, result, "success", Boolean(env, false));
  Set(env, result, "reason", String(env, "Shared texture probing requires the macOS Metal implementation."));
#endif
  return result;
}

napi_value PublishBgraFrame(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 3) {
    Throw(env, "publishBgraFrame(data, width, height) requires three arguments.");
    return nullptr;
  }
  void* data = nullptr;
  size_t data_size = 0;
  if (napi_get_buffer_info(env, argv[0], &data, &data_size) != napi_ok) {
    Throw(env, "publishBgraFrame data must be a Node.js Buffer.");
    return nullptr;
  }
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t frame_rate_n = 30;
  uint32_t frame_rate_d = 1;
  napi_get_value_uint32(env, argv[1], &width);
  napi_get_value_uint32(env, argv[2], &height);
  if (argc > 3) napi_get_value_uint32(env, argv[3], &frame_rate_n);
  if (argc > 4) napi_get_value_uint32(env, argv[4], &frame_rate_d);
  const size_t expected_size = static_cast<size_t>(width) * height * 4;
  if (width == 0 || height == 0 || expected_size != data_size || data_size > kSharedFrameCapacity) {
    Throw(env, "publishBgraFrame received invalid BGRA dimensions or buffer length.");
    return nullptr;
  }
  const uint8_t* bgra = static_cast<const uint8_t*>(data);
  std::vector<uint8_t> rgba(data_size);
  bool has_alpha = false;
  for (size_t offset = 0; offset < data_size; offset += 4) {
    const uint8_t alpha = bgra[offset + 3];
    auto unpremultiply = [alpha](uint8_t channel) -> uint8_t {
      if (alpha == 0 || alpha == 255) return channel;
      return static_cast<uint8_t>(std::min(255u, (static_cast<uint32_t>(channel) * 255u + alpha / 2u) / alpha));
    };
    rgba[offset] = unpremultiply(bgra[offset + 2]);
    rgba[offset + 1] = unpremultiply(bgra[offset + 1]);
    rgba[offset + 2] = unpremultiply(bgra[offset]);
    rgba[offset + 3] = alpha;
    has_alpha = has_alpha || alpha < 255;
  }
  PublishSharedFrame(rgba, width, height, frame_rate_n, frame_rate_d ? frame_rate_d : 1, has_alpha);
  return Boolean(env, true);
}

void Cleanup(void*) {
  std::lock_guard<std::mutex> state_lock(g_state_mutex);
  StopReceiver();
  if (g_finder) {
    NDIlib_find_destroy(g_finder);
    g_finder = nullptr;
  }
  if (g_initialized) {
    NDIlib_destroy();
    g_initialized = false;
  }
#ifndef _WIN32
  const bool unlink_shared_mapping = g_shared_owner;
#endif
  CloseSharedMapping();
  GpuPresenterShutdown();
#ifndef _WIN32
  if (unlink_shared_mapping) shm_unlink(kSharedMappingName);
#endif
}

napi_value Init(napi_env env, napi_value exports) {
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  const napi_property_descriptor properties[] = {
      {"getStatus", nullptr, GetStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"findSources", nullptr, FindSources, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"connect", nullptr, Connect, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"disconnect", nullptr, Disconnect, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getFrame", nullptr, GetFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getSharedFrame", nullptr, GetSharedFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"publishTestFrame", nullptr, PublishTestFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"publishFrame", nullptr, PublishFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"publishBgraFrame", nullptr, PublishBgraFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getEngineCapabilities", nullptr, GetEngineCapabilities, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"probeSharedTexture", nullptr, ProbeSharedTexture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"attachGpuOutput", nullptr, AttachGpuOutput, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"detachGpuOutput", nullptr, DetachGpuOutput, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"resizeGpuOutput", nullptr, ResizeGpuOutput, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"configureGpuPresenter", nullptr, ConfigureGpuPresenter, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"configureSync", nullptr, ConfigureSync, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"submitGpuSharedTexture", nullptr, SubmitGpuSharedTexture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getGpuPresenterStatus", nullptr, GetGpuPresenterStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getGpuAdapters", nullptr, GetGpuAdapters, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setGpuAdapterPreference", nullptr, SetGpuAdapterPreference, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"recoverGpuPresenter", nullptr, RecoverGpuPresenter, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"testVideoConverters", nullptr, TestVideoConverters, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"shutdownGpuPresenter", nullptr, ShutdownGpuPresenter, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
