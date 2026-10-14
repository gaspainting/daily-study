param([switch]$TestBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'D:\Program\Android\SDK' }
$javaRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\Program\Android\Android Studio\jbr' }
$toolsRoot = Join-Path $sdkRoot 'build-tools\36.0.0'
$androidJar = Join-Path $sdkRoot 'platforms\android-36\android.jar'
$expectedBuildRoot = Join-Path $env:TEMP 'njupt-study-checkin-build'
$buildRoot = $expectedBuildRoot
$originalMainRoot = Join-Path $projectRoot 'app\src\main'
$mainRoot = Join-Path $buildRoot 'source'
$outputRoot = Join-Path $projectRoot 'dist'
function Run-Native([string]$tool, [string[]]$arguments) { & $tool @arguments; if ($LASTEXITCODE -ne 0) { throw "$tool exited $LASTEXITCODE" } }
New-Item -ItemType Directory -Force -Path $buildRoot,$mainRoot,(Join-Path $buildRoot 'classes'),(Join-Path $buildRoot 'generated'),(Join-Path $buildRoot 'dex'),$outputRoot | Out-Null
# Delete stale build products only inside this verified build directory.
$resolvedBuild = (Resolve-Path -LiteralPath $buildRoot).Path
if ($resolvedBuild -ne $expectedBuildRoot) { throw 'Unexpected build path' }
Get-ChildItem -LiteralPath (Join-Path $buildRoot 'classes') -Force | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $buildRoot 'dex') -Force | Remove-Item -Recurse -Force
# aapt2 on Windows does not reliably open non-ASCII paths; stage inputs under an ASCII temp path.
foreach ($part in @('java','assets','res')) {
    $stagedPart=Join-Path $mainRoot $part
    New-Item -ItemType Directory -Force -Path $stagedPart | Out-Null
    Get-ChildItem -LiteralPath $stagedPart -Force | Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath (Join-Path $originalMainRoot $part) -Force | Copy-Item -Destination $stagedPart -Recurse -Force
}
$manifest = Get-Content -LiteralPath (Join-Path $originalMainRoot 'AndroidManifest.xml') -Raw
if ($TestBuild) { $manifest=$manifest.Replace('<application ', '<application android:debuggable="true" '); $manifest=$manifest.Replace('</manifest>','<instrumentation android:name="cn.edu.njupt.studycheckin.SmokeTests" android:targetPackage="cn.edu.njupt.studycheckin" /></manifest>') }
$manifestPath = Join-Path $buildRoot 'AndroidManifest.xml'
[IO.File]::WriteAllText($manifestPath,$manifest,[Text.UTF8Encoding]::new($false))
Run-Native (Join-Path $toolsRoot 'aapt2.exe') @('compile','--dir',(Join-Path $mainRoot 'res'),'-o',(Join-Path $buildRoot 'resources.zip'))
Run-Native (Join-Path $toolsRoot 'aapt2.exe') @('link','-o',(Join-Path $buildRoot 'resources.apk'),'-I',$androidJar,'--manifest',$manifestPath,'--java',(Join-Path $buildRoot 'generated'),'-A',(Join-Path $mainRoot 'assets'),(Join-Path $buildRoot 'resources.zip'))
$sources=@(Get-ChildItem -LiteralPath (Join-Path $mainRoot 'java'),(Join-Path $buildRoot 'generated') -Recurse -Filter '*.java' | ForEach-Object { '"'+$_.FullName.Replace('\','/')+'"' })
if ($TestBuild) { $sources += @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests\java') -Recurse -Filter '*.java' | ForEach-Object { '"'+$_.FullName.Replace('\','/')+'"' }) }
$sourceList=Join-Path $buildRoot 'sources.txt';[IO.File]::WriteAllLines($sourceList,$sources,[Text.UTF8Encoding]::new($false))
Run-Native (Join-Path $javaRoot 'bin\javac.exe') @('-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-classpath',$androidJar,'-d',(Join-Path $buildRoot 'classes'),('@'+$sourceList))
Run-Native (Join-Path $javaRoot 'bin\jar.exe') @('cf',(Join-Path $buildRoot 'classes.jar'),'-C',(Join-Path $buildRoot 'classes'),'.')
Run-Native (Join-Path $javaRoot 'bin\java.exe') @('-cp',(Join-Path $toolsRoot 'lib\d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',$androidJar,'--output',(Join-Path $buildRoot 'dex'),(Join-Path $buildRoot 'classes.jar'))
$unsigned=Join-Path $buildRoot 'unsigned.apk';Copy-Item -LiteralPath (Join-Path $buildRoot 'resources.apk') -Destination $unsigned -Force
Run-Native (Join-Path $javaRoot 'bin\jar.exe') @('uf',$unsigned,'-C',(Join-Path $buildRoot 'dex'),'classes.dex')
$aligned=Join-Path $buildRoot 'aligned.apk';Run-Native (Join-Path $toolsRoot 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
$keyDir=Join-Path $projectRoot '.signing';$keystore=Join-Path $keyDir 'personal-release.p12'
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
if (!(Test-Path -LiteralPath $keystore)) { Run-Native (Join-Path $javaRoot 'bin\keytool.exe') @('-genkeypair','-keystore',$keystore,'-storetype','PKCS12','-alias','daily-study','-storepass','daily-study-local','-keypass','daily-study-local','-keyalg','RSA','-keysize','2048','-validity','10000','-dname','CN=Daily Study Personal Build,OU=Personal,O=Local,C=CN') }
$name=if($TestBuild){'每日学习-v1.0.0-test.apk'}else{'每日学习-v1.0.0.apk'};$apk=Join-Path $outputRoot $name
Run-Native (Join-Path $javaRoot 'bin\java.exe') @('-jar',(Join-Path $toolsRoot 'lib\apksigner.jar'),'sign','--ks',$keystore,'--ks-key-alias','daily-study','--ks-pass','pass:daily-study-local','--key-pass','pass:daily-study-local','--out',$apk,$aligned)
Run-Native (Join-Path $javaRoot 'bin\java.exe') @('-jar',(Join-Path $toolsRoot 'lib\apksigner.jar'),'verify','--verbose',$apk)
$digest=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($apk+'.sha256'),($digest+'  '+$name+"`n"),[Text.UTF8Encoding]::new($false))
Write-Output "APK: $apk"
Write-Output "SHA256: $digest"
