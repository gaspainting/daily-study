package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/** Real storage migration checks use an isolated files directory. */
final class FeatureModelTests {
    private interface Action { void run() throws Exception; }
    private static void check(List<String> passes, boolean condition, String name) throws Exception {
        if (!condition) throw new Exception("FAIL: " + name);
        passes.add(name);
    }
    private static void rejects(List<String> passes, Action action, String name) throws Exception {
        boolean rejected = false;
        try { action.run(); } catch (Exception expected) { rejected = true; }
        check(passes, rejected, name);
    }
    private static JSONObject subject(Object minutes) throws Exception {
        return new JSONObject().put("minutes", minutes).put("content", "").put("problem", "").put("newWords", JSONObject.NULL).put("reviewWords", JSONObject.NULL).put("forgotWords", "");
    }
    static void run(Context original, List<String> passes) throws Exception {
        File directory = new File(original.getCacheDir(), "feature-model-test-" + UUID.randomUUID());
        if (!directory.mkdir()) throw new Exception("Feature fixture directory creation failed");
        String preferencePrefix="feature-model-"+UUID.randomUUID()+"-";
        Context context = new ContextWrapper(original) {
            @Override public File getFilesDir() { return directory; }
            @Override public SharedPreferences getSharedPreferences(String name,int mode) { return original.getSharedPreferences(preferencePrefix+name,mode); }
        };
        File file = new File(directory, "study-state.json");
        try {
            JSONObject legacy = new JSONObject(DataStore.readText(original.getAssets().open("seed.json")));
            legacy.put("version", 1).put("_revision", 3);
            JSONObject record = new JSONObject().put("subjects", new JSONObject().put("math", subject(JSONObject.NULL)).put("vocab", subject(0))).put("status", "休息").put("restKept", false).put("note", "原有随记");
            legacy.getJSONObject("records").put("2026-09-01", record);
            JSONObject review = new JSONObject().put("load", "适中").put("mathProblem", "旧极限").put("vocabReview", "旧词汇").put("adjustment", "减量").put("reason", "课程").put("halfDayRest", JSONObject.NULL);
            legacy.getJSONObject("reviews").put("2026-10-12", review);
            legacy.put("sessions", new JSONArray().put(new JSONObject().put("id", "session-legacy").put("date", "2026-09-01").put("subjectId", "math").put("seconds", 61).put("endedAt", "2026-09-01T10:00:00Z")));
            DataStore.validate(legacy);
            String originalText = legacy.toString();
            JSONObject migrated = DataStore.migrateState(legacy);
            check(passes, legacy.toString().equals(originalText) && migrated.getInt("version") == 9, "migration returns schema 9 without modifying legacy input");
            check(passes, migrated.getJSONObject("records").toString().equals(legacy.getJSONObject("records").toString()), "migration preserves outside-plan records null zero rest enum and note");
            check(passes, migrated.getJSONArray("sessions").toString().equals(legacy.getJSONArray("sessions").toString()), "migration preserves saved timer session identity seconds and endedAt");
            JSONObject migratedReview = migrated.getJSONObject("reviews").getJSONObject("2026-10-12");
            check(passes, migratedReview.getJSONObject("subjects").getString("math").equals("旧极限") && migratedReview.getJSONObject("subjects").getString("vocab").equals("旧词汇"), "migration copies legacy review aliases to stable subject IDs");
            check(passes, migratedReview.getString("mathProblem").equals("旧极限") && migratedReview.getString("vocabReview").equals("旧词汇") && migratedReview.isNull("halfDayRest"), "migration retains review alias fields and optional rest values");
            check(passes, DataStore.migrateState(migrated).toString().equals(migrated.toString()), "schema 9 migration is idempotent");
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(originalText.getBytes(StandardCharsets.UTF_8)); }
            JSONObject loaded = DataStore.load(context);
            check(passes, loaded.getInt("version") == 9 && loaded.getLong("_revision") == 3, "load upgrades legacy view without changing revision");
            check(passes, DataStore.readText(new FileInputStream(file)).equals(originalText), "read-only load leaves legacy file bytes unchanged");
            DataStore.save(context, loaded);
            check(passes, DataStore.load(context).getInt("version") == 9 && loaded.getLong("_revision") == 4, "actual save persists current schema and increments revision once");
            DataStore.restore(context, legacy);
            check(passes, DataStore.load(context).getInt("version") == 9 && DataStore.load(context).getLong("_revision") == 5, "legacy restore migrates schema while retaining revision concurrency");

            JSONObject archived = TestSubjects.inState(DataStore.load(context),"math");
            check(passes, DataStore.activeSubject(archived, LocalDate.of(1900, 1, 1)) && DataStore.activeSubject(archived, LocalDate.of(2100, 12, 31)), "absent activity periods preserve always-active legacy semantics");
            archived.put("activePeriods", new JSONArray().put(new JSONObject().put("from", "1900-01-01").put("to", "2026-10-14")).put(new JSONObject().put("from", "2026-10-17").put("to", JSONObject.NULL)));
            check(passes, DataStore.activeSubject(archived, LocalDate.of(2026, 10, 13)), "archive keeps active historical dates");
            check(passes, !DataStore.activeSubject(archived, LocalDate.of(2026, 10, 14)) && !DataStore.activeSubject(archived, LocalDate.of(2026, 10, 16)), "archive and restore preserve half-open inactive gap");
            check(passes, DataStore.activeSubject(archived, LocalDate.of(2026, 10, 17)), "reactivation includes its first date");
            JSONObject state = DataStore.load(context);
            TestSubjects.inState(state,"math").put("activePeriods",archived.getJSONArray("activePeriods"));
            DataStore.validate(state);
            DataStore.save(context, state);
            check(passes, TestSubjects.inState(DataStore.load(context),"math").getJSONArray("activePeriods").length() == 2, "activity periods persist through atomic storage");
            state.getJSONObject("reviews").getJSONObject("2026-10-12").getJSONObject("subjects").put("math", "新复盘");
            check(passes, DataStore.migrateState(state).getJSONObject("reviews").getJSONObject("2026-10-12").getJSONObject("subjects").getString("math").equals("新复盘"), "current review text is not overwritten by legacy alias during migration");
            JSONObject badReview = new JSONObject(state.toString());
            badReview.getJSONObject("reviews").getJSONObject("2026-10-12").getJSONObject("subjects").put("missing", "未知");
            rejects(passes, () -> DataStore.validate(badReview), "review validation rejects unknown subject IDs");
            for (int index = 0; index < 3; index++) {
                JSONObject invalid = new JSONObject(state.toString());
                JSONArray periods = new JSONArray();
                if (index == 0) periods.put(new JSONObject().put("from", "2026-10-14").put("to", "2026-10-14"));
                if (index == 1) periods.put(new JSONObject().put("from", "2026-10-12").put("to", "2026-10-16")).put(new JSONObject().put("from", "2026-10-14").put("to", JSONObject.NULL));
                if (index == 2) periods.put(new JSONObject().put("from", "2026-10-12").put("to", JSONObject.NULL)).put(new JSONObject().put("from", "2026-10-17").put("to", JSONObject.NULL));
                TestSubjects.inState(invalid,"math").put("activePeriods", periods);
                final JSONObject bad = invalid;
                rejects(passes, () -> DataStore.validate(bad), "activity period validation rejects malformed range " + index);
            }
            JSONObject inactive = new JSONObject(state.toString());
            TestSubjects.inState(inactive,"math").put("activePeriods", new JSONArray());
            DataStore.validate(inactive);
            check(passes, !DataStore.activeSubject(TestSubjects.inState(inactive,"math"), LocalDate.of(2026, 10, 14)), "empty periods mean archived for every date");
            JSONObject unknown = new JSONObject(state.toString()).put("version", 99);
            rejects(passes, () -> DataStore.validate(unknown), "future unsupported schema remains rejected");
            String before = DataStore.readText(new FileInputStream(file));
            rejects(passes, () -> DataStore.restore(context, badReview), "invalid migrated restore fails before atomic overwrite");
            check(passes, DataStore.readText(new FileInputStream(file)).equals(before), "failed restore preserves saved record file bytes");

            JSONObject widget=DataStore.load(context);
            JSONObject widgetPlan=widget.getJSONObject("plan");
            TestSubjects.inPlan(widgetPlan,"math").put("activePeriods",new JSONArray().put(new JSONObject().put("from","1900-01-01").put("to","2026-10-14")));
            widgetPlan.getJSONArray("subjects").put(new JSONObject().put("id","custom_archived").put("name","旧科目").put("kind","custom").put("defaults",new JSONArray("[10,10,10,10,10,10,10]")).put("activePeriods",new JSONArray()));
            JSONObject widgetRecord=new JSONObject().put("subjects",new JSONObject().put("math",subject(0)).put("vocab",subject(JSONObject.NULL)).put("custom_archived",subject(JSONObject.NULL))).put("status",JSONObject.NULL).put("restKept",JSONObject.NULL).put("note","");
            widget.getJSONObject("records").put("2026-10-14",widgetRecord);
            DataStore.validate(widget);
            JSONObject content=StudyWidget.content(widget,LocalDate.of(2026,10,14));
            check(passes,content.getString("status").equals("1/2 科目已记录")&&content.getInt("totalSubjects")==2,"widget denominator retains archived explicit zero and active unknown subject");
            check(passes,content.getString("subjects").contains("高数  0 分钟")&&!content.getString("subjects").contains("旧科目"),"widget omits inactive empty subject while retaining archived actual zero");
            check(passes,!content.getString("subjects").split("\\n")[0].contains("参考"),"widget does not present a reference for archived subject today");
            widgetRecord.getJSONObject("subjects").getJSONObject("math").put("minutes",JSONObject.NULL);
            content=StudyWidget.content(widget,LocalDate.of(2026,10,14));
            check(passes,content.getInt("totalSubjects")==1&&!content.getString("subjects").contains("高数"),"widget omits archived empty subject after actual field is cleared");

            JSONObject quantityState=DataStore.load(context), quantityPlan=quantityState.getJSONObject("plan");
            quantityPlan.getJSONArray("subjects").put(new JSONObject().put("id","quantity_test").put("name","刷题").put("kind","custom").put("measure","quantity").put("unit","题").put("defaults",new JSONArray("[20,20,20,20,20,20,20]")).put("activePeriods",new JSONArray().put(new JSONObject().put("from","2026-10-12").put("to",JSONObject.NULL))));
            quantityPlan.put("quantityTargets",new JSONObject().put("2026-10-14",new JSONObject().put("quantity_test",20)));
            JSONObject quantityRecord=new JSONObject().put("subjects",new JSONObject()).put("status","正常参考").put("restKept",JSONObject.NULL).put("note","");
            for(int i=0;i<quantityPlan.getJSONArray("subjects").length();i++){JSONObject subject=quantityPlan.getJSONArray("subjects").getJSONObject(i);JSONObject entry=subject.has("measure")?new JSONObject().put("minutes",JSONObject.NULL).put("content","").put("problem","").put("newWords",JSONObject.NULL).put("reviewWords",JSONObject.NULL).put("forgotWords","").put("quantity",25).put("quantityUnit","题"):subject(subject.getString("kind").equals("vocab")?JSONObject.NULL:JSONObject.NULL);quantityRecord.getJSONObject("subjects").put(subject.getString("id"),entry);}
            quantityState.getJSONObject("records").put("2026-10-14",quantityRecord);DataStore.validate(quantityState);DataStore.save(context,quantityState);
            JSONArray quantityAssessment=Reference.assess(quantityState,LocalDate.of(2026,10,14)).getJSONArray("quantities");
            check(passes,quantityAssessment.length()==1&&quantityAssessment.getJSONObject(0).getString("kind").equals("above"),"native quantity assessment grades an over-target record");
            JSONObject quantityWidget=StudyWidget.content(quantityState,LocalDate.of(2026,10,14));
            check(passes,quantityWidget.getString("subjects").contains("刷题")&&quantityWidget.getString("subjects").contains("25 题"),"widget shows quantity actual and unit");

            TimerStore.action(context,"discard");
            if(AppRules.allowed(LocalDateTime.now())) {
                String today=LocalDate.now().toString();JSONObject timerState=DataStore.migrateState(new JSONObject(DataStore.readText(original.getAssets().open("seed.json"))));
                timerState.getJSONObject("plan").put("startDate",today).put("endDate",today);
                TestSubjects.inState(timerState,"math").put("activePeriods",new JSONArray());
                TestSubjects.inState(timerState,"vocab").put("kind","custom");
                DataStore.save(context,timerState);
                JSONObject rejected=TimerStore.start(context,"math","高数",today);
                check(passes,rejected.optString("error").equals("该科目已归档")&&!TimerStore.snapshot(context).optBoolean("active"),"native timer rejects archived subject start without creating a timer");
                check(passes,!TimerStore.start(context,"vocab","单词",today).has("error"),"native timer can start active subject after archived rejection");
                SystemClock.sleep(40);JSONObject paused=TimerStore.action(context,"pause");long milliseconds=paused.getLong("elapsedMs");
                timerState=DataStore.load(context);TestSubjects.inState(timerState,"vocab").put("activePeriods",new JSONArray());DataStore.save(context,timerState);
                check(passes,TimerStore.action(context,"resume").optString("error").equals("该科目已归档")&&!TimerStore.snapshot(context).getBoolean("running")&&TimerStore.snapshot(context).getLong("elapsedMs")==milliseconds,"native timer resume rejects archived subject and preserves paused elapsed time");
                check(passes,TimerStore.action(context,"finish").optBoolean("finished"),"existing archived subject timer can finish and save its original session");
                JSONObject saved=DataStore.load(context);
                check(passes,saved.getJSONArray("sessions").length()==1&&saved.getJSONObject("records").getJSONObject(today).getJSONObject("subjects").getJSONObject("vocab").getDouble("minutes")>0,"archived timer finish retains actual minutes and session identity");
            } else passes.add("archived timer start/resume execution skipped because device is in protected rest time");
        } finally {
            TimerStore.action(context,"discard");
            original.deleteSharedPreferences(preferencePrefix+"stopwatch");
            File[] children = directory.listFiles();
            if (children != null) for (File child : children) child.delete();
            directory.delete();
        }
    }
}
