package cn.edu.njupt.studycheckin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.time.Instant;
import java.time.ZoneId;

public final class BackupReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        try {
            long now = System.currentTimeMillis();
            if (BackupStatus.shouldNotify(context, intent, now)) {
                NotificationManager manager = context.getSystemService(NotificationManager.class);
                manager.createNotificationChannel(new NotificationChannel(BackupStatus.CHANNEL, "备份提醒", NotificationManager.IMPORTANCE_DEFAULT));
                Intent activity = new Intent(context, MainActivity.class).putExtra("route", "settings").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent open = PendingIntent.getActivity(context, 412, activity, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                long exported = context.getSharedPreferences(BackupStatus.PREFS, Context.MODE_PRIVATE).getLong("lastExportAt", 0);
                String text = exported == 0 ? "尚未导出备份" : "上次备份：" + Instant.ofEpochMilli(exported).atZone(ZoneId.systemDefault()).toLocalDate();
                Notification notification = new Notification.Builder(context, BackupStatus.CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("备份提醒")
                    .setContentText(text).setContentIntent(open).setAutoCancel(true).build();
                manager.notify(BackupStatus.NOTIFICATION_ID, notification);
                BackupStatus.delivered(context, intent.getLongExtra("scheduledAt", 0), now);
            }
        } catch (RuntimeException ignored) { } finally { BackupStatus.schedule(context); }
    }
}
