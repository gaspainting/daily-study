package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Iterator;
import java.util.regex.Pattern;

/** Unsubmitted form values are stored separately from learning records and backups. */
public final class DraftStore {
    public static final int MAX_BYTES = 16 * 1024 * 1024;
    public static final int MAX_ENTRIES = 100;
    public static final int MAX_ENTRY_BYTES = 2 * DataStore.MAX_BYTES + 4096;
    private static final Object LOCK = new Object();
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}");
    private DraftStore() {}

    private static AtomicFile file(Context context) {
        return new AtomicFile(new File(context.getFilesDir(), "drafts.json"));
    }

    public static JSONObject get(Context context, String key) throws Exception {
        validateIdentifier(key);
        synchronized (LOCK) {
            return read(context).getJSONObject("entries").optJSONObject(key);
        }
    }

    public static void save(Context context, String key, JSONObject base, JSONObject values) throws Exception {
        validateIdentifier(key);
        validateFields(base);
        validateFields(values);
        JSONObject entry = new JSONObject().put("key", key)
                .put("base", new JSONObject(base.toString()))
                .put("values", new JSONObject(values.toString()))
                .put("updatedAt", Instant.now().toString());
        validateEntry(key, entry);
        synchronized (LOCK) {
            JSONObject root = read(context);
            JSONObject entries = root.getJSONObject("entries");
            JSONObject previous = entries.optJSONObject(key);
            if (previous != null && PlanStore.equivalent(previous.getJSONObject("base"), base) && PlanStore.equivalent(previous.getJSONObject("values"), values)) return;
            if (!entries.has(key) && entries.length() >= MAX_ENTRIES) throw new Exception("草稿数量已达上限");
            entries.put(key, entry);
            write(context, root);
        }
    }

    public static void delete(Context context, String key) throws Exception {
        validateIdentifier(key);
        synchronized (LOCK) {
            JSONObject root = read(context);
            if (!root.getJSONObject("entries").has(key)) return;
            root.getJSONObject("entries").remove(key);
            write(context, root);
        }
    }

    public static void clear(Context context) throws Exception {
        synchronized (LOCK) {
            write(context, empty());
        }
    }
    public static void deletePrefix(Context context, String prefix) throws Exception {
        validateIdentifier(prefix);
        synchronized (LOCK) {
            JSONObject root = read(context), entries = root.getJSONObject("entries");
            java.util.ArrayList<String> keys = new java.util.ArrayList<>();
            Iterator<String> iterator = entries.keys(); while (iterator.hasNext()) { String key = iterator.next(); if (key.startsWith(prefix)) keys.add(key); }
            if (keys.isEmpty()) return;
            for (String key : keys) entries.remove(key);
            write(context, root);
        }
    }

    private static JSONObject empty() throws Exception {
        return new JSONObject().put("version", 1).put("entries", new JSONObject());
    }

    private static JSONObject read(Context context) throws Exception {
        AtomicFile atomic = file(context);
        File base = atomic.getBaseFile();
        if (!base.exists() && !new File(base.getPath() + ".bak").exists()) return empty();
        byte[] bytes;
        try (InputStream input = atomic.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > MAX_BYTES) throw new Exception("草稿文件超出大小限制");
                output.write(buffer, 0, count);
            }
            bytes = output.toByteArray();
        }
        JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        validate(root);
        return root;
    }

    private static void write(Context context, JSONObject root) throws Exception {
        validate(root);
        byte[] bytes = root.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new Exception("草稿文件超出大小限制");
        AtomicFile atomic = file(context);
        FileOutputStream output = null;
        try {
            output = atomic.startWrite();
            output.write(bytes);
            output.getFD().sync();
            atomic.finishWrite(output);
            output = null;
        } catch (Exception failure) {
            if (output != null) atomic.failWrite(output);
            throw failure;
        }
        if (!root.toString().equals(read(context).toString())) throw new Exception("草稿保存失败");
    }

    private static void validate(JSONObject root) throws Exception {
        if (root == null || root.length() != 2 || !(root.opt("version") instanceof Integer)
                || root.getInt("version") != 1 || !(root.opt("entries") instanceof JSONObject)) {
            throw new Exception("草稿格式无效");
        }
        JSONObject entries = root.getJSONObject("entries");
        if (entries.length() > MAX_ENTRIES) throw new Exception("草稿数量已达上限");
        Iterator<String> keys = entries.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            validateIdentifier(key);
            if (!(entries.opt(key) instanceof JSONObject)) throw new Exception("草稿格式无效");
            validateEntry(key, entries.getJSONObject(key));
        }
    }

    private static void validateEntry(String key, JSONObject entry) throws Exception {
        if (entry.length() != 4 || !key.equals(entry.opt("key"))
                || !(entry.opt("base") instanceof JSONObject)
                || !(entry.opt("values") instanceof JSONObject)
                || !(entry.opt("updatedAt") instanceof String)) throw new Exception("草稿格式无效");
        validateFields(entry.getJSONObject("base"));
        validateFields(entry.getJSONObject("values"));
        String timestamp = entry.getString("updatedAt");
        if (timestamp.length() > 40) throw new Exception("草稿时间无效");
        try { Instant.parse(timestamp); } catch (Exception failure) { throw new Exception("草稿时间无效", failure); }
        if (entry.toString().getBytes(StandardCharsets.UTF_8).length > MAX_ENTRY_BYTES) throw new Exception("草稿内容过长");
    }

    private static void validateFields(JSONObject fields) throws Exception {
        if (fields == null || fields.length() > 250) throw new Exception("草稿字段无效");
        Iterator<String> keys = fields.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            validateIdentifier(key);
            Object value = fields.opt(key);
            if (value instanceof String) {
                if (((String) value).length() > 8000) throw new Exception("草稿文字过长");
            } else if (!(value instanceof Boolean)) {
                throw new Exception("草稿字段无效");
            }
        }
    }

    private static void validateIdentifier(String value) throws Exception {
        if (value == null || !IDENTIFIER.matcher(value).matches() || value.equals("__proto__")
                || value.equals("constructor") || value.equals("prototype")) throw new Exception("草稿标识无效");
    }
}
