package cn.edu.njupt.studycheckin;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
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
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/** Offline UI with a narrowly scoped local bridge, system document backup and real widgets. */
public class MainActivity extends Activity {
    private static final int EXPORT=101,IMPORT=102,NOTIFY=103;
    private WebView webView;
    private boolean pageReady=false;
    @Override public void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(248,247,243));
        webView=new WebView(this);webView.setBackgroundColor(Color.rgb(248,247,243));
        root.addView(webView,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets i=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());v.setPadding(i.left,i.top,i.right,i.bottom);}
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });root.requestApplyInsets();
        WebSettings settings=webView.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);
        if(Build.VERSION.SDK_INT>=26)settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        webView.addJavascriptInterface(new Bridge(),"Native");
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){
                new AlertDialog.Builder(MainActivity.this).setTitle("确认操作").setMessage(message).setPositiveButton("确认",(d,w)->result.confirm()).setNegativeButton("取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){
                new AlertDialog.Builder(MainActivity.this).setTitle("每日学习").setMessage(message).setPositiveButton("知道了",(d,w)->result.confirm()).setOnCancelListener(d->result.confirm()).show();return true;
            }
        });
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
            @Override public void onPageFinished(WebView v,String url){pageReady=true;resumePage();}
        });
        webView.loadUrl("file:///android_asset/index.html");
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->handleBack());
        try{ReminderScheduler.schedule(this);}catch(Exception e){show(e.getMessage());}
    }
    @Override protected void onResume(){super.onResume();resumePage();try{StudyWidget.refreshAll(this);ReminderScheduler.schedule(this);}catch(Exception ignored){}}
    private void resumePage(){if(pageReady&&webView!=null)webView.evaluateJavascript("window.onNativeResume && window.onNativeResume()",null);}
    @Override public void onBackPressed(){handleBack();}
    private void handleBack(){webView.evaluateJavascript("window.handleNativeBack ? window.handleNativeBack() : false", result->{if(!"true".equals(result))finish();});}
    @Override protected void onDestroy(){if(webView!=null){webView.removeJavascriptInterface("Native");webView.destroy();}super.onDestroy();}
    private void show(String text){runOnUiThread(()->Toast.makeText(this,text==null?"操作失败":text,Toast.LENGTH_LONG).show());}
    private JSONObject success(){try{return new JSONObject().put("ok",true);}catch(Exception e){return new JSONObject();}}
    private String error(Exception e){try{return new JSONObject().put("error",e.getMessage()==null?"操作失败":e.getMessage()).toString();}catch(Exception ignored){return "{\"error\":\"操作失败\"}";}}
    private void refreshPlatforms(){runOnUiThread(()->{try{StudyWidget.refreshAll(this);ReminderScheduler.schedule(this);resumePage();}catch(Exception e){show(e.getMessage());}});}
    private void refreshService(){runOnUiThread(()->{
        try {
            if(TimerStore.snapshot(this).optBoolean("active")){
                Intent intent=new Intent(this,TimerService.class).setAction(TimerService.ACTION_REFRESH);startForegroundService(intent);
            } else stopService(new Intent(this,TimerService.class));
        }catch(Exception e){TimerStore.action(this,"pause");show("后台计时未能启动，已暂停："+e.getMessage());}
    });}
    private void requestNotifications(){
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFY);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==NOTIFY){ReminderScheduler.schedule(this);resumePage();if(grants.length==0||grants[0]!=PackageManager.PERMISSION_GRANTED)show("通知未授权；可继续打卡和计时，提醒暂不可用");}}
    public final class Bridge {
        @JavascriptInterface public String getState(){try{return DataStore.load(MainActivity.this).toString();}catch(Exception e){return error(e);}}
        @JavascriptInterface public String saveState(String raw){
            try {
                if(raw==null||raw.getBytes(StandardCharsets.UTF_8).length>DataStore.MAX_BYTES)throw new Exception("记录文件过大");
                JSONObject s=new JSONObject(raw);DataStore.validate(s);
                synchronized(DataStore.LOCK){
                    if(s.optLong("_revision",0)!=DataStore.load(MainActivity.this).optLong("_revision",0))throw new Exception("记录已更新，请刷新后再保存；当前编辑仍保留");
                    DataStore.save(MainActivity.this,s);
                }
                if(s.getJSONObject("settings").getJSONObject("reminders").optBoolean("enabled"))runOnUiThread(()->requestNotifications());
                refreshPlatforms();return success().put("revision",s.getLong("_revision")).toString();
            }catch(Exception e){return error(e);}
        }
        @JavascriptInterface public String getTimer(){return TimerStore.snapshot(MainActivity.this).toString();}
        @JavascriptInterface public String startTimer(String id,String name,String day){
            JSONObject result=TimerStore.start(MainActivity.this,id,name,day);
            if(!result.has("error")){refreshService();runOnUiThread(()->requestNotifications());}return result.toString();
        }
        @JavascriptInterface public String timerAction(String action){
            JSONObject result=TimerStore.action(MainActivity.this,action);if(!result.has("error")){refreshService();refreshPlatforms();}return result.toString();
        }
        @JavascriptInterface public String getPlatformInfo(){try{
            boolean granted=Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
            NotificationManager manager=getSystemService(NotificationManager.class);
            return new JSONObject().put("androidVersion",Build.VERSION.RELEASE).put("sdkInt",Build.VERSION.SDK_INT)
                .put("notificationsGranted",granted&&manager.areNotificationsEnabled()).put("remindersExact",false)
                .put("supportsPinWidget",getSystemService(AppWidgetManager.class).isRequestPinAppWidgetSupported()).toString();
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public String exportBackup(){runOnUiThread(()->{
            try{Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE,"每日学习_备份_"+LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))+".json");startActivityForResult(i,EXPORT);
            }catch(Exception e){show(e.getMessage());}
        });return success().toString();}
        @JavascriptInterface public String importBackup(){
            if(TimerStore.snapshot(MainActivity.this).optBoolean("active"))return error(new Exception("请先结束当前计时，再导入备份"));
            runOnUiThread(()->{try{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","application/octet-stream"});startActivityForResult(i,IMPORT);}catch(Exception e){show(e.getMessage());}});return success().toString();
        }
        @JavascriptInterface public String pinWidget(){try{
            AppWidgetManager manager=getSystemService(AppWidgetManager.class);if(!manager.isRequestPinAppWidgetSupported())throw new Exception("请长按桌面空白处，在小组件中选择“每日学习”");
            runOnUiThread(()->{try{manager.requestPinAppWidget(new ComponentName(MainActivity.this,StudyWidget.class),null,null);}catch(Exception e){show(e.getMessage());}});return success().toString();
        }catch(Exception e){return error(e);}}
        @JavascriptInterface public void toast(String text){show(text);}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;Uri uri=data.getData();
        try {
            if(request==EXPORT){
                byte[] bytes=DataStore.load(this).toString(2).getBytes(StandardCharsets.UTF_8);
                try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new Exception("无法写入所选文件");out.write(bytes);}
                show(TimerStore.snapshot(this).optBoolean("active")?"已导出已保存记录；当前计时请结束后另行备份":"备份已导出");
            } else if(request==IMPORT){
                JSONObject imported=new JSONObject(DataStore.readText(getContentResolver().openInputStream(uri)));DataStore.validate(imported);
                if(TimerStore.snapshot(this).optBoolean("active"))throw new Exception("请先结束当前计时，再导入备份");
                String description="计划："+imported.getJSONObject("plan").getString("title")+"\n日期："+imported.getJSONObject("plan").getString("startDate")+" 至 "+imported.getJSONObject("plan").getString("endDate")+"\n每日记录："+imported.getJSONObject("records").length()+"天\n\n将替换当前计划和全部记录。建议先导出当前备份。";
                new AlertDialog.Builder(this).setTitle("确认恢复备份").setMessage(description).setNegativeButton("取消",null)
                    .setPositiveButton("恢复备份",(dialog,which)->{try{if(TimerStore.snapshot(this).optBoolean("active"))throw new Exception("请先结束当前计时");DataStore.restore(this,imported);webView.evaluateJavascript("window.onBackupRestored && window.onBackupRestored()",null);refreshPlatforms();show("备份已恢复");}catch(Exception e){show(e.getMessage());}}).show();
            }
        }catch(Exception e){show("操作失败："+e.getMessage());}
    }
}
