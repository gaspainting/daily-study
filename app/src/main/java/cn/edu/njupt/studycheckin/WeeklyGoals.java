package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Date-anchored weekly goals, independent of study quantities and teaching-week labels. */
public final class WeeklyGoals {
    private WeeklyGoals() {}
    private static void require(boolean condition, String message) throws Exception { if (!condition) throw new Exception(message); }
    private static LocalDate date(String value) throws Exception {
        require(value.matches("\\d{4}-\\d{2}-\\d{2}"), "目标日期无效");
        LocalDate result = LocalDate.parse(value);
        require(result.getYear() >= 1900 && result.getYear() <= 2100, "目标日期无效"); return result;
    }
    public static void validate(JSONObject plan) throws Exception {
        if (!plan.has("weekTasks")) return;
        JSONObject groups = plan.getJSONObject("weekTasks"); require(groups.length() <= 2000, "周任务资料过多");
        Set<String> subjects = new HashSet<>(), seen = new HashSet<>();
        JSONArray all = plan.getJSONArray("subjects");
        for (int i = 0; i < all.length(); i++) subjects.add(all.getJSONObject(i).getString("id"));
        Set<String> fields = new HashSet<>(Arrays.asList("id", "title", "subjectId", "done", "updatedAt"));
        Iterator<String> keys = groups.keys(); int count = 0;
        while (keys.hasNext()) {
            String key = keys.next(); date(key); JSONArray tasks = groups.getJSONArray(key);
            require(tasks.length() <= 50, "每周最多50项任务");
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject task = tasks.getJSONObject(i); require(task.length() == fields.size(), "任务格式无效");
                Iterator<String> names = task.keys(); while (names.hasNext()) require(fields.contains(names.next()), "任务含未知字段");
                Object id = task.get("id"), title = task.get("title"), subject = task.get("subjectId"), stamp = task.get("updatedAt");
                require(id instanceof String && ((String)id).matches("task_[A-Za-z0-9_-]{1,59}") && seen.add((String)id), "任务ID无效或重复");
                require(title instanceof String && !((String)title).trim().isEmpty() && ((String)title).length() <= 500, "任务名称须为1至500字");
                require(subject == JSONObject.NULL || subject instanceof String && subjects.contains((String)subject), "任务关联科目不存在");
                require(task.get("done") instanceof Boolean, "任务完成状态无效");
                require(stamp instanceof String && ((String)stamp).length() <= 40 && ((String)stamp).matches("\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?Z"), "任务记录时间无效");
                date(((String)stamp).substring(0,10));
                Instant.parse((String)stamp); count++;
            }
        }
        require(count <= 10000, "任务总数超过10000项");
    }
    public static List<String> keys(JSONObject plan) throws Exception {
        Set<String> keys = new HashSet<>();
        for (String field : new String[]{"weekGoals", "weekHints", "weekTasks"}) {
            JSONObject values = plan.optJSONObject(field); if (values == null) continue;
            Iterator<String> iterator = values.keys();
            while (iterator.hasNext()) { String key = iterator.next(); Object value = values.get(key); if (value instanceof String ? !((String)value).isEmpty() : ((JSONArray)value).length() > 0) keys.add(key); }
        }
        List<String> result = new ArrayList<>(keys); Collections.sort(result); return result;
    }
    public static JSONArray tasks(JSONObject plan, String key) {
        JSONObject groups = plan.optJSONObject("weekTasks"); return groups == null || groups.optJSONArray(key) == null ? new JSONArray() : groups.optJSONArray(key);
    }
    public static String subjectName(JSONObject plan, String id) throws Exception {
        JSONArray subjects = plan.getJSONArray("subjects");
        for (int i = 0; i < subjects.length(); i++) if (subjects.getJSONObject(i).getString("id").equals(id)) return subjects.getJSONObject(i).getString("name");
        return "";
    }
}
