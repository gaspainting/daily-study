package cn.edu.njupt.studycheckin;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONObject;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

/** Backup completion metadata is independent of learning records and readable reports. */
public final class BackupStatus {
    static final String PREFS = "backup_status";
    public static final String ACTION = "cn.edu.njupt.studycheckin.BACKUP_REMINDER";
    static final String CHANNEL = "backup_reminders";
    static final int ALARM_REQUEST = 411;
    static final int NOTIFICATION_ID = 41;
    private static final Object LOCK = new Object();
    private BackupStatus() {}
    private static SharedPreferences preferences(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static JSONObject get(Context context) throws Exception {
        synchronized (LOCK) {
            SharedPreferences preferences = preferences(context);
            long last = preferences.getLong("lastExportAt", 0), next = preferences.getLong("nextReminderAt", 0);
            return new JSONObject().put("lastExportAt", last == 0 ? JSONObject.NULL : Instant.ofEpochMilli(last).toString())
                .put("reminderEnabled", preferences.getBoolean("enabled", false)).put("reminderDays", preferences.getInt("days", 7))
                .put("nextReminderAt", next == 0 ? JSONObject.NULL : Instant.ofEpochMilli(next).toString())
                .put("notificationsAllowed", notificationsAllowed(context));
        }
    }
    public static void markExportSuccess(Context context) throws Exception {
        synchronized (LOCK) {
            if (!preferences(context).edit().putLong("lastExportAt", System.currentTimeMillis()).commit()) throw new IOException("备份日期记录失败");
            schedule(context);
        }
    }
    public static JSONObject set(Context context, boolean enabled, int days) throws Exception {
        if (days != 7 && days != 14 && days != 30) throw new Exception("备份提醒间隔须为 7、14 或 30 天");
        synchronized (LOCK) {
            SharedPreferences preferences = preferences(context);
            SharedPreferences.Editor editor = preferences.edit().putBoolean("enabled", enabled).putInt("days", days);
            if (enabled && !preferences.getBoolean("enabled", false)) editor.putLong("enabledAt", System.currentTimeMillis());
            if (!editor.commit()) throw new IOException("备份提醒保存失败");
            if (!enabled) context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
            schedule(context);
            return get(context);
        }
    }
    public static boolean notificationsAllowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if ((Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) || !manager.areNotificationsEnabled()) return false;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    static long nextSlot(long base, int days, ZonedDateTime now) {
        LocalDate due = Instant.ofEpochMilli(base).atZone(now.getZone()).toLocalDate().plusDays(days);
        if (due.isBefore(now.toLocalDate())) due = now.toLocalDate();
        ZonedDateTime slot = due.atTime(LocalTime.of(18, 0)).atZone(now.getZone());
        if (!slot.isAfter(now)) slot = due.plusDays(1).atTime(LocalTime.of(18, 0)).atZone(now.getZone());
        return slot.toInstant().toEpochMilli();
    }
    public static void schedule(Context context) {
        synchronized (LOCK) {
            AlarmManager manager = context.getSystemService(AlarmManager.class);
            Intent intent = new Intent(context, BackupReminderReceiver.class).setAction(ACTION);
            PendingIntent previous = PendingIntent.getBroadcast(context, ALARM_REQUEST, intent, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (previous != null) manager.cancel(previous);
            SharedPreferences preferences = preferences(context);
            if (!preferences.getBoolean("enabled", false) || !notificationsAllowed(context)) {
                preferences.edit().remove("nextReminderAt").commit(); return;
            }
            long base = Math.max(preferences.getLong("lastExportAt", 0), Math.max(preferences.getLong("lastReminderAt", 0), preferences.getLong("enabledAt", 0)));
            if (base == 0) base = System.currentTimeMillis();
            int days = preferences.getInt("days", 7);
            if (days != 7 && days != 14 && days != 30) { preferences.edit().remove("nextReminderAt").commit(); return; }
            long next = nextSlot(base, days, ZonedDateTime.now());
            if (!preferences.edit().putLong("nextReminderAt", next).commit()) return;
            intent.putExtra("scheduledAt", next);
            PendingIntent alarm = PendingIntent.getBroadcast(context, ALARM_REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            try { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, alarm); }
            catch (RuntimeException e) { preferences.edit().remove("nextReminderAt").commit(); }
        }
    }
    static boolean shouldNotify(Context context, Intent intent, long now) {
        SharedPreferences preferences = preferences(context); long scheduled = intent.getLongExtra("scheduledAt", 0);
        try {
            JSONObject state = DataStore.readStable(context);
            return ACTION.equals(intent.getAction()) && preferences.getBoolean("enabled", false) && notificationsAllowed(context)
                && scheduled > 0 && scheduled == preferences.getLong("nextReminderAt", 0) && now >= scheduled && now - scheduled <= 3600000
                && AppRules.allowed(state, Instant.ofEpochMilli(now).atZone(java.time.ZoneId.systemDefault()).toLocalDateTime());
        } catch (Exception ignored) { return false; }
    }
    static boolean delivered(Context context, long scheduledAt, long now) {
        synchronized (LOCK) {
            SharedPreferences preferences = preferences(context);
            if (!preferences.getBoolean("enabled", false) || scheduledAt != preferences.getLong("nextReminderAt", 0)) return false;
            return preferences.edit().putLong("lastReminderAt", now).remove("nextReminderAt").commit();
        }
    }
}
