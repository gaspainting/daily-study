package cn.edu.njupt.studycheckin;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import java.time.Instant;

/** Schedules confirmed downlink reminders locally; it does not assert that a notification was seen. */
public final class ShiyiReminderScheduler {
    public static final String ACTION = "cn.edu.njupt.studycheckin.SHIYI_REMINDER";
    private ShiyiReminderScheduler() {}
    public static void schedule(Context c) throws Exception {
        AlarmManager manager = c.getSystemService(AlarmManager.class);
        for (org.json.JSONObject reminder : toList(SyncStore.reminders(c))) {
            if (!"confirmed".equals(reminder.optString("status")) && !"scheduled".equals(reminder.optString("status"))) continue;
            long at = Instant.parse(reminder.getString("atUtc")).toEpochMilli(); if (at <= System.currentTimeMillis()) continue;
            int request = Math.abs(reminder.getString("eventId").hashCode()); Intent intent = new Intent(c, ShiyiReminderReceiver.class).setAction(ACTION).putExtra("eventId", reminder.getString("eventId")).putExtra("title", reminder.getString("title")).putExtra("deepLink", reminder.getString("deepLink"));
            PendingIntent pending = PendingIntent.getBroadcast(c, request, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE); manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending); reminder.put("status", "scheduled"); SyncStore.saveReminder(c, reminder);
        }
    }
    private static java.util.List<org.json.JSONObject> toList(org.json.JSONArray values) throws Exception { java.util.List<org.json.JSONObject> result = new java.util.ArrayList<>(); for (int i = 0; i < values.length(); i++) result.add(values.getJSONObject(i)); return result; }
}
