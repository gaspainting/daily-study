package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A user-requested, signed APK update. Study data and timers are never replaced here. */
public final class UpdateManager {
    public static final String MANIFEST_URL="https://github.com/gaspainting/daily-study-releases/releases/latest/download/update.json";
    static final long MAX_APK_BYTES=64L*1024*1024;
    static final int MAX_MANIFEST_BYTES=64*1024;
    private static final Object LOCK=new Object();
    private static final ExecutorService IO=Executors.newSingleThreadExecutor();
    private static final Handler MAIN=new Handler(Looper.getMainLooper());
    private static String phase="idle",error="";
    private static JSONObject candidate;
    private static long bytes,total,generation;
    private static HttpURLConnection connection;
    private UpdateManager(){}

    public static JSONObject state(Context context){
        synchronized(LOCK){try{
            PackageInfo installed=installed(context);
            return new JSONObject().put("phase",phase).put("currentVersion",installed.versionName)
                .put("currentCode",code(installed)).put("candidate",candidate==null?JSONObject.NULL:cloneJson(candidate))
                .put("bytes",bytes).put("total",total).put("error",error)
                .put("canInstall",context.getPackageManager().canRequestPackageInstalls());
        }catch(Exception e){try{return new JSONObject().put("phase","error").put("error","版本信息读取失败，请重试").put("candidate",JSONObject.NULL).put("canInstall",false);}catch(Exception ignored){return new JSONObject();}}}
    }

    public static void check(Context context,Runnable onChanged){
        Context app=context.getApplicationContext();final long token;
        synchronized(LOCK){if(busy())return;token=++generation;phase="checking";error="";bytes=0;total=0;}
        changed(onChanged);
        IO.execute(()->{
            try{
                cleanPartials(app);
                JSONObject next=new JSONObject(readManifest(app,token));validateManifest(app,next);
                if(!newer(app,next)){
                    synchronized(LOCK){ensureCurrent(token);candidate=null;phase="current";bytes=0;total=0;error="";}
                }else{
                    File cached=new File(directory(app),fileName(next));boolean ready=false;
                    if(cached.isFile()){try{verifyDownloaded(app,next,cached);ready=true;}catch(Exception ignored){if(!cached.delete())throw problem("下载文件无法替换，请重试");}}
                    synchronized(LOCK){ensureCurrent(token);candidate=cloneJson(next);total=next.getLong("apkBytes");bytes=ready?total:0;phase=ready?"ready":"available";error="";if(ready)persist(app,next);}
                }
            }catch(Cancelled ignored){}catch(Exception e){failed(token,e,"检查失败，请检查网络后重试");}
            changed(onChanged);
        });
    }

    public static void download(Context context,Runnable onChanged){
        Context app=context.getApplicationContext();final long token;final JSONObject next;
        synchronized(LOCK){
            if(busy())return;
            if(candidate==null){error="请先检查更新";phase="error";changed(onChanged);return;}
            if("ready".equals(phase)){changed(onChanged);return;}
            try{next=cloneJson(candidate);validateManifest(app,next);if(!newer(app,next))throw problem("已安装此版本，请重新检查更新");total=next.getLong("apkBytes");}
            catch(Exception e){error=message(e,"更新信息有误，请重新检查");phase="error";changed(onChanged);return;}
            token=++generation;phase="downloading";bytes=0;error="";
        }
        changed(onChanged);
        IO.execute(()->{
            File partial=null;HttpURLConnection request=null;
            try{
                File dir=directory(app);partial=new File(dir,"download-"+token+".part");
                request=open(next.getString("apkUrl"),token);long expected=next.getLong("apkBytes");
                long declared=request.getContentLengthLong();if(declared>MAX_APK_BYTES||declared>=0&&declared!=expected)throw problem("下载文件大小不符，请重新检查更新");
                long read=0,lastNotice=0;
                try(InputStream input=request.getInputStream();FileOutputStream output=new FileOutputStream(partial)){
                    byte[] buffer=new byte[16*1024];int count;
                    while((count=input.read(buffer))!=-1){ensureCurrent(token);read+=count;if(read>expected||read>MAX_APK_BYTES)throw problem("下载文件大小不符，请重新检查更新");output.write(buffer,0,count);
                        synchronized(LOCK){ensureCurrent(token);bytes=read;}
                        if(System.currentTimeMillis()-lastNotice>=250){changed(onChanged);lastNotice=System.currentTimeMillis();}
                    }
                    output.flush();output.getFD().sync();
                }
                if(read!=expected)throw problem("下载未完成，请重试");
                ensureCurrent(token);verifyDownloaded(app,next,partial);
                synchronized(LOCK){
                    ensureCurrent(token);File completed=new File(dir,fileName(next));
                    if(completed.exists()&&!completed.delete())throw problem("下载文件无法替换，请重试");
                    if(!partial.renameTo(completed))throw problem("下载文件保存失败，请重试");
                    partial=null;persist(app,next);bytes=expected;total=expected;phase="ready";error="";
                }
            }catch(Cancelled ignored){}catch(Exception e){failed(token,e,"下载失败，请检查网络和手机存储后重试");}
            finally{if(request!=null)disconnect(request);if(partial!=null)partial.delete();changed(onChanged);}
        });
    }

