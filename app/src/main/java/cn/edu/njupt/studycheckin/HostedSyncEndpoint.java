package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;

/** Reads a public HTTPS endpoint from build metadata; no secret is accepted. */
public final class HostedSyncEndpoint {
    private static final String KEY = "cn.edu.njupt.studycheckin.HOSTED_SYNC_ENDPOINT";
    private HostedSyncEndpoint() {}

    public static SyncTransport transport(Context context) throws Exception {
        ApplicationInfo info = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
        Bundle meta = info.metaData;
        String endpoint = meta == null ? "" : meta.getString(KEY, "");
        if (endpoint == null || endpoint.trim().isEmpty()) return null;
        return new HttpSyncTransport(context.getApplicationContext(), endpoint.trim());
    }
}
