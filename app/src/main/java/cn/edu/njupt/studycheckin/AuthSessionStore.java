package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Keystore-protected session metadata; access and refresh tokens never leave native storage. */
public final class AuthSessionStore {
    private static final String KEY_ALIAS = "shiyi-auth-session-v1";
    private static final Object LOCK = new Object();
    private static final int IV_BYTES = 12;
    private static final Object REFRESH_LOCK = new Object();
    private static boolean refreshInFlight;
    private AuthSessionStore() {}

    /** Native-only callback used by the future Auth client; it never crosses WebView. */
    public interface Refresher { JSONObject refresh(String refreshToken) throws Exception; }

    private static AtomicFile file(Context c) { return new AtomicFile(new File(c.getFilesDir(), "shiyi-auth-session.bin")); }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build()); generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
    }

    public static void save(Context c, String accountId, String workspaceId, String accessToken, String refreshToken, long expiresAtMillis) throws Exception {
        if (accountId == null || !accountId.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")) throw new Exception("账号ID无效");
        if (workspaceId == null || !workspaceId.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")) throw new Exception("工作区ID无效");
        if (accessToken == null || accessToken.length() < 16 || accessToken.length() > 8192 || refreshToken == null || refreshToken.length() < 16 || refreshToken.length() > 8192) throw new Exception("会话凭证无效");
        if (expiresAtMillis <= System.currentTimeMillis()) throw new Exception("会话已过期");
        JSONObject value = new JSONObject().put("accountId", accountId).put("workspaceId", workspaceId).put("accessToken", accessToken).put("refreshToken", refreshToken).put("expiresAtMillis", expiresAtMillis);
        byte[] iv = new byte[IV_BYTES]; new SecureRandom().nextBytes(iv); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(128, iv)); byte[] encrypted = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject envelope = new JSONObject().put("version", 1).put("iv", Base64.encodeToString(iv, Base64.NO_WRAP)).put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP));
        synchronized (LOCK) { AtomicFile af = file(c); FileOutputStream out = null; try { out = af.startWrite(); out.write(envelope.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); af.finishWrite(out); out = null; } finally { if (out != null) af.failWrite(out); } }
    }

    public static JSONObject status(Context c) throws Exception {
        synchronized (LOCK) {
            try {
                JSONObject value = read(c); if (value == null) return new JSONObject().put("state", "signed_out").put("authenticated", false);
                long expires = value.optLong("expiresAtMillis", 0L); boolean usable = expires > System.currentTimeMillis();
                return new JSONObject().put("state", usable ? "authenticated" : "expired").put("authenticated", usable).put("accountId", value.optString("accountId", JSONObject.NULL.toString())).put("workspaceId", value.optString("workspaceId", JSONObject.NULL.toString())).put("expiresAtMillis", expires);
            } catch (Exception error) { return new JSONObject().put("state", "storage_error").put("authenticated", false).put("error", "会话存储不可读"); }
        }
    }

    static boolean hasUsableSession(Context c) { try { JSONObject value = read(c); return value != null && value.optLong("expiresAtMillis", 0L) > System.currentTimeMillis(); } catch (Exception ignored) { return false; } }

    static JSONObject session(Context c) throws Exception { synchronized (LOCK) { return read(c); } }

    /** Single-flight refresh seam. The server response must contain new encrypted-session fields. */
    public static boolean refreshIfNeeded(Context c, Refresher refresher) throws Exception {
        if (refresher == null) return hasUsableSession(c);
        synchronized (REFRESH_LOCK) {
            JSONObject current = session(c); if (current != null && current.optLong("expiresAtMillis", 0L) > System.currentTimeMillis() + 60000L) return true;
            while (refreshInFlight) { REFRESH_LOCK.wait(15000L); current = session(c); if (current != null && current.optLong("expiresAtMillis", 0L) > System.currentTimeMillis()) return true; }
            refreshInFlight = true;
        }
        try {
            JSONObject current = session(c); if (current == null) return false; JSONObject next = refresher.refresh(current.getString("refreshToken"));
            save(c, next.getString("accountId"), next.getString("workspaceId"), next.getString("accessToken"), next.getString("refreshToken"), next.getLong("expiresAtMillis")); return true;
        } finally { synchronized (REFRESH_LOCK) { refreshInFlight = false; REFRESH_LOCK.notifyAll(); } }
    }

    public static void clear(Context c) throws Exception { synchronized (LOCK) { AtomicFile af = file(c); if (af.getBaseFile().exists() && !af.getBaseFile().delete()) throw new Exception("会话清除失败"); } }

    private static JSONObject read(Context c) throws Exception {
        AtomicFile af = file(c); if (!af.getBaseFile().exists()) return null; JSONObject envelope = new JSONObject(DataStore.readText(af.openRead())); if (envelope.optInt("version") != 1) throw new Exception("会话版本不支持");
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.DEFAULT), ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.DEFAULT); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv)); return new JSONObject(new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8));
    }
}
