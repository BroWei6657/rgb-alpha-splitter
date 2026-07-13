#include "d3d11_presenter.h"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <avrt.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <d3dcompiler.h>
#include <dxgi1_6.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

namespace {

template <typename T> void Release(T*& value) {
  if (value) {
    value->Release();
    value = nullptr;
  }
}

std::string WideToUtf8(const wchar_t* value) {
  if (!value || !*value) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  std::string result(std::max(0, size), '\0');
  if (size > 1) {
    WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), size, nullptr, nullptr);
    result.resize(size - 1);
  }
  return result;
}

std::string LuidString(const LUID& luid) {
  char value[32]{};
  std::snprintf(value, sizeof(value), "%08X:%08X", static_cast<uint32_t>(luid.HighPart), luid.LowPart);
  return value;
}

struct OutputSurface {
  HWND parent = nullptr;
  HWND child = nullptr;
  IDXGISwapChain1* swap_chain = nullptr;
  ID3D11RenderTargetView* render_target = nullptr;
  HANDLE frame_latency_waitable = nullptr;
  uint32_t width = 0;
  uint32_t height = 0;
  bool alpha = false;
};

struct ShaderConstants {
  float source_aspect;
  float output_aspect;
  float scaling_mode;
  float output_kind;
  float crop[4];
  float source_limited;
  float output_limited;
  float primaries_mode;
  float input_mode;
  float input_has_alpha;
  float alpha_gain;
  float invert_alpha;
  float interlaced;
  float field_order;
  float field_parity;
  float source_width;
  float source_height;
  float matrix_mode;
  float padding[3];
};

struct FramePacket {
  GpuPixelFormat format = GpuPixelFormat::rgba;
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t plane_count = 0;
  std::array<uint32_t, 4> plane_width{};
  std::array<uint32_t, 4> plane_height{};
  std::array<uint32_t, 4> bytes_per_pixel{};
  std::array<std::vector<uint8_t>, 4> planes;
  bool has_alpha = false;
  bool interlaced = false;
  int field_order = 0;
  int64_t timecode = 0;
  int64_t timestamp = 0;
  ID3D11Texture2D* shared_texture = nullptr;
  bool valid = false;
};

struct TextureSet {
  std::array<ID3D11Texture2D*, 4> textures{};
  std::array<ID3D11ShaderResourceView*, 4> views{};
  std::array<uint32_t, 4> widths{};
  std::array<uint32_t, 4> heights{};
  std::array<DXGI_FORMAT, 4> formats{};
};

std::mutex g_render_mutex;
std::mutex g_queue_mutex;
std::condition_variable g_work_ready;
std::thread g_present_thread;
bool g_stop_thread = false;
FramePacket g_pending;

ID3D11Device* g_device = nullptr;
ID3D11Device1* g_device1 = nullptr;
ID3D11DeviceContext* g_context = nullptr;
IDXGIFactory2* g_factory = nullptr;
ID3D11VertexShader* g_vertex_shader = nullptr;
ID3D11PixelShader* g_pixel_shader = nullptr;
ID3D11SamplerState* g_sampler = nullptr;
ID3D11Buffer* g_constants = nullptr;
TextureSet g_texture_sets[2];
int g_current_texture_set = 0;
bool g_previous_texture_valid = false;
ID3D11Texture2D* g_current_shared_texture = nullptr;
ID3D11Texture2D* g_previous_shared_texture = nullptr;
ID3D11ShaderResourceView* g_current_shared_view = nullptr;
ID3D11ShaderResourceView* g_previous_shared_view = nullptr;
OutputSurface g_rgb;
OutputSurface g_alpha;
GpuPresenterConfig g_config;
GpuPresenterStatus g_status;
std::deque<double> g_frame_samples;
std::string g_adapter_preference = "high-performance";
std::string g_requested_adapter_luid;
std::atomic<bool> g_available{false};

LRESULT CALLBACK ChildWindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  return DefWindowProcW(window, message, wparam, lparam);
}

void ClearPacket(FramePacket& packet, bool keep_capacity = true) {
  Release(packet.shared_texture);
  packet.valid = false;
  packet.plane_count = 0;
  if (!keep_capacity) {
    for (auto& plane : packet.planes) std::vector<uint8_t>().swap(plane);
  }
}

void DestroyTextureSet(TextureSet& set) {
  for (auto& view : set.views) Release(view);
  for (auto& texture : set.textures) Release(texture);
  set = TextureSet{};
}

void DestroySurface(OutputSurface& output) {
  Release(output.render_target);
  Release(output.swap_chain);
  output.frame_latency_waitable = nullptr;
  if (output.child) DestroyWindow(output.child);
  output = OutputSurface{};
}

void UpdateAverage(double& target, double sample) {
  target = target <= 0.0 ? sample : target * 0.9 + sample * 0.1;
}

void UpdateFrameSamples(double sample) {
  g_frame_samples.push_back(sample);
  if (g_frame_samples.size() > 240) g_frame_samples.pop_front();
  std::vector<double> sorted(g_frame_samples.begin(), g_frame_samples.end());
  std::sort(sorted.begin(), sorted.end());
  if (!sorted.empty()) g_status.p95_frame_ms = sorted[static_cast<size_t>((sorted.size() - 1) * 0.95)];
}

