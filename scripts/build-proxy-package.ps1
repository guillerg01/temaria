$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $root "release"
$packageRoot = Join-Path $releaseRoot "TemariaProxy"
$scriptsRoot = Join-Path $packageRoot "scripts"
$zipPath = Join-Path $releaseRoot "TemariaProxy-Windows.zip"

if (Test-Path $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Force -Path $scriptsRoot | Out-Null

Copy-Item -LiteralPath (Join-Path $root "start-temaria-proxy.bat") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "start-temaria-proxy.ps1") -Destination $scriptsRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "agentrouter-local-gateway.mjs") -Destination $scriptsRoot

@"
TEMARIA PROXY PARA WINDOWS

1. Instala ngrok: https://ngrok.com/download
2. En una consola ejecuta una sola vez:
   ngrok config add-authtoken TU_TOKEN
3. Haz doble clic en start-temaria-proxy.bat.
4. La primera vez introduce la API key de AgentRouter y la API key de Render.
5. Deja la ventana abierta o minimizada mientras se usa Temaria.

No hace falta instalar ni copiar el proyecto Temaria. Si Node.js no existe, el
lanzador intenta instalar Node.js LTS con winget. Las claves se guardan cifradas
para el usuario actual de Windows en %LOCALAPPDATA%\TemariaProxy\config.json.

Para cambiar las claves, elimina esa carpeta de configuracion y abre de nuevo
el lanzador. Los logs estan en %LOCALAPPDATA%\TemariaProxy\runtime.
"@ | Set-Content -LiteralPath (Join-Path $packageRoot "LEEME.txt") -Encoding UTF8

Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Paquete creado: $zipPath"
