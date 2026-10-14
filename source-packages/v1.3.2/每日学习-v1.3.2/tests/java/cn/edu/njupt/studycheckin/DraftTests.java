package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import android.system.Os;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Draft storage exercises real AtomicFile I/O without changing application records. */
final class DraftTests {
    private interface Action { void run() throws Exception; }
    private static void check(List<String> passes, boolean condition, String name) throws Exception {
        if (!condition) throw new Exception("FAIL: " + name);
        passes.add(name);
    }
    private static void rejects(List<String> passes, Action action, String name) throws Exception {
        boolean rejected = false;
        try { action.run(); } catch (Exception expected) { rejected = true; }
        check(passes, rejected, name);
    }
    private static String repeat(char value, int count) {
        char[] chars = new char[count];
        java.util.Arrays.fill(chars, value);
        return new String(chars);
    }
    static void run(Context original, List<String> passes) throws Exception {
        String recordsBefore = DataStore.load(original).toString();
        File directory = new File(original.getCacheDir(), "draft-test-" + UUID.randomUUID());
        if (!directory.mkdir()) throw new Exception("Draft fixture directory creation failed");
        Context context = new ContextWrapper(original) { @Override public File getFilesDir() { return directory; } };
        File file = new File(directory, "drafts.json");
        try {
            check(passes, DraftStore.get(context, "daily:2026-10-14") == null && !file.exists(), "missing draft remains absent without creating default values");
            JSONObject base = new JSONObject().put("minutes-math", "").put("minutes-vocab", "0").put("reminders-enabled", false);
            JSONObject values = new JSONObject().put("minutes-math", "0").put("minutes-vocab", "").put("note", "  随记\n第二行  ").put("status", "休息").put("rest-kept", "").put("reminders-enabled", true);
            DraftStore.save(context, "daily:2026-10-14", base, values);
            JSONObject draft = DraftStore.get(context, "daily:2026-10-14");
            JSONObject restored = draft.getJSONObject("values");
            check(passes, restored.getString("minutes-math").equals("0") && restored.getString("minutes-vocab").equals(""), "draft preserves explicit zero and unrecorded raw input separately");
            check(passes, restored.getString("status").equals("休息") && restored.getString("rest-kept").equals(""), "draft rest selection does not infer missing field values");
            check(passes, restored.getString("note").equals("  随记\n第二行  ") && restored.getBoolean("reminders-enabled"), "draft preserves whitespace multiline content and checkbox value");
            check(passes, draft.getJSONObject("base").getString("minutes-math").equals("") && !draft.getJSONObject("base").getBoolean("reminders-enabled"), "draft stores unchanged base for conflict detection");
            check(passes, draft.getString("key").equals("daily:2026-10-14") && Instant.parse(draft.getString("updatedAt")).toEpochMilli() > 0, "draft includes actual key and persistence timestamp");
            values.put("note", "mutated");
            restored.put("minutes-math", "99");
            Context restarted = new ContextWrapper(original) { @Override public File getFilesDir() { return directory; } };
            check(passes, DraftStore.get(restarted, "daily:2026-10-14").getJSONObject("values").getString("minutes-math").equals("0") && DraftStore.get(restarted, "daily:2026-10-14").getJSONObject("values").getString("note").contains("第二行"), "restart reloads persisted draft independent of mutable input and returned objects");
            String[] contexts = {"daily:2026-10-15", "review:2026-10-12", "plan:2026-10-12:2026-12-20", "subject:math", "week:2026-10-12", "reference:2026-10-14", "new-subject", "reminders"};
            for (String key : contexts) DraftStore.save(context, key, new JSONObject(), new JSONObject().put("context", key));
            check(passes, DraftStore.get(context, "daily:2026-10-15").getJSONObject("values").getString("context").equals("daily:2026-10-15") && DraftStore.get(context, "daily:2026-10-14").getJSONObject("values").getString("minutes-math").equals("0"), "daily dates and each form context have isolated drafts");
            DraftStore.delete(context, "daily:2026-10-15");
            DraftStore.delete(context, "daily:2026-10-15");
            check(passes, DraftStore.get(context, "daily:2026-10-15") == null && DraftStore.get(context, "daily:2026-10-14") != null && DraftStore.get(context, "review:2026-10-12") != null, "delete is idempotent and only removes its selected context");
            String previous = DraftStore.get(context, "daily:2026-10-14").toString();
            String[] invalidKeys = {"../study-state.json", "", "__proto__", "constructor", "prototype", "daily/2026-10-14", repeat('k', 161), "日期"};
            for (String key : invalidKeys) rejects(passes, () -> DraftStore.save(context, key, new JSONObject(), new JSONObject()), "draft rejects unsafe identifier " + key.substring(0, Math.min(20, key.length())));
            Object[] invalidValues = {7, JSONObject.NULL, new JSONObject(), new org.json.JSONArray()};
            for (int i = 0; i < invalidValues.length; i++) {
                JSONObject invalid = new JSONObject().put("note", invalidValues[i]);
                rejects(passes, () -> DraftStore.save(context, "daily:2026-10-14", base, invalid), "draft rejects non raw primitive field " + i);
            }
            rejects(passes, () -> DraftStore.save(context, "daily:2026-10-14", new JSONObject().put("constructor", ""), new JSONObject()), "draft rejects polluted base field identifier");
            rejects(passes, () -> DraftStore.save(context, "daily:2026-10-14", base, new JSONObject().put("note", repeat('n', 5001))), "draft rejects oversized string before replacement");
            JSONObject tooManyFields = new JSONObject();
            for (int i = 0; i < 251; i++) tooManyFields.put("field-" + i, "");
            rejects(passes, () -> DraftStore.save(context, "daily:2026-10-14", base, tooManyFields), "draft rejects more than 250 fields");
            JSONObject oversizedEntry = new JSONObject();
            for (int i = 0; i < 75; i++) oversizedEntry.put("note-" + i, repeat('字', 5000));
            rejects(passes, () -> DraftStore.save(context, "daily:2026-10-14", base, oversizedEntry), "draft measures UTF8 entry limit rather than character count alone");
            check(passes, DraftStore.get(context, "daily:2026-10-14").toString().equals(previous), "invalid save attempts leave previously stored draft unchanged");
            Os.chmod(file.getAbsolutePath(), 0400);
            Os.chmod(directory.getAbsolutePath(), 0500);
            try {
                rejects(passes, () -> DraftStore.save(context, "daily:2026-10-14", base, new JSONObject().put("note", "not written")), "draft reports actual filesystem save failure");
                check(passes, DraftStore.get(context, "daily:2026-10-14").toString().equals(previous), "failed atomic write preserves existing draft");
            } finally { Os.chmod(directory.getAbsolutePath(), 0700); Os.chmod(file.getAbsolutePath(), 0600); }
            DraftStore.save(context, "daily:2026-10-14", base, new JSONObject().put("note", "retry"));
            check(passes, DraftStore.get(context, "daily:2026-10-14").getJSONObject("values").getString("note").equals("retry"), "draft save can retry after real filesystem failure");
            DraftStore.clear(context);
            check(passes, DraftStore.get(context, "daily:2026-10-14") == null && DraftStore.get(context, "reminders") == null, "clear removes all contexts");
            for (int i = 0; i < DraftStore.MAX_ENTRIES; i++) DraftStore.save(context, "daily:" + i, new JSONObject(), new JSONObject().put("note", ""));
            rejects(passes, () -> DraftStore.save(context, "daily:overflow", new JSONObject(), new JSONObject()), "draft maximum refuses new entries without evicting old drafts");
            DraftStore.save(context, "daily:0", new JSONObject(), new JSONObject().put("note", "updated"));
            check(passes, DraftStore.get(context, "daily:0").getJSONObject("values").getString("note").equals("updated") && DraftStore.get(context, "daily:99") != null, "existing draft stays editable at entry limit");
            DraftStore.clear(context);
            try (FileOutputStream output = new FileOutputStream(file)) { byte[] block = new byte[8192]; int left = DraftStore.MAX_BYTES + 1; while (left > 0) { int count = Math.min(left, block.length); output.write(block, 0, count); left -= count; } }
            rejects(passes, () -> DraftStore.get(context, "day:0"), "draft refuses reading an oversized file before parsing");
            rejects(passes, () -> DraftStore.save(context, "day:0", base, values), "oversized draft file is not overwritten by autosave");
            check(passes, file.length() == DraftStore.MAX_BYTES + 1L, "draft read and autosave overflow leave the original file unchanged");
            DraftStore.clear(context);
            String intact = DraftStore.get(context, "missing") == null ? "{\"version\":1,\"entries\":{}}" : "";
            try (FileOutputStream output = new FileOutputStream(file)) { output.write("{broken".getBytes(StandardCharsets.UTF_8)); }
            rejects(passes, () -> DraftStore.save(context, "daily:recovery", new JSONObject(), new JSONObject()), "corrupt draft file is not silently overwritten by autosave");
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(intact.getBytes(StandardCharsets.UTF_8)); }
            check(passes, DataStore.load(original).toString().equals(recordsBefore), "draft save delete clear and failures never change saved learning records");
        } finally {
            Os.chmod(directory.getAbsolutePath(), 0700);
            File[] remaining = directory.listFiles();
            if (remaining != null) for (File child : remaining) child.delete();
            directory.delete();
        }
    }
}
