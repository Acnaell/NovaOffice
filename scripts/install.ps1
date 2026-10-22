# Instala o CLI `nova` da NovaOffice a partir do GitHub Releases (Windows).
#
#   irm https://raw.githubusercontent.com/Acnaell/novaoffice/main/scripts/install.ps1 | iex
#
# Variaveis opcionais:
#   $env:NOVA_VERSION      tag a instalar (padrao: a versao mais recente, ex.: v0.1.0)
#   $env:NOVA_INSTALL_DIR  pasta de destino (padrao: %LOCALAPPDATA%\Programs\NovaOffice\bin)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'Acnaell/novaoffice'
$installDir = if ($env:NOVA_INSTALL_DIR) { $env:NOVA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\NovaOffice\bin' }

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64') {
    Write-Warning "Arquitetura ${arch}: usando o binario x86_64 (no Windows ARM ele roda por emulacao)."
}
$target = 'x86_64-pc-windows-msvc'
$asset = "nova-$target.zip"
$base = if ($env:NOVA_VERSION) { "https://github.com/$repo/releases/download/$($env:NOVA_VERSION)" } else { "https://github.com/$repo/releases/latest/download" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("nova-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host "Baixando $asset..."
    $zip = Join-Path $tmp $asset
    Invoke-WebRequest "$base/$asset" -OutFile $zip -UseBasicParsing
    $sumFile = Join-Path $tmp "$asset.sha256"
    Invoke-WebRequest "$base/$asset.sha256" -OutFile $sumFile -UseBasicParsing

    $expected = ((Get-Content $sumFile -Raw).Trim() -split '\s+')[0].ToLower()
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { throw 'Falha na verificacao SHA-256 do download.' }

    Expand-Archive $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Copy-Item (Join-Path $tmp "nova-$target\nova.exe") $installDir -Force
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $installDir)) {
    $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$env:Path;$installDir"
    Write-Host "Pasta adicionada ao PATH do usuario. Abra um terminal novo para usar 'nova'."
}

$exe = Join-Path $installDir 'nova.exe'
Write-Host "Instalado: $exe ($(& $exe --version))"
