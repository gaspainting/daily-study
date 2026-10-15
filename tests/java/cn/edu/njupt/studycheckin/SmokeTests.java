package cn.edu.njupt.studycheckin;

import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** Real Android API tests, compiled only with build.ps1 -TestBuild. */
public class SmokeTests extends Instrumentation {
    private final List<String> passes=new ArrayList<>();
    private void check(boolean condition,String name)throws Exception {if(!condition)throw new Exception("FAIL: "+name);passes.add(name);}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Context c=getTargetContext();JSONObject original=null;Bundle results=new Bundle();int resultCode=ActivityCodes.OK;
        try {
            original=DataStore.load(c);TimerStore.action(c,"discard");
            JSONObject seed=new JSONObject(DataStore.readText(c.getAssets().open("seed.json")));DataStore.restore(c,new JSONObject(seed.toString()));
            JSONObject p=seed.getJSONObject("plan"),targets=p.getJSONObject("targets");check(targets.length()==70,"seed covers exactly70 days");
            check(seed.getJSONObject("records").length()==0,"initial actual records are empty");
            int[] expectedMath={340,340,390,390,430,430,430,465,465,465},expectedVocab={140,140,155,155,175,175,175,175,175,175};
            LocalDate first=LocalDate.of(2026,10,12);for(int w=0;w<10;w++){int m=0,v=0;for(int d=0;d<7;d++){JSONObject t=targets.getJSONObject(first.plusDays(w*7+d).toString());m+=t.getInt("math");v+=t.getInt("vocab");}check(m==expectedMath[w]&&v==expectedVocab[w],"week"+(w+7)+" exact reference totals");}
            check(AppRules.allowed(LocalDateTime.of(2026,10,13,20,29)),"weekday20:29 allowed");
            check(!AppRules.allowed(LocalDateTime.of(2026,10,13,20,30)),"weekday20:30 excluded");
            check(!AppRules.allowed(LocalDateTime.of(2026,10,17,9,29)),"weekend09:29 excluded");
            check(AppRules.allowed(LocalDateTime.of(2026,10,17,9,30)),"weekend09:30 allowed");
            check(!AppRules.allowed(LocalDateTime.of(2026,10,18,19,0)),"weekend19:00 excluded");
            JSONObject r=new JSONObject().put("subjects",new JSONObject().put("math",subject(JSONObject.NULL)).put("vocab",subject(0))).put("status","休息").put("restKept",JSONObject.NULL).put("note","");
            seed.getJSONObject("records").put("2026-10-12",r);DataStore.save(c,seed);JSONObject read=DataStore.load(c).getJSONObject("records").getJSONObject("2026-10-12");
            check(read.getJSONObject("subjects").getJSONObject("math").isNull("minutes")&&read.getJSONObject("subjects").getJSONObject("vocab").getInt("minutes")==0,"blank and explicit0 survive storage");
            String backup=DataStore.load(c).toString();JSONObject backupObject=new JSONObject(backup);DataStore.validate(backupObject);check(backupObject.getJSONObject("records").getJSONObject("2026-10-12").getString("status").equals("休息"),"backup roundtrip preserves rest record");
            JSONObject invalid=new JSONObject(backup);invalid.getJSONObject("settings").getJSONObject("reminders").put("weekendTime","19:00");boolean rejected=false;try{DataStore.validate(invalid);}catch(Exception e){rejected=true;}check(rejected,"backup rejects reminder during rest");
            invalid=new JSONObject(backup);invalid.getJSONObject("records").getJSONObject("2026-10-12").getJSONObject("subjects").getJSONObject("math").put("minutes",-1);rejected=false;try{DataStore.validate(invalid);}catch(Exception e){rejected=true;}check(rejected,"backup rejects negative actual minutes");
            seed=DataStore.load(c);String today=LocalDate.now().toString();seed.getJSONObject("plan").put("startDate",today).put("endDate",today);seed.getJSONObject("records").remove(today);DataStore.save(c,seed);
            if(AppRules.allowed(LocalDateTime.now())){
                check(!TimerStore.start(c,"math","高数",today).has("error"),"timer starts on Android16");SystemClock.sleep(160);
                JSONObject paused=TimerStore.action(c,"pause");long stopped=paused.getLong("elapsedMs");check(stopped>=100&&!paused.getBoolean("running"),"pause retains elapsed learning");SystemClock.sleep(120);
                check(TimerStore.snapshot(c).getLong("elapsedMs")==stopped,"paused time excluded");
                check(TimerStore.action(c,"resume").getBoolean("running"),"resume starts next segment");SystemClock.sleep(120);
                JSONObject finished=TimerStore.action(c,"finish");check(finished.optBoolean("finished"),"finish stores actual record");
                JSONObject persisted=DataStore.load(c);check(persisted.getJSONObject("records").getJSONObject(today).getJSONObject("subjects").getJSONObject("math").getDouble("minutes")>0,"timer writes actual rather than reference");
                check(persisted.getJSONArray("sessions").length()==1,"finish creates exactly1 session");TimerStore.action(c,"finish");check(DataStore.load(c).getJSONArray("sessions").length()==1,"repeat finish cannot double count");
                check(TimerStore.start(c,"math","高数",LocalDate.now().minusDays(1).toString()).has("error"),"historical date timer rejected");
                TimerStore.start(c,"math","高数",today);
                JSONObject active=new JSONObject(c.getSharedPreferences("stopwatch",Context.MODE_PRIVATE).getString("timer","{}"));
                active.put("segmentDeadlineWall",active.getLong("segmentStartWall")+80);
                c.getSharedPreferences("stopwatch",Context.MODE_PRIVATE).edit().putString("timer",active.toString()).commit();SystemClock.sleep(180);
                JSONObject boundary=TimerStore.snapshot(c);check(!boundary.getBoolean("running")&&boundary.getLong("elapsedMs")==80,"cutoff auto pause clips segment precisely");TimerStore.action(c,"discard");
            }else passes.add("timer running tests skipped because device is in protected rest time");
            check(!DataStore.load(c).getJSONObject("settings").getJSONObject("reminders").getBoolean("enabled"),"reminders default disabled");
            StudyWidget.refreshAll(c);ReminderScheduler.schedule(c);passes.add("widget refresh and disabled reminder scheduling do not crash");
            if(AppRules.allowed(LocalDateTime.now())&&ReminderScheduler.notificationsAllowed(c)){
                JSONObject enabled=DataStore.load(c);enabled.getJSONObject("settings").getJSONObject("reminders").put("enabled",true);DataStore.save(c,enabled);
                c.getSharedPreferences("reminder_delivery",Context.MODE_PRIVATE).edit().remove("date").commit();
                android.content.Intent reminder=new android.content.Intent(c,ReminderReceiver.class).setAction(ReminderScheduler.ACTION).putExtra("date",LocalDate.now().toString()).putExtra("scheduledAt",System.currentTimeMillis()-1000);
                new ReminderReceiver().onReceive(c,reminder);
                boolean notified=false;for(android.service.notification.StatusBarNotification n:c.getSystemService(android.app.NotificationManager.class).getActiveNotifications())if(n.getId()==31)notified=true;
                check(notified,"enabled reminder posts native notification");
                new ReminderReceiver().onReceive(c,reminder);check(c.getSharedPreferences("reminder_delivery",Context.MODE_PRIVATE).getString("date","").equals(LocalDate.now().toString()),"same day reminder delivered once");
                c.getSystemService(android.app.NotificationManager.class).cancel(31);
            }
            InspirationTests.run(c,passes);
            ReleasePolishTests.run(c,passes);
            DraftTests.run(c,passes);
            FeatureModelTests.run(c,passes);
            ReportTests.run(c,passes);
            PlanTests.run(c,passes);
            InspirationSearchTests.run(c,passes);
            VocabularyTests.run(c,passes);
            AuditTests.run(c,passes);
            CourseScheduleTests.run(c,passes);
            results.putString("stream","PASS "+passes.size()+" checks\n"+String.join("\n",passes)+"\n");
        } catch(Exception e){results.putString("stream","FAILED after "+passes.size()+" checks: "+e+"\n"+String.join("\n",passes)+"\n");resultCode=ActivityCodes.FAIL;}
        finally{TimerStore.action(c,"discard");if(original!=null)try{DataStore.restore(c,original);}catch(Exception ignored){}}
        finish(resultCode,results);
    }
    private static class ActivityCodes{static final int OK=-1,FAIL=0;}
    private static JSONObject subject(Object minutes)throws Exception{return new JSONObject().put("minutes",minutes).put("content","").put("problem","").put("newWords",JSONObject.NULL).put("reviewWords",JSONObject.NULL).put("forgotWords","");}
}
