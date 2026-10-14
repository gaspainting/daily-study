param([string]$ApkPath)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
. (Join-Path $project 'scripts\release-common.ps1')
$script:Checks = 0
function Assert([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
    $script:Checks++
}
function Assert-Reject([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert $rejected $Message
}
if (!$ApkPath) {
    [xml]$manifest = Get-Content -LiteralPath (Join-Path $project 'app\src\main\AndroidManifest.xml') -Raw -Encoding UTF8
    $version = $manifest.DocumentElement.GetAttribute('versionName','http://schemas.android.com/apk/res/android')
    $ApkPath = Join-Path $project ('dist\每日学习-v' + $version + '.apk')
}
$apk = Get-ReleaseApkInfo $ApkPath
Assert ($script:ReleaseRepository -ceq 'gaspainting/daily-study') 'Release API uses the renamed repository.'
Assert ($script:ReleaseApkRepository -ceq 'gaspainting/daily-study-releases') 'APK manifest paths remain compatible with installed clients.'
Assert ($apk.PackageName -ceq 'cn.edu.njupt.studycheckin') 'Release package must be the real app.'
Assert ($apk.SignerSha256 -ceq $script:ReleaseSigner) 'Release signer must preserve existing installations.'
$temporary = New-ReleaseTemporaryDirectory
try {
    $notes = Join-Path $temporary 'notes.md'
    [IO.File]::WriteAllText($notes, "# 本地测试更新说明`n`n仅用于发布工具离线验证。`n", $script:ReleaseUtf8)
    $prepared = Join-Path $temporary 'prepared'
    & (Join-Path $project 'scripts\prepare-release.ps1') -ApkPath $apk.Path -NotesPath $notes -OutputDirectory $prepared
    $release = Get-PreparedRelease $prepared
    Assert (@(Get-ChildItem -LiteralPath $prepared).Count -eq 3) 'Only three public files should be staged.'
    Assert ($release.Manifest.versionCode -eq $apk.VersionCode -and $release.Manifest.versionName -ceq $apk.VersionName) 'Manifest must use actual compiled metadata.'
    Assert ((Get-FileHash -LiteralPath $release.ApkPath -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $apk.ApkSha256) 'Staged APK must be unchanged.'
    Assert ($release.Manifest.releaseNotes -ceq [IO.File]::ReadAllText($notes,$script:ReleaseUtf8)) 'Markdown notes must keep Chinese and real newlines.'
    $validation = & (Join-Path $project 'scripts\publish-release.ps1') -ReleaseDirectory $prepared -ValidateOnly
    Assert (($validation -join '|') -match 'No remote requests') 'ValidateOnly must avoid network and publishing.'
    $binaryPath = Join-Path $temporary 'binary-output.bin'
    Invoke-ReleaseBinaryCommand 'node' @('-e','process.stderr.write("stream diagnostics\n");process.stdout.write(Buffer.from(Array.from({length:1024},(_,i)=>i%256)));') $binaryPath
    $binary = [IO.File]::ReadAllBytes($binaryPath)
    $binaryMatches = $binary.Length -eq 1024
    for ($i = 0; $i -lt $binary.Length; $i++) { if ($binary[$i] -ne ($i % 256)) { $binaryMatches = $false; break } }
    Assert $binaryMatches 'Binary subprocess output must preserve every byte, including NUL and invalid UTF-8.'
    $argumentPath = Join-Path $temporary 'arguments.bin'
    $specialArgument = '中文 path "quoted" slash\'
    Invoke-ReleaseBinaryCommand 'node' @('-e','process.stdout.write(Buffer.from(process.argv[1],"utf8"));',$specialArgument) $argumentPath
    Assert ([IO.File]::ReadAllText($argumentPath,$script:ReleaseUtf8) -ceq $specialArgument) 'Windows native argument quoting must preserve spaces, quotes, Unicode and a trailing backslash.'
    $failedPath = Join-Path $temporary 'failed-download.bin'
    Assert-Reject { Invoke-ReleaseBinaryCommand 'node' @('-e','process.stdout.write("partial");process.stderr.write("failed");process.exit(9);') $failedPath } 'Binary subprocess failure must be reported.'
    Assert (!(Test-Path -LiteralPath $failedPath)) 'Failed binary downloads must not leave a partial file.'
    $assetIndex = 0
    $draftAssets = @($release.ApkPath,$release.ManifestPath,$release.NotesPath | ForEach-Object {
        $assetIndex++
        [pscustomobject]@{id=$assetIndex;name=[IO.Path]::GetFileName($_);size=(Get-Item -LiteralPath $_).Length;digest=('sha256:'+(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant())}
    })
    $draft = [pscustomobject]@{id=123;draft=$true;prerelease=$false;tag_name=('v'+$apk.VersionName);assets=$draftAssets}
    Assert-ReleaseDraft $draft ('v'+$apk.VersionName) $release
    Assert $true 'An identical three-asset draft must be eligible for guarded recovery.'
    $draft.draft = $false
    Assert-Reject { Assert-ReleaseDraft $draft ('v'+$apk.VersionName) $release } 'Published releases cannot be resumed as drafts.'
    $draft.draft = $true
    $savedDigest = $draft.assets[0].digest
    $draft.assets[0].digest = 'sha256:' + ('0'*64)
    Assert-Reject { Assert-ReleaseDraft $draft ('v'+$apk.VersionName) $release } 'Draft recovery must reject a differing remote asset.'
    $draft.assets[0].digest = $savedDigest
    $draft.assets += [pscustomobject]@{id=4;name='source.zip';size=1;digest='sha256:0'}
    Assert-Reject { Assert-ReleaseDraft $draft ('v'+$apk.VersionName) $release } 'Draft recovery must reject extra remote files.'
    $draft.assets = $draftAssets
    Assert-Reject { Assert-ReleaseDraft $draft 'v0.0.0' $release } 'Draft recovery must reject a different version tag.'
    Assert-Reject { & (Join-Path $project 'scripts\prepare-release.ps1') -ApkPath $apk.Path -NotesPath $notes -OutputDirectory $prepared } 'Preparation must not overwrite existing release files.'
    $saved = [IO.File]::ReadAllText($release.ManifestPath,$script:ReleaseUtf8)
    $incorrect = $saved | ConvertFrom-Json
    $incorrect.versionCode = [string]$incorrect.versionCode
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $release.Manifest.releaseNotes } 'Quoted versionCode must be rejected.'
    $incorrect = $saved | ConvertFrom-Json
    $incorrect.apkUrl = 'https://example.com/foreign.apk'
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $release.Manifest.releaseNotes } 'Foreign APK URL must be rejected.'
    $incorrect = $saved | ConvertFrom-Json
    $incorrect.apkSha256 = '0' * 64
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $release.Manifest.releaseNotes } 'Incorrect APK hash must be rejected.'
    $incorrect = $saved | ConvertFrom-Json
    $incorrect.signerSha256 = '0' * 64
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $release.Manifest.releaseNotes } 'Incorrect signer must be rejected.'
    $incorrect = $saved | ConvertFrom-Json
    $incorrect.releaseNotes = 'a' * 8001
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $incorrect.releaseNotes } 'Notes beyond 8000 characters must be rejected.'
    $incorrect = $saved | ConvertFrom-Json
    $incorrect.releaseNotes = ([string][char]0x4E2D) * 7000
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $incorrect.releaseNotes } 'UTF-8 notes beyond 16 KiB must be rejected.'
    $incorrect = $saved | ConvertFrom-Json
    $incorrect.apkBytes = 67108865
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $release.Manifest.releaseNotes } 'APK sizes beyond 64 MiB must be rejected.'
    $incorrect = $saved | ConvertFrom-Json
    $incorrect | Add-Member -NotePropertyName privateKey -NotePropertyValue 'not allowed'
    Assert-Reject { Assert-ReleaseManifest $incorrect $apk $release.Manifest.releaseNotes } 'Unexpected manifest fields must be rejected.'
    $extra = Join-Path $prepared 'source.zip'
    [IO.File]::WriteAllText($extra,'not a public release asset',$script:ReleaseUtf8)
    Assert-Reject { Get-PreparedRelease $prepared } 'Extra source files must block publication.'
    Remove-Item -LiteralPath $extra
    $testCopy = Join-Path $temporary 'daily-study-test.apk'
    Copy-Item -LiteralPath $apk.Path -Destination $testCopy
    Assert-Reject { Get-ReleaseApkInfo $testCopy } 'A test-named APK must be rejected.'
    $debugApk = Join-Path ([IO.Path]::GetDirectoryName($apk.Path)) ([IO.Path]::GetFileNameWithoutExtension($apk.Path) + '-test.apk')
    if (Test-Path -LiteralPath $debugApk) {
        $renamedDebug = Join-Path $temporary 'renamed-debug.apk'
        Copy-Item -LiteralPath $debugApk -Destination $renamedDebug
        Assert-Reject { Get-ReleaseApkInfo $renamedDebug } 'Renaming a debug APK must not bypass manifest inspection.'
    }
    # Corruption must fail the real apksigner check, rather than trusting a JSON hash.
    $corruptPath = Join-Path $temporary 'corrupt.apk'
    $bytes = [IO.File]::ReadAllBytes($apk.Path)
    $bytes[100] = $bytes[100] -bxor 1
    [IO.File]::WriteAllBytes($corruptPath,$bytes)
    Assert-Reject { Get-ReleaseApkInfo $corruptPath } 'Corrupted APK must fail validation.'
    $previousApk = Join-Path $project 'dist\每日学习-v1.2.0.apk'
    if ($apk.VersionName -cne '1.2.0' -and (Test-Path -LiteralPath $previousApk)) {
        Assert-Reject { Get-ReleaseApkInfo $previousApk } 'A stale release APK must not be published as the current source version.'
    }
    Write-Output ('PASS: ' + $script:Checks + ' release tooling assertions; no remote mutations.')
} finally { Remove-ReleaseTemporaryDirectory $temporary }