std::vector<GpuAdapterInfo> EnumerateAdapters(IDXGIFactory6** factory_out = nullptr,
                                               std::vector<IDXGIAdapter1*>* native_out = nullptr) {
  IDXGIFactory6* factory6 = nullptr;
  if (FAILED(CreateDXGIFactory2(0, __uuidof(IDXGIFactory6), reinterpret_cast<void**>(&factory6)))) return {};
  std::vector<GpuAdapterInfo> result;
  std::vector<IDXGIAdapter1*> native;
  for (UINT index = 0;; ++index) {
    IDXGIAdapter1* adapter = nullptr;
    const HRESULT hr = factory6->EnumAdapterByGpuPreference(
        index, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE, __uuidof(IDXGIAdapter1), reinterpret_cast<void**>(&adapter));
    if (hr == DXGI_ERROR_NOT_FOUND) break;
    if (FAILED(hr) || !adapter) continue;
    DXGI_ADAPTER_DESC1 desc{};
    adapter->GetDesc1(&desc);
    result.push_back({WideToUtf8(desc.Description), LuidString(desc.AdapterLuid),
                      static_cast<uint64_t>(desc.DedicatedVideoMemory),
                      static_cast<uint64_t>(desc.SharedSystemMemory),
                      (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0});
    native.push_back(adapter);
  }
  if (native_out) {
    *native_out = std::move(native);
  } else {
    for (auto* adapter : native) Release(adapter);
  }
  if (factory_out) {
    *factory_out = factory6;
  } else {
    Release(factory6);
  }
  return result;
}

bool CompileShader(const char* source, const char* target, ID3DBlob** blob, std::string& reason) {
  ID3DBlob* error = nullptr;
  const HRESULT result = D3DCompile(source, std::strlen(source), nullptr, nullptr, nullptr, "main", target,
      D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, blob, &error);
  if (FAILED(result)) {
    reason = error ? std::string(static_cast<const char*>(error->GetBufferPointer()), error->GetBufferSize())
                   : "D3D shader compilation failed.";
    Release(error);
    return false;
  }
  Release(error);
  return true;
}

bool ResizeSurface(OutputSurface& output, std::string& reason) {
  if (!output.child || !output.swap_chain || !output.parent) return false;
  RECT bounds{};
  GetClientRect(output.parent, &bounds);
  const uint32_t width = std::max<LONG>(1, bounds.right - bounds.left);
  const uint32_t height = std::max<LONG>(1, bounds.bottom - bounds.top);
  SetWindowPos(output.child, HWND_TOP, 0, 0, width, height, SWP_SHOWWINDOW | SWP_NOACTIVATE);
  if (width == output.width && height == output.height && output.render_target) return true;
  Release(output.render_target);
  const HRESULT resized = output.swap_chain->ResizeBuffers(2, width, height, DXGI_FORMAT_B8G8R8A8_UNORM,
      DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT);
  if (FAILED(resized)) {
    reason = "D3D swap-chain resize failed.";
    return false;
  }
  ID3D11Texture2D* back_buffer = nullptr;
  const HRESULT get_buffer = output.swap_chain->GetBuffer(0, __uuidof(ID3D11Texture2D),
      reinterpret_cast<void**>(&back_buffer));
  const HRESULT create_view = SUCCEEDED(get_buffer)
      ? g_device->CreateRenderTargetView(back_buffer, nullptr, &output.render_target)
      : get_buffer;
  Release(back_buffer);
  if (FAILED(create_view)) {
    reason = "D3D back-buffer creation failed.";
    return false;
  }
  output.width = width;
  output.height = height;
  return true;
}

DXGI_FORMAT PlaneFormat(const FramePacket& packet, uint32_t plane) {
  switch (packet.format) {
    case GpuPixelFormat::rgba: return DXGI_FORMAT_R8G8B8A8_UNORM;
    case GpuPixelFormat::bgra: return DXGI_FORMAT_B8G8R8A8_UNORM;
    case GpuPixelFormat::uyvy:
    case GpuPixelFormat::uyva: return plane == 0 ? DXGI_FORMAT_R8G8B8A8_UNORM : DXGI_FORMAT_R8_UNORM;
    case GpuPixelFormat::nv12: return plane == 0 ? DXGI_FORMAT_R8_UNORM : DXGI_FORMAT_R8G8_UNORM;
    case GpuPixelFormat::i420:
    case GpuPixelFormat::yv12: return DXGI_FORMAT_R8_UNORM;
    case GpuPixelFormat::p216:
    case GpuPixelFormat::pa16: return plane == 1 ? DXGI_FORMAT_R16G16_UNORM : DXGI_FORMAT_R16_UNORM;
  }
  return DXGI_FORMAT_UNKNOWN;
}

float InputMode(GpuPixelFormat format) {
  if (format == GpuPixelFormat::uyvy || format == GpuPixelFormat::uyva) return 1.0f;
  if (format == GpuPixelFormat::nv12 || format == GpuPixelFormat::p216 || format == GpuPixelFormat::pa16) return 2.0f;
  if (format == GpuPixelFormat::i420 || format == GpuPixelFormat::yv12) return 3.0f;
  return 0.0f;
}

bool EnsurePlaneTexture(TextureSet& set, uint32_t plane, uint32_t width, uint32_t height,
                        DXGI_FORMAT format, std::string& reason) {
  if (set.textures[plane] && set.widths[plane] == width && set.heights[plane] == height &&
      set.formats[plane] == format) return true;
  Release(set.views[plane]);
  Release(set.textures[plane]);
  D3D11_TEXTURE2D_DESC desc{};
  desc.Width = width;
  desc.Height = height;
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.Format = format;
  desc.SampleDesc.Count = 1;
  desc.Usage = D3D11_USAGE_DEFAULT;
  desc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  if (FAILED(g_device->CreateTexture2D(&desc, nullptr, &set.textures[plane])) ||
      FAILED(g_device->CreateShaderResourceView(set.textures[plane], nullptr, &set.views[plane]))) {
    reason = "GPU input-plane texture creation failed.";
    return false;
  }
  set.widths[plane] = width;
  set.heights[plane] = height;
  set.formats[plane] = format;
  return true;
}

bool UploadPacket(const FramePacket& packet, std::string& reason) {
  const auto started = std::chrono::steady_clock::now();
  const int target_index = 1 - g_current_texture_set;
  TextureSet& target = g_texture_sets[target_index];
  for (uint32_t plane = 0; plane < packet.plane_count; ++plane) {
    const DXGI_FORMAT format = PlaneFormat(packet, plane);
    if (format == DXGI_FORMAT_UNKNOWN || !EnsurePlaneTexture(target, plane, packet.plane_width[plane],
        packet.plane_height[plane], format, reason)) return false;
    const uint32_t row_pitch = packet.plane_width[plane] * packet.bytes_per_pixel[plane];
    g_context->UpdateSubresource(target.textures[plane], 0, nullptr, packet.planes[plane].data(), row_pitch, 0);
  }
  g_previous_texture_valid = g_texture_sets[g_current_texture_set].views[0] != nullptr;
  g_current_texture_set = target_index;
  const double elapsed = std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now() - started).count();
  UpdateAverage(g_status.upload_ms, elapsed);
  return true;
}

