#include "d3d11_presenter.h"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>

namespace {

template <typename T> void Release(T*& value) { if (value) { value->Release(); value = nullptr; } }

struct OutputSurface {
  HWND parent = nullptr;
  HWND child = nullptr;
  IDXGISwapChain1* swap_chain = nullptr;
  ID3D11RenderTargetView* render_target = nullptr;
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
  float padding[3];
};

std::mutex g_mutex;
ID3D11Device* g_device = nullptr;
ID3D11Device1* g_device1 = nullptr;
ID3D11DeviceContext* g_context = nullptr;
IDXGIFactory2* g_factory = nullptr;
ID3D11VertexShader* g_vertex_shader = nullptr;
ID3D11PixelShader* g_pixel_shader = nullptr;
ID3D11SamplerState* g_sampler = nullptr;
ID3D11Buffer* g_constants = nullptr;
ID3D11Texture2D* g_upload_texture = nullptr;
ID3D11ShaderResourceView* g_upload_view = nullptr;
ID3D11Texture2D* g_y_texture = nullptr; ID3D11Texture2D* g_uv_texture = nullptr; ID3D11Texture2D* g_alpha_texture = nullptr;
ID3D11ShaderResourceView* g_y_view = nullptr; ID3D11ShaderResourceView* g_uv_view = nullptr; ID3D11ShaderResourceView* g_alpha_view = nullptr;
uint32_t g_upload_width = 0;
uint32_t g_upload_height = 0;
uint32_t g_yuv_width = 0; uint32_t g_yuv_height = 0;
OutputSurface g_rgb;
OutputSurface g_alpha;
GpuPresenterConfig g_config;
bool g_available = false;
uint64_t g_submitted_frames = 0;
uint64_t g_presentation_failures = 0;
std::condition_variable g_work_ready;
std::thread g_present_thread;
bool g_stop_thread = false;
ID3D11Texture2D* g_pending_shared_texture = nullptr;
ID3D11Texture2D* g_current_shared_texture = nullptr;
ID3D11ShaderResourceView* g_current_shared_view = nullptr;
std::vector<uint8_t> g_pending_rgba;
uint32_t g_pending_width = 0;
uint32_t g_pending_height = 0;
std::vector<uint16_t> g_pending_y; std::vector<uint16_t> g_pending_uv; std::vector<uint16_t> g_pending_alpha;
bool g_pending_yuv = false; bool g_pending_yuv_has_alpha = false;

LRESULT CALLBACK ChildWindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  return DefWindowProcW(window, message, wparam, lparam);
}

bool CompileShader(const char* source, const char* target, ID3DBlob** blob, std::string& reason) {
  ID3DBlob* error = nullptr;
  const HRESULT result = D3DCompile(source, std::strlen(source), nullptr, nullptr, nullptr, "main", target,
      D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, blob, &error);
  if (FAILED(result)) {
    reason = error ? std::string(static_cast<const char*>(error->GetBufferPointer()), error->GetBufferSize()) : "D3D shader compilation failed.";
    Release(error);
    return false;
  }
  Release(error);
  return true;
}

void DestroySurface(OutputSurface& output) {
  Release(output.render_target);
  Release(output.swap_chain);
  if (output.child) DestroyWindow(output.child);
  output = OutputSurface{};
}

bool ResizeSurface(OutputSurface& output, std::string& reason) {
  if (!output.child || !output.swap_chain) return false;
  RECT bounds{};
  GetClientRect(output.parent, &bounds);
  const uint32_t width = std::max<LONG>(1, bounds.right - bounds.left);
  const uint32_t height = std::max<LONG>(1, bounds.bottom - bounds.top);
  SetWindowPos(output.child, HWND_TOP, 0, 0, width, height, SWP_SHOWWINDOW | SWP_NOACTIVATE);
  if (width == output.width && height == output.height && output.render_target) return true;
  Release(output.render_target);
  const HRESULT resized = output.swap_chain->ResizeBuffers(2, width, height, DXGI_FORMAT_B8G8R8A8_UNORM, 0);
  if (FAILED(resized)) { reason = "D3D swap-chain resize failed."; return false; }
  ID3D11Texture2D* back_buffer = nullptr;
  if (FAILED(output.swap_chain->GetBuffer(0, __uuidof(ID3D11Texture2D), reinterpret_cast<void**>(&back_buffer))) ||
      FAILED(g_device->CreateRenderTargetView(back_buffer, nullptr, &output.render_target))) {
    Release(back_buffer); reason = "D3D back-buffer creation failed."; return false;
  }
  Release(back_buffer);
  output.width = width;
  output.height = height;
  return true;
}

