package cn.edu.njupt.studycheckin;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

/** Schedules a bounded system job; it is a retry opportunity, not a realtime guarantee. */
public final class SyncScheduler {
    public static final int JOB_ID = 240501;
    private static final long PERIOD_MILLIS = 6L * 60L * 60L * 1000L;
    private SyncScheduler() {}

    public static void schedule(Context context) {
        JobScheduler jobs = context.getSystemService(JobScheduler.class);
        if (jobs == null) return;
        if (jobs.getPendingJob(JOB_ID) != null) return;
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(context, HostedSyncJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setPeriodic(PERIOD_MILLIS)
            .setBackoffCriteria(30L * 60L * 1000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build();
        jobs.schedule(info);
    }

    public static void cancel(Context context) {
        JobScheduler jobs = context.getSystemService(JobScheduler.class);
        if (jobs != null) jobs.cancel(JOB_ID);
    }
}
