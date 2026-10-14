package cn.edu.njupt.studycheckin;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.provider.Settings;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.JsResult;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.view.WindowInsets;
import android.window.OnBackInvokedDispatcher;
import org.json.JSONObject;
import java.io.OutputStream;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.io.File;
import java.time.LocalDate;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import android.os.Handler;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/** Local UI; only native material fetches can reach the network. */
public class MainActivity extends Activity {
    private static final int EXPORT=101,IMPORT=102,NOTIFY=103,REPORT=104;
    private volatile JSONObject reportRequest;
    private volatile String recoveryError;
    private WebView webView;
    private boolean pageReady=false;
    private volatile boolean startupConsumed=false;
    private volatile boolean hasPaused=false;
    private volatile boolean startupPending=false;
    private final AtomicBoolean updateInstallBusy=new AtomicBoolean();
    private static volatile String pendingDaily=null,drawMessage="",drawDate="";
    private static final Object DRAW_LOCK=new Object();
    private static final ExecutorService IO=Executors.newFixedThreadPool(2);
    private static final AtomicBoolean FETCHING=new AtomicBoolean(),POSTER_BUSY=new AtomicBoolean();
    @Override public void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        startupConsumed=bundle!=null;
        try{recoverStorage();}catch(Exception ignored){}
        InspirationPoster.cleanOldExports(this);
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(248,247,243));
        webView=new WebView(this);webView.setBackgroundColor(Color.rgb(248,247,243));
        root.addView(webView,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(i.left,i.top,i.right,i.bottom);}
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });root.requestApplyInsets();
        WebSettings settings=webView.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale*100));
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBlockNetworkLoads(true);
        if(Build.VERSION.SDK_INT>=26)settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        webView.addJavascriptInterface(new Bridge(),"Native");
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){
                boolean discard=message.contains("丢弃")&&message.contains("计时"),edits=message.contains("未保存")&&!discard,clear=message.contains("清除")&&message.contains("草稿");
                new AlertDialog.Builder(MainActivity.this).setTitle(edits?"修改未保存":discard?"丢弃本次计时？":clear?"清除草稿？":"确认操作").setMessage(message).setPositiveButton(edits?"丢弃输入":discard?"丢弃":clear?"清除":"确认",(d,w)->result.confirm()).setNegativeButton(edits?"继续编辑":"取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){
                new AlertDialog.Builder(MainActivity.this).setTitle("每日学习").setMessage(message).setPositiveButton("知道了",(d,w)->result.confirm()).setOnCancelListener(d->result.confirm()).show();return true;
            }
        });
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                Uri uri=r.getUrl();if("study.local".equals(uri.getHost())){
                    try{if(!"https".equals(uri.getScheme())||uri.getPathSegments().size()!=2||!"media".equals(uri.getPathSegments().get(0)))throw new Exception("图片路径无效");String key=uri.getLastPathSegment();return new WebResourceResponse(key.endsWith(".png")?"image/png":"image/jpeg",null,new FileInputStream(InspirationStore.media(MainActivity.this,key)));}
                    catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",null,new java.io.ByteArrayInputStream(new byte[0]));}
                }return null;
            }
            @Override public void onPageFinished(WebView v,String url){pageReady=true;resumePage();new Handler(getMainLooper()).postDelayed(()->refreshInspiration(false),6000);}
        });
        webView.loadUrl("file:///android_asset/index.html");
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->handleBack());
        if(recoveryError==null)try{ReminderScheduler.schedule(this);}catch(Exception e){show(e.getMessage());}
    }
    @Override protected void onResume(){super.onResume();updateInstallBusy.set(false);resumePage();if(recoveryError==null)try{StudyWidget.refreshAll(this);ReminderScheduler.schedule(this);BackupStatus.schedule(this);}catch(Exception ignored){}}
    @Override protected void onPause(){startupConsumed=true;startupPending=false;hasPaused=true;if(webView!=null)webView.evaluateJavascript("window.InspirationUI && window.InspirationUI.background()",null);super.onPause();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);resumePage();}
    private void resumePage(){if(pageReady&&webView!=null)webView.evaluateJavascript((hasPaused?"window.InspirationUI && window.InspirationUI.background();":"")+"window.onNativeResume && window.onNativeResume()",null);}
    @Override public void onBackPressed(){handleBack();}
    private void handleBack(){webView.evaluateJavascript("window.handleNativeBack ? window.handleNativeBack() : false", result->{if(!"true".equals(result))finish();});}
    @Override protected void onDestroy(){pageReady=false;if(webView!=null){webView.removeJavascriptInterface("Native");webView.destroy();webView=null;}super.onDestroy();}
    private void show(String text){runOnUiThread(()->Toast.makeText(this,text==null?"操作失败":text,Toast.LENGTH_LONG).show());}
    private void recoverStorage()throws Exception{try{PlanStore.recover(this);BackupManager.recover(this);recoveryError=null;}catch(Exception e){recoveryError="上次恢复未完成，请重新读取";throw new Exception(recoveryError);}}
    private void storageReady()throws Exception{if(recoveryError!=null||new File(getFilesDir(),"plan-switch-journal.json").exists()||new File(getFilesDir(),"plan-switch-journal.json.bak").exists()||new File(getFilesDir(),"restore-journal.json").exists()||new File(getFilesDir(),"restore-journal.json.bak").exists())recoverStorage();}
    private void backupCheckFailed(Exception error){runOnUiThread(()->{
        if(isFinishing()||isDestroyed())return;
        new AlertDialog.Builder(this).setTitle("备份检查失败").setMessage(error.getMessage())
            .setNegativeButton("取消",null).setPositiveButton("重新选择",(d,w)->{
                try{JSONObject result=new JSONObject(new Bridge().importBackup());if(result.has("error"))show(result.getString("error"));}catch(Exception e){show(e.getMessage());}
            }).show();
    });}
    private void inspirationChanged(){runOnUiThread(()->{if(pageReady&&webView!=null)webView.evaluateJavascript("window.onInspirationChanged && window.onInspirationChanged()",null);});}
    private void updateChanged(){runOnUiThread(()->{if(pageReady&&webView!=null&&!isDestroyed())webView.evaluateJavascript("window.onAppUpdateChanged && window.onAppUpdateChanged()",null);});}
    private void finishPendingDaily(boolean allowCached){synchronized(DRAW_LOCK){if(pendingDaily==null)return;String day=pendingDaily;
        try{if(!day.equals(LocalDate.now().toString())){pendingDaily=null;drawMessage="日期已改变，请为今天重新抽签";return;}JSONObject state=InspirationStore.snapshot(getApplicationContext(),"daily",0,1);if(state.getInt("ready")==0&&!allowCached)return;InspirationStore.record(getApplicationContext(),"daily",day);drawMessage="";}
        catch(Exception e){if(!allowCached)return;drawMessage="日签未生成："+e.getMessage();}pendingDaily=null;
    }}
    private void refreshInspiration(boolean manual){
        if(recoveryError!=null)return;
        try{if(!InspirationStore.load(this).getJSONObject("settings").getBoolean("online")){if(manual)show("联网素材已关闭");return;}}
        catch(Exception e){if(manual)show(e.getMessage());return;}
        if(!FETCHING.compareAndSet(false,true))return;inspirationChanged();
        android.content.Context context=getApplicationContext();IO.execute(()->{try{String message=InspirationSources.refresh(context,()->{finishPendingDaily(false);inspirationChanged();});if(manual)show(message);}catch(Exception e){if(manual)show("素材暂未更新："+e.getMessage());}finally{FETCHING.set(false);finishPendingDaily(true);inspirationChanged();}});
    }
    private String makePoster(String id,boolean share){
        try{storageReady();}catch(Exception e){return error(e);}
        if(!POSTER_BUSY.compareAndSet(false,true))return error(new Exception("图文正在生成，请稍候"));
        IO.execute(()->{try{ArrayList<File> files=InspirationPoster.render(getApplicationContext(),id);if(share||Build.VERSION.SDK_INT<29){Intent intent=InspirationPoster.share(getApplicationContext(),files,id);runOnUiThread(()->{try{startActivity(intent);}catch(Exception e){show("无法打开分享面板："+e.getMessage());}});}else show("已保存 "+InspirationPoster.saveToGallery(getApplicationContext(),files)+" 张图片到相册 / 每日学习");}catch(Exception e){show("图文导出失败："+e.getMessage());}finally{POSTER_BUSY.set(false);}});return success().toString();
    }
    private JSONObject success(){try{return new JSONObject().put("ok",true);}catch(Exception e){return new JSONObject();}}
    private String error(Exception e){try{return new JSONObject().put("error",e.getMessage()==null?"操作失败":e.getMessage()).toString();}catch(Exception ignored){return "{\"error\":\"操作失败\"}";}}
    private void refreshPlatforms(){runOnUiThread(()->{try{StudyWidget.refreshAll(this);ReminderScheduler.schedule(this);resumePage();}catch(Exception e){show(e.getMessage());}});}
    private void refreshService(){runOnUiThread(()->{
        try {
            if(TimerStore.snapshot(this).optBoolean("active")){
                Intent intent=new Intent(this,TimerService.class).setAction(TimerService.ACTION_REFRESH);startForegroundService(intent);
            } else stopService(new Intent(this,TimerService.class));
        }catch(Exception e){JSONObject paused=TimerStore.action(this,"pause");show("后台计时启动失败："+e.getMessage()+(paused.has("error")?"；暂停失败，请重试":"；计时已暂停"));}
    });}
    private void requestNotifications(){
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFY);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==NOTIFY){ReminderScheduler.schedule(this);resumePage();}}
    public final class Bridge {
        @JavascriptInterface public String getLaunchRoute(){try{String route=getIntent().getStringExtra("route");getIntent().removeExtra("route");return new JSONObject().put("route","settings".equals(route)?"settings":"").toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String getDraft(String key){try{storageReady();JSONObject draft=DraftStore.get(MainActivity.this,key);return new JSONObject().put("draft",draft==null?JSONObject.NULL:draft).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String saveDraft(String key,String base,String values){try{storageReady();DraftStore.save(MainActivity.this,key,new JSONObject(base),new JSONObject(values));return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String deleteDraft(String key){try{storageReady();DraftStore.delete(MainActivity.this,key);return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String clearDrafts(){try{storageReady();DraftStore.clear(MainActivity.this);return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String getPlans(){try{storageReady();return PlanStore.list(MainActivity.this).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String createPlan(String raw){try{storageReady();return success().put("id",PlanStore.create(MainActivity.this,new JSONObject(raw))).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String switchPlan(String id){try{storageReady();PlanStore.switchTo(MainActivity.this,id);refreshPlatforms();return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String getBackupStatus(){try{return BackupStatus.get(MainActivity.this).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String openBackupNotificationSettings(){runOnUiThread(()->{try{Intent intent=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName());if(ReminderScheduler.notificationsGloballyAllowed(MainActivity.this))intent=new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,"backup_reminders");startActivity(intent);}catch(Exception e){show("无法打开通知设置，请重试");}});return success().toString();}
        @JavascriptInterface public String setBackupReminder(boolean enabled,int days){try{return BackupStatus.set(MainActivity.this,enabled,days).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String exportReport(String format,String start,String end,String subjectId){try{storageReady();
            if(!"csv".equals(format)&&!"pdf".equals(format))throw new Exception("请选择 CSV 或 PDF");
            JSONObject request=new JSONObject().put("format",format).put("start",start).put("end",end).put("subjectId",subjectId).put("state",DataStore.readStable(MainActivity.this));
            synchronized(MainActivity.this){if(reportRequest!=null)throw new Exception("报表正在导出");reportRequest=request;}
            runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("pdf".equals(format)?"application/pdf":"text/csv").putExtra(Intent.EXTRA_TITLE,"每日学习_"+start+"_"+end+"."+format);startActivityForResult(intent,REPORT);}catch(Exception e){reportRequest=null;show("无法选择保存位置，请重试");}});return success().toString();
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public String searchInspiration(String scope,int offset,int limit,String query,String theme,String language){try{return InspirationSearch.snapshot(MainActivity.this,scope,offset,limit,query,theme,language).put("fetching",FETCHING.get()).put("posterBusy",POSTER_BUSY.get()).put("drawing",pendingDaily!=null).put("drawMessage",LocalDate.now().toString().equals(drawDate)?drawMessage:"").toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String getInspirationFilters(){try{return InspirationSearch.facets(MainActivity.this).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String getUpdateState(){try{return UpdateManager.state(MainActivity.this).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String checkUpdate(){try{UpdateManager.check(getApplicationContext(),MainActivity.this::updateChanged);return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String downloadUpdate(){try{UpdateManager.download(getApplicationContext(),MainActivity.this::updateChanged);return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String cancelUpdate(){try{UpdateManager.cancel(getApplicationContext());updateChanged();return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String installUpdate(){
            JSONObject timer=TimerStore.snapshot(MainActivity.this);
            if(timer.has("error"))return error(new Exception("计时状态读取失败，请重试"));
            if(timer.optBoolean("active"))return error(new Exception("请先结束当前计时，再安装更新"));
            if(!updateInstallBusy.compareAndSet(false,true))return error(new Exception("安装界面正在打开，请稍候"));
            runOnUiThread(()->{try{
                if(!getPackageManager().canRequestPackageInstalls()){
                    Intent permission=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName()));
                    startActivity(permission);return;
                }
                IO.execute(()->{try{Intent install=UpdateManager.prepareInstall(getApplicationContext());runOnUiThread(()->{
                    try{if(TimerStore.snapshot(MainActivity.this).optBoolean("active"))throw new Exception("请先结束当前计时，再安装更新");startActivity(install);}
                    catch(Exception e){updateInstallBusy.set(false);show("无法开始安装："+e.getMessage());updateChanged();}
                });}catch(Exception e){updateInstallBusy.set(false);show(e.getMessage());updateChanged();}});
            }catch(Exception e){updateInstallBusy.set(false);show("无法打开安装设置："+e.getMessage());updateChanged();}});
            return success().toString();
        }
        @JavascriptInterface public String getStartup(){try{storageReady();if(startupConsumed)return new JSONObject().put("show",false).toString();startupConsumed=true;
            try{return new JSONObject().put("show",true).put("entry",InspirationStore.record(MainActivity.this,"startup",LocalDate.now().toString())).toString();}
            catch(InspirationStore.NoImageException missing){JSONObject s=InspirationStore.load(MainActivity.this);if(!s.getJSONObject("settings").getBoolean("online"))return new JSONObject().put("show",false).toString();startupPending=true;MainActivity.this.refreshInspiration(false);return new JSONObject().put("show",true).put("waiting",true).toString();}
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public String nextStartup(){try{storageReady();if(!startupPending||hasPaused)return new JSONObject().put("show",false).toString();try{JSONObject entry=InspirationStore.record(MainActivity.this,"startup",LocalDate.now().toString());startupPending=false;return new JSONObject().put("show",true).put("entry",entry).toString();}catch(InspirationStore.NoImageException missing){return new JSONObject().put("show",false).put("waiting",true).toString();}}catch(Exception e){return error(e);}}
        @JavascriptInterface public String cancelStartup(){startupPending=false;return success().toString();}
        @JavascriptInterface public String getInspiration(String scope,int offset,int limit){try{return InspirationStore.snapshot(MainActivity.this,scope,offset,limit).put("fetching",FETCHING.get()).put("posterBusy",POSTER_BUSY.get()).put("drawing",pendingDaily!=null).put("drawMessage",LocalDate.now().toString().equals(drawDate)?drawMessage:"").toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String drawDaily(){try{storageReady();String day=LocalDate.now().toString();JSONObject s=InspirationStore.snapshot(MainActivity.this,"daily",0,1);if(!s.isNull("daily"))return s.getJSONObject("daily").toString();
            drawDate=day;
            if(s.getBoolean("online")&&s.getInt("ready")==0){synchronized(DRAW_LOCK){if(pendingDaily==null){pendingDaily=day;drawMessage="正在获取日签图片…";}}MainActivity.this.refreshInspiration(false);inspirationChanged();return new JSONObject().put("pending",true).toString();}
            JSONObject result=InspirationStore.record(MainActivity.this,"daily",day);drawMessage="";inspirationChanged();return result.toString();
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public String getInspirationEntry(String id){try{return InspirationStore.getEntry(MainActivity.this,id).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String favoriteInspiration(String id,boolean value){try{storageReady();InspirationStore.favorite(MainActivity.this,id,value);inspirationChanged();return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String setInspirationOnline(boolean value){try{storageReady();InspirationStore.online(MainActivity.this,value);inspirationChanged();return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String refreshInspiration(){try{storageReady();MainActivity.this.refreshInspiration(true);return success().toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String cleanInspirationPending(){try{storageReady();if(FETCHING.get())throw new Exception("请等本次素材准备结束后再清理");int n=InspirationStore.cleanPending(MainActivity.this);inspirationChanged();return success().put("removed",n).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String saveInspirationImage(String id){return makePoster(id,false);}
        @JavascriptInterface public String shareInspiration(String id){return makePoster(id,true);}
        @JavascriptInterface public String getState(){try{synchronized(DataStore.LOCK){storageReady();return DataStore.readStable(MainActivity.this).toString();}}catch(Exception e){return error(e);}}
        @JavascriptInterface public String saveState(String raw){
            try {
                storageReady();
                if(raw==null||raw.getBytes(StandardCharsets.UTF_8).length>DataStore.MAX_BYTES)throw new Exception("记录文件过大");
                JSONObject s=new JSONObject(raw);DataStore.validate(s);
                synchronized(DataStore.LOCK){
                    storageReady();DataStore.requireNoPendingRecovery(MainActivity.this);
                    if(s.optLong("_revision",0)!=DataStore.load(MainActivity.this).optLong("_revision",0))throw new Exception("记录已更新，请刷新后再保存；当前编辑仍保留");
                    DataStore.save(MainActivity.this,s);
                }
                refreshPlatforms();return success().put("revision",s.getLong("_revision")).toString();
            }catch(Exception e){return error(e);}
        }
        @JavascriptInterface public String getTimer(){return TimerStore.snapshot(MainActivity.this).toString();}
        @JavascriptInterface public String startTimer(String id,String name,String day){
            try{storageReady();}catch(Exception e){return error(e);}
            JSONObject result=TimerStore.start(MainActivity.this,id,name,day);
            if(!result.has("error")){refreshService();runOnUiThread(()->requestNotifications());}return result.toString();
        }
        @JavascriptInterface public String timerAction(String action){
            try{storageReady();}catch(Exception e){return error(e);}
            JSONObject result=TimerStore.action(MainActivity.this,action);if(!result.has("error")){refreshService();refreshPlatforms();}return result.toString();
        }
        @JavascriptInterface public String getAppInfo(){try{
            PackageInfo p=getPackageManager().getPackageInfo(getPackageName(),0);
            return new JSONObject().put("versionName",p.versionName).put("versionCode",Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode).put("packageName",p.packageName).toString();
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public String getFontLicense(){try{return new JSONObject().put("text",DataStore.readText(getAssets().open("report-font-OFL.txt"))).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String requestNotificationAccess(){runOnUiThread(()->requestNotifications());return success().toString();}
        @JavascriptInterface public String openNotificationSettings(){runOnUiThread(()->{try{
            Intent i=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName());
            if(ReminderScheduler.notificationsGloballyAllowed(MainActivity.this)&&!ReminderScheduler.reminderChannelAllowed(MainActivity.this))i=new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,"study_reminders");
            startActivity(i);
        }catch(Exception e){show("无法打开通知设置："+e.getMessage());}});return success().toString();}
        @JavascriptInterface public String getPlatformInfo(){try{
            boolean granted=Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
            NotificationManager manager=getSystemService(NotificationManager.class);
            return new JSONObject().put("androidVersion",Build.VERSION.RELEASE).put("sdkInt",Build.VERSION.SDK_INT).put("fontScale",getResources().getConfiguration().fontScale)
                .put("runtimePermissionGranted",granted).put("notificationsEnabled",manager.areNotificationsEnabled()).put("reminderChannelEnabled",ReminderScheduler.reminderChannelAllowed(MainActivity.this))
                .put("notificationsGranted",ReminderScheduler.notificationsAllowed(MainActivity.this)).put("remindersExact",false)
                .put("supportsPinWidget",getSystemService(AppWidgetManager.class).isRequestPinAppWidgetSupported()).toString();
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public String exportBackup(){try{storageReady();}catch(Exception e){return error(e);}runOnUiThread(()->{
            try{Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip");
                i.putExtra(Intent.EXTRA_TITLE,"每日学习_完整备份_"+LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))+".zip");startActivityForResult(i,EXPORT);
            }catch(Exception e){show(e.getMessage());}
        });return success().toString();}
        @JavascriptInterface public String importBackup(){
            try{storageReady();}catch(Exception e){return error(e);}
            if(TimerStore.snapshot(MainActivity.this).optBoolean("active"))return error(new Exception("请先结束当前计时，再导入备份"));
            runOnUiThread(()->{try{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/zip","application/x-zip-compressed","application/json","text/plain","application/octet-stream"});startActivityForResult(i,IMPORT);}catch(Exception e){show(e.getMessage());}});return success().toString();
        }
        @JavascriptInterface public String pinWidget(){try{
            AppWidgetManager manager=getSystemService(AppWidgetManager.class);if(!manager.isRequestPinAppWidgetSupported())return success().put("requested",false).put("unsupported",true).toString();
            Intent completed=new Intent(MainActivity.this,WidgetPinReceiver.class).setAction(WidgetPinReceiver.ACTION);
            int flags=PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0);
            PendingIntent callback=PendingIntent.getBroadcast(MainActivity.this,401,completed,flags);
            boolean requested=manager.requestPinAppWidget(new ComponentName(MainActivity.this,StudyWidget.class),null,callback);
            return success().put("requested",requested).put("unsupported",!requested).toString();
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public void toast(String text){show(text);}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null){if(request==REPORT)reportRequest=null;return;}Uri uri=data.getData();
        try {
            if(request==REPORT){JSONObject selected=reportRequest;IO.execute(()->{try{if(selected==null)throw new Exception("请重新选择报表范围");try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new Exception("无法写入所选文件");ReportExport.write(getApplicationContext(),selected.getJSONObject("state"),out,selected.getString("format"),selected.getString("start"),selected.getString("end"),selected.getString("subjectId"));}show("报表已导出");}catch(Exception e){show("报表导出失败，请重试");}finally{reportRequest=null;}});
            }else if(request==EXPORT){
                show("正在导出备份…");IO.execute(()->{try{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new Exception("无法写入所选文件");BackupManager.export(getApplicationContext(),out);}}catch(Exception e){show("导出失败，请勿使用不完整文件："+e.getMessage());return;}try{BackupStatus.markExportSuccess(getApplicationContext());show(TimerStore.snapshot(this).optBoolean("active")?"备份已导出，未包含当前计时":"备份已导出");}catch(Exception e){show("备份已导出，日期未能更新");}runOnUiThread(()->resumePage());});
            } else if(request==IMPORT){
                show("正在检查备份…");IO.execute(()->{BackupManager.Imported imported=null;try{
                    imported=BackupManager.read(getApplicationContext(),getContentResolver().openInputStream(uri));if(TimerStore.snapshot(this).optBoolean("active"))throw new Exception("请先结束当前计时，再导入备份");JSONObject study=imported.study;String targetPlan=PlanStore.activeId(getApplicationContext());
                    String scope=imported.allPlans()?"将替换全部计划及其学习记录、计时明细、复盘、学习提醒设置，以及日签图片、历史和收藏；未保存草稿将清除。":imported.complete()?"将替换当前计划的学习记录、计时明细、复盘、学习提醒设置和草稿，以及日签图片、历史和收藏。其他计划保留。":"将替换当前计划的学习记录、计时明细、复盘、学习提醒设置和草稿。其他计划和日签保留。";
                    String description="备份计划："+study.getJSONObject("plan").getString("title")+"\n日期："+study.getJSONObject("plan").getString("startDate")+" 至 "+study.getJSONObject("plan").getString("endDate")+"\n学习记录："+study.getJSONObject("records").length()+"天\n"+(imported.allPlans()?"备份共 "+imported.planCount()+" 个计划；当前共 "+PlanStore.list(getApplicationContext()).getJSONArray("plans").length()+" 个计划\n":"当前计划："+DataStore.load(getApplicationContext()).getJSONObject("plan").getString("title")+"\n")+"\n"+scope+"\n此操作不能撤销。";
                    BackupManager.Imported checked=imported;runOnUiThread(()->{if(isFinishing()||isDestroyed()){checked.close();return;}new AlertDialog.Builder(this).setTitle(checked.allPlans()?"恢复并替换全部计划？":"恢复并替换当前计划？").setMessage(description).setNegativeButton("取消",(d,w)->checked.close()).setOnCancelListener(d->checked.close()).setPositiveButton("恢复并替换",(dialog,which)->IO.execute(()->{try{if(!targetPlan.equals(PlanStore.activeId(getApplicationContext())))throw new Exception("当前计划已切换，请重新选择备份");BackupManager.restore(getApplicationContext(),checked);boolean draftsCleared=true;try{if(checked.allPlans())DraftStore.clear(getApplicationContext());else DraftStore.deletePrefix(getApplicationContext(),targetPlan+":");}catch(Exception cleanup){draftsCleared=false;}runOnUiThread(()->{if(webView!=null)webView.evaluateJavascript("window.onBackupRestored && window.onBackupRestored()",null);refreshPlatforms();inspirationChanged();});show(draftsCleared?"备份已恢复":"备份已恢复，草稿未能清除");}catch(Exception e){show("恢复失败："+e.getMessage());}finally{checked.close();}})).show();});
                }catch(Exception e){if(imported!=null)imported.close();backupCheckFailed(e);}});
            }
        }catch(Exception e){show("操作失败："+e.getMessage());}
    }
}