void BindTextureSet(const TextureSet& set, uint32_t first_slot) {
  ID3D11ShaderResourceView* views[4] = {set.views[0], set.views[1], set.views[2], set.views[3]};
  g_context->PSSetShaderResources(first_slot, 4, views);
}

bool RecordFailure(HRESULT hr, const std::string& reason) {
  ++g_status.presentation_failures;
  ++g_status.consecutive_failures;
  g_status.last_error = reason;
  const HRESULT removed = g_device ? g_device->GetDeviceRemovedReason() : E_FAIL;
  if (FAILED(removed)) {
    char value[64]{};
    std::snprintf(value, sizeof(value), "0x%08X", static_cast<uint32_t>(removed));
    g_status.device_removed_reason = value;
  } else if (FAILED(hr)) {
    char value[64]{};
    std::snprintf(value, sizeof(value), "0x%08X", static_cast<uint32_t>(hr));
    g_status.device_removed_reason = value;
  }
  return false;
}

bool RenderSurface(OutputSurface& output, const GpuPresenterConfig& config, float source_aspect,
                   float input_mode, bool has_alpha, bool interlaced, int field_order,
                   bool shared, std::string& reason, int64_t* present_time_ns) {
  if (!output.swap_chain) return true;
  if (!output.render_target) return RecordFailure(E_FAIL, "D3D output surface is not ready.");
  const auto render_started = std::chrono::steady_clock::now();
  D3D11_VIEWPORT viewport{0, 0, static_cast<float>(output.width), static_cast<float>(output.height), 0, 1};
  ShaderConstants constants{};
  constants.source_aspect = source_aspect;
  constants.output_aspect = static_cast<float>(config.output_width) / std::max(1u, config.output_height);
  constants.scaling_mode = static_cast<float>(config.scaling_mode);
  constants.output_kind = output.alpha ? 1.0f : 0.0f;
  constants.crop[0] = config.crop_x;
  constants.crop[1] = config.crop_y;
  constants.crop[2] = config.crop_width;
  constants.crop[3] = config.crop_height;
  constants.source_limited = static_cast<float>(config.source_limited);
  constants.output_limited = static_cast<float>(config.output_limited);
  constants.primaries_mode = static_cast<float>(config.primaries_mode);
  constants.input_mode = shared ? 0.0f : input_mode;
  constants.input_has_alpha = has_alpha ? 1.0f : 0.0f;
  constants.alpha_gain = config.alpha_gain;
  constants.invert_alpha = static_cast<float>(config.invert_alpha);
  const bool previous_available = shared ? g_previous_shared_view != nullptr : g_previous_texture_valid;
  constants.interlaced = (interlaced || config.scan_mode != 0) && previous_available ? 1.0f : 0.0f;
  constants.field_order = static_cast<float>(field_order >= 0 ? field_order : config.field_order);
  constants.field_parity = static_cast<float>((g_status.submitted_frames + (constants.field_order > 0.5f ? 1 : 0)) & 1);
  constants.source_width = source_aspect > 0.0f ? source_aspect : 1.0f;
  constants.source_height = 1.0f;
  constants.matrix_mode = static_cast<float>(config.matrix_mode);
  if (!shared) {
    constants.source_width = static_cast<float>(g_texture_sets[g_current_texture_set].widths[0] *
        ((input_mode > 0.5f && input_mode < 1.5f) ? 2 : 1));
    constants.source_height = static_cast<float>(g_texture_sets[g_current_texture_set].heights[0]);
  }
  g_context->UpdateSubresource(g_constants, 0, nullptr, &constants, 0, 0);
  g_context->RSSetViewports(1, &viewport);
  g_context->OMSetRenderTargets(1, &output.render_target, nullptr);
  g_context->VSSetShader(g_vertex_shader, nullptr, 0);
  g_context->PSSetShader(g_pixel_shader, nullptr, 0);
  if (shared) {
    ID3D11ShaderResourceView* views[8] = {g_current_shared_view, nullptr, nullptr, nullptr,
                                         g_previous_shared_view, nullptr, nullptr, nullptr};
    g_context->PSSetShaderResources(0, 8, views);
  } else {
    BindTextureSet(g_texture_sets[g_current_texture_set], 0);
    BindTextureSet(g_texture_sets[1 - g_current_texture_set], 4);
  }
  g_context->PSSetSamplers(0, 1, &g_sampler);
  g_context->PSSetConstantBuffers(0, 1, &g_constants);
  g_context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  g_context->Draw(3, 0);
  ID3D11ShaderResourceView* empty[8] = {};
  g_context->PSSetShaderResources(0, 8, empty);
  const auto before_present = std::chrono::steady_clock::now();
  UpdateAverage(g_status.render_ms, std::chrono::duration<double, std::milli>(before_present - render_started).count());
  const HRESULT presented = output.swap_chain->Present(0, DXGI_PRESENT_DO_NOT_WAIT);
  const auto after_present = std::chrono::steady_clock::now();
  if (present_time_ns) {
    *present_time_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(after_present.time_since_epoch()).count();
  }
  UpdateAverage(g_status.present_ms, std::chrono::duration<double, std::milli>(after_present - before_present).count());
  if (presented == DXGI_ERROR_WAS_STILL_DRAWING) return true;
  if (FAILED(presented)) {
    reason = "D3D swap-chain presentation failed.";
    return RecordFailure(presented, reason);
  }
  return true;
}

