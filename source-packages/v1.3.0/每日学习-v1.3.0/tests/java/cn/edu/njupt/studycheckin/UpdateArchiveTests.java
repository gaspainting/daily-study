package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import org.json.JSONObject;
import java.io.File;
import java.util.List;

/** Mandatory signed APK fixtures. Run with an older update-enabled bootstrap installed. */
final class UpdateArchiveTests {
    private interface Action{void run()throws Exception;}
    private static void check(List<String> passes,boolean value,String name)throws Exception{if(!value)throw new Exception("FAIL: "+name);passes.add(name);}
    private static void rejects(List<String> passes,Action action,String expected,String name)throws Exception{
        Exception failure=null;try{action.run();}catch(Exception e){failure=e;}
        check(passes,failure!=null&&failure.getMessage()!=null&&failure.getMessage().contains(expected),name);
    }
    private static File fixture(Context context,String name)throws Exception{File file=new File(context.getCacheDir(),name);if(!file.isFile())throw new Exception("Missing mandatory APK fixture: "+name);return file;}
    private static JSONObject forFile(JSONObject template,File file)throws Exception{return new JSONObject(template.toString()).put("apkBytes",file.length()).put("apkSha256",UpdateManager.sha256(file));}
    @SuppressWarnings("deprecation") static void run(Context context,List<String> passes)throws Exception{
        String original=DataStore.load(context).toString();
        File good=fixture(context,"update-good.apk"),wrongSign=fixture(context,"update-wrong-sign.apk"),wrongPackage=fixture(context,"update-wrong-package.apk"),old=fixture(context,"update-old.apk");
        int flags=android.os.Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo archive=context.getPackageManager().getPackageArchiveInfo(good.getAbsolutePath(),flags);
        if(archive==null||archive.applicationInfo==null)throw new Exception("Good APK fixture unreadable");
        String name=archive.versionName;
        JSONObject manifest=new JSONObject().put("formatVersion",1).put("packageName",context.getPackageName())
            .put("versionCode",UpdateManager.code(archive)).put("versionName",name).put("minSdk",archive.applicationInfo.minSdkVersion)
            .put("apkUrl","https://github.com/gaspainting/daily-study-releases/releases/download/v"+name+"/daily-study-v"+name+".apk")
            .put("apkBytes",good.length()).put("apkSha256",UpdateManager.sha256(good)).put("signerSha256",UpdateManager.installedSigner(context))
            .put("releaseNotes","安装包实测").put("releaseDate","2026-10-14");
        check(passes,UpdateManager.code(archive)>UpdateManager.code(UpdateManager.installed(context)),"signed APK fixture has genuinely newer code than installed bootstrap");
        UpdateManager.verifyDownloaded(context,manifest,good);check(passes,true,"native archive check accepts real newer APK with same package version minSdk and certificate");
        JSONObject alteredHash=new JSONObject(manifest.toString()).put("apkSha256",new String(new char[64]).replace('\0','0'));
        rejects(passes,()->UpdateManager.verifyDownloaded(context,alteredHash,good),"校验失败","native archive check rejects modified manifest checksum for real APK");
        JSONObject wrongSignManifest=forFile(manifest,wrongSign);
        rejects(passes,()->UpdateManager.verifyDownloaded(context,wrongSignManifest,wrongSign),"签名不匹配","native archive check rejects APK signed with different private key despite correct checksum");
        JSONObject wrongPackageManifest=forFile(manifest,wrongPackage);
        rejects(passes,()->UpdateManager.verifyDownloaded(context,wrongPackageManifest,wrongPackage),"版本不匹配","native archive check rejects real APK with different package despite correct checksum");
        JSONObject oldManifest=forFile(manifest,old);
        rejects(passes,()->UpdateManager.verifyDownloaded(context,oldManifest,old),"版本不匹配","native archive check rejects real old version disguised as newer manifest");
        JSONObject mismatchCode=new JSONObject(manifest.toString()).put("versionCode",manifest.getLong("versionCode")+1);
        rejects(passes,()->UpdateManager.verifyDownloaded(context,mismatchCode,good),"版本不匹配","native archive check rejects genuine APK whose code differs from manifest");
        JSONObject mismatchMin=new JSONObject(manifest.toString()).put("minSdk",manifest.getInt("minSdk")+1);
        rejects(passes,()->UpdateManager.verifyDownloaded(context,mismatchMin,good),"版本不匹配","native archive check rejects genuine APK whose minimum Android differs from manifest");
        check(passes,DataStore.load(context).toString().equals(original),"real signed APK validation preserves learning records");
    }
}
