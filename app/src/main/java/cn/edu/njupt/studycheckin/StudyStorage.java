package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONObject;

/** Storage port used by the bridge; JSON remains the current implementation. */
public final class StudyStorage {
    public interface Port {
        JSONObject readForUi() throws Exception;
        JSONObject readStable() throws Exception;
        void requireReady() throws Exception;
        void saveState(JSONObject state) throws Exception;
        long saveEvaluationSchedule(JSONObject command) throws Exception;
    }
    private StudyStorage() {}
    public static Port open(Context context) { return new JsonPort(context.getApplicationContext()); }
    private static final class JsonPort implements Port {
        private final Context context;
        JsonPort(Context context) { this.context=context; }
        public JSONObject readForUi() throws Exception { return DataStore.readForUi(context); }
        public JSONObject readStable() throws Exception { DataStore.requireNoPendingRecovery(context); return DataStore.load(context); }
        public void requireReady() throws Exception { DataStore.requireNoPendingRecovery(context); }
        public void saveState(JSONObject state) throws Exception { DataStore.saveFromBridge(context,state); }
        public long saveEvaluationSchedule(JSONObject command) throws Exception { return DataStore.saveEvaluationSchedule(context,command); }
    }
}