void PresentationLoop() {
  DWORD task_index = 0;
  HANDLE mmcss = AvSetMmThreadCharacteristicsW(L"Playback", &task_index);
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
  auto next_present = std::chrono::steady_clock::now();
  FramePacket packet;
  bool have_frame = false;
  bool shared = false;
  float source_aspect = 16.0f / 9.0f;
  float input_mode = 0.0f;
  bool has_alpha = false;
  bool interlaced = false;
  int field_order = 0;
  bool new_since_present = false;

  while (true) {
    {
      std::unique_lock<std::mutex> queue_lock(g_queue_mutex);
      g_work_ready.wait_until(queue_lock, next_present, [] { return g_stop_thread || g_pending.valid; });
      if (g_stop_thread) break;
      if (g_pending.valid) {
        std::swap(packet, g_pending);
        g_pending.valid = false;
        new_since_present = true;
      }
    }

    if (packet.valid) {
      std::lock_guard<std::mutex> render_lock(g_render_mutex);
      std::string reason;
      if (packet.shared_texture) {
        Release(g_previous_shared_view);
        Release(g_previous_shared_texture);
        g_previous_shared_texture = g_current_shared_texture;
        g_previous_shared_view = g_current_shared_view;
        g_current_shared_texture = packet.shared_texture;
        packet.shared_texture = nullptr;
        g_current_shared_view = nullptr;
        D3D11_TEXTURE2D_DESC desc{};
        g_current_shared_texture->GetDesc(&desc);
        source_aspect = static_cast<float>(desc.Width) / std::max(1u, desc.Height);
        if (SUCCEEDED(g_device->CreateShaderResourceView(g_current_shared_texture, nullptr, &g_current_shared_view))) {
          have_frame = true;
          shared = true;
          has_alpha = true;
          interlaced = false;
          field_order = 0;
        } else {
          RecordFailure(E_FAIL, "Shared-texture shader view creation failed.");
        }
      } else if (UploadPacket(packet, reason)) {
        have_frame = true;
        shared = false;
        source_aspect = static_cast<float>(packet.width) / std::max(1u, packet.height);
        input_mode = InputMode(packet.format);
        has_alpha = packet.has_alpha;
        interlaced = packet.interlaced;
        field_order = packet.field_order;
      } else {
        RecordFailure(E_FAIL, reason);
      }
      packet.valid = false;
    }

    const auto now = std::chrono::steady_clock::now();
    if (!have_frame || now < next_present) continue;
    const auto frame_started = now;
    bool rgb_ok = true;
    bool alpha_ok = true;
    {
      std::lock_guard<std::mutex> render_lock(g_render_mutex);
      std::string reason;
      const GpuPresenterConfig config = g_config;
      HANDLE master_waitable = g_rgb.frame_latency_waitable ? g_rgb.frame_latency_waitable : g_alpha.frame_latency_waitable;
      g_status.clock_source = master_waitable ? (g_rgb.frame_latency_waitable ? "dxgi-rgb" : "dxgi-alpha") : "host-monotonic";
      g_status.clock_locked = master_waitable != nullptr;
      if (master_waitable && g_status.submitted_frames > 0) WaitForSingleObject(master_waitable, 20);
      const auto paced_now = std::chrono::steady_clock::now();
      UpdateAverage(g_status.tick_jitter_us,
          std::abs(std::chrono::duration<double, std::micro>(paced_now - next_present).count()));
      int64_t rgb_present_ns = 0;
      int64_t alpha_present_ns = 0;
      rgb_ok = RenderSurface(g_rgb, config, source_aspect, input_mode, has_alpha, interlaced,
                             field_order, shared, reason, &rgb_present_ns);
      alpha_ok = RenderSurface(g_alpha, config, source_aspect, input_mode, has_alpha, interlaced,
                               field_order, shared, reason, &alpha_present_ns);
      if (rgb_ok && alpha_ok) {
        ++g_status.submitted_frames;
        if (!new_since_present) ++g_status.repeated_frames;
        new_since_present = false;
        g_status.consecutive_failures = 0;
      }
      if (rgb_present_ns && alpha_present_ns) {
        UpdateAverage(g_status.paired_present_skew_us, std::abs(alpha_present_ns - rgb_present_ns) / 1000.0);
      }
      const double frame_ms = std::chrono::duration<double, std::milli>(
          std::chrono::steady_clock::now() - frame_started).count();
      UpdateFrameSamples(frame_ms);
      const uint64_t interval_ns = 1000000000ull * std::max(1u, config.frame_rate_d) /
          std::max(1u, config.frame_rate_n);
      next_present += std::chrono::nanoseconds(interval_ns);
      const auto after_present = std::chrono::steady_clock::now();
      if (next_present <= after_present) next_present = after_present + std::chrono::nanoseconds(interval_ns);
    }
  }
  ClearPacket(packet, false);
  if (mmcss) AvRevertMmThreadCharacteristics(mmcss);
}

