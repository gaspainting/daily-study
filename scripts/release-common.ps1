$ErrorActionPreference = 'Stop'
$script:ReleaseRepository = 'gaspainting/daily-study'
# Existing clients validate the legacy APK path; GitHub redirects it after rename.
$script:ReleaseApkRepository = 'gaspainting/daily-study-releases'
$script:ReleaseSigner = 'fa74d9cbf26f6d34709400a576b93442b8295bdb607e7f80753669133244c3b5'
$script:ReleaseProject = Split-Path -Parent $PSScriptRoot
$script:ReleaseUtf8 = [Text.UTF8Encoding]::new($false)

function Test-ReleaseReadCommand([string]$Tool, [string[]]$Arguments) {
    if ($Tool -notmatch '^gh(\.exe)?$' -or $Arguments.Count -lt 2 -or $Arguments[0] -cne 'api' -or $Arguments[1] -notmatch '^repos/') { return $false }
    # gh api switches to POST when fields/input are supplied, even without --method.
    foreach ($argument in $Arguments) {
        if ($argument -match '^(--method|--input|--field|--raw-field)(=|$)' -or $argument -cmatch '^(-X|-f|-F)') { return $false }
    }
    return $true
}
function Test-ReleaseTransientError([string]$Message) {
    return $Message -match '(?i)\bEOF\b|connection reset|TLS handshake timeout|i/o timeout|HTTP 50[234]'
}
function Invoke-ReleaseCommand([string]$Tool, [string[]]$Arguments) {
    $attempts = if (Test-ReleaseReadCommand $Tool $Arguments) { 3 } else { 1 }
    for ($attempt=1; $attempt -le $attempts; $attempt++) {
        $previousErrorAction=$ErrorActionPreference
        try { $ErrorActionPreference='Continue'; $lines=@(& $Tool @Arguments 2>&1); $code=$LASTEXITCODE }
        finally { $ErrorActionPreference=$previousErrorAction }
        if ($code -eq 0) { return ($lines -join "`n") }
        $message=$Tool + ' failed: ' + ($lines -join "`n")
        if ($attempt -eq $attempts -or !(Test-ReleaseTransientError $message)) { throw $message }
        Start-Sleep -Seconds $attempt
    }
}

function ConvertTo-ReleaseNativeArgument([string]$Argument) {
    # Windows argv quoting for ProcessStartInfo.Arguments, also available in PowerShell 5.1.
    $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return ('"' + $escaped + '"')
}

function Invoke-ReleaseBinaryCommand([string]$Tool, [string[]]$Arguments, [string]$Destination) {
    if (Test-Path -LiteralPath $Destination) { throw 'Binary download destination already exists.' }
    $toolPath = (Get-Command $Tool -ErrorAction Stop).Source
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $toolPath
    $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-ReleaseNativeArgument $_ }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $completed = $false
    try {
        if (!$process.Start()) { throw 'Binary download process did not start.' }
        $errors = $process.StandardError.ReadToEndAsync()
        $output = [IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $process.StandardOutput.BaseStream.CopyTo($output) } finally { $output.Dispose() }
        $process.WaitForExit()
        $errorText = $errors.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw ($Tool + ' failed: ' + $errorText) }
        $completed = $true
    } finally {
        $process.Dispose()
        if (!$completed -and (Test-Path -LiteralPath $Destination -PathType Leaf)) { Remove-Item -LiteralPath $Destination }
    }
}

function Save-ReleaseAsset([long]$AssetId, [string]$Destination) {
    if ($AssetId -le 0) { throw 'Invalid release asset ID.' }
    # gh supplies authentication internally; raw stdout is streamed without text conversion.
    for ($attempt=1; $attempt -le 3; $attempt++) {
        try { Invoke-ReleaseBinaryCommand 'gh' @('api',('repos/' + $script:ReleaseRepository + '/releases/assets/' + $AssetId),'--header','Accept: application/octet-stream') $Destination; return }
        catch { if ($attempt -eq 3 -or !(Test-ReleaseTransientError $_.Exception.Message)) { throw }; Start-Sleep -Seconds $attempt }
    }
}

function Assert-ReleaseDraft($Remote, [string]$Tag, $Release) {
    if (!$Remote.draft -or $Remote.prerelease -or $Remote.tag_name -cne $Tag -or $Remote.id -le 0 -or @($Remote.assets).Count -ne 3) { throw 'The matching release must be a draft with exactly three assets.' }
    foreach ($path in @($Release.ApkPath,$Release.ManifestPath,$Release.NotesPath)) {
        $name = [IO.Path]::GetFileName($path)
        $asset = @($Remote.assets | Where-Object { $_.name -ceq $name })
        $digest = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($asset.Count -ne 1 -or $asset[0].id -le 0 -or $asset[0].size -ne (Get-Item -LiteralPath $path).Length -or $asset[0].digest -cne ('sha256:' + $digest)) { throw ('Draft asset differs from the prepared release: ' + $name + '. No assets will be overwritten.') }
    }
}

