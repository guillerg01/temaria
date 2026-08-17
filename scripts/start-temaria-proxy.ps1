$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue

# Render requires modern HTTPS. Windows PowerShell may otherwise negotiate an
# obsolete protocol and fail with "Could not create SSL/TLS secure channel".
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  throw "No se pudo activar TLS 1.2 en esta version de Windows PowerShell. Actualiza PowerShell o Windows y vuelve a ejecutar el lanzador."
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$GatewayScriptPath = Join-Path $PSScriptRoot "agentrouter-local-gateway.mjs"
$BootstrapPath = Join-Path $ProjectRoot "bootstrap.json"
if (-not (Test-Path $GatewayScriptPath)) {
  $GatewayScriptPath = Join-Path $ProjectRoot "scripts\agentrouter-local-gateway.mjs"
}
if (-not (Test-Path $GatewayScriptPath)) {
  throw "Falta agentrouter-local-gateway.mjs junto al lanzador. Vuelve a copiar el paquete completo."
}
$StateRoot = Join-Path $env:LOCALAPPDATA "TemariaProxy"
$ConfigPath = Join-Path $StateRoot "config.json"
$RuntimeRoot = Join-Path $StateRoot "runtime"
$GatewayEnvPath = Join-Path $RuntimeRoot "gateway.env"
$NodeLog = Join-Path $RuntimeRoot "gateway.log"
$NodeErrorLog = Join-Path $RuntimeRoot "gateway-error.log"
$NgrokLog = Join-Path $RuntimeRoot "ngrok.log"
$NgrokErrorLog = Join-Path $RuntimeRoot "ngrok-error.log"
$RenderServiceDefault = "srv-d9ui25u417fc7388thvg"
$GatewayPort = 4317
$gateway = $null
$ngrok = $null

New-Item -ItemType Directory -Force -Path $StateRoot, $RuntimeRoot | Out-Null

function Get-PlainSecret([string]$Encrypted) {
  if ([string]::IsNullOrWhiteSpace($Encrypted)) { return "" }
  $bytes = [Convert]::FromBase64String($Encrypted)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  return [Text.Encoding]::UTF8.GetString($plain)
}

function Protect-Secret([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  return [Convert]::ToBase64String($protected)
}

function Read-SecretValue([string]$Prompt, [string]$Existing = "") {
  if (-not [string]::IsNullOrWhiteSpace($Existing)) { return $Existing }
  $value = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-DotEnvValue([string]$Name) {
  $path = Join-Path $ProjectRoot ".env"
  if (-not (Test-Path $path)) { return "" }
  $line = Get-Content $path | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
  if (-not $line) { return "" }
  return (($line -split "=", 2)[1]).Trim().Trim('"').Trim("'")
}

function Save-Config($Config) {
  $Config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  try { icacls.exe $ConfigPath /inheritance:r /grant:r "${identity}:(R,W)" | Out-Null } catch { }
}

if (-not (Test-Path $ConfigPath) -and (Test-Path $BootstrapPath)) {
  $bootstrap = Get-Content -Raw $BootstrapPath | ConvertFrom-Json
  $config = [pscustomobject]@{
    renderServiceId = [string]$bootstrap.renderServiceId
    renderApiKey = Protect-Secret ([string]$bootstrap.renderApiKey)
    agentRouterApiKey = Protect-Secret ([string]$bootstrap.agentRouterApiKey)
    gatewaySecret = Protect-Secret ([string]$bootstrap.gatewaySecret)
    lastNgrokUrl = ""
  }
  Save-Config $config
  Remove-Item -LiteralPath $BootstrapPath -Force -ErrorAction SilentlyContinue
  Write-Host "Credenciales preconfiguradas importadas y cifradas para este usuario." -ForegroundColor Green
} elseif (Test-Path $ConfigPath) {
  $config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
} else {
  $config = [pscustomobject]@{
    renderServiceId = $RenderServiceDefault
    renderApiKey = ""
    agentRouterApiKey = ""
    gatewaySecret = ""
    lastNgrokUrl = ""
  }
}

$renderApiKey = Get-PlainSecret ([string]$config.renderApiKey)
$upstreamApiKey = Get-PlainSecret ([string]$config.agentRouterApiKey)
if ([string]::IsNullOrWhiteSpace($upstreamApiKey)) { $upstreamApiKey = Get-DotEnvValue "AGENTROUTER_API_KEY" }
$gatewaySecret = Get-PlainSecret ([string]$config.gatewaySecret)

if ([string]::IsNullOrWhiteSpace($upstreamApiKey)) {
  $upstreamApiKey = Read-SecretValue "Clave AGENTROUTER_API_KEY (se guarda cifrada solo en esta PC)"
}
if ([string]::IsNullOrWhiteSpace($renderApiKey)) {
  $renderApiKey = Read-SecretValue "API key de Render (se guarda cifrada solo en esta PC)"
}
if ([string]::IsNullOrWhiteSpace($gatewaySecret)) {
  $gatewaySecret = [Convert]::ToBase64String([byte[]](1..48 | ForEach-Object { Get-Random -Maximum 256 }))
}

$serviceId = [string]$config.renderServiceId
if ([string]::IsNullOrWhiteSpace($serviceId)) { $serviceId = Read-Host "ID del servicio Render [$RenderServiceDefault]" }
if ([string]::IsNullOrWhiteSpace($serviceId)) { $serviceId = $RenderServiceDefault }

$config.renderServiceId = $serviceId
$config.renderApiKey = Protect-Secret $renderApiKey
$config.agentRouterApiKey = Protect-Secret $upstreamApiKey
$config.gatewaySecret = Protect-Secret $gatewaySecret
Save-Config $config

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js no esta instalado. Intentando instalar Node.js LTS con winget..." -ForegroundColor Yellow
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    winget.exe install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  }
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw "Instala Node.js LTS desde https://nodejs.org/ y vuelve a ejecutar este archivo."
  }
}
if (-not (Get-Command ngrok.exe -ErrorAction SilentlyContinue)) {
  throw "Instala ngrok y configura su token con: ngrok config add-authtoken TU_TOKEN"
}