void ReleaseDeviceResources() {
  DestroySurface(g_rgb);
  DestroySurface(g_alpha);
  DestroyTextureSet(g_texture_sets[0]);
  DestroyTextureSet(g_texture_sets[1]);
  Release(g_current_shared_view);
  Release(g_previous_shared_view);
  Release(g_current_shared_texture);
  Release(g_previous_shared_texture);
  Release(g_constants);
  Release(g_sampler);
  Release(g_pixel_shader);
  Release(g_vertex_shader);
  Release(g_factory);
  Release(g_context);
  Release(g_device1);
  Release(g_device);
  g_available = false;
  g_status.available = false;
}

}  // namespace

std::vector<GpuAdapterInfo> GpuPresenterGetAdapters() {
  return EnumerateAdapters();
}

void GpuPresenterSetAdapterPreference(const std::string& preference, const std::string& luid) {
  std::lock_guard<std::mutex> lock(g_render_mutex);
  g_adapter_preference = preference == "system" ? "system" : "high-performance";
  g_requested_adapter_luid = luid;
}

bool GpuPresenterInitialize(std::string& reason) {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  if (g_available) return true;

  IDXGIFactory6* factory6 = nullptr;
  std::vector<IDXGIAdapter1*> native_adapters;
  const auto adapters = EnumerateAdapters(&factory6, &native_adapters);
  if (!factory6 || native_adapters.empty()) {
    reason = "No D3D11 hardware adapter was found.";
    for (auto* adapter : native_adapters) Release(adapter);
    Release(factory6);
    return false;
  }

  size_t selected_index = 0;
  if (!g_requested_adapter_luid.empty()) {
    for (size_t index = 0; index < adapters.size(); ++index) {
      if (adapters[index].luid == g_requested_adapter_luid) {
        selected_index = index;
        break;
      }
    }
  } else if (g_adapter_preference == "system") {
    uint64_t most_shared = 0;
    for (size_t index = 0; index < adapters.size(); ++index) {
      if (!adapters[index].software && adapters[index].shared_memory >= most_shared) {
        most_shared = adapters[index].shared_memory;
        selected_index = index;
      }
    }
  }
  while (selected_index < adapters.size() && adapters[selected_index].software) ++selected_index;
  if (selected_index >= native_adapters.size()) selected_index = 0;

  D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  D3D_FEATURE_LEVEL created_level{};
  const HRESULT created = D3D11CreateDevice(native_adapters[selected_index], D3D_DRIVER_TYPE_UNKNOWN, nullptr,
      D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, ARRAYSIZE(levels), D3D11_SDK_VERSION,
      &g_device, &created_level, &g_context);
  for (auto* adapter : native_adapters) Release(adapter);
  if (FAILED(created)) {
    Release(factory6);
    reason = "D3D11 hardware device creation failed.";
    return false;
  }
  g_factory = factory6;
  g_device->QueryInterface(__uuidof(ID3D11Device1), reinterpret_cast<void**>(&g_device1));
  g_status = GpuPresenterStatus{};
  g_status.adapter_name = adapters[selected_index].name;
  g_status.adapter_luid = adapters[selected_index].luid;
  g_status.dedicated_memory = adapters[selected_index].dedicated_memory;

  const char* vertex_source = R"(
    struct O { float4 p:SV_POSITION; float2 uv:TEXCOORD0; };
    O main(uint id:SV_VertexID) { O o; float2 p=float2((id<<1)&2,id&2); o.uv=p; o.p=float4(p*float2(2,-2)+float2(-1,1),0,1); return o; })";
  const char* pixel_source = R"(
    Texture2D<float4> c0:register(t0); Texture2D<float4> c1:register(t1); Texture2D<float4> c2:register(t2); Texture2D<float4> c3:register(t3);
    Texture2D<float4> p0:register(t4); Texture2D<float4> p1:register(t5); Texture2D<float4> p2:register(t6); Texture2D<float4> p3:register(t7);
    SamplerState samp:register(s0);
    cbuffer C:register(b0) { float sourceAspect,outputAspect,scalingMode,outputKind; float4 crop;
      float sourceLimited,outputLimited,primariesMode,inputMode; float inputHasAlpha,alphaGain,invertAlpha,interlaced;
      float fieldOrder,fieldParity,sourceWidth,sourceHeight; float matrixMode,m0,m1,m2; };
    float4 rawPixel(float2 q,bool previous) {
      if(inputMode<.5) return previous?p0.SampleLevel(samp,q,0):c0.SampleLevel(samp,q,0);
      if(inputMode<1.5){float2 pixel=floor(q*float2(sourceWidth,sourceHeight));float2 packed=float2((floor(pixel.x*.5)+.5)/ceil(sourceWidth*.5),(pixel.y+.5)/sourceHeight);
        float4 v=previous?p0.SampleLevel(samp,packed,0):c0.SampleLevel(samp,packed,0);float y=fmod(pixel.x,2)<.5?v.g:v.a;
        float a=inputHasAlpha>.5?(previous?p1.SampleLevel(samp,q,0).r:c1.SampleLevel(samp,q,0).r):1;return float4(y,v.r,v.b,a);}
      if(inputMode<2.5){float y=previous?p0.SampleLevel(samp,q,0).r:c0.SampleLevel(samp,q,0).r;float2 uv=previous?p1.SampleLevel(samp,q,0).rg:c1.SampleLevel(samp,q,0).rg;
        float a=inputHasAlpha>.5?(previous?p2.SampleLevel(samp,q,0).r:c2.SampleLevel(samp,q,0).r):1;return float4(y,uv,a);}
      float y=previous?p0.SampleLevel(samp,q,0).r:c0.SampleLevel(samp,q,0).r;float u=previous?p1.SampleLevel(samp,q,0).r:c1.SampleLevel(samp,q,0).r;
      float v=previous?p2.SampleLevel(samp,q,0).r:c2.SampleLevel(samp,q,0).r;return float4(y,u,v,1);
    }
    float4 sourcePixel(float2 q){float4 current=rawPixel(q,false);if(interlaced<.5)return current;float lineIndex=floor(q.y*sourceHeight);
      if(fmod(lineIndex,2)==fieldParity)return current;float2 dy=float2(0,1/sourceHeight);float4 bob=.5*(rawPixel(saturate(q-dy),false)+rawPixel(saturate(q+dy),false));
      float4 previous=rawPixel(q,true);float motion=step(.035,length(current.rgb-previous.rgb));return lerp(previous,bob,motion);}
    float3 yuv(float3 v){float l=sourceLimited>.5?1.164383*(v.x-16.0/255.0):v.x;float cb=v.y-.5;float cr=v.z-.5;
      if(matrixMode>.5)return sourceLimited>.5?float3(l+1.67867*cr,l-.187326*cb-.650424*cr,l+2.14177*cb):
        float3(l+1.4746*cr,l-.164553*cb-.571353*cr,l+1.8814*cb);
      return sourceLimited>.5?float3(l+1.792741*cr,l-.213249*cb-.532909*cr,l+2.112402*cb):
        float3(l+1.5748*cr,l-.187324*cb-.468124*cr,l+1.8556*cb);}
    float3 decodeRange(float3 v){return sourceLimited>.5?saturate((v-16.0/255.0)/(219.0/255.0)):v;}
    float3 encodeRange(float3 v){return outputLimited>.5?v*(219.0/255.0)+16.0/255.0:v;}
    float3 primaries(float3 v){if(abs(primariesMode)<.5)return v;float3 l=pow(max(v,0),2.4);
      float3x3 a=float3x3(.6274,.3293,.0433,.0691,.9195,.0114,.0164,.088,.8956);
      float3x3 b=float3x3(1.6605,-.5876,-.0728,-.1246,1.1329,-.0083,-.0182,-.1006,1.1187);
      l=mul(primariesMode>0?a:b,l);return pow(saturate(l),1.0/2.4);}
    float4 main(float4 pos:SV_POSITION,float2 uv:TEXCOORD0):SV_TARGET {float2 q=uv;
      if(scalingMode<.5){if(outputAspect>sourceAspect){float c=sourceAspect/outputAspect;if(abs(uv.x-.5)>c*.5)return 0;q.x=(uv.x-(1-c)*.5)/c;}
        else{float c=outputAspect/sourceAspect;if(abs(uv.y-.5)>c*.5)return 0;q.y=(uv.y-(1-c)*.5)/c;}}
      else if(scalingMode<1.5){if(outputAspect>sourceAspect)q.y=(uv.y-.5)*(sourceAspect/outputAspect)+.5;else q.x=(uv.x-.5)*(outputAspect/sourceAspect)+.5;}
      else if(scalingMode>2.5)q=crop.xy+uv*crop.zw;float4 v=sourcePixel(q);float a=saturate(v.a*alphaGain);if(invertAlpha>.5)a=1-a;
      if(outputKind>.5)return a.xxxx;float3 rgb=inputMode>.5?yuv(v.rgb):decodeRange(v.rgb);return float4(encodeRange(primaries(rgb)),1);})";

  ID3DBlob* vertex_blob = nullptr;
  ID3DBlob* pixel_blob = nullptr;
  if (!CompileShader(vertex_source, "vs_5_0", &vertex_blob, reason) ||
      !CompileShader(pixel_source, "ps_5_0", &pixel_blob, reason) ||
      FAILED(g_device->CreateVertexShader(vertex_blob->GetBufferPointer(), vertex_blob->GetBufferSize(), nullptr, &g_vertex_shader)) ||
      FAILED(g_device->CreatePixelShader(pixel_blob->GetBufferPointer(), pixel_blob->GetBufferSize(), nullptr, &g_pixel_shader))) {
    Release(vertex_blob);
    Release(pixel_blob);
    ReleaseDeviceResources();
    return false;
  }
  Release(vertex_blob);
  Release(pixel_blob);
  D3D11_SAMPLER_DESC sampler{};
  sampler.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sampler.AddressU = sampler.AddressV = sampler.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  D3D11_BUFFER_DESC buffer{};
  buffer.ByteWidth = sizeof(ShaderConstants);
  buffer.Usage = D3D11_USAGE_DEFAULT;
  buffer.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
  if (FAILED(g_device->CreateSamplerState(&sampler, &g_sampler)) ||
      FAILED(g_device->CreateBuffer(&buffer, nullptr, &g_constants))) {
    reason = "D3D shader resources could not be created.";
    ReleaseDeviceResources();
    return false;
  }
  WNDCLASSW window_class{};
  window_class.lpfnWndProc = ChildWindowProc;
  window_class.hInstance = GetModuleHandleW(nullptr);
  window_class.lpszClassName = L"NDIAlphaSplitterGpuOutputV112";
  RegisterClassW(&window_class);
  g_available = true;
  g_status.available = true;
  g_stop_thread = false;
  g_present_thread = std::thread(PresentationLoop);
  reason = "D3D11 presenter initialized on " + g_status.adapter_name + ".";
  return true;
}