function Get-ReleaseTools {
    $sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'D:\Program\Android\SDK' }
    $javaRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\Program\Android\Android Studio\jbr' }
    $result = @{
        Aapt = Join-Path $sdkRoot 'build-tools\36.0.0\aapt2.exe'
        Java = Join-Path $javaRoot 'bin\java.exe'
        Signer = Join-Path $sdkRoot 'build-tools\36.0.0\lib\apksigner.jar'
    }
    foreach ($path in $result.Values) { if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw ('Build tool not found: ' + $path) } }
    return $result
}

function New-ReleaseTemporaryDirectory {
    $basePath = [IO.Path]::GetFullPath($env:TEMP)
    $path = Join-Path $basePath ('daily-study-release-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $path | Out-Null
    return $path
}

function Remove-ReleaseTemporaryDirectory([string]$Path) {
    # Remove only the directory created by this tool, inside the resolved TEMP root.
    $basePath = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($Path)
    if (!$resolved.StartsWith($basePath, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^daily-study-release-[a-f0-9]{32}$') {
        throw 'Unexpected temporary release path; refusing cleanup.'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

function Get-ReleaseApkInfo([string]$ApkPath) {
    $fullPath = (Resolve-Path -LiteralPath $ApkPath).Path
    if (!(Test-Path -LiteralPath $fullPath -PathType Leaf) -or [IO.Path]::GetExtension($fullPath) -cne '.apk') { throw 'Select a release APK file.' }
    $apkLength = (Get-Item -LiteralPath $fullPath).Length
    if ($apkLength -le 0 -or $apkLength -gt 67108864) { throw 'Release APK exceeds the 64 MiB app download limit.' }
    if ($fullPath -match '(?i)([\\/](\.signing|tests)[\\/]|-test\.apk$)') { throw 'Test APKs and private signing paths cannot be released.' }
    $tools = Get-ReleaseTools
    $temporary = New-ReleaseTemporaryDirectory
    try {
        $stagedApk = Join-Path $temporary 'release.apk'
        Copy-Item -LiteralPath $fullPath -Destination $stagedApk
        $badging = Invoke-ReleaseCommand $tools.Aapt @('dump','badging',$stagedApk)
        $package = [regex]::Match($badging, "(?m)^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'")
        $minimum = [regex]::Match($badging, "(?m)^minSdkVersion:'(\d+)'")
        if (!$package.Success -or !$minimum.Success) { throw 'APK metadata could not be read.' }
        if ($badging -match '(?m)^application-debuggable') { throw 'Debuggable APK cannot be released.' }
        $xml = Invoke-ReleaseCommand $tools.Aapt @('dump','xmltree','--file','AndroidManifest.xml',$stagedApk)
        if ($xml -match '(?m)\bE: instrumentation\b' -or $xml -match '(?m)\bandroid:testOnly\([^\r\n]*0xffffffff') { throw 'Instrumentation or test-only APK cannot be released.' }
        $signature = Invoke-ReleaseCommand $tools.Java @('-jar',$tools.Signer,'verify','--verbose','--print-certs',$stagedApk)
        $certificates = [regex]::Matches($signature, '(?m)^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$')
        if ($certificates.Count -ne 1) { throw 'Release APK must have exactly one verified signer.' }
        $certificate = $certificates[0].Groups[1].Value.ToLowerInvariant()
        if ($certificate -cne $script:ReleaseSigner) { throw 'APK signer does not match the existing personal release certificate.' }
        $version = $package.Groups[3].Value
        if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected release version format.' }
        [xml]$source = [IO.File]::ReadAllText((Join-Path $script:ReleaseProject 'app\src\main\AndroidManifest.xml'), $script:ReleaseUtf8)
        $android = 'http://schemas.android.com/apk/res/android'
        if ($package.Groups[1].Value -cne $source.manifest.package -or
            $version -cne $source.DocumentElement.GetAttribute('versionName',$android) -or
            $package.Groups[2].Value -cne $source.DocumentElement.GetAttribute('versionCode',$android) -or
            $minimum.Groups[1].Value -cne $source.manifest.'uses-sdk'.GetAttribute('minSdkVersion',$android)) {
            throw 'Compiled APK metadata differs from the current source Manifest; rebuild the intended release.'
        }
        # The public APK contains packaged web assets, not Java sources or signing material.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($stagedApk)
        try {
            foreach ($entry in $archive.Entries) {
                if ($entry.FullName -match '(?i)(^|/)(\.signing|personal-release)(/|\.)|\.(p12|jks|keystore|java)$') { throw 'APK contains source or private signing material.' }
            }
        } finally { $archive.Dispose() }
        return [pscustomobject]@{
            Path = $fullPath
            PackageName = $package.Groups[1].Value
            VersionCode = [int]$package.Groups[2].Value
            VersionName = $version
            MinSdk = [int]$minimum.Groups[1].Value
            ApkBytes = (Get-Item -LiteralPath $stagedApk).Length
            ApkSha256 = (Get-FileHash -LiteralPath $stagedApk -Algorithm SHA256).Hash.ToLowerInvariant()
            SignerSha256 = $certificate
        }
    } finally { Remove-ReleaseTemporaryDirectory $temporary }
}

function Assert-ReleaseManifest($Manifest, $Apk, [string]$Notes) {
    $fields = @('formatVersion','packageName','versionCode','versionName','minSdk','apkUrl','apkBytes','apkSha256','signerSha256','releaseNotes','releaseDate')
    $actualFields = @($Manifest.PSObject.Properties.Name | Sort-Object)
    if (($actualFields -join '|') -cne (($fields | Sort-Object) -join '|')) { throw 'Unexpected update.json fields.' }
    foreach ($field in @('formatVersion','versionCode','minSdk','apkBytes')) {
        if ($Manifest.$field -isnot [int] -and $Manifest.$field -isnot [long]) { throw ('Expected an integer in update.json: ' + $field) }
    }
    foreach ($field in @('packageName','versionName','apkUrl','apkSha256','signerSha256','releaseNotes','releaseDate')) {
        if ($Manifest.$field -isnot [string]) { throw ('Expected a string in update.json: ' + $field) }
    }
    if ($Manifest.apkBytes -le 0 -or $Manifest.apkBytes -gt 67108864 -or $Manifest.versionCode -le 0) { throw 'APK size or versionCode is outside the update limits.' }
    if ([string]::IsNullOrWhiteSpace($Notes) -or $Notes.Length -gt 8000 -or $script:ReleaseUtf8.GetByteCount($Notes) -gt 16384) { throw 'Release notes exceed the app update limits.' }
    $apkName = 'daily-study-v' + $Apk.VersionName + '.apk'
    $url = 'https://github.com/' + $script:ReleaseApkRepository + '/releases/download/v' + $Apk.VersionName + '/' + $apkName
    if ($Manifest.formatVersion -ne 1 -or $Manifest.packageName -cne $Apk.PackageName -or
        $Manifest.versionCode -ne $Apk.VersionCode -or $Manifest.versionName -cne $Apk.VersionName -or
        $Manifest.minSdk -ne $Apk.MinSdk -or $Manifest.apkUrl -cne $url -or
        $Manifest.apkBytes -ne $Apk.ApkBytes -or $Manifest.apkSha256 -cne $Apk.ApkSha256 -or
        $Manifest.signerSha256 -cne $Apk.SignerSha256 -or $Manifest.releaseNotes -cne $Notes -or
        $Manifest.releaseDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'update.json does not match the APK and release notes.' }
    $date = [DateTime]::ParseExact($Manifest.releaseDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    if ($date.Date -gt (Get-Date).Date) { throw 'Release date cannot be in the future.' }
}

function Get-PreparedRelease([string]$ReleaseDirectory) {
    $directory = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
    if (!(Test-Path -LiteralPath $directory -PathType Container)) { throw 'Release directory not found.' }
    $items = @(Get-ChildItem -LiteralPath $directory -Force)
    if ($items.Count -ne 3 -or @($items | Where-Object { $_.PSIsContainer }).Count -ne 0) { throw 'Release directory must contain exactly three public files.' }
    $manifestPath = Join-Path $directory 'update.json'
    $notesPath = Join-Path $directory 'RELEASE-NOTES.md'
    if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf) -or !(Test-Path -LiteralPath $notesPath -PathType Leaf)) { throw 'Release manifest or notes missing.' }
    if ((Get-Item -LiteralPath $manifestPath).Length -gt 65536) { throw 'Update manifest exceeds the app limit.' }
    $manifest = [IO.File]::ReadAllText($manifestPath, $script:ReleaseUtf8) | ConvertFrom-Json
    $notes = [IO.File]::ReadAllText($notesPath, $script:ReleaseUtf8)
    $apkPath = Join-Path $directory ('daily-study-v' + $manifest.versionName + '.apk')
    $apk = Get-ReleaseApkInfo $apkPath
    Assert-ReleaseManifest $manifest $apk $notes
    return [pscustomobject]@{ Directory=$directory; Manifest=$manifest; Apk=$apk; ApkPath=$apkPath; ManifestPath=$manifestPath; NotesPath=$notesPath }
}
