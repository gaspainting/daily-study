package cn.edu.njupt.studycheckin;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

public final class ReminderScheduler {
    public static final String ACTION="cn.edu.njupt.studycheckin.REMINDER";
    private ReminderScheduler(){}
    public static boolean notificationsAllowed(Context c){return(Build.VERSION.SDK_INT<33||c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED)&&c.getSystemService(NotificationManager.class).areNotificationsEnabled();}
    public static void schedule(Context c){
        AlarmManager manager=c.getSystemService(AlarmManager.class);
        Intent intent=new Intent(c,ReminderReceiver.class).setAction(ACTION);
        PendingIntent existing=PendingIntent.getBroadcast(c,301,intent,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);
        if(existing!=null)manager.cancel(existing);
        try{
            JSONObject state=DataStore.load(c),r=state.getJSONObject("settings").getJSONObject("reminders"),p=state.getJSONObject("plan");
            if(!r.getBoolean("enabled")||!notificationsAllowed(c))return;
            ZonedDateTime now=ZonedDateTime.now();LocalDate end=LocalDate.parse(p.getString("endDate")),day=now.toLocalDate();LocalDate start=LocalDate.parse(p.getString("startDate"));
            if(day.isBefore(start))day=start;
            String delivered=c.getSharedPreferences("reminder_delivery",Context.MODE_PRIVATE).getString("date","");
            for(int i=0;i<731&&!day.isAfter(end);i++,day=day.plusDays(1)){
                LocalTime time=LocalTime.parse(r.getString(day.getDayOfWeek().getValue()>=6?"weekendTime":"weekdayTime"));
                ZonedDateTime slot=day.atTime(time).atZone(now.getZone());
                if(slot.isAfter(now)&&!delivered.equals(day.toString())&&AppRules.allowedTime(day,time.getHour(),time.getMinute())){
                    intent.putExtra("date",day.toString()).putExtra("scheduledAt",slot.toInstant().toEpochMilli());
                    PendingIntent next=PendingIntent.getBroadcast(c,301,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                    manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,slot.toInstant().toEpochMilli(),next);return;
                }
            }
        }catch(Exception ignored){/* Invalid or unavailable data must never cause unsolicited reminders. */}
    }
}