void GpuPresenterShutdown() {
  {
    std::lock_guard<std::mutex> queue_lock(g_queue_mutex);
    g_stop_thread = true;
    g_work_ready.notify_all();
  }
  if (g_present_thread.joinable()) g_present_thread.join();
  {
    std::lock_guard<std::mutex> queue_lock(g_queue_mutex);
    ClearPacket(g_pending, false);
  }
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  ReleaseDeviceResources();
  g_frame_samples.clear();
}

bool GpuPresenterRecover(std::string& reason) {
  GpuPresenterShutdown();
  return GpuPresenterInitialize(reason);
}

bool GpuPresenterAttach(const char* kind, const void* native_handle, size_t handle_size, std::string& reason) {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  if (!g_available || handle_size < sizeof(HWND)) {
    reason = "GPU presenter is unavailable.";
    return false;
  }
  HWND parent = nullptr;
  std::memcpy(&parent, native_handle, sizeof(HWND));
  if (!IsWindow(parent)) {
    reason = "Invalid Electron output HWND.";
    return false;
  }
  OutputSurface& output = std::strcmp(kind, "alpha") == 0 ? g_alpha : g_rgb;
  DestroySurface(output);
  output.parent = parent;
  output.alpha = std::strcmp(kind, "alpha") == 0;
  output.child = CreateWindowExW(0, L"NDIAlphaSplitterGpuOutputV112", L"", WS_CHILD | WS_VISIBLE,
      0, 0, 1, 1, parent, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!output.child) {
    reason = "GPU child window creation failed.";
    return false;
  }
  DXGI_SWAP_CHAIN_DESC1 desc{};
  desc.Width = 1;
  desc.Height = 1;
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.SampleDesc.Count = 1;
  desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  desc.BufferCount = 2;
  desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
  desc.Flags = DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT;
  if (FAILED(g_factory->CreateSwapChainForHwnd(g_device, output.child, &desc, nullptr, nullptr, &output.swap_chain))) {
    reason = "GPU swap-chain creation failed.";
    DestroySurface(output);
    return false;
  }
  IDXGISwapChain2* swap_chain2 = nullptr;
  if (SUCCEEDED(output.swap_chain->QueryInterface(__uuidof(IDXGISwapChain2), reinterpret_cast<void**>(&swap_chain2)))) {
    swap_chain2->SetMaximumFrameLatency(1);
    output.frame_latency_waitable = swap_chain2->GetFrameLatencyWaitableObject();
    Release(swap_chain2);
  }
  const bool resized = ResizeSurface(output, reason);
  g_status.rgb_attached = g_rgb.swap_chain != nullptr;
  g_status.alpha_attached = g_alpha.swap_chain != nullptr;
  return resized;
}

