# 신구대조전 단독망용 로컬 웹 서버 (PowerShell만 사용, 별도 설치 불필요)
# - 이 PC 안(127.0.0.1)에서만 열린다. 네트워크의 다른 PC에서는 접속할 수 없다.
# - 시스템 설정을 바꾸지 않는다. 창을 닫으면 서버가 멈춘다.
# - 같은 주소(포트)를 써야 브라우저에 저장된 작업이 이어지므로 8080을 우선 쓴다.
param([int]$Port = 8080, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot          # 패키지 폴더 (이 스크립트는 tools\ 안에 있음)
$Marker = 'singu-offline'
$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.hwpx' = 'application/octet-stream'; '.hwp' = 'application/octet-stream'
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; '.zip' = 'application/zip'
}

function Test-OurServer([int]$p) {
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$p/__singu" -UseBasicParsing -TimeoutSec 2
    return $r.Headers['X-Singu'] -eq $Marker
  } catch { return $false }
}

# 1) 포트 고르기: 이미 이 서버가 떠 있으면 브라우저만 연다
$listener = $null
foreach ($p in @($Port) + (($Port + 1)..($Port + 10))) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start(); $listener = $l; $Port = $p; break
  } catch {
    if (Test-OurServer $p) {
      Write-Host "신구대조전 서버가 이미 실행 중입니다: http://127.0.0.1:$p/"
      if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$p/" }
      exit 0
    }
  }
}
if (-not $listener) { Write-Host '사용할 수 있는 포트를 찾지 못했습니다. 다른 프로그램을 닫고 다시 실행해 주세요.'; Read-Host '엔터를 누르면 닫힙니다'; exit 1 }

$url = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Host '  신구대조전 (단독망)' -ForegroundColor Cyan
Write-Host "  주소: $url"
if ($Port -ne 8080) { Write-Host '  ※ 8080 포트를 다른 프로그램이 쓰고 있어 다른 포트로 열었습니다. 브라우저에 저장된 작업은 포트마다 따로 보관됩니다.' -ForegroundColor Yellow }
Write-Host '  이 창을 닫으면 서버가 멈춥니다. 작업 중에는 닫지 마세요.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

function Send($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [bool]$head) {
  $hdr = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nX-Singu: $Marker`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($hdr)
  $stream.Write($hb, 0, $hb.Length)
  if (-not $head -and $body.Length) { $stream.Write($body, 0, $body.Length) }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'

# 2) 요청 처리 (한 번에 하나씩, 응답 후 연결 닫음)
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
    $line = $reader.ReadLine()
    if (-not $line) { continue }
    while (($h = $reader.ReadLine()) -ne $null -and $h -ne '') { }   # 나머지 헤더는 쓰지 않음
    $parts = $line.Split(' ')
    $method = $parts[0]; $target = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
    $isHead = $method -eq 'HEAD'
    if ($method -ne 'GET' -and -not $isHead) { Send $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' $utf8.GetBytes('GET만 지원합니다.') $false; continue }

    $path = ($target.Split('?')[0]).Split('#')[0]
    $path = [System.Uri]::UnescapeDataString($path)
    if ($path -eq '/__singu') { Send $stream 200 'OK' 'text/plain; charset=utf-8' $utf8.GetBytes('ok') $isHead; continue }
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $rel = $path.TrimStart('/').Replace('/', '\')
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      Send $stream 403 'Forbidden' 'text/plain; charset=utf-8' $utf8.GetBytes('접근할 수 없는 경로입니다.') $isHead; continue
    }
    if (Test-Path -LiteralPath $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $type = if ($Mime.ContainsKey($ext)) { $Mime[$ext] } else { 'application/octet-stream' }
      Send $stream 200 'OK' $type ([System.IO.File]::ReadAllBytes($full)) $isHead
    } elseif ($path -eq '/config.js') {
      # 단독망: 온라인(Supabase) 설정이 없음 → 도구는 오프라인 모드로 동작
      Send $stream 200 'OK' 'text/javascript; charset=utf-8' $utf8.GetBytes("// 단독망 모드: 온라인 기능 없음`nwindow.SINGU_CONFIG = {};`n") $isHead
    } else {
      Send $stream 404 'Not Found' 'text/plain; charset=utf-8' $utf8.GetBytes('파일이 없습니다.') $isHead
    }
  } catch {
    # 브라우저가 연결을 먼저 끊는 경우 등은 무시
  } finally {
    $client.Close()
  }
}