bool RenderSurface(OutputSurface& output, ID3D11ShaderResourceView* source, float source_aspect, std::string& reason,
                   bool yuv = false, bool yuv_has_alpha = false) {
  if (!output.swap_chain) return true;
  if (!output.render_target) { reason = "D3D output surface is not ready."; return false; }
  D3D11_VIEWPORT viewport{0, 0, static_cast<float>(output.width), static_cast<float>(output.height), 0, 1};
  ShaderConstants constants{};
  constants.source_aspect = source_aspect;
  constants.output_aspect = static_cast<float>(g_config.output_width) / std::max(1u, g_config.output_height);
  constants.scaling_mode = static_cast<float>(g_config.scaling_mode);
  constants.output_kind = output.alpha ? 1.0f : 0.0f;
  constants.crop[0] = g_config.crop_x; constants.crop[1] = g_config.crop_y;
  constants.crop[2] = g_config.crop_width; constants.crop[3] = g_config.crop_height;
  constants.source_limited = static_cast<float>(g_config.source_limited);
  constants.output_limited = static_cast<float>(g_config.output_limited);
  constants.primaries_mode = static_cast<float>(g_config.primaries_mode);
  constants.input_mode = yuv ? 1.0f : 0.0f;
  constants.input_has_alpha = yuv_has_alpha ? 1.0f : 0.0f;
  g_context->UpdateSubresource(g_constants, 0, nullptr, &constants, 0, 0);
  g_context->RSSetViewports(1, &viewport);
  g_context->OMSetRenderTargets(1, &output.render_target, nullptr);
  g_context->VSSetShader(g_vertex_shader, nullptr, 0);
  g_context->PSSetShader(g_pixel_shader, nullptr, 0);
  ID3D11ShaderResourceView* resources[4] = { source, yuv ? g_y_view : nullptr, yuv ? g_uv_view : nullptr, yuv && yuv_has_alpha ? g_alpha_view : nullptr };
  g_context->PSSetShaderResources(0, 4, resources);
  g_context->PSSetSamplers(0, 1, &g_sampler);
  g_context->PSSetConstantBuffers(0, 1, &g_constants);
  g_context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  g_context->Draw(3, 0);
  ID3D11ShaderResourceView* empty[4] = {};
  g_context->PSSetShaderResources(0, 4, empty);
  const HRESULT presented = output.swap_chain->Present(0, 0);
  if (FAILED(presented)) { reason = "D3D swap-chain presentation failed."; return false; }
  return true;
}

bool RenderTexture(ID3D11Texture2D* texture, std::string& reason) {
  D3D11_TEXTURE2D_DESC description{};
  texture->GetDesc(&description);
  ID3D11ShaderResourceView* view = nullptr;
  if (FAILED(g_device->CreateShaderResourceView(texture, nullptr, &view))) {
    reason = "Unable to create a shader view for the input texture.";
    return false;
  }
  const float aspect = static_cast<float>(description.Width) / std::max(1u, description.Height);
  const bool rgb_ok = RenderSurface(g_rgb, view, aspect, reason);
  const bool alpha_ok = RenderSurface(g_alpha, view, aspect, reason);
  if (rgb_ok && alpha_ok) ++g_submitted_frames; else ++g_presentation_failures;
  Release(view);
  return rgb_ok && alpha_ok;
}