$gatewayEnvLines = @(
  "AGENTROUTER_API_KEY=$upstreamApiKey",
  "AGENTROUTER_UPSTREAM_URL=https://agentrouter.org/v1",
  "AGENTROUTER_USER_AGENT=codex_cli_rs/0.114.0",
  "TEMARIA_GATEWAY_SECRET=$gatewaySecret",
  "TEMARIA_GATEWAY_HOST=127.0.0.1",
  "TEMARIA_GATEWAY_PORT=$GatewayPort"
)
[IO.File]::WriteAllLines($GatewayEnvPath, $gatewayEnvLines, (New-Object Text.UTF8Encoding($false)))
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
try { icacls.exe $GatewayEnvPath /inheritance:r /grant:r "${identity}:(R,W)" | Out-Null } catch { }

function Get-TunnelUrl {
  try {
    $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5
    $https = @(
      $tunnels.tunnels | Where-Object {
        $_.public_url -like "https://*" -and [string]$_.config.addr -match ":$GatewayPort/?$"
      }
    ) | Select-Object -First 1
    if ($https) { return [string]$https.public_url }
  } catch { }
  return ""
}

function Test-OwnedGateway {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$GatewayPort/health" -Headers @{ Authorization = "Bearer $gatewaySecret" } -TimeoutSec 2
    return $health.status -eq "ok" -and $health.authorized -eq $true
  } catch { return $false }
}

$portOccupied = $false
try { $portOccupied = $null -ne (Get-NetTCPConnection -LocalPort $GatewayPort -State Listen -ErrorAction Stop | Select-Object -First 1) } catch { }
if ($portOccupied) {
  if (-not (Test-OwnedGateway)) {
    throw "El puerto $GatewayPort ya esta ocupado por otro gateway. Cierra el proxy manual anterior y vuelve a ejecutar el lanzador."
  }
  Write-Host "Gateway de Temaria ya activo; se reutilizara." -ForegroundColor DarkGray
} else {
  $gateway = Start-Process -FilePath (Get-Command node.exe).Source -WorkingDirectory $ProjectRoot -ArgumentList @(
    "--env-file=`"$GatewayEnvPath`"", "`"$GatewayScriptPath`""
  ) -RedirectStandardOutput $NodeLog -RedirectStandardError $NodeErrorLog -PassThru -WindowStyle Hidden
}

