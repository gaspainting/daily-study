param(
    [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
    [switch]$ValidateOnly,
    [switch]$ResumeDraft
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-common.ps1')
$release = Get-PreparedRelease $ReleaseDirectory
$repository = $script:ReleaseRepository
$tag = 'v' + $release.Apk.VersionName
if ($ValidateOnly) {
    Write-Output ('Validated locally: ' + $tag + ' / code ' + $release.Apk.VersionCode)
    Write-Output 'No remote requests or uploads were made.'
    return
}
Get-Command gh -ErrorAction Stop | Out-Null
$repo = (Invoke-ReleaseCommand 'gh' @('api',('repos/' + $repository))) | ConvertFrom-Json
if ($repo.full_name -cne $repository -or $repo.private -ne $false -or !$repo.default_branch) { throw 'The selected release repository must be the dedicated public repository with an initialized branch.' }
$existing = (Invoke-ReleaseCommand 'gh' @('api',('repos/' + $repository + '/releases?per_page=100'))) | ConvertFrom-Json
if (@($existing).Count -ge 100) { throw 'Release history exceeded the validation window; inspect it before publishing.' }
$matching = @($existing | Where-Object { $_.tag_name -ceq $tag })
if ($ResumeDraft) {
    if ($matching.Count -ne 1 -or !$matching[0].draft -or $matching[0].prerelease) { throw 'ResumeDraft requires exactly one existing draft for this version; published releases cannot be resumed.' }
} elseif ($matching.Count -gt 0) { throw 'Release already exists; published versions and assets are never overwritten. Use ResumeDraft only after reviewing an identical failed draft.' }
$tags = (Invoke-ReleaseCommand 'gh' @('api',('repos/' + $repository + '/git/matching-refs/tags/' + $tag))) | ConvertFrom-Json
if (!$ResumeDraft -and @($tags | Where-Object { $_.ref -ceq ('refs/tags/' + $tag) }).Count -gt 0) { throw 'Tag already exists; choose a new release version instead of moving it.' }
$temporary = New-ReleaseTemporaryDirectory
try {
    # Upload a validated snapshot, so a concurrent local build cannot alter the inputs.
    $snapshotDirectory = Join-Path $temporary 'staged'
    New-Item -ItemType Directory -Path $snapshotDirectory | Out-Null
    foreach ($path in @($release.ApkPath,$release.ManifestPath,$release.NotesPath)) { Copy-Item -LiteralPath $path -Destination (Join-Path $snapshotDirectory ([IO.Path]::GetFileName($path))) }
    $release = Get-PreparedRelease $snapshotDirectory
    # Check the public releases before creating any draft; versionCode must move forward.
    foreach ($old in @($existing | Where-Object { !$_.draft -and !$_.prerelease })) {
        if (@($old.assets | Where-Object { $_.name -ceq 'update.json' }).Count -ne 1) { throw ('Existing release has no unique update manifest: ' + $old.tag_name) }
        $oldDirectory = Join-Path $temporary ([Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $oldDirectory | Out-Null
        $oldManifestAsset = @($old.assets | Where-Object { $_.name -ceq 'update.json' })[0]
        Save-ReleaseAsset $oldManifestAsset.id (Join-Path $oldDirectory 'update.json')
        $oldManifest = [IO.File]::ReadAllText((Join-Path $oldDirectory 'update.json'),$script:ReleaseUtf8) | ConvertFrom-Json
        if ($oldManifest.packageName -cne $release.Apk.PackageName -or $oldManifest.signerSha256 -cne $release.Apk.SignerSha256 -or
            $oldManifest.formatVersion -ne 1 -or ($oldManifest.versionCode -isnot [int] -and $oldManifest.versionCode -isnot [long]) -or
            $oldManifest.versionCode -ge $release.Apk.VersionCode) { throw ('Release would change identity or fail to advance versionCode: ' + $old.tag_name) }
    }
    if (!$ResumeDraft) {
        Invoke-ReleaseCommand 'gh' @('release','create',$tag,'--repo',$repository,'--target',$repo.default_branch,'--draft','--title',('每日学习 ' + $tag),'--notes-file',$release.NotesPath,$release.ApkPath,$release.ManifestPath,$release.NotesPath) | Out-Null
        # Draft tags need not exist as Git refs yet. Locate the draft, then use its release ID.
        $created = (Invoke-ReleaseCommand 'gh' @('api',('repos/' + $repository + '/releases?per_page=100'))) | ConvertFrom-Json
        $matching = @($created | Where-Object { $_.tag_name -ceq $tag })
        if ($matching.Count -ne 1 -or !$matching[0].draft) { throw 'Could not locate exactly one newly created draft.' }
    }
    $remote = (Invoke-ReleaseCommand 'gh' @('api',('repos/' + $repository + '/releases/' + $matching[0].id))) | ConvertFrom-Json
    $localFiles = @($release.ApkPath,$release.ManifestPath,$release.NotesPath)
    Assert-ReleaseDraft $remote $tag $release
    $downloadDirectory = Join-Path $temporary 'downloaded'
    New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
    foreach ($path in $localFiles) {
        $name = [IO.Path]::GetFileName($path)
        $asset = @($remote.assets | Where-Object { $_.name -ceq $name })
        $digest = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($asset.Count -ne 1 -or $asset[0].size -ne (Get-Item -LiteralPath $path).Length -or $asset[0].digest -cne ('sha256:' + $digest)) { throw ('GitHub API asset size or SHA-256 differs: ' + $name + '. The release remains a draft.') }
        $downloaded = Join-Path $downloadDirectory $name
        Save-ReleaseAsset $asset[0].id $downloaded
        if (!(Test-Path -LiteralPath $downloaded) -or (Get-FileHash -LiteralPath $downloaded -Algorithm SHA256).Hash.ToLowerInvariant() -cne $digest) { throw ('Downloaded asset differs: ' + $name + '. The release remains a draft.') }
    }
    Get-PreparedRelease $downloadDirectory | Out-Null
    $patchPath = Join-Path $temporary 'publish.json'
    [IO.File]::WriteAllText($patchPath, ('{"draft":false,"make_latest":"true"}' + "`n"), $script:ReleaseUtf8)
    $published = (Invoke-ReleaseCommand 'gh' @('api','--method','PATCH',('repos/' + $repository + '/releases/' + $remote.id),'--input',$patchPath)) | ConvertFrom-Json
    if ($published.id -ne $remote.id -or $published.draft) { throw 'The draft publication response did not confirm the intended release.' }
    $latest = (Invoke-ReleaseCommand 'gh' @('api',('repos/' + $repository + '/releases/latest'))) | ConvertFrom-Json
    if ($latest.tag_name -cne $tag -or $latest.draft -or $latest.prerelease) { throw 'Published release is not the current stable release.' }
    $stableUrl = 'https://github.com/' + $repository + '/releases/latest/download/update.json'
    $stablePath = Join-Path $temporary 'public-update.json'
    Invoke-WebRequest -Uri $stableUrl -OutFile $stablePath -UseBasicParsing
    if ((Get-FileHash -LiteralPath $stablePath -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $release.ManifestPath -Algorithm SHA256).Hash) { throw 'The stable public update URL does not match the published manifest; release exists but public verification failed.' }
    Write-Output ('Published and verified: ' + $latest.html_url)
    Write-Output ('Update manifest: ' + $stableUrl)
    Write-Output ('APK: ' + $release.Manifest.apkUrl)
    Write-Output ('APK SHA256: ' + $release.Apk.ApkSha256)
} finally { Remove-ReleaseTemporaryDirectory $temporary }
