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
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;

/** Local-only sync metadata. It records durable intent and queues; it does not claim a LAN sync occurred. */
public final class SyncStore {
    public static final int PROTOCOL_VERSION = 1;
    private static final String KEY_ALIAS = "shiyi-sync-device";
    private static final Object LOCK = new Object();
    private static AtomicFile file(Context c) { return new AtomicFile(new File(c.getFilesDir(), "sync-state.json")); }
    private SyncStore() {}

    private static void ensureIdentity() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return;
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY).setDigests(KeyProperties.DIGEST_SHA256).build());
        generator.generateKeyPair();
    }
    private static JSONObject empty() throws Exception {
        return new JSONObject().put("protocolVersion", PROTOCOL_VERSION).put("deviceId", UUID.randomUUID().toString()).put("databaseEpoch", UUID.randomUUID().toString()).put("deviceSequence", 0L).put("autoSync", false).put("manualAddress", "")
            .put("pair", new JSONObject().put("status", "unpaired").put("desktopId", JSONObject.NULL).put("desktopName", JSONObject.NULL).put("address", JSONObject.NULL).put("port", JSONObject.NULL).put("fingerprint", JSONObject.NULL).put("pairedAt", JSONObject.NULL).put("revoked", false))
            .put("outbox", new JSONArray()).put("inbox", new JSONArray()).put("dedupe", new JSONArray()).put("cursor", 0L)
            .put("sync", new JSONObject().put("status", "not_configured").put("lastAttemptAt", JSONObject.NULL).put("lastSuccessAt", JSONObject.NULL).put("lastFailure", JSONObject.NULL))
            .put("reminders", new JSONArray());
    }
    private static JSONObject readLocked(Context c) throws Exception {
        ensureIdentity(); AtomicFile af = file(c); JSONObject state = af.getBaseFile().exists() ? new JSONObject(DataStore.readText(af.openRead())) : empty(); validate(state); if (!af.getBaseFile().exists()) writeLocked(c, state); return state;
    }
    private static void writeLocked(Context c, JSONObject state) throws Exception {
        validate(state); byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > 1024 * 1024) throw new Exception("同步队列超过1MB，请先完成同步"); AtomicFile af = file(c); FileOutputStream out = null;
        try { out = af.startWrite(); out.write(bytes); out.getFD().sync(); af.finishWrite(out); out = null; } finally { if (out != null) af.failWrite(out); }
    }
    public static JSONObject status(Context c) throws Exception {
        synchronized (LOCK) { JSONObject state = readLocked(c), pair = state.getJSONObject("pair"), sync = state.getJSONObject("sync"), publicPair = new JSONObject(pair.toString()); publicPair.remove("code"); return new JSONObject().put("protocolVersion", PROTOCOL_VERSION).put("deviceId", state.getString("deviceId")).put("databaseEpoch", state.getString("databaseEpoch")).put("deviceSequence", state.getLong("deviceSequence")).put("autoSync", state.getBoolean("autoSync")).put("manualAddress", state.getString("manualAddress")).put("pair", publicPair).put("pendingCount", state.getJSONArray("outbox").length()).put("inboxCursor", state.getLong("cursor")).put("status", sync.getString("status")).put("lastAttemptAt", sync.opt("lastAttemptAt")).put("lastSuccessAt", sync.opt("lastSuccessAt")).put("lastFailure", sync.opt("lastFailure")).put("reminderCount", state.getJSONArray("reminders").length()); }
    }
    public static JSONObject saveSettings(Context c, boolean autoSync, String manualAddress) throws Exception { synchronized (LOCK) { JSONObject state = readLocked(c); state.put("autoSync", autoSync).put("manualAddress", manualAddress == null ? "" : manualAddress.trim()); if (state.getJSONObject("pair").getString("status").equals("unpaired")) state.getJSONObject("sync").put("status", manualAddress == null || manualAddress.trim().isEmpty() ? "not_configured" : "ready_to_pair"); writeLocked(c, state); return status(c); } }
    public static JSONObject beginPairing(Context c, String code) throws Exception { synchronized (LOCK) { if (code == null || code.trim().length() < 4 || code.trim().length() > 128) throw new Exception("请输入拾遗配对码"); JSONObject state = readLocked(c), pair = state.getJSONObject("pair"); pair.put("status", "pending").put("code", code.trim()).put("revoked", false); state.getJSONObject("sync").put("status", "pairing_pending"); writeLocked(c, state); return status(c); } }
    public static JSONObject savePairing(Context c, String desktopId, String desktopName, String address, int port, String fingerprint) throws Exception { synchronized (LOCK) { if (desktopId == null || desktopId.trim().isEmpty() || address == null || address.trim().isEmpty() || port < 1 || port > 65535 || fingerprint == null || fingerprint.trim().isEmpty()) throw new Exception("拾遗设备信息不完整"); JSONObject state = readLocked(c), pair = state.getJSONObject("pair"); pair.remove("code"); pair.put("status", "paired").put("desktopId", desktopId.trim()).put("desktopName", desktopName == null ? "" : desktopName.trim()).put("address", address.trim()).put("port", port).put("fingerprint", fingerprint.trim()).put("pairedAt", java.time.Instant.now().toString()).put("revoked", false); state.getJSONObject("sync").put("status", "waiting_for_desktop").put("lastFailure", JSONObject.NULL); writeLocked(c, state); return status(c); } }
    public static JSONObject unpair(Context c) throws Exception { synchronized (LOCK) { JSONObject state = readLocked(c); state.put("pair", empty().getJSONObject("pair")).put("autoSync", false); state.getJSONObject("sync").put("status", "not_configured"); writeLocked(c, state); return status(c); } }
    public static JSONObject syncNow(Context c) throws Exception { synchronized (LOCK) { JSONObject state = readLocked(c), pair = state.getJSONObject("pair"), sync = state.getJSONObject("sync"); sync.put("lastAttemptAt", java.time.Instant.now().toString()); if (!"paired".equals(pair.optString("status"))) { sync.put("status", "not_paired"); sync.put("lastFailure", "尚未绑定拾遗设备"); } else { sync.put("status", "waiting_for_desktop").put("lastFailure", "拾遗桌面端尚未连接，记录仍在本机队列"); } writeLocked(c, state); return status(c); } }
    public static JSONObject saveReminder(Context c, JSONObject reminder) throws Exception { synchronized (LOCK) { validateReminder(reminder); JSONObject state = readLocked(c); JSONArray list = state.getJSONArray("reminders"); String eventId = reminder.getString("eventId"); for (int i = 0; i < list.length(); i++) if (eventId.equals(list.getJSONObject(i).getString("eventId"))) { list.put(i, new JSONObject(reminder.toString())); writeLocked(c, state); return status(c); } list.put(new JSONObject(reminder.toString())); writeLocked(c, state); return status(c); } }
    public static JSONArray reminders(Context c) throws Exception { synchronized (LOCK) { return new JSONArray(readLocked(c).getJSONArray("reminders").toString()); } }
    public static void markReminderDelivered(Context c, String eventId) throws Exception { synchronized (LOCK) { JSONObject state = readLocked(c); JSONArray list = state.getJSONArray("reminders"); for (int i = 0; i < list.length(); i++) if (eventId.equals(list.getJSONObject(i).getString("eventId"))) list.getJSONObject(i).put("status", "delivered"); writeLocked(c, state); } }
    private static void validateReminder(JSONObject reminder) throws Exception { Set<String> allowed = new HashSet<>(); for (String key : new String[]{"eventId","title","atUtc","timezone","deepLink","schemaVersion","status"}) allowed.add(key); require(reminder.length() == allowed.size(), "拾遗提醒字段不完整"); Iterator<String> keys = reminder.keys(); while (keys.hasNext()) require(allowed.contains(keys.next()), "拾遗提醒含未知字段"); require(reminder.getString("eventId").matches("[A-Za-z0-9._:-]{3,128}"), "拾遗提醒ID无效"); require(!reminder.getString("title").trim().isEmpty() && reminder.getString("title").length() <= 500, "拾遗提醒标题无效"); java.time.Instant.parse(reminder.getString("atUtc")); require(reminder.getInt("schemaVersion") == 1, "拾遗提醒版本不支持"); require("confirmed".equals(reminder.getString("status")) || "scheduled".equals(reminder.getString("status")) || "delivered".equals(reminder.getString("status")) || "cancelled".equals(reminder.getString("status")), "拾遗提醒状态无效"); require(reminder.getString("deepLink").startsWith("daily-study://"), "拾遗提醒入口无效"); }
    private static void validate(JSONObject state) throws Exception { require(state.getInt("protocolVersion") == PROTOCOL_VERSION, "同步协议版本不支持"); require(state.getString("deviceId").matches("[0-9a-fA-F-]{36}"), "设备ID无效"); require(state.getString("databaseEpoch").matches("[0-9a-fA-F-]{36}"), "数据库代次无效"); require(state.getLong("deviceSequence") >= 0 && state.getLong("cursor") >= 0, "同步序号无效"); require(state.getJSONArray("outbox").length() <= 1000 && state.getJSONArray("inbox").length() <= 1000 && state.getJSONArray("dedupe").length() <= 2000, "同步队列过大"); JSONObject pair = state.getJSONObject("pair"); require("unpaired".equals(pair.getString("status")) || "pending".equals(pair.getString("status")) || "paired".equals(pair.getString("status")), "绑定状态无效"); JSONArray reminders = state.getJSONArray("reminders"); require(reminders.length() <= 500, "拾遗提醒过多"); for (int i = 0; i < reminders.length(); i++) validateReminder(reminders.getJSONObject(i)); }
    private static void require(boolean yes, String message) throws Exception { if (!yes) throw new Exception(message); }
}
