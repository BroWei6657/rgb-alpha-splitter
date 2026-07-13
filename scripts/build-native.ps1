$ErrorActionPreference = "Stop"

$nodeGyp = "C:\Program Files\nodejs\node_modules\npm\node_modules\node-gyp\bin\node-gyp.js"
if (-not (Test-Path $nodeGyp)) {
  throw "node-gyp was not found in the Node.js installation."
}

$devDir = Join-Path $PSScriptRoot "..\.electron-gyp"
node $nodeGyp rebuild --target=37.10.3 --arch=x64 --dist-url=https://electronjs.org/headers --devdir=$devDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Copy-Item -Force "build\Release\ndi-node.node" "native\ndi-node.node"
Write-Host "Built native\ndi-node.node"
