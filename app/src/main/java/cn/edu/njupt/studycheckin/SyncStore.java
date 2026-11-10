package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Durable Android-side hosted-sync metadata.
 *
 * This class deliberately has no LAN discovery or desktop address fields in its
 * public API. It records local operations and explicit server acknowledgements;
 * it never treats a local enqueue as a cloud confirmation.
 */
public final class SyncStore {
    public static final int PROTOCOL_VERSION = 1;
    public static final int STATE_SCHEMA_VERSION = 2;
    public static final int BUSINESS_SCHEMA_VERSION = 9;
    private static final String KEY_ALIAS = "shiyi-sync-device";
    private static final Object LOCK = new Object();
    private SyncStore() {}

    private static AtomicFile file(Context c) { return new AtomicFile(new File(c.getFilesDir(), "sync-state.json")); }
    private static AtomicFile journalFile(Context c) { return new AtomicFile(new File(c.getFilesDir(), "sync-commit-journal.json")); }

    private static void ensureIdentity() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return;
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setDigests(KeyProperties.DIGEST_SHA256).build());
        generator.generateKeyPair();
    }

    private static JSONObject empty() throws Exception {
        return new JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("stateSchemaVersion", STATE_SCHEMA_VERSION)
            .put("deviceId", UUID.randomUUID().toString())
            .put("clientInstanceId", UUID.randomUUID().toString())
            .put("clientInstanceGeneration", 1L)
            .put("deviceSequence", 0L)
            .put("accountId", JSONObject.NULL)
            .put("workspaceId", JSONObject.NULL)
            .put("autoSync", false)
            .put("outbox", new JSONArray())
            .put("inbox", new JSONArray())
            .put("dedupe", new JSONArray())
            .put("conflicts", new JSONArray())
            .put("serverRevisions", new JSONObject())
            .put("cursor", 0L)
            .put("serverEpoch", JSONObject.NULL)
            .put("sync", new JSONObject().put("status", "local_saved").put("lastAttemptAt", JSONObject.NULL)
                .put("lastSuccessAt", JSONObject.NULL).put("lastFailure", JSONObject.NULL))
            .put("reminders", new JSONArray());
    }

    private static JSONObject readLocked(Context c) throws Exception {
        ensureIdentity();
        AtomicFile af = file(c);
        boolean existed = af.getBaseFile().exists();
        JSONObject state = existed ? new JSONObject(DataStore.readText(af.openRead())) : empty();
        boolean changed = normalize(state);
        validate(state);
        if (!existed || changed) writeLocked(c, state);
        return state;
    }

    /** Migrates the v2.4.0 local placeholder without deleting its metadata. */
    private static boolean normalize(JSONObject state) throws Exception {
        boolean changed = false;
        if (state.optInt("stateSchemaVersion", 0) != STATE_SCHEMA_VERSION) { state.put("stateSchemaVersion", STATE_SCHEMA_VERSION); changed = true; }
        if (!state.has("clientInstanceId") || !uuid(state.optString("clientInstanceId", ""))) {
            state.put("clientInstanceId", UUID.randomUUID().toString()); changed = true;
        }
        if (!state.has("clientInstanceGeneration")) { state.put("clientInstanceGeneration", 1L); changed = true; }
        if (!state.has("accountId")) { state.put("accountId", JSONObject.NULL); changed = true; }
        if (!state.has("workspaceId")) { state.put("workspaceId", JSONObject.NULL); changed = true; }
        if (!state.has("conflicts")) { state.put("conflicts", new JSONArray()); changed = true; }
        if (!state.has("serverRevisions")) { state.put("serverRevisions", new JSONObject()); changed = true; }
        if (!state.has("serverEpoch")) { state.put("serverEpoch", JSONObject.NULL); changed = true; }
        for (String key : new String[]{"outbox", "inbox", "dedupe", "reminders"}) {
            if (!state.has(key)) { state.put(key, new JSONArray()); changed = true; }
        }
        JSONArray reminders = state.getJSONArray("reminders");
        for (int i = 0; i < reminders.length(); i++) {
            JSONObject reminder = reminders.optJSONObject(i);
            if (reminder != null && normalizeReminder(reminder)) changed = true;
        }
        if (!state.has("sync")) { state.put("sync", empty().getJSONObject("sync")); changed = true; }

        // Move the old LAN-only fields under a private legacy marker. They are
        // retained for migration evidence but are never returned to the WebView.
        if (state.has("pair") || state.has("manualAddress")) {
            JSONObject legacy = new JSONObject();
            if (state.optJSONObject("pair") != null) legacy.put("pair", new JSONObject(state.getJSONObject("pair").toString()));
            if (state.has("manualAddress")) legacy.put("manualAddress", state.optString("manualAddress", ""));
            state.put("legacyLanMetadata", legacy);
            state.remove("pair"); state.remove("manualAddress"); changed = true;
        }
        JSONObject sync = state.getJSONObject("sync");
        String old = sync.optString("status", "signed_out");
        if ("waiting_for_desktop".equals(old) || "pairing_pending".equals(old) || "not_paired".equals(old) || "ready_to_pair".equals(old)) {
            sync.put("status", "local_saved"); changed = true;
        }
        if (!sync.has("lastAttemptAt")) { sync.put("lastAttemptAt", JSONObject.NULL); changed = true; }
        if (!sync.has("lastSuccessAt")) { sync.put("lastSuccessAt", JSONObject.NULL); changed = true; }
        if (!sync.has("lastFailure")) { sync.put("lastFailure", JSONObject.NULL); changed = true; }
        if (!state.has("protocolVersion")) { state.put("protocolVersion", PROTOCOL_VERSION); changed = true; }
        if (!state.has("deviceSequence")) { state.put("deviceSequence", 0L); changed = true; }
        if (!state.has("cursor")) { state.put("cursor", 0L); changed = true; }
        return changed;
    }

    private static void writeLocked(Context c, JSONObject state) throws Exception {
        validate(state);
        byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 2 * 1024 * 1024) throw new Exception("同步队列超过2MB，请先完成同步");
        AtomicFile af = file(c); FileOutputStream out = null;
        try {
            out = af.startWrite(); out.write(bytes); out.getFD().sync(); af.finishWrite(out); out = null;
        } finally { if (out != null) af.failWrite(out); }
    }

    public static JSONObject status(Context c) throws Exception {
        synchronized (LOCK) {
            JSONObject state = readLocked(c), sync = state.getJSONObject("sync");
            JSONObject auth = AuthSessionStore.status(c);
            JSONObject account = new JSONObject().put("state", auth.optString("state", "signed_out"))
                .put("authenticated", auth.optBoolean("authenticated", false));
            if (!state.isNull("accountId")) account.put("accountId", state.getString("accountId")); else if (auth.has("accountId")) account.put("accountId", auth.getString("accountId"));
            if (!state.isNull("workspaceId")) account.put("workspaceId", state.getString("workspaceId")); else if (auth.has("workspaceId")) account.put("workspaceId", auth.getString("workspaceId"));
            return new JSONObject().put("protocolVersion", PROTOCOL_VERSION)
                .put("stateSchemaVersion", STATE_SCHEMA_VERSION)
                .put("deviceId", state.getString("deviceId"))
                .put("clientInstanceId", state.getString("clientInstanceId"))
                .put("clientInstanceGeneration", state.getLong("clientInstanceGeneration"))
                .put("account", account)
                .put("autoSync", state.getBoolean("autoSync"))
                .put("pendingCount", state.getJSONArray("outbox").length())
                .put("inboxCursor", state.getLong("cursor"))
                .put("serverEpoch", state.opt("serverEpoch"))
                .put("conflictCount", state.getJSONArray("conflicts").length())
                .put("status", sync.getString("status"))
                .put("lastAttemptAt", sync.opt("lastAttemptAt"))
                .put("lastSuccessAt", sync.opt("lastSuccessAt"))
                .put("lastFailure", sync.opt("lastFailure"))
                .put("reminderCount", state.getJSONArray("reminders").length())
                 .put("capabilities", new JSONObject().put("localOutbox", true).put("httpsTransport", true)
                     .put("periodicSync", true).put("pushAccelerated", false).put("downlinkReminders", true)
                     .put("downlinkBusiness", false));
        }
    }

    /** Enables local queueing for a backend workspace; no credential is accepted here. */
    public static JSONObject saveSettings(Context c, boolean autoSync, String workspaceId) throws Exception {
        synchronized (LOCK) {
            JSONObject state = readLocked(c); String workspace = trim(workspaceId);
            if (!workspace.isEmpty()) validId(workspace, "工作区ID");
            if (!state.isNull("workspaceId") && !workspace.isEmpty() && !workspace.equals(state.getString("workspaceId")) && state.getJSONArray("outbox").length() > 0)
                throw new Exception("当前工作区还有待上传操作，请先完成同步");
            state.put("autoSync", autoSync && !workspace.isEmpty());
            state.put("workspaceId", workspace.isEmpty() ? JSONObject.NULL : workspace);
            JSONObject sync = state.getJSONObject("sync");
        if (!autoSync || workspace.isEmpty()) { sync.put("status", "local_saved").put("lastFailure", JSONObject.NULL); }
            else if (!AuthSessionStore.hasUsableSession(c)) sync.put("status", "session_invalid").put("lastFailure", "尚未登录拾遗账号");
            else sync.put("status", "backend_unavailable").put("lastFailure", "托管端点尚未配置");
            writeLocked(c, state); return publicStatus(c, state);
        }
    }

    /** Binds native session metadata to the local queue without exposing tokens. */
    public static void bindAuthenticatedSession(Context c) throws Exception {
        synchronized (LOCK) {
            JSONObject auth = AuthSessionStore.status(c); if (!auth.optBoolean("authenticated", false)) throw new Exception("拾遗账号会话不可用");
            String accountId = auth.getString("accountId"), workspaceId = auth.getString("workspaceId"); JSONObject state = readLocked(c);
            if (!state.isNull("accountId") && !accountId.equals(state.getString("accountId")) && state.getJSONArray("outbox").length() > 0) throw new Exception("当前账号还有待上传操作，请先完成同步");
            if (!state.isNull("workspaceId") && !workspaceId.equals(state.getString("workspaceId")) && state.getJSONArray("outbox").length() > 0) throw new Exception("当前工作区还有待上传操作，请先完成同步");
            state.put("accountId", accountId).put("workspaceId", workspaceId); writeLocked(c, state);
        }
    }

    public static JSONObject unpair(Context c) throws Exception { return signOut(c); }

    public static JSONObject signOut(Context c) throws Exception {
        synchronized (LOCK) {
            AuthSessionStore.clear(c); JSONObject state = readLocked(c); state.put("autoSync", false);
            JSONObject sync = state.getJSONObject("sync");
            if (state.getJSONArray("outbox").length() > 0) sync.put("status", "session_invalid").put("lastFailure", "已退出账号，待上传操作仍保留在本机");
            else { state.put("accountId", JSONObject.NULL).put("workspaceId", JSONObject.NULL); sync.put("status", "local_saved").put("lastFailure", JSONObject.NULL); }
            writeLocked(c, state); return publicStatus(c, state);
        }
    }

    /** Records an attempt without claiming that a server accepted anything. */
    public static JSONObject syncNow(Context c) throws Exception {
        synchronized (LOCK) {
            JSONObject state = readLocked(c), sync = state.getJSONObject("sync");
            sync.put("lastAttemptAt", now());
            if (!state.getBoolean("autoSync") || state.isNull("workspaceId")) sync.put("status", "local_saved").put("lastFailure", "尚未启用托管同步");
            else if (!AuthSessionStore.hasUsableSession(c)) sync.put("status", "session_invalid").put("lastFailure", "拾遗账号会话不可用");
            else sync.put("status", "backend_unavailable").put("lastFailure", "托管端点尚未配置，记录仍在本机队列");
            writeLocked(c, state); return publicStatus(c, state);
        }
    }

    /** Keeps a successful local save truthful if queue bookkeeping itself fails. */
    public static void markQueueError(Context c, String message) {
        try {
            synchronized (LOCK) { JSONObject state = readLocked(c); state.getJSONObject("sync").put("status", "error").put("lastFailure", message == null ? "待上传操作未能记录" : message); writeLocked(c, state); }
        } catch (Exception ignored) { }
    }

    /** Writes the pre-save side of the local-save/outbox recovery point. */
    public static void prepareStateSave(Context c, String planId, JSONObject before) throws Exception {
        if (planId == null || planId.trim().isEmpty() || before == null) throw new Exception("本地保存恢复点无效");
        JSONObject journal = new JSONObject().put("version", 1).put("planId", planId).put("beforeRevision", before.optLong("_revision", 0L)).put("before", new JSONObject(before.toString())).put("createdAtUtc", now());
        byte[] bytes = journal.toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > DataStore.MAX_BYTES) throw new Exception("本地保存恢复点过大");
        synchronized (LOCK) { AtomicFile af = journalFile(c); FileOutputStream out = null; try { out = af.startWrite(); out.write(bytes); out.getFD().sync(); af.finishWrite(out); out = null; } finally { if (out != null) af.failWrite(out); } }
    }

    /** Completes the recovery point after DataStore has durably accepted the save. */
    public static void finishStateSave(Context c, String planId, JSONObject after) throws Exception {
        synchronized (LOCK) { File journal = journalFile(c).getBaseFile(); if (!journal.exists()) return; JSONObject value = new JSONObject(DataStore.readText(new AtomicFile(journal).openRead())); if (!planId.equals(value.optString("planId"))) throw new Exception("本地保存恢复点计划不一致"); enqueueStateDelta(c, planId, value.getJSONObject("before"), after); if (!journal.delete()) throw new Exception("本地保存恢复点清理失败"); }
    }

    /** Replays an unfinished local-save recovery point on the next native entry. */
    public static void recoverPendingState(Context c, JSONObject current) throws Exception {
        synchronized (LOCK) { File journal = journalFile(c).getBaseFile(); if (!journal.exists()) return; JSONObject value = new JSONObject(DataStore.readText(new AtomicFile(journal).openRead())); long beforeRevision = value.optLong("beforeRevision", -1L); if (current.optLong("_revision", 0L) > beforeRevision) enqueueStateDelta(c, value.getString("planId"), value.getJSONObject("before"), current); if (!journal.delete()) throw new Exception("本地保存恢复点清理失败"); }
    }

    /** Converts a successful local save into small entity operations. */
    public static int enqueueStateDelta(Context c, String planId, JSONObject before, JSONObject after) throws Exception {
        synchronized (LOCK) {
            JSONObject state = readLocked(c);
            if (!state.getBoolean("autoSync") || state.isNull("workspaceId")) return 0;
            String workspace = state.getString("workspaceId"), deviceId = state.getString("deviceId"), instance = state.getString("clientInstanceId");
            String zone = after.optJSONObject("evaluation") == null ? ZoneId.systemDefault().getId() : after.getJSONObject("evaluation").optString("timezone", ZoneId.systemDefault().getId());
            int added = 0;
            JSONObject beforePlan = before == null ? null : before.optJSONObject("plan"), afterPlan = after.optJSONObject("plan");
            JSONObject planBefore = without(beforePlan, "weekTasks"), planAfter = without(afterPlan, "weekTasks");
            if (!same(planBefore, planAfter) && afterPlan != null) added += append(state, workspace, deviceId, instance, planId, "plan", "plan:" + planId, "upsert_plan", planAfter, after, zone);
            added += diffMap(state, workspace, deviceId, instance, planId, "record", "upsert_record", "delete_record", before == null ? null : before.optJSONObject("records"), after.optJSONObject("records"), zone, after);
            added += diffMap(state, workspace, deviceId, instance, planId, "review", "upsert_review", "delete_review", before == null ? null : before.optJSONObject("reviews"), after.optJSONObject("reviews"), zone, after);
            if (!same(before == null ? null : before.optJSONObject("evaluation"), after.optJSONObject("evaluation")) && after.has("evaluation")) added += append(state, workspace, deviceId, instance, planId, "evaluation", "evaluation:" + planId, "upsert_evaluation", after.getJSONObject("evaluation"), after, zone);
            added += diffTasks(state, workspace, deviceId, instance, planId, before, after, zone);
            added += diffQueue(state, workspace, deviceId, instance, planId, before, after, zone);
            if (added > 0) state.getJSONObject("sync").put("status", "pending_upload").put("lastFailure", JSONObject.NULL);
            writeLocked(c, state); return added;
        }
    }

    private static int diffMap(JSONObject state, String workspace, String deviceId, String instance, String planId, String type, String upsert, String delete, JSONObject before, JSONObject after, String zone, JSONObject latest) throws Exception {
        Set<String> keys = new HashSet<>(); if (before != null) for (Iterator<String> it = before.keys(); it.hasNext();) keys.add(it.next()); if (after != null) for (Iterator<String> it = after.keys(); it.hasNext();) keys.add(it.next());
        int added = 0; for (String key : keys) {
            JSONObject b = before == null || !before.has(key) || before.isNull(key) ? null : before.optJSONObject(key);
            JSONObject a = after == null || !after.has(key) || after.isNull(key) ? null : after.optJSONObject(key);
            if (same(b, a)) continue;
            String entity = type + ":" + planId + ":" + key;
            added += append(state, workspace, deviceId, instance, planId, type, entity, a == null ? delete : upsert, a == null ? new JSONObject().put("key", key) : a, latest, zone);
        }
        return added;
    }

    private static int diffTasks(JSONObject state, String workspace, String deviceId, String instance, String planId, JSONObject before, JSONObject after, String zone) throws Exception {
        Map<String, JSONObject> b = tasks(before == null ? null : before.optJSONObject("plan")), a = tasks(after.optJSONObject("plan")); Set<String> keys = new HashSet<>(); keys.addAll(b.keySet()); keys.addAll(a.keySet()); int added = 0;
        for (String key : keys) { JSONObject bv = b.get(key), av = a.get(key); if (same(bv, av)) continue; added += append(state, workspace, deviceId, instance, planId, "task", "task:" + planId + ":" + key, av == null ? "delete_task" : "upsert_task", av == null ? new JSONObject().put("taskId", key) : av, after, zone); }
        return added;
    }

    private static int diffQueue(JSONObject state, String workspace, String deviceId, String instance, String planId, JSONObject before, JSONObject after, String zone) throws Exception {
        Map<String, JSONObject> b = queue(before), a = queue(after); Set<String> keys = new HashSet<>(); keys.addAll(b.keySet()); keys.addAll(a.keySet()); int added = 0;
        for (String key : keys) { JSONObject bv = b.get(key), av = a.get(key); if (same(bv, av)) continue; added += append(state, workspace, deviceId, instance, planId, "review", "review:" + planId + ":queue:" + key, av == null ? "delete_review" : "upsert_review", av == null ? new JSONObject().put("id", key) : av, after, zone); }
        return added;
    }

    private static Map<String, JSONObject> tasks(JSONObject plan) throws Exception {
        Map<String, JSONObject> result = new HashMap<>(); if (plan == null || plan.optJSONObject("weekTasks") == null) return result; JSONObject groups = plan.getJSONObject("weekTasks");
        for (Iterator<String> it = groups.keys(); it.hasNext();) { String group = it.next(); JSONArray list = groups.optJSONArray(group); if (list == null) continue; for (int i = 0; i < list.length(); i++) { JSONObject value = list.optJSONObject(i); if (value == null) continue; String id = value.optString("id", group + ":" + i); result.put(id, new JSONObject(value.toString()).put("groupKey", group)); } }
        return result;
    }

    private static Map<String, JSONObject> queue(JSONObject state) throws Exception {
        Map<String, JSONObject> result = new HashMap<>(); if (state == null || state.optJSONObject("reviewQueue") == null) return result; JSONArray list = state.getJSONObject("reviewQueue").optJSONArray("items"); if (list == null) return result;
        for (int i = 0; i < list.length(); i++) { JSONObject value = list.optJSONObject(i); if (value != null) result.put(value.optString("id", "item:" + i), new JSONObject(value.toString())); }
        return result;
    }

    private static int append(JSONObject state, String workspace, String deviceId, String instance, String planId, String type, String entityId, String command, JSONObject payload, JSONObject latest, String zone) throws Exception {
        JSONArray list = state.getJSONArray("outbox"); long localRevision = latest.optLong("_revision", 0L);
        for (int i = 0; i < list.length(); i++) { JSONObject existing = list.getJSONObject(i); if (existing.optLong("localRevision", -1L) == localRevision && entityId.equals(existing.getJSONObject("operation").optString("entityId")) && same(payload, existing.getJSONObject("operation").optJSONObject("payload"))) return 0; }
        if (list.length() >= 2000) { state.getJSONObject("sync").put("status", "error").put("lastFailure", "待上传操作达到上限，请先完成同步"); return 0; }
        JSONObject revisions = state.getJSONObject("serverRevisions"); long base = revisions.optLong(entityId, 0L);
        JSONObject operation = new JSONObject().put("protocolVersion", PROTOCOL_VERSION).put("workspaceId", workspace).put("deviceId", deviceId).put("clientInstanceId", instance)
            .put("operationId", UUID.randomUUID().toString()).put("entityType", type).put("entityId", entityId).put("command", command).put("baseServerRevision", base)
            .put("schemaVersion", BUSINESS_SCHEMA_VERSION).put("occurredAtUtc", now()).put("businessTimeZone", zone).put("payload", new JSONObject(payload.toString()));
        list.put(new JSONObject().put("operation", operation).put("localRevision", localRevision).put("state", "pending_upload").put("attempts", 0).put("createdAtUtc", now()));
        state.put("deviceSequence", state.getLong("deviceSequence") + 1L); return 1;
    }

    /** Clears one operation only after an explicit server ACK has been received. */
    public static JSONObject acknowledge(Context c, String operationId, long serverRevision, long cursor, String serverEpoch) throws Exception {
        synchronized (LOCK) {
            if (operationId == null || operationId.trim().isEmpty()) throw new Exception("待确认操作ID无效");
            if (serverRevision < 0 || cursor < 0) throw new Exception("服务端确认序号无效");
            JSONObject state = readLocked(c); JSONArray list = state.getJSONArray("outbox"); JSONArray dedupes = state.getJSONArray("dedupe"); boolean found = false; String entityId = null;
            String dedupe = state.getString("clientInstanceId") + "|" + operationId;
            for (int i = list.length() - 1; i >= 0; i--) { JSONObject entry = list.getJSONObject(i), operation = entry.getJSONObject("operation"); if (operationId.equals(operation.optString("operationId"))) { found = true; entityId = operation.getString("entityId"); dedupe = operation.getString("clientInstanceId") + "|" + operation.getString("operationId"); list.remove(i); break; } }
            if (!found) {
                // A lost ACK can make the server answer duplicate after the
                // original transaction was already committed locally. Treat
                // that replay as success instead of turning a durable sync
                // into an error; the first ACK already persisted the revision.
                if (!contains(dedupes, dedupe)) throw new Exception("待确认操作不存在");
                acceptServerEpoch(state, serverEpoch);
                state.put("cursor", Math.max(state.getLong("cursor"), cursor));
                if (serverEpoch != null && !serverEpoch.trim().isEmpty() && state.isNull("serverEpoch")) state.put("serverEpoch", serverEpoch);
                writeLocked(c, state); return publicStatus(c, state);
            }
            acceptServerEpoch(state, serverEpoch);
            if (!contains(dedupes, dedupe)) dedupes.put(dedupe); while (dedupes.length() > 4000) dedupes.remove(0);
            state.getJSONObject("serverRevisions").put(entityId, serverRevision); state.put("cursor", Math.max(state.getLong("cursor"), cursor)); if (serverEpoch != null && !serverEpoch.trim().isEmpty()) state.put("serverEpoch", serverEpoch);
            JSONObject sync = state.getJSONObject("sync"); sync.put("lastSuccessAt", now()).put("lastFailure", JSONObject.NULL).put("status", list.length() == 0 ? "cloud_confirmed" : "pending_upload"); writeLocked(c, state); return publicStatus(c, state);
        }
    }

    public static JSONObject recordConflict(Context c, JSONObject conflict) throws Exception {
        synchronized (LOCK) { JSONObject state = readLocked(c); JSONArray list = state.getJSONArray("conflicts"); list.put(new JSONObject(conflict.toString())); while (list.length() > 200) list.remove(0); state.getJSONObject("sync").put("status", "conflict").put("lastFailure", "有待处理的同步冲突"); writeLocked(c, state); return publicStatus(c, state); }
    }

    /** Validates a hosted operation before a future downlink adapter can apply it. */
    public static void validateHostedOperation(JSONObject operation) throws Exception {
        if (operation == null) throw new Exception("下行操作缺失");
        validateOperation(operation);
    }

    /** Persists a received downlink result before a cursor can be advanced. */
    public static JSONObject recordInbox(Context c, JSONObject operation, String result, String error) throws Exception {
        if (operation == null) throw new Exception("下行操作缺失");
        if (!"applied".equals(result) && !"rejected".equals(result)) throw new Exception("下行结果无效");
        synchronized (LOCK) {
            JSONObject state = readLocked(c); JSONArray inbox = state.getJSONArray("inbox");
            String key = operation.optString("clientInstanceId", "") + "|" + operation.optString("operationId", "");
            for (int i = 0; i < inbox.length(); i++) if (key.equals(inbox.getJSONObject(i).optString("dedupeKey", ""))) return publicStatus(c, state);
            JSONObject entry = new JSONObject().put("dedupeKey", key).put("operation", new JSONObject(operation.toString()))
                .put("result", result).put("receivedAtUtc", now());
            if (error != null && !error.trim().isEmpty()) entry.put("error", error);
            inbox.put(entry); while (inbox.length() > 2000) inbox.remove(0);
            state.getJSONObject("sync").put("status", "rejected".equals(result) ? "error" : (state.getJSONArray("outbox").length() == 0 ? "device_applied" : "pending_upload"));
            if ("rejected".equals(result)) state.getJSONObject("sync").put("lastFailure", error == null ? "下行操作未应用" : error);
            writeLocked(c, state); return publicStatus(c, state);
        }
    }

    /** Advances the durable pull cursor only after the corresponding inbox entry is stored. */
    public static JSONObject advanceCursor(Context c, long cursor, String serverEpoch) throws Exception {
        if (cursor < 0) throw new Exception("同步游标无效");
        synchronized (LOCK) {
            JSONObject state = readLocked(c); acceptServerEpoch(state, serverEpoch); state.put("cursor", Math.max(state.getLong("cursor"), cursor));
            if (serverEpoch != null && !serverEpoch.trim().isEmpty()) state.put("serverEpoch", serverEpoch);
            writeLocked(c, state); return publicStatus(c, state);
        }
    }

    public static JSONArray pendingOperations(Context c) throws Exception {
        synchronized (LOCK) { JSONObject state = readLocked(c); JSONArray result = new JSONArray(); JSONArray list = state.getJSONArray("outbox"); for (int i = 0; i < list.length(); i++) result.put(new JSONObject(list.getJSONObject(i).getJSONObject("operation").toString())); return result; }
    }

    public static void markTransportFailure(Context c, String code, String message, boolean retryable) {
        try {
            synchronized (LOCK) { JSONObject state = readLocked(c); String status = retryable ? "offline" : ("UNAUTHENTICATED".equals(code) ? "session_invalid" : ("DEVICE_REVOKED".equals(code) ? "device_revoked" : "error")); state.getJSONObject("sync").put("status", status).put("lastFailure", message == null ? code : message); writeLocked(c, state); }
        } catch (Exception ignored) { }
    }

    public static JSONObject saveReminder(Context c, JSONObject reminder) throws Exception {
        JSONObject normalized = new JSONObject(reminder == null ? "{}" : reminder.toString()); normalizeReminder(normalized); validateReminder(normalized);
        synchronized (LOCK) { JSONObject state = readLocked(c); JSONArray list = state.getJSONArray("reminders"); String eventId = normalized.getString("eventId"); for (int i = 0; i < list.length(); i++) if (eventId.equals(list.getJSONObject(i).getString("eventId"))) { list.put(i, new JSONObject(normalized.toString())); writeLocked(c, state); return publicStatus(c, state); } list.put(new JSONObject(normalized.toString())); writeLocked(c, state); return publicStatus(c, state); }
    }

    public static JSONArray reminders(Context c) throws Exception { synchronized (LOCK) { return new JSONArray(readLocked(c).getJSONArray("reminders").toString()); } }
    public static void markReminderReceived(Context c, String eventId, long version) throws Exception { updateReminderReceipt(c, eventId, version, "received"); }
    public static void markReminderScheduled(Context c, String eventId, long version) throws Exception { updateReminderReceipt(c, eventId, version, "scheduled"); }
    public static void markReminderDelivered(Context c, String eventId) throws Exception { markReminderDelivered(c, eventId, -1L); }
    public static void markReminderDelivered(Context c, String eventId, long version) throws Exception { updateReminderReceipt(c, eventId, version, "delivered"); }
    public static void cancelReminder(Context c, String eventId, long version) throws Exception { updateReminderReceipt(c, eventId, version, "cancelled"); }

    private static void updateReminderReceipt(Context c, String eventId, long version, String receipt) throws Exception {
        synchronized (LOCK) {
            JSONObject state = readLocked(c); JSONArray list = state.getJSONArray("reminders"); boolean found = false;
            for (int i = 0; i < list.length(); i++) {
                JSONObject reminder = list.getJSONObject(i); if (!eventId.equals(reminder.getString("eventId"))) continue;
                long current = reminder.optLong("reminderVersion", 1L); if (version >= 0 && current != version) throw new Exception("提醒版本已更新");
                String now = now(); reminder.put("receiptState", receipt);
                if ("received".equals(receipt)) { reminder.put("status", "received").put("receivedAtUtc", now); }
                else if ("scheduled".equals(receipt)) { reminder.put("status", "scheduled").put("scheduledAtUtc", now); }
                else if ("delivered".equals(receipt)) { reminder.put("status", "delivered").put("deliveredAtUtc", now); }
                else if ("cancelled".equals(receipt)) { reminder.put("status", "cancelled").put("cancelledAtUtc", now); }
                found = true; break;
            }
            if (!found) throw new Exception("提醒不存在"); writeLocked(c, state);
        }
    }

    private static JSONObject publicStatus(Context c, JSONObject state) throws Exception { return status(c); }
    private static void acceptServerEpoch(JSONObject state, String serverEpoch) throws Exception {
        if (serverEpoch == null || serverEpoch.trim().isEmpty()) return;
        if (!state.isNull("serverEpoch") && !serverEpoch.equals(state.getString("serverEpoch"))) throw new Exception("服务端同步代次已变化，请先获取快照");
    }
    private static boolean contains(JSONArray list, String value) { for (int i = 0; i < list.length(); i++) if (value.equals(list.optString(i, null))) return true; return false; }
    private static JSONObject without(JSONObject source, String key) throws Exception { if (source == null) return null; JSONObject value = new JSONObject(source.toString()); value.remove(key); return value; }
    private static boolean same(JSONObject a, JSONObject b) { return a == null ? b == null : b != null && a.toString().equals(b.toString()); }
    private static String now() { return Instant.now().toString(); }
    private static String trim(String value) { return value == null ? "" : value.trim(); }
    private static boolean uuid(String value) { return value != null && value.matches("[0-9a-fA-F-]{36}"); }
    private static void validId(String value, String label) throws Exception { require(value != null && value.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"), label + "无效"); }
    private static void validateOperation(JSONObject operation) throws Exception {
        require(operation.getInt("protocolVersion") == PROTOCOL_VERSION && operation.getInt("schemaVersion") == BUSINESS_SCHEMA_VERSION, "同步协议版本不支持");
        validId(operation.getString("workspaceId"), "工作区ID"); validId(operation.getString("deviceId"), "设备ID"); validId(operation.getString("clientInstanceId"), "客户端实例ID"); validId(operation.getString("operationId"), "操作ID");
        require(operation.getString("entityId").length() <= 384 && operation.getString("entityId").length() > 0, "实体ID无效"); require(operation.getString("businessTimeZone").length() <= 64, "业务时区无效"); Instant.parse(operation.getString("occurredAtUtc"));
        String type = operation.getString("entityType"), command = operation.getString("command"); require(type.equals("plan") || type.equals("record") || type.equals("task") || type.equals("review") || type.equals("evaluation") || type.equals("reminder"), "实体类型不支持"); require(command.equals("upsert_" + type) || (type.equals("reminder") ? command.equals("cancel_reminder") : command.equals("delete_" + type)), "同步命令不支持"); require(operation.getLong("baseServerRevision") >= 0, "服务端修订号无效"); require(operation.optJSONObject("payload") != null, "同步载荷无效");
    }
    private static void validateQueueEntry(JSONObject entry) throws Exception { require(entry.getJSONObject("operation") != null, "待上传操作缺少信封"); validateOperation(entry.getJSONObject("operation")); require(entry.getLong("localRevision") >= 0 && entry.getInt("attempts") >= 0, "本地操作状态无效"); }
    private static boolean normalizeReminder(JSONObject reminder) throws Exception {
        boolean changed = false;
        if (!reminder.has("reminderVersion")) { reminder.put("reminderVersion", 1L); changed = true; }
        if (!reminder.has("receiptState")) { String status = reminder.optString("status", "received"); String receipt = "scheduled".equals(status) ? "scheduled" : "delivered".equals(status) ? "delivered" : "cancelled".equals(status) ? "cancelled" : "received"; reminder.put("receiptState", receipt); changed = true; }
        for (String key : new String[]{"receivedAtUtc", "scheduledAtUtc", "deliveredAtUtc", "cancelledAtUtc"}) if (!reminder.has(key)) { reminder.put(key, JSONObject.NULL); changed = true; }
        if (!reminder.has("sourceRevision")) { reminder.put("sourceRevision", 0L); changed = true; }
        return changed;
    }
    private static void validateReminder(JSONObject reminder) throws Exception {
        Set<String> required = new HashSet<>(); for (String key : new String[]{"eventId", "title", "atUtc", "timezone", "deepLink", "schemaVersion", "status"}) required.add(key);
        Set<String> allowed = new HashSet<>(required); for (String key : new String[]{"reminderVersion", "receiptState", "receivedAtUtc", "scheduledAtUtc", "deliveredAtUtc", "cancelledAtUtc", "sourceRevision"}) allowed.add(key);
        Iterator<String> keys = reminder.keys(); while (keys.hasNext()) { String key = keys.next(); require(allowed.contains(key), "拾遗提醒含未知字段"); } for (String key : required) require(reminder.has(key) && !reminder.isNull(key), "拾遗提醒字段不完整");
        require(reminder.getString("eventId").matches("[A-Za-z0-9._:-]{3,128}"), "拾遗提醒ID无效"); require(!reminder.getString("title").trim().isEmpty() && reminder.getString("title").length() <= 500, "拾遗提醒标题无效"); Instant.parse(reminder.getString("atUtc")); require(reminder.getInt("schemaVersion") == 1, "拾遗提醒版本不支持");
        String status = reminder.getString("status"); require("received".equals(status) || "confirmed".equals(status) || "scheduled".equals(status) || "delivered".equals(status) || "cancelled".equals(status), "拾遗提醒状态无效"); require(reminder.getString("deepLink").startsWith("daily-study://"), "拾遗提醒入口无效");
        require(reminder.getLong("reminderVersion") > 0, "拾遗提醒版本无效"); require("received".equals(reminder.getString("receiptState")) || "scheduled".equals(reminder.getString("receiptState")) || "delivered".equals(reminder.getString("receiptState")) || "cancelled".equals(reminder.getString("receiptState")), "拾遗提醒回执状态无效"); require(reminder.getLong("sourceRevision") >= 0, "拾遗提醒来源修订无效");
        for (String key : new String[]{"receivedAtUtc", "scheduledAtUtc", "deliveredAtUtc", "cancelledAtUtc"}) if (!reminder.isNull(key)) Instant.parse(reminder.getString(key));
    }
    private static void validate(JSONObject state) throws Exception {
        require(state.getInt("protocolVersion") == PROTOCOL_VERSION && state.getInt("stateSchemaVersion") == STATE_SCHEMA_VERSION, "同步状态版本不支持"); require(uuid(state.getString("deviceId")) && uuid(state.getString("clientInstanceId")), "设备身份无效"); require(state.getLong("clientInstanceGeneration") > 0 && state.getLong("deviceSequence") >= 0 && state.getLong("cursor") >= 0, "同步序号无效");
        if (!state.isNull("accountId")) validId(state.getString("accountId"), "账号ID"); if (!state.isNull("workspaceId")) validId(state.getString("workspaceId"), "工作区ID");
        JSONArray outbox = state.getJSONArray("outbox"); require(outbox.length() <= 2000, "同步队列过大"); for (int i = 0; i < outbox.length(); i++) validateQueueEntry(outbox.getJSONObject(i));
        require(state.getJSONArray("inbox").length() <= 2000 && state.getJSONArray("dedupe").length() <= 4000 && state.getJSONArray("conflicts").length() <= 200, "同步历史过大");
        String sync = state.getJSONObject("sync").getString("status"); require("local_saved".equals(sync) || "signed_out".equals(sync) || "not_configured".equals(sync) || "pending_upload".equals(sync) || "cloud_confirmed".equals(sync) || "device_applied".equals(sync) || "conflict".equals(sync) || "offline".equals(sync) || "session_invalid".equals(sync) || "device_revoked".equals(sync) || "backend_unavailable".equals(sync) || "error".equals(sync), "同步状态无效");
        JSONArray reminders = state.getJSONArray("reminders"); require(reminders.length() <= 500, "拾遗提醒过多"); for (int i = 0; i < reminders.length(); i++) validateReminder(reminders.getJSONObject(i));
    }
    private static void require(boolean yes, String message) throws Exception { if (!yes) throw new Exception(message); }
}
