package cn.edu.njupt.studycheckin;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Executes hosted sync only when a build supplies an HTTPS endpoint. */
public final class HostedSyncJobService extends JobService {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override public boolean onStartJob(final JobParameters params) {
        executor.execute(() -> {
            boolean retry = false;
            try {
                SyncTransport transport = HostedSyncEndpoint.transport(getApplicationContext());
                if (transport == null) {
                    SyncStore.syncNow(getApplicationContext());
                } else {
                    HostedSyncService.run(getApplicationContext(), transport);
                }
            } catch (Exception error) {
                String code = error instanceof SyncTransport.SyncException ? ((SyncTransport.SyncException) error).code : "JOB_FAILED";
                boolean retryable = error instanceof SyncTransport.SyncException && ((SyncTransport.SyncException) error).retryable;
                SyncStore.markTransportFailure(getApplicationContext(), code, error.getMessage(), retryable);
                retry = retryable;
            } finally {
                jobFinished(params, retry);
            }
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }

    @Override public void onDestroy() { executor.shutdownNow(); super.onDestroy(); }
}
