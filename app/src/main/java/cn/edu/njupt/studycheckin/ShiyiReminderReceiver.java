package cn.edu.njupt.studycheckin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

public final class ShiyiReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (!ShiyiReminderScheduler.ACTION.equals(intent.getAction())) {
            try { ShiyiReminderScheduler.schedule(c); } catch (Exception ignored) {}
            return;
        }
        try {
            String eventId = intent.getStringExtra("eventId"); if (eventId == null) return;
            NotificationManager manager = c.getSystemService(NotificationManager.class); manager.createNotificationChannel(new NotificationChannel("shiyi_reminders", "拾遗提醒", NotificationManager.IMPORTANCE_DEFAULT));
            String link = intent.getStringExtra("deepLink"); Intent open = new Intent(c, MainActivity.class).setData(link == null ? Uri.parse("daily-study://review") : Uri.parse(link)).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent pending = PendingIntent.getActivity(c, Math.abs(eventId.hashCode()), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification n = new Notification.Builder(c, "shiyi_reminders").setSmallIcon(R.drawable.ic_notification).setContentTitle(intent.getStringExtra("title") == null ? "拾遗回顾提醒" : intent.getStringExtra("title")).setContentText("打开每日学习查看回顾").setAutoCancel(true).setContentIntent(pending).build(); manager.notify(Math.abs(eventId.hashCode()), n); SyncStore.markReminderDelivered(c, eventId);
        } catch (Exception ignored) {}
    }
}
