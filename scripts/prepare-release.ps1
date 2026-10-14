param(
    [Parameter(Mandatory=$true)][string]$ApkPath,
    [Parameter(Mandatory=$true)][string]$NotesPath,
    [string]$OutputDirectory,
    [string]$ReleaseDate = (Get-Date -Format 'yyyy-MM-dd')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-common.ps1')
$apk = Get-ReleaseApkInfo $ApkPath
$notesFullPath = (Resolve-Path -LiteralPath $NotesPath).Path
if ($notesFullPath -match '(?i)[\\/]\.signing[\\/]') { throw 'Signing files cannot be used as release notes.' }
$notes = [IO.File]::ReadAllText($notesFullPath, $script:ReleaseUtf8)
if ([string]::IsNullOrWhiteSpace($notes) -or $notes.Length -gt 8000 -or $script:ReleaseUtf8.GetByteCount($notes) -gt 16384) { throw 'Release notes must be nonempty, at most 8000 characters and 16 KiB.' }
$name = 'daily-study-v' + $apk.VersionName + '.apk'
$manifest = [pscustomobject][ordered]@{
    formatVersion = 1
    packageName = $apk.PackageName
    versionCode = $apk.VersionCode
    versionName = $apk.VersionName
    minSdk = $apk.MinSdk
    apkUrl = 'https://github.com/' + $script:ReleaseApkRepository + '/releases/download/v' + $apk.VersionName + '/' + $name
    apkBytes = $apk.ApkBytes
    apkSha256 = $apk.ApkSha256
    signerSha256 = $apk.SignerSha256
    releaseNotes = $notes
    releaseDate = $ReleaseDate
}
Assert-ReleaseManifest $manifest $apk $notes
if (!$OutputDirectory) { $OutputDirectory = Join-Path $script:ReleaseProject ('release\v' + $apk.VersionName) }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Output directory already exists; review it or choose a new directory. Existing releases are never overwritten.' }
if ($output -match '(?i)(^|[\\/])(\.signing|tests)([\\/]|$)') { throw 'Choose a separate public release directory.' }
New-Item -ItemType Directory -Path $output | Out-Null
Copy-Item -LiteralPath $apk.Path -Destination (Join-Path $output $name)
[IO.File]::WriteAllText((Join-Path $output 'update.json'), (($manifest | ConvertTo-Json -Depth 4) + "`n"), $script:ReleaseUtf8)
[IO.File]::WriteAllText((Join-Path $output 'RELEASE-NOTES.md'), $notes, $script:ReleaseUtf8)
$verified = Get-PreparedRelease $output
Write-Output ('Prepared: ' + $verified.Directory)
Write-Output ('APK version: ' + $apk.VersionName + ' / code ' + $apk.VersionCode)
Write-Output ('APK SHA256: ' + $apk.ApkSha256)
Write-Output ('Signer SHA256: ' + $apk.SignerSha256)
Write-Output 'Public files: APK, update.json, RELEASE-NOTES.md'
