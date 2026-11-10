package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/**
 * HTTPS-only adapter for the logical v0.3 routes. It is not wired to a
 * production endpoint until the Mac/Supabase OpenAPI and fixtures are frozen.
 */
public final class HttpSyncTransport implements SyncTransport {
    private final Context context;
    private final String baseUrl;
    private final int timeoutMillis;
    private final AuthSessionStore.Refresher refresher;

    public HttpSyncTransport(Context context, String baseUrl) throws Exception {
        this(context, baseUrl, null);
    }

    public HttpSyncTransport(Context context, String baseUrl, AuthSessionStore.Refresher refresher) throws Exception {
        if (baseUrl == null || !baseUrl.matches("https://[^\\s/]+(?:/[^\\s]*)?")) throw new Exception("托管同步地址必须使用 HTTPS");
        URI uri = URI.create(baseUrl); if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) throw new Exception("托管同步地址不能包含凭证或查询参数");
        this.context = context.getApplicationContext(); this.baseUrl = baseUrl.replaceAll("/+$", ""); this.timeoutMillis = 15000; this.refresher = refresher;
    }

    @Override public JSONObject capabilities() throws Exception { return request("GET", "/api/v1/capabilities", null); }
    @Override public JSONObject push(JSONArray operations) throws Exception { return request("POST", "/api/v1/sync/push", new JSONObject().put("operations", new JSONArray(operations.toString()))); }
    @Override public JSONObject pull(long cursor) throws Exception { if (cursor < 0) throw new Exception("同步游标无效"); return request("GET", "/api/v1/sync/pull?cursor=" + cursor, null); }

    private JSONObject request(String method, String path, JSONObject body) throws Exception {
        try { AuthSessionStore.refreshIfNeeded(context, refresher); } catch (Exception error) { throw new SyncException("UNAUTHENTICATED", "拾遗账号会话不可用", false); }
        JSONObject session = AuthSessionStore.session(context); if (session == null || session.optLong("expiresAtMillis", 0L) <= System.currentTimeMillis()) throw new SyncException("UNAUTHENTICATED", "拾遗账号会话不可用", false);
        URL url = new URL(baseUrl + path); HttpURLConnection raw = (HttpURLConnection) url.openConnection(); if (!(raw instanceof HttpsURLConnection)) throw new SyncException("UNSUPPORTED_TRANSPORT", "托管同步必须使用 HTTPS", false);
        HttpsURLConnection connection = (HttpsURLConnection) raw; connection.setInstanceFollowRedirects(false); connection.setRequestMethod(method); connection.setConnectTimeout(timeoutMillis); connection.setReadTimeout(timeoutMillis); connection.setUseCaches(false); connection.setDoInput(true); connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Authorization", "Bearer " + session.getString("accessToken"));
        if (body != null) { connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8"); try (OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); } }
        int code; try { code = connection.getResponseCode(); } catch (Exception error) { throw new SyncException("TEMPORARY_UNAVAILABLE", "托管同步网络不可用", true); }
        String text = read(code >= 400 ? connection.getErrorStream() : connection.getInputStream()); JSONObject result;
        try { result = text.isEmpty() ? new JSONObject() : new JSONObject(text); } catch (Exception error) { throw new SyncException("INVALID_RESPONSE", "托管同步响应格式无效", false); }
        if (code >= 200 && code < 300) return result;
        String errorCode = result.optString("code", code == 401 ? "UNAUTHENTICATED" : code == 403 ? "FORBIDDEN" : code == 409 ? "REVISION_CONFLICT" : code == 429 ? "RATE_LIMITED" : code >= 500 ? "TEMPORARY_UNAVAILABLE" : "VALIDATION_FAILED");
        boolean retryable = "TEMPORARY_UNAVAILABLE".equals(errorCode) || "RATE_LIMITED".equals(errorCode);
        throw new SyncException(errorCode, result.optString("message", "托管同步请求失败"), retryable);
    }

    private static String read(InputStream stream) throws Exception { if (stream == null) return ""; try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] buffer = new byte[4096]; int length; while ((length = in.read(buffer)) >= 0) out.write(buffer, 0, length); return out.toString(StandardCharsets.UTF_8.name()); } }
}
