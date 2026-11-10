package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONObject;

/**
 * Conservative downlink boundary for the hosted-sync draft. Only reminders
 * have a local adapter today; other business commands are retained as an
 * explicit rejection until the Mac/backend domain payloads are frozen.
 */
public final class HostedDownlink {
    private HostedDownlink() {}

    public static JSONObject process(Context context, JSONObject envelope) throws Exception {
        JSONObject operation = envelope == null ? null : envelope.optJSONObject("operation");
        if (operation == null) operation = envelope;
        try {
            SyncStore.validateHostedOperation(operation);
        } catch (Exception error) {
            return rejected(context, operation == null ? new JSONObject() : operation, "INVALID_DOWNLINK", error.getMessage());
        }
        String command = operation.getString("command");
        if (!"reminder".equals(operation.getString("entityType")))
            return rejected(context, operation, "UNSUPPORTED_DOWNLINK", "手机尚未支持该下行业务命令");
        try {
            JSONObject payload = operation.getJSONObject("payload");
            long version = payload.optLong("reminderVersion", operation.optLong("reminderVersion", 1L));
            if ("upsert_reminder".equals(command)) {
                if (!payload.has("sourceRevision") && operation.has("serverRevision")) payload.put("sourceRevision", operation.optLong("serverRevision", 0L));
                SyncStore.saveReminder(context, payload);
                SyncStore.markReminderReceived(context, payload.getString("eventId"), version);
                ShiyiReminderScheduler.schedule(context);
            } else if ("cancel_reminder".equals(command)) {
                String eventId = payload.optString("eventId", "");
                if (eventId.isEmpty()) eventId = reminderId(operation.getString("entityId"));
                if (eventId.isEmpty()) throw new Exception("提醒ID缺失");
                ShiyiReminderScheduler.cancel(context, eventId, version);
            } else {
                return rejected(context, operation, "UNSUPPORTED_DOWNLINK", "手机尚未支持该提醒命令");
            }
            SyncStore.recordInbox(context, operation, "applied", null);
            return new JSONObject().put("result", "applied").put("operationId", operation.getString("operationId"));
        } catch (Exception error) {
            return rejected(context, operation, "DOWNLINK_NOT_APPLIED", error.getMessage());
        }
    }

    private static JSONObject rejected(Context context, JSONObject operation, String code, String message) throws Exception {
        String detail = message == null || message.trim().isEmpty() ? code : message;
        SyncStore.recordInbox(context, operation == null ? new JSONObject() : operation, "rejected", detail);
        return new JSONObject().put("result", "rejected").put("code", code).put("error", detail)
            .put("operationId", operation == null ? JSONObject.NULL : operation.opt("operationId"));
    }

    private static String reminderId(String entityId) {
        return entityId != null && entityId.startsWith("reminder:") ? entityId.substring("reminder:".length()) : "";
    }
}
