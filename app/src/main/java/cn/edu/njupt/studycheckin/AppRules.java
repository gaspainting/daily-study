package cn.edu.njupt.studycheckin;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import org.json.JSONObject;

/** Scheduling boundaries never prohibit saving an honest manual record. */
public final class AppRules {
    private AppRules() {}
    public static final String DEFAULT_WEEKDAY_END = "20:30";
    public static final String DEFAULT_WEEKEND_START = "09:30";
    public static final String DEFAULT_WEEKEND_END = "19:00";

    public static boolean allowed(LocalDateTime now) {
        return allowedTime(now.toLocalDate(), now.getHour(), now.getMinute(), DEFAULT_WEEKDAY_END, DEFAULT_WEEKEND_START, DEFAULT_WEEKEND_END);
    }

    public static boolean allowed(JSONObject state, LocalDateTime now) {
        JSONObject rest = restHours(state);
        return allowedTime(now.toLocalDate(), now.getHour(), now.getMinute(), rest.optString("weekdayEnd", DEFAULT_WEEKDAY_END), rest.optString("weekendStart", DEFAULT_WEEKEND_START), rest.optString("weekendEnd", DEFAULT_WEEKEND_END));
    }

    public static boolean allowedTime(LocalDate day, int hour, int minute) {
        return allowedTime(day, hour, minute, DEFAULT_WEEKDAY_END, DEFAULT_WEEKEND_START, DEFAULT_WEEKEND_END);
    }

    public static boolean allowedTime(JSONObject state, LocalDate day, int hour, int minute) {
        JSONObject rest = restHours(state);
        return allowedTime(day, hour, minute, rest.optString("weekdayEnd", DEFAULT_WEEKDAY_END), rest.optString("weekendStart", DEFAULT_WEEKEND_START), rest.optString("weekendEnd", DEFAULT_WEEKEND_END));
    }

    private static boolean allowedTime(LocalDate day, int hour, int minute, String weekdayEnd, String weekendStart, String weekendEnd) {
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
        int time = hour * 60 + minute;
        boolean weekend = day.getDayOfWeek().getValue() >= 6;
        int end = minutes(weekend ? weekendEnd : weekdayEnd);
        return weekend ? time >= minutes(weekendStart) && time < end : time < end;
    }

    public static long cutoffMillis(ZonedDateTime now) {
        LocalTime cutoff = LocalTime.parse(now.getDayOfWeek().getValue() >= 6 ? DEFAULT_WEEKEND_END : DEFAULT_WEEKDAY_END);
        return now.toLocalDate().atTime(cutoff).atZone(now.getZone()).toInstant().toEpochMilli();
    }

    public static long cutoffMillis(JSONObject state, ZonedDateTime now) {
        JSONObject rest = restHours(state);
        LocalTime cutoff = LocalTime.parse(now.getDayOfWeek().getValue() >= 6 ? rest.optString("weekendEnd", DEFAULT_WEEKEND_END) : rest.optString("weekdayEnd", DEFAULT_WEEKDAY_END));
        return now.toLocalDate().atTime(cutoff).atZone(now.getZone()).toInstant().toEpochMilli();
    }

    public static String restReason(LocalDateTime now){
        return restReason(null, now);
    }

    public static String restReason(JSONObject state, LocalDateTime now){
        JSONObject rest = restHours(state);
        String start = rest.optString("weekendStart", DEFAULT_WEEKEND_START), weekendEnd = rest.optString("weekendEnd", DEFAULT_WEEKEND_END), weekdayEnd = rest.optString("weekdayEnd", DEFAULT_WEEKDAY_END);
        return now.getDayOfWeek().getValue()>=6 ? (now.getHour()*60+now.getMinute()<minutes(start) ? start+" 前为休息时段" : weekendEnd+" 起为休息时段") : weekdayEnd+" 起为休息时段";
    }

    private static int minutes(String value) {
        try { return Integer.parseInt(value.substring(0, 2)) * 60 + Integer.parseInt(value.substring(3, 5)); }
        catch (Exception ignored) { return 0; }
    }

    private static JSONObject restHours(JSONObject state) {
        if (state != null) {
            JSONObject settings = state.optJSONObject("settings"), rest = settings == null ? null : settings.optJSONObject("restHours");
            if (rest != null) return rest;
        }
        try { return new JSONObject().put("weekdayEnd", DEFAULT_WEEKDAY_END).put("weekendStart", DEFAULT_WEEKEND_START).put("weekendEnd", DEFAULT_WEEKEND_END); }
        catch (Exception ignored) { return new JSONObject(); }
    }
}
