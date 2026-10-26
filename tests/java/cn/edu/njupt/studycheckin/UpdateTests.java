package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.URL;
import java.util.List;

/** Native validation and failure/cancellation contracts. Does not publish or install an APK. */
final class UpdateTests {
    private interface Action{void run()throws Exception;}
    private static void check(List<String> passes,boolean value,String name)throws Exception{if(!value)throw new Exception("FAIL: "+name);passes.add(name);}
    private static void rejects(List<String> passes,Action action,String name)throws Exception{boolean rejected=false;try{action.run();}catch(Exception e){rejected=true;}check(passes,rejected,name);}
    private static JSONObject candidate(Context context)throws Exception{
        return new JSONObject().put("formatVersion",1).put("packageName",context.getPackageName())
            .put("versionCode",UpdateManager.code(UpdateManager.installed(context))+1).put("versionName","99.0.0")
            .put("minSdk",26).put("apkUrl","https://github.com/gaspainting/daily-study-releases/releases/download/v99.0.0/daily-study-v99.0.0.apk")
            .put("apkBytes",1).put("apkSha256",repeat('a',64)).put("signerSha256",UpdateManager.installedSigner(context))
            .put("releaseNotes","更新测试").put("releaseDate","2026-10-14");
    }
    private static String repeat(char value,int count){char[] chars=new char[count];java.util.Arrays.fill(chars,value);return new String(chars);}
    static void run(Context context,List<String> passes)throws Exception{
        String original=DataStore.load(context).toString();JSONObject valid=candidate(context);
        UpdateManager.validateManifest(context,valid);check(passes,true,"update accepts exact repository HTTPS manifest with installed signer");
        check(passes,UpdateManager.installedSigner(context).matches("[a-f0-9]{64}"),"update reads actual Android signing certificate digest");
        check(passes,UpdateManager.newer(context,valid),"update compares actual integer build codes");
        JSONObject current=new JSONObject(valid.toString()).put("versionCode",UpdateManager.code(UpdateManager.installed(context)));
        check(passes,!UpdateManager.newer(context,current),"same build code is current rather than available");
        JSONObject previous=new JSONObject(valid.toString()).put("versionCode",1);
        check(passes,!UpdateManager.newer(context,previous),"older build code cannot be offered as update");
        String[] integerKeys={"formatVersion","versionCode","minSdk","apkBytes"};
        for(String key:integerKeys){JSONObject invalid=new JSONObject(valid.toString()).put(key,"1");rejects(passes,()->UpdateManager.validateManifest(context,invalid),"update rejects string integer for "+key);}
        JSONObject fractional=new JSONObject(valid.toString()).put("versionCode",4.5);rejects(passes,()->UpdateManager.validateManifest(context,fractional),"update rejects fractional version code");
        JSONObject wrongPackage=new JSONObject(valid.toString()).put("packageName","other.app");rejects(passes,()->UpdateManager.validateManifest(context,wrongPackage),"update rejects different application package");
        JSONObject differentSigner=new JSONObject(valid.toString()).put("signerSha256",repeat('b',64));rejects(passes,()->UpdateManager.validateManifest(context,differentSigner),"update rejects manifest with different signing key");
        JSONObject oversized=new JSONObject(valid.toString()).put("apkBytes",UpdateManager.MAX_APK_BYTES+1);rejects(passes,()->UpdateManager.validateManifest(context,oversized),"update rejects oversized APK manifest");
        JSONObject zero=new JSONObject(valid.toString()).put("apkBytes",0);rejects(passes,()->UpdateManager.validateManifest(context,zero),"update rejects empty APK manifest");
        JSONObject tooNew=new JSONObject(valid.toString()).put("minSdk",android.os.Build.VERSION.SDK_INT+1);rejects(passes,()->UpdateManager.validateManifest(context,tooNew),"update rejects incompatible Android minimum");
        JSONObject unsupported=new JSONObject(valid.toString()).put("formatVersion",2);rejects(passes,()->UpdateManager.validateManifest(context,unsupported),"update rejects unknown manifest schema");
        JSONObject invalidDate=new JSONObject(valid.toString()).put("releaseDate","2026-02-30");rejects(passes,()->UpdateManager.validateManifest(context,invalidDate),"update rejects invalid release date");
        JSONObject invalidDigest=new JSONObject(valid.toString()).put("apkSha256",repeat('Z',64));rejects(passes,()->UpdateManager.validateManifest(context,invalidDigest),"update rejects malformed download digest");
        String[] urls={"http://github.com/gaspainting/daily-study-releases/releases/download/v99.0.0/daily-study-v99.0.0.apk",
            "https://example.org/daily-study-v99.0.0.apk","https://github.com/other/daily-study-releases/releases/download/v99.0.0/daily-study-v99.0.0.apk",
            "https://github.com/gaspainting/daily-study-releases/releases/latest/download/daily-study-v99.0.0.apk",
            "https://github.com/gaspainting/daily-study-releases/releases/download/v99.0.0/daily-study-v99.0.0.apk?x=1",
            "https://user@github.com/gaspainting/daily-study-releases/releases/download/v99.0.0/daily-study-v99.0.0.apk",
            "https://github.com:8443/gaspainting/daily-study-releases/releases/download/v99.0.0/daily-study-v99.0.0.apk"};
        for(int i=0;i<urls.length;i++){JSONObject invalid=new JSONObject(valid.toString()).put("apkUrl",urls[i]);rejects(passes,()->UpdateManager.validateManifest(context,invalid),"update rejects unsafe or mutable asset address "+i);}
        check(passes,UpdateManager.allowedHost("release-assets.githubusercontent.com")&&UpdateManager.allowedHost("objects.githubusercontent.com"),"update allows actual GitHub release asset redirect hosts");
        check(passes,!UpdateManager.allowedHost("github.com.example.org")&&!UpdateManager.allowedHost("raw.githubusercontent.com"),"update rejects unrelated redirect hosts");
        check(passes,!UpdateManager.safeTransport(new URL("http://github.com/a")),"update redirect transport cannot become cleartext");
        check(passes,UpdateManager.readLimited(new ByteArrayInputStream(new byte[UpdateManager.MAX_MANIFEST_BYTES]),UpdateManager.MAX_MANIFEST_BYTES).length==UpdateManager.MAX_MANIFEST_BYTES,"update accepts bounded manifest maximum");
        rejects(passes,()->UpdateManager.readLimited(new ByteArrayInputStream(new byte[UpdateManager.MAX_MANIFEST_BYTES+1]),UpdateManager.MAX_MANIFEST_BYTES),"update rejects streamed manifest exceeding maximum");
        File fixture=new File(context.getCacheDir(),"update-validation.bin");
        try{
            try(FileOutputStream output=new FileOutputStream(fixture)){output.write(7);}
            rejects(passes,()->UpdateManager.verifyDownloaded(context,valid,fixture),"update rejects downloaded digest mismatch");
            JSONObject truncated=new JSONObject(valid.toString()).put("apkBytes",2);rejects(passes,()->UpdateManager.verifyDownloaded(context,truncated,fixture),"update rejects truncated APK");
            JSONObject badArchive=new JSONObject(valid.toString()).put("apkSha256",UpdateManager.sha256(fixture));rejects(passes,()->UpdateManager.verifyDownloaded(context,badArchive,fixture),"update rejects non APK even with matching digest");
            rejects(passes,()->UpdateManager.verifyDownloaded(context,current,fixture),"update revalidation prevents same version installation");
        }finally{fixture.delete();}
        Uri privateRecord=Uri.parse("content://"+context.getPackageName()+".updates/../state.json");
        rejects(passes,()->{try(android.os.ParcelFileDescriptor ignored=context.getContentResolver().openFileDescriptor(privateRecord,"r")){if(ignored==null)throw new Exception();}},"update provider cannot expose study records by path traversal");
        Uri fake=Uri.parse("content://"+context.getPackageName()+".updates/update-1-"+repeat('a',64)+".apk");
        rejects(passes,()->{try(android.os.ParcelFileDescriptor ignored=context.getContentResolver().openFileDescriptor(fake,"w")){if(ignored==null)throw new Exception();}},"update provider refuses APK writes");
        rejects(passes,()->{try(android.os.ParcelFileDescriptor ignored=context.getContentResolver().openFileDescriptor(fake,"r")){if(ignored==null)throw new Exception();}},"update provider refuses unverified APK");
        SharedPreferences stopwatch=context.getSharedPreferences("stopwatch",Context.MODE_PRIVATE);String timer=stopwatch.getString("timer",null);
        try{
            JSONObject paused=new JSONObject().put("active",true).put("id","update-paused-fixture").put("subjectId","math").put("subjectName","高数").put("date","2026-10-14").put("running",false).put("accumulatedMs",120000).put("message","");
            stopwatch.edit().putString("timer",paused.toString()).commit();
            rejects(passes,()->UpdateManager.prepareInstall(context),"update installation blocks unresolved paused timer");
            check(passes,TimerStore.snapshot(context).optBoolean("active")&&TimerStore.snapshot(context).getLong("elapsedMs")==120000,"blocked installation preserves timer and elapsed time");
        }finally{SharedPreferences.Editor edit=stopwatch.edit();if(timer==null)edit.remove("timer");else edit.putString("timer",timer);edit.commit();}
        UpdateManager.check(context,null);UpdateManager.cancel(context);String cancelled=UpdateManager.state(context).getString("phase");
        check(passes,!cancelled.equals("checking")&&!cancelled.equals("downloading"),"update cancel exits busy state without reporting installed");
        SystemClock.sleep(250);check(passes,UpdateManager.state(context).getString("phase").equals(cancelled),"cancelled check cannot publish stale async completion");
        long interval=UpdateManager.FOREGROUND_CHECK_INTERVAL_MS;
        check(passes,UpdateManager.foregroundDue(100,-1,"idle"),"foreground update permits a first restored-process check");
        check(passes,!UpdateManager.foregroundDue(interval,1,"current"),"foreground update waits for the full interval");
        check(passes,UpdateManager.foregroundDue(interval+1,1,"current"),"foreground update becomes due exactly at the interval boundary");
        check(passes,UpdateManager.foregroundDue(interval+1,1,"error"),"foreground return can retry a previous failed check");
        check(passes,UpdateManager.foregroundDue(1,100,"current"),"a reset monotonic clock cannot suppress checking indefinitely");
        for(String busy:new String[]{"checking","downloading","available","ready"})check(passes,!UpdateManager.foregroundDue(interval*2,1,busy),"foreground update retains pending state "+busy);
        check(passes,!UpdateManager.checkForeground(context,null),"rapid foreground return does not restart a recently cancelled check");
        UpdateManager.check(context,null);check(passes,"checking".equals(UpdateManager.state(context).getString("phase")),"manual check bypasses the foreground cooldown");
        check(passes,!UpdateManager.checkForeground(context,null),"foreground check does not duplicate an active manual check");UpdateManager.cancel(context);
        check(passes,DataStore.load(context).toString().equals(original),"update validation cancellation and install refusal preserve learning records");
    }
}
