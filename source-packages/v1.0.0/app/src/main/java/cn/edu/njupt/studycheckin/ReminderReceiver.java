package cn.edu.njupt.studycheckin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalDateTime;

public final class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent){
        try{
            if(ReminderScheduler.ACTION.equals(intent.getAction())){
                JSONObject s=DataStore.load(c),p=s.getJSONObject("plan");String day=LocalDate.now().toString();long scheduled=intent.getLongExtra("scheduledAt",0),now=System.currentTimeMillis();
                boolean duplicate=day.equals(c.getSharedPreferences("reminder_delivery",Context.MODE_PRIVATE).getString("date",""));
                if(s.getJSONObject("settings").getJSONObject("reminders").getBoolean("enabled")&&ReminderScheduler.notificationsAllowed(c)&&!duplicate
                    &&day.equals(intent.getStringExtra("date"))&&day.compareTo(p.getString("startDate"))>=0&&day.compareTo(p.getString("endDate"))<=0
                    &&scheduled>0&&now>=scheduled&&now-scheduled<=3600000&&AppRules.allowed(LocalDateTime.now())){
                    NotificationManager manager=c.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("study_reminders","学习提醒",NotificationManager.IMPORTANCE_DEFAULT));
                    PendingIntent open=PendingIntent.getActivity(c,302,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                    Notification n=new Notification.Builder(c,"study_reminders").setSmallIcon(R.drawable.ic_notification).setContentTitle("留一点时间给今天")
                        .setContentText("按状态选择学习、回顾或休息。参考量可以调整。").setAutoCancel(true).setContentIntent(open).build();manager.notify(31,n);
                    c.getSharedPreferences("reminder_delivery",Context.MODE_PRIVATE).edit().putString("date",day).commit();
                }
            }
        }catch(Exception ignored){}finally{ReminderScheduler.schedule(c);StudyWidget.refreshAll(c);}
    }
}