    public static void cancel(Context context){
        HttpURLConnection active;
        synchronized(LOCK){if(!busy())return;++generation;active=connection;connection=null;phase=candidate==null?"idle":"available";error="";bytes=0;total=candidate==null?0:candidate.optLong("apkBytes");}
        if(active!=null)active.disconnect();
    }

    /** Revalidates the APK at the last moment; launching an installer is not installation success. */
    public static Intent prepareInstall(Context context)throws Exception{
        synchronized(DataStore.LOCK){
            JSONObject timer=TimerStore.snapshot(context);
            if(timer.has("error"))throw problem("计时状态读取失败，请重试");
            if(timer.optBoolean("active"))throw problem("请先保存或舍弃当前计时");
            if(!context.getPackageManager().canRequestPackageInstalls())throw problem("请先允许每日学习安装应用");
            JSONObject next;
            synchronized(LOCK){if(!"ready".equals(phase)||candidate==null)throw problem("请先下载更新");next=cloneJson(candidate);}
            validateManifest(context,next);File file=new File(directory(context),fileName(next));verifyDownloaded(context,next,file);
            return new Intent(Intent.ACTION_VIEW).setDataAndType(contentUri(context,file),"application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
        }
    }

    static File directory(Context context)throws IOException{
        File dir=new File(context.getFilesDir(),"updates");if(!dir.isDirectory()&&!dir.mkdirs())throw problem("下载目录不可用，请检查手机存储后重试");return dir;
    }
    static Uri contentUri(Context context,File file){return new Uri.Builder().scheme("content").authority(context.getPackageName()+".updates").appendPath(file.getName()).build();}
    static String fileName(JSONObject manifest)throws Exception{return "update-"+manifest.getLong("versionCode")+"-"+manifest.getString("apkSha256")+".apk";}
    static JSONObject persisted(Context context)throws Exception{
        File saved=new File(directory(context),"verified.json");try(InputStream input=new FileInputStream(saved)){return new JSONObject(new String(readLimited(input,MAX_MANIFEST_BYTES),StandardCharsets.UTF_8));}
    }
    private static void persist(Context context,JSONObject manifest)throws Exception{
        File dir=directory(context),temp=new File(dir,"verified.part"),saved=new File(dir,"verified.json");
        byte[] content=manifest.toString().getBytes(StandardCharsets.UTF_8);
        try(FileOutputStream output=new FileOutputStream(temp)){output.write(content);output.flush();output.getFD().sync();}
        if(!temp.renameTo(saved)){temp.delete();throw problem("更新信息保存失败，请重试");}
    }

    private static void cleanPartials(Context context)throws Exception{
        File[] files=directory(context).listFiles();if(files==null)return;
        for(File file:files)if(file.getName().matches("download-[0-9]+\\.part")||file.getName().equals("verified.part"))file.delete();
    }

    static void validateManifest(Context context,JSONObject manifest)throws Exception{
        if(integer(manifest,"formatVersion")!=1)throw problem("更新信息格式不兼容，请稍后重试");
        if(!context.getPackageName().equals(string(manifest,"packageName",150)))throw problem("更新应用不匹配，请重新检查");
        long version=integer(manifest,"versionCode"),size=integer(manifest,"apkBytes"),minimum=integer(manifest,"minSdk");
        if(version<1||version>Integer.MAX_VALUE||size<1||size>MAX_APK_BYTES||minimum<26||minimum>Integer.MAX_VALUE)throw problem("更新信息有误，请重新检查");
        String name=string(manifest,"versionName",40);if(!name.matches("[0-9]+\\.[0-9]+\\.[0-9]+"))throw problem("更新版本信息有误，请重新检查");
        String apkSha=string(manifest,"apkSha256",64),signer=string(manifest,"signerSha256",64);
        if(!apkSha.matches("[a-f0-9]{64}")||!signer.matches("[a-f0-9]{64}"))throw problem("更新校验信息有误，请重新检查");
        if(!installedSigner(context).equals(signer))throw problem("更新签名不匹配，请重新检查");
        if(minimum>Build.VERSION.SDK_INT)throw problem("此更新不支持当前安卓版本");
        String location=string(manifest,"apkUrl",500);URL url=new URL(location);
        String expected="/gaspainting/daily-study-releases/releases/download/v"+name+"/daily-study-v"+name+".apk";
        if(!safeTransport(url)||!"github.com".equals(url.getHost())||!expected.equals(url.getPath())||url.getQuery()!=null||url.getRef()!=null)throw problem("更新下载地址无效，请重新检查");
        string(manifest,"releaseNotes",8000);String date=string(manifest,"releaseDate",10);
        try{if(!LocalDate.parse(date).toString().equals(date))throw new Exception();}catch(Exception e){throw problem("更新日期信息有误，请重新检查");}
    }

    static void verifyDownloaded(Context context,JSONObject manifest,File file)throws Exception{
        validateManifest(context,manifest);
        if(!newer(context,manifest))throw problem("已安装此版本，请重新检查更新");
        if(!file.isFile()||file.length()!=manifest.getLong("apkBytes"))throw problem("下载文件不完整，请重新下载");
        if(!sha256(file).equals(manifest.getString("apkSha256")))throw problem("下载校验失败，请重新下载");
        PackageInfo archive=context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),signingFlags());
        if(archive==null||archive.applicationInfo==null)throw problem("安装包无法读取，请重新下载");
        if(!context.getPackageName().equals(archive.packageName)||code(archive)!=manifest.getLong("versionCode")||!manifest.getString("versionName").equals(archive.versionName)||archive.applicationInfo.minSdkVersion!=manifest.getInt("minSdk"))throw problem("安装包版本不匹配，请重新检查更新");
        if(!signer(archive).equals(installedSigner(context))||!signer(archive).equals(manifest.getString("signerSha256")))throw problem("安装包签名不匹配，请重新检查更新");
    }

    static String installedSigner(Context context)throws Exception{return signer(installed(context));}
    static PackageInfo installed(Context context)throws Exception{return context.getPackageManager().getPackageInfo(context.getPackageName(),signingFlags());}
    static long code(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
    @SuppressWarnings("deprecation") private static int signingFlags(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
    @SuppressWarnings("deprecation") private static String signer(PackageInfo info)throws Exception{
        Signature[] signatures=Build.VERSION.SDK_INT>=28&&info.signingInfo!=null?info.signingInfo.getApkContentsSigners():info.signatures;
        if(signatures==null||signatures.length!=1)throw problem("应用签名无法确认，请重新检查更新");
        return hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }
    static boolean newer(Context context,JSONObject manifest)throws Exception{return manifest.getLong("versionCode")>code(installed(context));}
    static String sha256(File file)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1)digest.update(buffer,0,count);}return hex(digest.digest());
    }
    private static String hex(byte[] digest){StringBuilder result=new StringBuilder();for(byte value:digest)result.append(String.format(java.util.Locale.US,"%02x",value&255));return result.toString();}
    static long integer(JSONObject manifest,String key)throws Exception{Object value=manifest.get(key);if(!(value instanceof Integer)&&!(value instanceof Long))throw problem("更新信息有误，请重新检查");return ((Number)value).longValue();}
    private static String string(JSONObject manifest,String key,int maximum)throws Exception{Object value=manifest.get(key);if(!(value instanceof String)||((String)value).length()>maximum||((String)value).isEmpty())throw problem("更新信息有误，请重新检查");return (String)value;}
    static boolean safeTransport(URL url){return "https".equals(url.getProtocol())&&(url.getPort()==-1||url.getPort()==443)&&url.getUserInfo()==null;}
    static boolean allowedHost(String host){return "github.com".equals(host)||"release-assets.githubusercontent.com".equals(host)||"objects.githubusercontent.com".equals(host);}
    static byte[] readLimited(InputStream input,int limit)throws IOException{ByteArrayOutputStream result=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1){if(result.size()+count>limit)throw problem("更新信息过大，请稍后重试");result.write(buffer,0,count);}return result.toByteArray();}
    private static String readManifest(Context context,long token)throws Exception{
        HttpURLConnection request=open(MANIFEST_URL,token);
        try(InputStream input=request.getInputStream()){ensureCurrent(token);byte[] value=readLimited(input,MAX_MANIFEST_BYTES);ensureCurrent(token);return new String(value,StandardCharsets.UTF_8);}finally{disconnect(request);}
    }
    private static HttpURLConnection open(String location,long token)throws Exception{
        URL url=new URL(location);
        for(int redirects=0;redirects<=5;redirects++){
            ensureCurrent(token);if(!safeTransport(url)||!allowedHost(url.getHost()))throw problem("更新下载地址无效，请重新检查");
            HttpURLConnection request=(HttpURLConnection)url.openConnection();request.setInstanceFollowRedirects(false);request.setConnectTimeout(12000);request.setReadTimeout(18000);request.setRequestProperty("User-Agent","DailyStudy-Updater/1");request.setRequestProperty("Accept-Encoding","identity");request.setUseCaches(false);
            synchronized(LOCK){ensureCurrent(token);connection=request;}
            int status;
            try{status=request.getResponseCode();}catch(Exception e){disconnect(request);throw e;}
            if(status==301||status==302||status==303||status==307||status==308){String next=request.getHeaderField("Location");disconnect(request);if(next==null)throw problem("更新下载地址不可用，请重试");url=new URL(url,next);continue;}
            if(status!=200){disconnect(request);if(status==404)throw problem("暂未找到更新，请稍后重试");if(status==403||status==429)throw problem("更新服务暂时繁忙，请稍后重试");throw problem("更新服务不可用，请稍后重试");}
            return request;
        }
        throw problem("更新下载地址不可用，请重试");
    }
    private static void disconnect(HttpURLConnection request){request.disconnect();synchronized(LOCK){if(connection==request)connection=null;}}
    private static boolean busy(){return "checking".equals(phase)||"downloading".equals(phase);}
    private static void ensureCurrent(long token)throws Cancelled{synchronized(LOCK){if(token!=generation)throw new Cancelled();}}
    private static void failed(long token,Exception cause,String fallback){synchronized(LOCK){if(token!=generation)return;phase="error";error=message(cause,fallback);}}
    private static String message(Exception error,String fallback){return error instanceof UpdateProblem?error.getMessage():fallback;}
    private static JSONObject cloneJson(JSONObject value)throws Exception{return new JSONObject(value.toString());}
    private static UpdateProblem problem(String message){return new UpdateProblem(message);}
    private static void changed(Runnable callback){if(callback!=null)MAIN.post(callback);}
    private static final class UpdateProblem extends IOException{UpdateProblem(String message){super(message);}}
    private static final class Cancelled extends IOException{}
}
