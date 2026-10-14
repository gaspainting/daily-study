package cn.edu.njupt.studycheckin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.json.JSONObject;
import java.util.Locale;

public final class TimerService extends Service {
    public static final String ACTION_REFRESH="cn.edu.njupt.studycheckin.REFRESH_TIMER";
    private static final String PREFIX="cn.edu.njupt.studycheckin.TIMER_";
    private static final String CHANNEL="study_timer";
    private static final int NOTIFICATION=21;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private String signature="";
    private final Runnable tick=new Runnable(){@Override public void run(){if(update(false))handler.postDelayed(this,1000);}};
    @Override public void onCreate(){super.onCreate();getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"学习计时",NotificationManager.IMPORTANCE_LOW));}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        String action=intent==null?null:intent.getAction();
        if(action!=null&&action.startsWith(PREFIX)){
            JSONObject result=TimerStore.action(this,action.substring(PREFIX.length()));
            if(result.has("error"))android.widget.Toast.makeText(this,result.optString("error"),android.widget.Toast.LENGTH_LONG).show();
            StudyWidget.refreshAll(this);
        }
        handler.removeCallbacks(tick);if(update(true))handler.postDelayed(tick,1000);
        return START_NOT_STICKY;
    }
    private boolean update(boolean force){
        JSONObject t=TimerStore.snapshot(this);
        if(t.has("error")||!t.optBoolean("active")){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return false;}
        boolean running=t.optBoolean("running");long ms=t.optLong("elapsedMs");
        String next=t.optString("subjectId")+"|"+running+"|"+t.optString("message")+(running?"":("|"+ms));
        if(force||!next.equals(signature)){
            signature=next;
            PendingIntent open=PendingIntent.getActivity(this,201,new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            String duration=String.format(Locale.ROOT,"%02d:%02d:%02d",ms/3600000,(ms/60000)%60,(ms/1000)%60);
            String message=t.optString("message");if(message.isEmpty())message=running?"正在计时":"已暂停 · "+duration;
            Notification.Builder b=new Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle(t.optString("subjectName")+" · "+(running?"正在学习":"已暂停"))
                .setContentText(message).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_SERVICE)
                .setWhen(System.currentTimeMillis()-ms).setShowWhen(running).setUsesChronometer(running);
            b.addAction(action(running?"pause":"resume",running?"暂停":"继续",202));b.addAction(action("finish","结束并保存",203));
            if(Build.VERSION.SDK_INT>=34)startForeground(NOTIFICATION,b.build(),ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(NOTIFICATION,b.build());
        }
        return true;
    }
    private Notification.Action action(String name,String label,int request){
        PendingIntent pending=PendingIntent.getService(this,request,new Intent(this,TimerService.class).setAction(PREFIX+name),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(this,R.drawable.ic_notification),label,pending).build();
    }
    @Override public void onDestroy(){handler.removeCallbacks(tick);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
