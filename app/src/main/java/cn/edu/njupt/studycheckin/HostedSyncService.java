package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Coordinates the durable outbox with a versioned transport. It is kept
 * independent from Activity/WebView lifecycle so a system job trigger
 * can use the same ACK and conflict rules.
 */
public final class HostedSyncService {
    private HostedSyncService() {}

    public static JSONObject run(Context context, SyncTransport transport) throws Exception {
        if (transport == null) throw new Exception("托管同步传输未配置");
        try {
            SyncStore.bindAuthenticatedSession(context);
            JSONArray operations = SyncStore.pendingOperations(context);
            if (operations.length() > 0) {
                JSONObject response = transport.push(operations);
                if (response == null) throw new SyncTransport.SyncException("INVALID_RESPONSE", "托管同步上传响应为空", false);
                JSONArray acknowledgements = response.optJSONArray("acknowledgements");
                if (acknowledgements == null) throw new SyncTransport.SyncException("INVALID_RESPONSE", "托管同步缺少 ACK", false);
                if (acknowledgements != null) for (int i = 0; i < acknowledgements.length(); i++) {
                    JSONObject item = acknowledgements.getJSONObject(i); String result = item.optString("result", item.optString("status", ""));
                    if ("accepted".equals(result) || "duplicate".equals(result)) {
                        if (!item.has("operationId") || !item.has("serverRevision")) throw new SyncTransport.SyncException("INVALID_RESPONSE", "托管同步 ACK 字段不完整", false);
                        SyncStore.acknowledge(context, item.getString("operationId"), item.getLong("serverRevision"), item.optLong("cursor", 0L), item.optString("serverEpoch", null));
                    }
                    else if ("conflict".equals(result)) SyncStore.recordConflict(context, item);
                }
            }
            JSONObject pull = transport.pull(SyncStore.status(context).optLong("inboxCursor", 0L));
            if (pull == null || !pull.has("operations") || pull.optJSONArray("operations") == null) throw new SyncTransport.SyncException("INVALID_RESPONSE", "托管同步下行响应格式无效", false);
            JSONArray downlinks = pull.optJSONArray("operations");
            boolean rejected = false;
            if (downlinks != null) for (int i = 0; i < downlinks.length(); i++) {
                JSONObject result = HostedDownlink.process(context, downlinks.getJSONObject(i));
                if ("rejected".equals(result.optString("result"))) rejected = true;
            }
            if (rejected) throw new SyncTransport.SyncException("UNSUPPORTED_DOWNLINK", "有下行操作未应用", false);
            if (pull.has("cursor")) SyncStore.advanceCursor(context, pull.getLong("cursor"), pull.optString("serverEpoch", null));
            return SyncStore.status(context);
        } catch (SyncTransport.SyncException error) {
            SyncStore.markTransportFailure(context, error.code, error.getMessage(), error.retryable); throw error;
        }
    }
}