bool UploadRgba(const uint8_t* rgba, uint32_t width, uint32_t height, std::string& reason) {
  if(width!=g_upload_width||height!=g_upload_height){Release(g_upload_view);Release(g_upload_texture);D3D11_TEXTURE2D_DESC d{};d.Width=width;d.Height=height;d.MipLevels=1;d.ArraySize=1;d.Format=DXGI_FORMAT_R8G8B8A8_UNORM;d.SampleDesc.Count=1;d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_SHADER_RESOURCE;if(FAILED(g_device->CreateTexture2D(&d,nullptr,&g_upload_texture))||FAILED(g_device->CreateShaderResourceView(g_upload_texture,nullptr,&g_upload_view))){reason="GPU upload texture creation failed.";return false;}g_upload_width=width;g_upload_height=height;}
  g_context->UpdateSubresource(g_upload_texture,0,nullptr,rgba,width*4,0);
  return true;
}

bool UploadP216(const std::vector<uint16_t>& y, const std::vector<uint16_t>& uv,
                         const std::vector<uint16_t>& alpha, uint32_t width, uint32_t height,
                         bool has_alpha, std::string& reason) {
  if (width != g_yuv_width || height != g_yuv_height) {
    Release(g_y_view); Release(g_uv_view); Release(g_alpha_view); Release(g_y_texture); Release(g_uv_texture); Release(g_alpha_texture);
    D3D11_TEXTURE2D_DESC d{}; d.MipLevels=1; d.ArraySize=1; d.SampleDesc.Count=1; d.Usage=D3D11_USAGE_DEFAULT; d.BindFlags=D3D11_BIND_SHADER_RESOURCE;
    d.Width=width; d.Height=height; d.Format=DXGI_FORMAT_R16_UNORM;
    if (FAILED(g_device->CreateTexture2D(&d,nullptr,&g_y_texture)) || FAILED(g_device->CreateShaderResourceView(g_y_texture,nullptr,&g_y_view))) { reason="P216 luma texture creation failed."; return false; }
    d.Width=(width+1)/2; d.Format=DXGI_FORMAT_R16G16_UNORM;
    if (FAILED(g_device->CreateTexture2D(&d,nullptr,&g_uv_texture)) || FAILED(g_device->CreateShaderResourceView(g_uv_texture,nullptr,&g_uv_view))) { reason="P216 chroma texture creation failed."; return false; }
    d.Width=width; d.Format=DXGI_FORMAT_R16_UNORM;
    if (FAILED(g_device->CreateTexture2D(&d,nullptr,&g_alpha_texture)) || FAILED(g_device->CreateShaderResourceView(g_alpha_texture,nullptr,&g_alpha_view))) { reason="PA16 alpha texture creation failed."; return false; }
    g_yuv_width=width; g_yuv_height=height;
  }
  g_context->UpdateSubresource(g_y_texture,0,nullptr,y.data(),width*2,0);
  g_context->UpdateSubresource(g_uv_texture,0,nullptr,uv.data(),width*2,0);
  if(has_alpha&&!alpha.empty())g_context->UpdateSubresource(g_alpha_texture,0,nullptr,alpha.data(),width*2,0);
  return true;
}

