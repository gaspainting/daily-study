package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;

/** Versioned hosted-sync transport seam. A backend must freeze its schema before this is enabled. */
public interface SyncTransport {
    JSONObject capabilities() throws Exception;
    JSONObject push(JSONArray operations) throws Exception;
    JSONObject pull(long cursor) throws Exception;

    final class SyncException extends Exception {
        public final String code;
        public final boolean retryable;
        public SyncException(String code, String message, boolean retryable) { super(message); this.code = code; this.retryable = retryable; }
    }
}
