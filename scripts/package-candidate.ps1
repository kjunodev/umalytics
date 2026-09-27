param(
  [string]$Version = '0.5.0',
  [string]$Candidate = 'rc.3'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$extensionRoot = Join-Path $repoRoot 'apps/extension/.output'
$versionName = "$Version-$Candidate"
$outputRoot = Join-Path $repoRoot "downloads/$Version/$Candidate"
$families = @(
  @{ Name = 'chromium'; Folder = 'chrome-mv3' },
  @{ Name = 'firefox'; Folder = 'firefox-mv3' }
)
$targets = foreach ($family in $families) {
  $source = Join-Path $extensionRoot $family.Folder
  $manifestPath = Join-Path $source 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Missing manifest: $manifestPath" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'UmaLytics' -or $manifest.version -ne $Version) { throw "Manifest identity mismatch: $manifestPath" }
  if ($family.Name -eq 'chromium' -and $manifest.version_name -ne $versionName) { throw "Version name mismatch: $manifestPath" }
  if ($family.Name -eq 'firefox' -and $manifest.browser_specific_settings.gecko.id -ne 'umalytics@kjunodev') { throw "Firefox ID mismatch: $manifestPath" }
  [pscustomobject]@{
    Family = $family.Name
    Source = $source
    Zip = Join-Path $outputRoot "umalytics-$($family.Name)-$versionName.zip"
  }
}
$sumsPath = Join-Path $outputRoot 'SHA256SUMS.txt'
foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target.Zip) { throw "Refusing to overwrite: $($target.Zip)" }
}
if (Test-Path -LiteralPath $sumsPath) { throw "Refusing to overwrite: $sumsPath" }

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$sums = @()
foreach ($target in $targets) {
  [System.IO.Compression.ZipFile]::CreateFromDirectory($target.Source, $target.Zip)
  $sourceFiles = Get-ChildItem -LiteralPath $target.Source -File -Recurse -Force
  $archive = [System.IO.Compression.ZipFile]::OpenRead($target.Zip)
  try {
    $entries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    if ($entries.Count -ne $sourceFiles.Count) { throw "File count mismatch: $($target.Zip)" }
    if (-not ($entries | Where-Object FullName -EQ 'manifest.json')) { throw "Root manifest missing: $($target.Zip)" }
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($entry in $entries) {
      if (-not $seen.Add($entry.FullName)) { throw "Duplicate archive entry: $($entry.FullName)" }
      $sourceFile = Join-Path $target.Source ($entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar))
      if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Unexpected archive entry: $($entry.FullName)" }
      $expected = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
      $stream = $entry.Open()
      try {
        $hash = [System.Security.Cryptography.SHA256]::HashData($stream)
        $actual = [Convert]::ToHexString($hash)
      } finally { $stream.Dispose() }
      if ($actual -ne $expected) { throw "File hash mismatch: $($entry.FullName)" }
    }
  } finally { $archive.Dispose() }
  $zipHash = (Get-FileHash -LiteralPath $target.Zip -Algorithm SHA256).Hash.ToLowerInvariant()
  $sums += "$zipHash  $([IO.Path]::GetFileName($target.Zip))"
  Write-Output "$($target.Family): $($sourceFiles.Count) files, SHA-256 $zipHash"
}
[IO.File]::WriteAllText($sumsPath, ($sums -join "`n") + "`n")
Write-Output "Checksums: $sumsPath"