void PresentationLoop() {
  std::unique_lock<std::mutex> lock(g_mutex);
  auto next_present = std::chrono::steady_clock::now();
  int current_mode = 0;
  bool current_yuv_alpha = false;
  float current_aspect = 16.0f / 9.0f;
  while (!g_stop_thread) {
    const auto has_pending = [] { return g_stop_thread || g_pending_shared_texture || !g_pending_rgba.empty() || g_pending_yuv; };
    if (current_mode == 0) g_work_ready.wait(lock, has_pending);
    else g_work_ready.wait_until(lock, next_present, has_pending);
    if (g_stop_thread) break;
    ID3D11Texture2D* shared = g_pending_shared_texture; g_pending_shared_texture = nullptr;
    std::vector<uint8_t> rgba; rgba.swap(g_pending_rgba);
    const uint32_t width = g_pending_width, height = g_pending_height;
    std::vector<uint16_t> y; y.swap(g_pending_y); std::vector<uint16_t> uv; uv.swap(g_pending_uv); std::vector<uint16_t> alpha; alpha.swap(g_pending_alpha);
    const bool yuv_pending=g_pending_yuv, yuv_alpha=g_pending_yuv_has_alpha; g_pending_yuv=false;
    std::string reason;
    if (shared) {
      Release(g_current_shared_view); Release(g_current_shared_texture); g_current_shared_texture=shared;
      D3D11_TEXTURE2D_DESC description{}; shared->GetDesc(&description); current_aspect=static_cast<float>(description.Width)/std::max(1u,description.Height);
      if (SUCCEEDED(g_device->CreateShaderResourceView(shared,nullptr,&g_current_shared_view))) current_mode=3;
      else { ++g_presentation_failures; current_mode=0; }
    } else if (yuv_pending) {
      Release(g_current_shared_view); Release(g_current_shared_texture);
      if (UploadP216(y,uv,alpha,width,height,yuv_alpha,reason)) { current_mode=2;current_yuv_alpha=yuv_alpha;current_aspect=static_cast<float>(width)/height; }
      else ++g_presentation_failures;
    } else if (!rgba.empty()) {
      Release(g_current_shared_view); Release(g_current_shared_texture);
      if (UploadRgba(rgba.data(),width,height,reason)) { current_mode=1;current_aspect=static_cast<float>(width)/height; }
      else ++g_presentation_failures;
    }
    const auto now = std::chrono::steady_clock::now();
    if (current_mode == 0 || now < next_present) continue;
    bool rgb_ok=false,alpha_ok=false;
    if(current_mode==1){rgb_ok=RenderSurface(g_rgb,g_upload_view,current_aspect,reason);alpha_ok=RenderSurface(g_alpha,g_upload_view,current_aspect,reason);}
    else if(current_mode==2){rgb_ok=RenderSurface(g_rgb,nullptr,current_aspect,reason,true,current_yuv_alpha);alpha_ok=RenderSurface(g_alpha,nullptr,current_aspect,reason,true,current_yuv_alpha);}
    else {rgb_ok=RenderSurface(g_rgb,g_current_shared_view,current_aspect,reason);alpha_ok=RenderSurface(g_alpha,g_current_shared_view,current_aspect,reason);}
    if(rgb_ok&&alpha_ok)++g_submitted_frames;else++g_presentation_failures;
    const uint64_t interval_ns = 1000000000ull * std::max(1u, g_config.frame_rate_d) / std::max(1u, g_config.frame_rate_n);
    const auto interval = std::chrono::nanoseconds(interval_ns);
    next_present += interval;
    const auto after_present = std::chrono::steady_clock::now();
    if (next_present <= after_present) next_present = after_present + interval;
  }
  Release(g_pending_shared_texture);
  Release(g_current_shared_view); Release(g_current_shared_texture);
}

}  // namespace