$existingTunnel = Get-TunnelUrl
if ([string]::IsNullOrWhiteSpace($existingTunnel)) {
  $ngrok = Start-Process -FilePath (Get-Command ngrok.exe).Source -WorkingDirectory $ProjectRoot -ArgumentList @(
    "http", "$GatewayPort", "--log=stdout"
  ) -RedirectStandardOutput $NgrokLog -RedirectStandardError $NgrokErrorLog -PassThru -WindowStyle Hidden
} else {
  Write-Host "Tunel ngrok ya activo; se reutilizara." -ForegroundColor DarkGray
}

function Invoke-RenderApi([string]$Method, [string]$Path, $Body = $null) {
  $headers = @{ Authorization = "Bearer $renderApiKey"; Accept = "application/json" }
  $params = @{ Uri = "https://api.render.com/v1$Path"; Method = $Method; Headers = $headers; TimeoutSec = 30 }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }
  Invoke-RestMethod @params
}

function Update-RenderTunnel([string]$TunnelUrl) {
  $baseUrl = "$TunnelUrl/v1"
  $remoteBaseUrl = Invoke-RenderApi "Get" "/services/$serviceId/env-vars/AGENTROUTER_BASE_URL"
  $remoteSecret = Invoke-RenderApi "Get" "/services/$serviceId/env-vars/AGENTROUTER_API_KEY"
  $changed = $false
  Write-Host "Actualizando AGENTROUTER_BASE_URL en Render..." -ForegroundColor Cyan
  if ([string]$remoteBaseUrl.value -ne $baseUrl) {
    Invoke-RenderApi "Put" "/services/$serviceId/env-vars/AGENTROUTER_BASE_URL" @{ value = $baseUrl } | Out-Null
    $changed = $true
  }
  if ([string]$remoteSecret.value -ne $gatewaySecret) {
    Invoke-RenderApi "Put" "/services/$serviceId/env-vars/AGENTROUTER_API_KEY" @{ value = $gatewaySecret } | Out-Null
    $changed = $true
  }
  if (-not $changed) {
    Write-Host "Render ya esta conectado a este tunel; no necesita redespliegue." -ForegroundColor Green
    $config.lastNgrokUrl = $TunnelUrl
    Save-Config $config
    return
  }
  Write-Host "Solicitando redespliegue de Render..." -ForegroundColor Cyan
  Invoke-RenderApi "Post" "/services/$serviceId/deploys" @{ clearCache = "do_not_clear" } | Out-Null
  $config.lastNgrokUrl = $TunnelUrl
  Save-Config $config
  Write-Host "Listo: $baseUrl" -ForegroundColor Green
}

try {
  $ready = $false
  for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    try { $health = Invoke-RestMethod "http://127.0.0.1:$GatewayPort/health" -TimeoutSec 2; $ready = $health.status -eq "ok" } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw "El gateway local no inicio. Revisa $NodeLog" }
  $tunnel = ""
  for ($i = 0; $i -lt 30 -and [string]::IsNullOrWhiteSpace($tunnel); $i++) { $tunnel = Get-TunnelUrl; if ([string]::IsNullOrWhiteSpace($tunnel)) { Start-Sleep -Seconds 1 } }
  if ([string]::IsNullOrWhiteSpace($tunnel)) { throw "ngrok no publico un tunel. Revisa $NgrokLog y $NgrokErrorLog" }
  Update-RenderTunnel $tunnel
  Write-Host "Proxy activo. No cierres esta ventana; puedes minimizarla." -ForegroundColor Green
  while ($true) {
    Start-Sleep -Seconds 20
    if ($gateway -and $gateway.HasExited) { Write-Host "Gateway detenido; reinicia el lanzador." -ForegroundColor Red; break }
    if ($ngrok -and $ngrok.HasExited) { Write-Host "ngrok detenido; reinicia el lanzador." -ForegroundColor Red; break }
    $nextTunnel = Get-TunnelUrl
    if (-not [string]::IsNullOrWhiteSpace($nextTunnel) -and $nextTunnel -ne $tunnel) { $tunnel = $nextTunnel; Update-RenderTunnel $tunnel }
    Write-Host "$(Get-Date -Format HH:mm:ss) activo: $tunnel" -ForegroundColor DarkGray
  }
} finally {
  Remove-Item -LiteralPath $GatewayEnvPath -Force -ErrorAction SilentlyContinue
  if ($gateway -and -not $gateway.HasExited) { Stop-Process -Id $gateway.Id -Force -ErrorAction SilentlyContinue }
  if ($ngrok -and -not $ngrok.HasExited) { Stop-Process -Id $ngrok.Id -Force -ErrorAction SilentlyContinue }
}