void GpuPresenterDetach(const char* kind) {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  DestroySurface(std::strcmp(kind, "alpha") == 0 ? g_alpha : g_rgb);
  g_status.rgb_attached = g_rgb.swap_chain != nullptr;
  g_status.alpha_attached = g_alpha.swap_chain != nullptr;
}

bool GpuPresenterResize(const char* kind, std::string& reason) {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  OutputSurface& output = std::strcmp(kind, "alpha") == 0 ? g_alpha : g_rgb;
  return !output.swap_chain || ResizeSurface(output, reason);
}

void GpuPresenterConfigure(const GpuPresenterConfig& config) {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  g_config = config;
}

bool GpuPresenterSubmitFrame(const GpuFrameDesc& frame, std::string& reason) {
  if (!frame.width || !frame.height || !frame.plane_count || frame.plane_count > 4) {
    reason = "Invalid GPU frame description.";
    return false;
  }
  std::lock_guard<std::mutex> queue_lock(g_queue_mutex);
  if (!g_available) {
    reason = "GPU presenter is unavailable.";
    return false;
  }
  if (g_pending.valid) ++g_status.overwritten_frames;
  ClearPacket(g_pending);
  g_pending.format = frame.format;
  g_pending.width = frame.width;
  g_pending.height = frame.height;
  g_pending.plane_count = frame.plane_count;
  g_pending.has_alpha = frame.has_alpha;
  g_pending.interlaced = frame.interlaced;
  g_pending.field_order = frame.field_order;
  g_pending.timecode = frame.timecode;
  g_pending.timestamp = frame.timestamp;
  for (uint32_t index = 0; index < frame.plane_count; ++index) {
    const auto& source = frame.planes[index];
    if (!source.data || !source.width || !source.height || !source.bytes_per_pixel || source.stride == 0) {
      ClearPacket(g_pending);
      reason = "Invalid GPU frame plane.";
      return false;
    }
    const uint32_t row_bytes = source.width * source.bytes_per_pixel;
    if (static_cast<uint32_t>(std::abs(source.stride)) < row_bytes) {
      ClearPacket(g_pending);
      reason = "GPU frame plane stride is too small.";
      return false;
    }
    auto& destination = g_pending.planes[index];
    destination.resize(static_cast<size_t>(row_bytes) * source.height);
    for (uint32_t row = 0; row < source.height; ++row) {
      std::memcpy(destination.data() + static_cast<size_t>(row) * row_bytes,
                  source.data + static_cast<ptrdiff_t>(row) * source.stride, row_bytes);
    }
    g_pending.plane_width[index] = source.width;
    g_pending.plane_height[index] = source.height;
    g_pending.bytes_per_pixel[index] = source.bytes_per_pixel;
  }
  g_pending.valid = true;
  ++g_status.received_frames;
  g_work_ready.notify_one();
  return true;
}