bool GpuPresenterInitialize(std::string& reason) {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_available) return true;
  D3D_FEATURE_LEVEL level{};
  if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
      nullptr, 0, D3D11_SDK_VERSION, &g_device, &level, &g_context))) {
    reason = "D3D11 hardware device creation failed."; return false;
  }
  g_device->QueryInterface(__uuidof(ID3D11Device1), reinterpret_cast<void**>(&g_device1));
  IDXGIDevice* dxgi_device = nullptr; IDXGIAdapter* adapter = nullptr;
  if (FAILED(g_device->QueryInterface(__uuidof(IDXGIDevice), reinterpret_cast<void**>(&dxgi_device))) ||
      FAILED(dxgi_device->GetAdapter(&adapter)) ||
      FAILED(adapter->GetParent(__uuidof(IDXGIFactory2), reinterpret_cast<void**>(&g_factory)))) {
    Release(dxgi_device); Release(adapter); reason = "DXGI factory creation failed."; return false;
  }
  Release(dxgi_device); Release(adapter);
  const char* vertex_source = R"(
    struct O { float4 p:SV_POSITION; float2 uv:TEXCOORD0; };
    O main(uint id:SV_VertexID) { O o; float2 p=float2((id<<1)&2,id&2); o.uv=p; o.p=float4(p*float2(2,-2)+float2(-1,1),0,1); return o; })";
  const char* pixel_source = R"(
    Texture2D tex:register(t0); Texture2D texY:register(t1); Texture2D texUV:register(t2); Texture2D texA:register(t3); SamplerState samp:register(s0);
    cbuffer C:register(b0) { float sourceAspect,outputAspect,scalingMode,outputKind; float4 crop; float sourceLimited,outputLimited,primariesMode,inputMode; float inputHasAlpha,p0,p1,p2; };
    float3 decodeRange(float3 v){return sourceLimited>.5?saturate((v-16.0/255.0)/(219.0/255.0)):v;}
    float3 encodeRange(float3 v){return outputLimited>.5?v*(219.0/255.0)+16.0/255.0:v;}
    float3 primaries(float3 v){if(abs(primariesMode)<.5)return v; float3 l=pow(max(v,0),2.4); float3x3 a=float3x3(.6274,.3293,.0433,.0691,.9195,.0114,.0164,.088,.8956); float3x3 b=float3x3(1.6605,-.5876,-.0728,-.1246,1.1329,-.0083,-.0182,-.1006,1.1187); l=mul(primariesMode>0?a:b,l); return pow(saturate(l),1.0/2.4);}
    float4 main(float4 p:SV_POSITION,float2 uv:TEXCOORD0):SV_TARGET { float2 q=uv;
      if(scalingMode<.5){if(outputAspect>sourceAspect){float c=sourceAspect/outputAspect;if(abs(uv.x-.5)>c*.5)return 0;q.x=(uv.x-(1-c)*.5)/c;}else{float c=outputAspect/sourceAspect;if(abs(uv.y-.5)>c*.5)return 0;q.y=(uv.y-(1-c)*.5)/c;}}
      else if(scalingMode<1.5){if(outputAspect>sourceAspect)q.y=(uv.y-.5)*(sourceAspect/outputAspect)+.5;else q.x=(uv.x-.5)*(outputAspect/sourceAspect)+.5;}
      else if(scalingMode>2.5)q=crop.xy+uv*crop.zw; float4 v;
      if(inputMode>.5){float yy=texY.Sample(samp,q).r;float2 cc=texUV.Sample(samp,q).rg;float l=1.164383*(yy-16.0/255.0);float cb=cc.x-.5;float cr=cc.y-.5;v=float4(l+1.792741*cr,l-.213249*cb-.532909*cr,l+2.112402*cb,inputHasAlpha>.5?texA.Sample(samp,q).r:1);}
      else v=tex.Sample(samp,q); float a=v.a; if(outputKind>.5)return a.xxxx; float3 rgb=inputMode>.5?v.rgb:decodeRange(v.rgb); return float4(encodeRange(primaries(rgb)),1); })";
  ID3DBlob* vertex_blob = nullptr; ID3DBlob* pixel_blob = nullptr;
  if (!CompileShader(vertex_source, "vs_5_0", &vertex_blob, reason) || !CompileShader(pixel_source, "ps_5_0", &pixel_blob, reason) ||
      FAILED(g_device->CreateVertexShader(vertex_blob->GetBufferPointer(), vertex_blob->GetBufferSize(), nullptr, &g_vertex_shader)) ||
      FAILED(g_device->CreatePixelShader(pixel_blob->GetBufferPointer(), pixel_blob->GetBufferSize(), nullptr, &g_pixel_shader))) {
    Release(vertex_blob); Release(pixel_blob); return false;
  }
  Release(vertex_blob); Release(pixel_blob);
  D3D11_SAMPLER_DESC sampler{}; sampler.Filter=D3D11_FILTER_MIN_MAG_MIP_LINEAR; sampler.AddressU=sampler.AddressV=sampler.AddressW=D3D11_TEXTURE_ADDRESS_CLAMP;
  D3D11_BUFFER_DESC buffer{}; buffer.ByteWidth=sizeof(ShaderConstants); buffer.Usage=D3D11_USAGE_DEFAULT; buffer.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
  if (FAILED(g_device->CreateSamplerState(&sampler,&g_sampler)) || FAILED(g_device->CreateBuffer(&buffer,nullptr,&g_constants))) {
    reason="D3D shader resources could not be created."; return false;
  }
  WNDCLASSW window_class{}; window_class.lpfnWndProc=ChildWindowProc; window_class.hInstance=GetModuleHandleW(nullptr); window_class.lpszClassName=L"NDIAlphaSplitterGpuOutput";
  RegisterClassW(&window_class);
  g_available=true; g_stop_thread=false; g_present_thread=std::thread(PresentationLoop); return true;
}

