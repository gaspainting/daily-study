package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Coordinates the durable outbox with a versioned transport. It is kept
 * independent from Activity/WebView lifecycle so a future WorkManager trigger
 * can use the same ACK and conflict rules.
 */
public final class HostedSyncService {
    private HostedSyncService() {}

    public static JSONObject run(Context context, SyncTransport transport) throws Exception {
        if (transport == null) throw new Exception("托管同步传输未配置");
        SyncStore.bindAuthenticatedSession(context);
        JSONArray operations = SyncStore.pendingOperations(context); if (operations.length() == 0) return SyncStore.status(context);
        try {
            JSONObject response = transport.push(operations);
            JSONArray acknowledgements = response.optJSONArray("acknowledgements");
            if (acknowledgements != null) for (int i = 0; i < acknowledgements.length(); i++) {
                JSONObject item = acknowledgements.getJSONObject(i); String result = item.optString("result", item.optString("status", ""));
                if ("accepted".equals(result) || "duplicate".equals(result)) SyncStore.acknowledge(context, item.getString("operationId"), item.getLong("serverRevision"), item.optLong("cursor", 0L), item.optString("serverEpoch", null));
                else if ("conflict".equals(result)) SyncStore.recordConflict(context, item);
            }
            return SyncStore.status(context);
        } catch (SyncTransport.SyncException error) {
            SyncStore.markTransportFailure(context, error.code, error.getMessage(), error.retryable); throw error;
        }
    }
}
