{
  "variables": {
    "ndi_sdk_dir%": "<!(node -p \"process.env.NDI_SDK_DIR || (process.platform === 'win32' ? 'C:/Program Files/NDI/NDI 6 SDK' : '/Library/NDI SDK for Apple')\")"
  },
  "targets": [
    {
      "target_name": "ndi-node",
      "sources": [ "native/ndi_addon.cpp", "native/gpu_presenter_v112.cpp" ],
      "defines": [ "NAPI_VERSION=9" ],
      "conditions": [
        ["OS=='win'", {
          "include_dirs": [ "<(ndi_sdk_dir)/Include" ],
          "libraries": [ "<(ndi_sdk_dir)/Lib/x64/Processing.NDI.Lib.x64.lib", "d3d11.lib", "dxgi.lib", "d3dcompiler.lib", "avrt.lib" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [ "/std:c++17", "/utf-8" ],
              "ExceptionHandling": 1
            }
          }
        }],
        ["OS=='mac'", {
          "include_dirs": [ "<(ndi_sdk_dir)/include" ],
          "libraries": [ "<(ndi_sdk_dir)/lib/macOS/libndi.dylib" ],
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "LD_RUNPATH_SEARCH_PATHS": [
              "@loader_path",
              "/Library/NDI SDK for Apple/lib/macOS",
              "/usr/local/lib",
              "/opt/homebrew/lib"
            ]
          }
        }]
      ]
    }
  ]
}