bool GpuPresenterSubmitRgba(const uint8_t* rgba, uint32_t width, uint32_t height, std::string& reason) {
  GpuFrameDesc frame;
  frame.format = GpuPixelFormat::rgba;
  frame.width = width;
  frame.height = height;
  frame.plane_count = 1;
  frame.has_alpha = true;
  frame.planes[0] = {rgba, static_cast<int32_t>(width * 4), width, height, 4};
  return GpuPresenterSubmitFrame(frame, reason);
}

bool GpuPresenterSubmitP216(const uint8_t* data, uint32_t width, uint32_t height, uint32_t stride,
                            bool has_alpha, std::string& reason) {
  GpuFrameDesc frame;
  frame.format = has_alpha ? GpuPixelFormat::pa16 : GpuPixelFormat::p216;
  frame.width = width;
  frame.height = height;
  frame.plane_count = has_alpha ? 3 : 2;
  frame.has_alpha = has_alpha;
  frame.planes[0] = {data, static_cast<int32_t>(stride), width, height, 2};
  frame.planes[1] = {data + static_cast<size_t>(stride) * height, static_cast<int32_t>(stride),
                     (width + 1) / 2, height, 4};
  if (has_alpha) {
    frame.planes[2] = {data + static_cast<size_t>(stride) * height * 2, static_cast<int32_t>(width * 2),
                       width, height, 2};
  }
  return GpuPresenterSubmitFrame(frame, reason);
}

bool GpuPresenterSubmitSharedTexture(const void* bytes, size_t size, std::string& reason) {
  if (!bytes || size < sizeof(HANDLE)) {
    reason = "Invalid Windows shared texture handle.";
    return false;
  }
  ID3D11Texture2D* texture = nullptr;
  {
    std::lock_guard<std::mutex> render_lock(g_render_mutex);
    if (!g_available || !g_device1) {
      reason = "D3D11.1 shared texture import is unavailable.";
      return false;
    }
    HANDLE handle = nullptr;
    std::memcpy(&handle, bytes, sizeof(HANDLE));
    if (FAILED(g_device1->OpenSharedResource1(handle, __uuidof(ID3D11Texture2D),
        reinterpret_cast<void**>(&texture))) || !texture) {
      reason = "Electron shared texture import failed on the selected GPU adapter.";
      return false;
    }
  }
  std::lock_guard<std::mutex> queue_lock(g_queue_mutex);
  if (g_pending.valid) ++g_status.overwritten_frames;
  ClearPacket(g_pending);
  g_pending.shared_texture = texture;
  g_pending.valid = true;
  ++g_status.received_frames;
  g_work_ready.notify_one();
  return true;
}

bool GpuPresenterIsAvailable() {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  return g_available;
}

bool GpuPresenterHasOutputs() {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  return g_rgb.swap_chain || g_alpha.swap_chain;
}

GpuPresenterStatus GpuPresenterGetStatus() {
  std::lock_guard<std::mutex> render_lock(g_render_mutex);
  std::lock_guard<std::mutex> queue_lock(g_queue_mutex);
  GpuPresenterStatus status = g_status;
  status.available = g_available;
  status.rgb_attached = g_rgb.swap_chain != nullptr;
  status.alpha_attached = g_alpha.swap_chain != nullptr;
  status.queue_depth = g_pending.valid ? 1u : 0u;
  return status;
}

#else

bool GpuPresenterInitialize(std::string& reason) { reason = "Metal presenter is not implemented in v1.2.0; compatibility backend is active."; return false; }
void GpuPresenterShutdown() {}
bool GpuPresenterRecover(std::string& reason) { reason = "Metal presenter is not available on this platform."; return false; }
void GpuPresenterSetAdapterPreference(const std::string&, const std::string&) {}
std::vector<GpuAdapterInfo> GpuPresenterGetAdapters() { return {}; }
bool GpuPresenterAttach(const char*, const void*, size_t, std::string& reason) { reason = "GPU presenter is not available on this platform."; return false; }
void GpuPresenterDetach(const char*) {}
bool GpuPresenterResize(const char*, std::string& reason) { reason = "GPU presenter is not available on this platform."; return false; }
void GpuPresenterConfigure(const GpuPresenterConfig&) {}
bool GpuPresenterSubmitFrame(const GpuFrameDesc&, std::string& reason) { reason = "GPU presenter is not available on this platform."; return false; }
bool GpuPresenterSubmitRgba(const uint8_t*, uint32_t, uint32_t, std::string& reason) { reason = "GPU presenter is not available on this platform."; return false; }
bool GpuPresenterSubmitP216(const uint8_t*, uint32_t, uint32_t, uint32_t, bool, std::string& reason) { reason = "GPU presenter is not available on this platform."; return false; }
bool GpuPresenterSubmitSharedTexture(const void*, size_t, std::string& reason) { reason = "GPU presenter is not available on this platform."; return false; }
bool GpuPresenterIsAvailable() { return false; }
bool GpuPresenterHasOutputs() { return false; }
GpuPresenterStatus GpuPresenterGetStatus() { GpuPresenterStatus status; status.last_error = "Compatibility backend active; macOS GPU validation is pending."; return status; }

#endif