void GpuPresenterShutdown() {
  {
    std::lock_guard<std::mutex> lock(g_mutex); g_stop_thread=true; g_work_ready.notify_all();
  }
  if(g_present_thread.joinable())g_present_thread.join();
  std::lock_guard<std::mutex> lock(g_mutex); DestroySurface(g_rgb); DestroySurface(g_alpha);
  Release(g_upload_view); Release(g_upload_texture); Release(g_current_shared_view); Release(g_current_shared_texture); Release(g_y_view); Release(g_uv_view); Release(g_alpha_view); Release(g_y_texture); Release(g_uv_texture); Release(g_alpha_texture); Release(g_constants); Release(g_sampler); Release(g_pixel_shader); Release(g_vertex_shader);
  Release(g_factory); Release(g_context); Release(g_device1); Release(g_device); g_available=false;
}

bool GpuPresenterAttach(const char* kind, const void* native_handle, size_t handle_size, std::string& reason) {
  std::lock_guard<std::mutex> lock(g_mutex); if (!g_available || handle_size < sizeof(HWND)) { reason="GPU presenter is unavailable."; return false; }
  HWND parent=nullptr; std::memcpy(&parent,native_handle,sizeof(HWND)); if (!IsWindow(parent)) { reason="Invalid Electron output HWND."; return false; }
  OutputSurface& output=std::strcmp(kind,"alpha")==0?g_alpha:g_rgb; DestroySurface(output); output.parent=parent; output.alpha=std::strcmp(kind,"alpha")==0;
  output.child=CreateWindowExW(0,L"NDIAlphaSplitterGpuOutput",L"",WS_CHILD|WS_VISIBLE,0,0,1,1,parent,nullptr,GetModuleHandleW(nullptr),nullptr);
  if(!output.child){reason="GPU child window creation failed.";return false;}
  DXGI_SWAP_CHAIN_DESC1 desc{}; desc.Width=1;desc.Height=1;desc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;desc.SampleDesc.Count=1;desc.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT;desc.BufferCount=2;desc.SwapEffect=DXGI_SWAP_EFFECT_FLIP_DISCARD;
  if(FAILED(g_factory->CreateSwapChainForHwnd(g_device,output.child,&desc,nullptr,nullptr,&output.swap_chain))){reason="GPU swap-chain creation failed.";DestroySurface(output);return false;}
  return ResizeSurface(output,reason);
}

void GpuPresenterDetach(const char* kind){std::lock_guard<std::mutex> lock(g_mutex);DestroySurface(std::strcmp(kind,"alpha")==0?g_alpha:g_rgb);}
bool GpuPresenterResize(const char* kind,std::string& reason){std::lock_guard<std::mutex> lock(g_mutex);OutputSurface& output=std::strcmp(kind,"alpha")==0?g_alpha:g_rgb;return !output.swap_chain||ResizeSurface(output,reason);}
void GpuPresenterConfigure(const GpuPresenterConfig& config){std::lock_guard<std::mutex> lock(g_mutex);g_config=config;}

