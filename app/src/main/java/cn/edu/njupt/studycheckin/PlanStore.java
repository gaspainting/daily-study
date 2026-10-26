package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;

/** One active state and up to eight named plans, switched through a recoverable journal. */
public final class PlanStore {
    public static final int MAX_PLANS = 8;
    public static final int MAX_BYTES = 16 * 1024 * 1024;
    private PlanStore() {}
    private static AtomicFile file(Context context) { return new AtomicFile(new File(context.getFilesDir(), "plans.json")); }
    private static AtomicFile journal(Context context) { return new AtomicFile(new File(context.getFilesDir(), "plan-switch-journal.json")); }
    private static boolean exists(AtomicFile file) { return file.getBaseFile().exists() || new File(file.getBaseFile().getPath() + ".bak").exists(); }
    private static void write(AtomicFile file, byte[] bytes) throws Exception {
        FileOutputStream output = null;
        try {
            output = file.startWrite(); output.write(bytes); file.finishWrite(output); output = null;
            if (!java.util.Arrays.equals(bytes, InspirationStore.read(file.openRead(), bytes.length + 1))) throw new java.io.IOException("计划写入失败");
        }
        catch (Exception error) { if (output != null) file.failWrite(output); throw error; }
    }
    private static JSONObject initial(Context context) throws Exception {
        return new JSONObject().put("version", 1).put("activeId", "main").put("items", new JSONArray().put(new JSONObject().put("id", "main").put("name", DataStore.load(context).getJSONObject("plan").getString("title")).put("state", JSONObject.NULL)));
    }
    private static JSONObject catalog(Context context) throws Exception {
        AtomicFile file = file(context);
        JSONObject catalog = exists(file) ? new JSONObject(new String(InspirationStore.read(file.openRead(), MAX_BYTES), StandardCharsets.UTF_8)) : initial(context);
        validate(catalog, false, null); return catalog;
    }
    private static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    private static int index(JSONObject catalog, String id) throws Exception {
        JSONArray items = catalog.getJSONArray("items");
        for (int i = 0; i < items.length(); i++) if (items.getJSONObject(i).getString("id").equals(id)) return i;
        throw new Exception("计划不存在");
    }
    private static void noTimer(Context context) throws Exception {
        JSONObject timer = TimerStore.snapshot(context);
        if (timer.has("error")) throw new Exception(timer.getString("error"));
        if (timer.optBoolean("active")) throw new Exception("请先结束当前计时");
    }
    public static JSONObject list(Context context) throws Exception {
        synchronized (DataStore.LOCK) {
            recover(context);
            JSONObject catalog = catalog(context); String active = catalog.getString("activeId"); JSONArray items = catalog.getJSONArray("items"), list = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i); String id = item.getString("id");
                String name = id.equals(active) ? DataStore.load(context).getJSONObject("plan").getString("title") : item.getJSONObject("state").getJSONObject("plan").getString("title");
                list.put(new JSONObject().put("id", id).put("name", name));
            }
            return new JSONObject().put("activeId", active).put("plans", list);
        }
    }
    public static String activeId(Context context) throws Exception {
        synchronized (DataStore.LOCK) { recover(context); return catalog(context).getString("activeId"); }
    }
    public static String create(Context context, JSONObject newState) throws Exception {
        synchronized (DataStore.LOCK) {
            recover(context); noTimer(context);
            JSONObject source=copy(newState);source.remove("evaluation");source.put("version",Math.min(source.getInt("version"),8));JSONObject state = DataStore.migrateState(source), catalog = catalog(context); JSONArray items = catalog.getJSONArray("items");
            if (items.length() >= MAX_PLANS) throw new Exception("最多保存 8 个计划");
            if (state.getJSONObject("records").length() != 0 || state.getJSONObject("reviews").length() != 0 || (state.has("sessions") && state.getJSONArray("sessions").length() != 0) || (state.has("courseReviews") && state.getJSONObject("courseReviews").length() != 0)) throw new Exception("新计划不能包含已有记录");
            for(String key:WeeklyGoals.keys(state.getJSONObject("plan"))){JSONArray tasks=WeeklyGoals.tasks(state.getJSONObject("plan"),key);for(int i=0;i<tasks.length();i++)if(tasks.getJSONObject(i).getBoolean("done"))throw new Exception("新计划不能包含已完成任务");}
            String id = "plan_" + UUID.randomUUID().toString().replace("-", "");
            items.put(new JSONObject().put("id", id).put("name", state.getJSONObject("plan").getString("title")).put("state", state));
            saveCatalog(context, catalog); return id;
        }
    }
    public static JSONObject switchTo(Context context, String id) throws Exception {
        synchronized (DataStore.LOCK) {
            recover(context); noTimer(context);
            JSONObject catalog = catalog(context); String active = catalog.getString("activeId"); int destination = index(catalog, id);
            if (id.equals(active)) return DataStore.load(context);
            JSONArray items = catalog.getJSONArray("items"); JSONObject next = DataStore.migrateState(items.getJSONObject(destination).getJSONObject("state"));
            JSONObject before = DataStore.load(context), previous = items.getJSONObject(index(catalog, active));
            previous.put("name", before.getJSONObject("plan").getString("title")).put("state", before);
            items.getJSONObject(destination).put("name", next.getJSONObject("plan").getString("title")).put("state", JSONObject.NULL);
            catalog.put("activeId", id); validate(catalog, false, null);
            byte[] oldStudy = previous(context, "study-state.json", DataStore.MAX_BYTES), oldCatalog = previous(context, "plans.json", MAX_BYTES);
            JSONObject rollback = new JSONObject().put("study", oldStudy == null ? JSONObject.NULL : Base64.encodeToString(oldStudy, Base64.NO_WRAP)).put("plans", oldCatalog == null ? JSONObject.NULL : Base64.encodeToString(oldCatalog, Base64.NO_WRAP));
            write(journal(context), rollback.toString().getBytes(StandardCharsets.UTF_8));
            try {
                DataStore.restore(context, next);
                if (!equivalent(next, DataStore.load(context))) throw new java.io.IOException("计划写入失败");
                saveCatalog(context, catalog); clearJournal(context);
            }
            catch (Exception error) { try { recover(context); } catch (Exception recovery) { error.addSuppressed(recovery); } throw error; }
            return DataStore.load(context);
        }
    }
    private static byte[] previous(Context context, String name, int limit) throws Exception {
        AtomicFile file = new AtomicFile(new File(context.getFilesDir(), name)); return exists(file) ? InspirationStore.read(file.openRead(), limit) : null;
    }
    private static void saveCatalog(Context context, JSONObject catalog) throws Exception {
        validate(catalog, false, null); byte[] bytes = catalog.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new Exception("计划总记录超过 16MB");
        write(file(context), bytes);
    }
    public static void recover(Context context) throws Exception {
        synchronized (DataStore.LOCK) {
            AtomicFile journal = journal(context); if (!exists(journal)) return;
            JSONObject before = new JSONObject(new String(InspirationStore.read(journal.openRead(), 32 * 1024 * 1024), StandardCharsets.UTF_8));
            for (String key : new String[]{"study", "plans"}) {
                if (!before.has(key) || (!before.isNull(key) && !(before.opt(key) instanceof String))) throw new Exception("计划恢复信息不完整");
                if (!before.isNull(key) && Base64.decode(before.getString(key), Base64.NO_WRAP).length > (key.equals("study") ? DataStore.MAX_BYTES : MAX_BYTES)) throw new Exception("计划恢复信息超过支持大小");
            }
            for (String[] entry : new String[][]{{"study", "study-state.json"}, {"plans", "plans.json"}}) {
                AtomicFile target = new AtomicFile(new File(context.getFilesDir(), entry[1]));
                if (before.isNull(entry[0])) target.delete(); else write(target, Base64.decode(before.getString(entry[0]), Base64.NO_WRAP));
            }
            clearJournal(context);
        }
    }
    private static void clearJournal(Context context) throws Exception { AtomicFile file = journal(context); file.delete(); if (exists(file)) throw new java.io.IOException("计划切换失败"); }
    public static JSONObject backupSnapshot(Context context) throws Exception {
        synchronized (DataStore.LOCK) {
            recover(context); JSONObject snapshot = copy(catalog(context)); String active = snapshot.getString("activeId"); JSONArray items = snapshot.getJSONArray("items");
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i); JSONObject state = item.getString("id").equals(active) ? DataStore.load(context) : DataStore.migrateState(item.getJSONObject("state"));
                item.put("name", state.getJSONObject("plan").getString("title")).put("state", state);
            }
            validateBackup(snapshot, DataStore.load(context));
            if (snapshot.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new Exception("计划总记录超过 16MB");
            return snapshot;
        }
    }
    public static void validateBackup(JSONObject snapshot, JSONObject study) throws Exception { validate(snapshot, true, study); }
    public static void restoreBackup(Context context, JSONObject snapshot) throws Exception {
        synchronized (DataStore.LOCK) {
            validate(snapshot, true, null); JSONObject catalog = copy(snapshot); String active = catalog.getString("activeId");
            JSONArray items = catalog.getJSONArray("items");
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                if (item.getString("id").equals(active)) item.put("state", JSONObject.NULL);
                else item.put("state", DataStore.migrateState(item.getJSONObject("state")));
            }
            saveCatalog(context, catalog);
        }
    }
    private static void exactKeys(JSONObject object, String... names) throws Exception {
        Set<String> expected = new HashSet<>(java.util.Arrays.asList(names));
        if (object.length() != expected.size()) throw new Exception("计划信息字段不完整");
        Iterator<String> keys = object.keys(); while (keys.hasNext()) if (!expected.contains(keys.next())) throw new Exception("计划信息含未知字段");
    }
    private static void validate(JSONObject catalog, boolean backup, JSONObject study) throws Exception {
        if (catalog == null) throw new Exception("计划信息缺失"); exactKeys(catalog, "version", "activeId", "items");
        if (!(catalog.opt("version") instanceof Number) || catalog.getDouble("version") != 1 || !(catalog.opt("activeId") instanceof String)) throw new Exception("计划信息版本无效");
        String active = catalog.getString("activeId"); JSONArray items = catalog.getJSONArray("items"); Set<String> ids = new HashSet<>();
        if (catalog.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new Exception("计划总记录超过 16MB");
        if (items.length() < 1 || items.length() > MAX_PLANS) throw new Exception("计划数须为 1 至 8 个");
        boolean found = false;
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i); exactKeys(item, "id", "name", "state");
            if (!(item.opt("id") instanceof String) || !(item.opt("name") instanceof String)) throw new Exception("计划名称或编号无效");
            String id = item.getString("id"), name = item.getString("name");
            if (!id.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") || "constructor".equals(id) || "prototype".equals(id) || !ids.add(id) || name.trim().isEmpty() || name.length() > 128) throw new Exception("计划名称或编号无效");
            boolean current = id.equals(active); found |= current;
            if (current && !backup) { if (!item.isNull("state")) throw new Exception("当前计划记录位置无效"); }
            else {
                JSONObject state = item.getJSONObject("state"); DataStore.validate(state);
                if (state.toString().getBytes(StandardCharsets.UTF_8).length > DataStore.MAX_BYTES) throw new Exception("单个计划记录超过 4MB");
                if (!name.equals(state.getJSONObject("plan").getString("title"))) throw new Exception("计划名称与记录不一致");
                if (current && study != null && !equivalent(state, study)) throw new Exception("当前计划与备份记录不一致");
            }
        }
        if (!found) throw new Exception("当前计划不存在");
    }
    static boolean equivalent(JSONObject first, JSONObject second) throws Exception {
        return equal(first, second);
    }
    private static boolean equal(Object first, Object second) throws Exception {
        if (first == second) return true;
        if (first == null || second == null || first == JSONObject.NULL || second == JSONObject.NULL) return first == JSONObject.NULL && second == JSONObject.NULL;
        if (first instanceof JSONObject && second instanceof JSONObject) {
            JSONObject a = (JSONObject) first, b = (JSONObject) second;
            if (a.length() != b.length()) return false;
            Iterator<String> keys = a.keys(); while (keys.hasNext()) { String key = keys.next(); if (!b.has(key) || !equal(a.get(key), b.get(key))) return false; } return true;
        }
        if (first instanceof JSONArray && second instanceof JSONArray) {
            JSONArray a = (JSONArray) first, b = (JSONArray) second; if (a.length() != b.length()) return false;
            for (int i = 0; i < a.length(); i++) if (!equal(a.get(i), b.get(i))) return false; return true;
        }
        if (first instanceof Number && second instanceof Number) return new java.math.BigDecimal(first.toString()).compareTo(new java.math.BigDecimal(second.toString())) == 0;
        return first.equals(second);
    }
}
