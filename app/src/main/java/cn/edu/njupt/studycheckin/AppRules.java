package cn.edu.njupt.studycheckin;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;

/** Scheduling boundaries never prohibit saving an honest manual record. */
public final class AppRules {
    private AppRules() {}
    public static boolean allowed(LocalDateTime now) {
        return allowedTime(now.toLocalDate(), now.getHour(), now.getMinute());
    }
    public static boolean allowedTime(LocalDate day, int hour, int minute) {
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
        int time = hour * 60 + minute;
        boolean weekend = day.getDayOfWeek().getValue() >= 6;
        return weekend ? time >= 570 && time < 1140 : time < 1230;
    }
    public static long cutoffMillis(ZonedDateTime now) {
        LocalTime cutoff = now.getDayOfWeek().getValue() >= 6 ? LocalTime.of(19, 0) : LocalTime.of(20, 30);
        return now.toLocalDate().atTime(cutoff).atZone(now.getZone()).toInstant().toEpochMilli();
    }
    public static String restReason(LocalDateTime now){
        return now.getDayOfWeek().getValue()>=6?(now.getHour()*60+now.getMinute()<570?"09:30 前为休息时段":"19:00 起为休息时段"):"20:30 起为休息时段";
    }
}