bool GpuPresenterSubmitRgba(const uint8_t* rgba,uint32_t width,uint32_t height,std::string& reason){
  std::lock_guard<std::mutex> lock(g_mutex);if(!g_available||!rgba)return false;
  g_pending_rgba.assign(rgba,rgba+static_cast<size_t>(width)*height*4);g_pending_width=width;g_pending_height=height;g_pending_yuv=false;Release(g_pending_shared_texture);g_work_ready.notify_one();return true;
}

bool GpuPresenterSubmitP216(const uint8_t* data,uint32_t width,uint32_t height,uint32_t stride,bool has_alpha,std::string& reason){
  std::lock_guard<std::mutex> lock(g_mutex);if(!g_available||!data||stride<width*2){reason="Invalid P216 frame.";return false;}g_pending_y.resize(static_cast<size_t>(width)*height);g_pending_uv.resize(static_cast<size_t>(width)*height);if(has_alpha)g_pending_alpha.resize(static_cast<size_t>(width)*height);else g_pending_alpha.clear();
  for(uint32_t row=0;row<height;++row){std::memcpy(g_pending_y.data()+static_cast<size_t>(row)*width,data+static_cast<size_t>(row)*stride,width*2);std::memcpy(g_pending_uv.data()+static_cast<size_t>(row)*width,data+static_cast<size_t>(height+row)*stride,width*2);if(has_alpha)std::memcpy(g_pending_alpha.data()+static_cast<size_t>(row)*width,data+stride*height*2+static_cast<size_t>(row)*width*2,width*2);}g_pending_width=width;g_pending_height=height;g_pending_yuv=true;g_pending_yuv_has_alpha=has_alpha;g_pending_rgba.clear();Release(g_pending_shared_texture);g_work_ready.notify_one();return true;
}

bool GpuPresenterSubmitSharedTexture(const void* bytes,size_t size,std::string& reason){
  std::lock_guard<std::mutex> lock(g_mutex);if(!g_available||!g_device1||size<sizeof(HANDLE)){reason="D3D11.1 shared texture import is unavailable.";return false;}HANDLE handle=nullptr;std::memcpy(&handle,bytes,sizeof(HANDLE));ID3D11Texture2D* texture=nullptr;HRESULT result=g_device1->OpenSharedResource1(handle,__uuidof(ID3D11Texture2D),reinterpret_cast<void**>(&texture));if(FAILED(result)||!texture){reason="Electron shared texture import failed.";return false;}Release(g_pending_shared_texture);g_pending_shared_texture=texture;g_pending_rgba.clear();g_pending_yuv=false;g_work_ready.notify_one();return true;
}
bool GpuPresenterIsAvailable(){return g_available;}
GpuPresenterStatus GpuPresenterGetStatus(){std::lock_guard<std::mutex> lock(g_mutex);return {g_available,g_rgb.swap_chain!=nullptr,g_alpha.swap_chain!=nullptr,g_submitted_frames,g_presentation_failures};}

#else
bool GpuPresenterInitialize(std::string& reason){reason="Metal presenter is not implemented in v1.1.1.";return false;}
void GpuPresenterShutdown(){}
bool GpuPresenterAttach(const char*,const void*,size_t,std::string& reason){reason="GPU presenter is not available on this platform.";return false;}
void GpuPresenterDetach(const char*){}
bool GpuPresenterResize(const char*,std::string&){return false;}
void GpuPresenterConfigure(const GpuPresenterConfig&){}
bool GpuPresenterSubmitRgba(const uint8_t*,uint32_t,uint32_t,std::string&){return false;}
bool GpuPresenterSubmitP216(const uint8_t*,uint32_t,uint32_t,uint32_t,bool,std::string&){return false;}
bool GpuPresenterSubmitSharedTexture(const void*,size_t,std::string&){return false;}
bool GpuPresenterIsAvailable(){return false;}
GpuPresenterStatus GpuPresenterGetStatus(){return {};}
#endif
