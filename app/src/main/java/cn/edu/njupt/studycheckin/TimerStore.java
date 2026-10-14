package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.UUID;

/** A monotonic stopwatch; each segment is clipped at its scheduling cutoff. */
public final class TimerStore {
    private TimerStore() {}
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("stopwatch",Context.MODE_PRIVATE); }
    private static int boot(Context c) { return Settings.Global.getInt(c.getContentResolver(),Settings.Global.BOOT_COUNT,-1); }
    private static JSONObject read(Context c) throws Exception {
        String value=prefs(c).getString("timer",null); return value==null?null:new JSONObject(value);
    }
    private static void write(Context c, JSONObject t) throws Exception {
        SharedPreferences.Editor e=prefs(c).edit(); if(t==null)e.remove("timer");else e.putString("timer",t.toString());
        if(!e.commit()) throw new Exception("计时保存失败，请重试");
    }
    private static long segment(JSONObject t) {
        long elapsed=Math.max(0,SystemClock.elapsedRealtime()-t.optLong("segmentStartElapsed"));
        long limit=Math.max(0,t.optLong("segmentDeadlineWall")-t.optLong("segmentStartWall"));
        return Math.min(elapsed,limit);
    }
    private static JSONObject checked(Context c) throws Exception {
        JSONObject t=read(c); if(t==null)return null;
        if(t.optBoolean("running")) {
            boolean reboot=t.optInt("bootCount",-1)!=boot(c)||SystemClock.elapsedRealtime()<t.optLong("segmentStartElapsed");
            if(reboot) {
                t.put("running",false).put("message","手机已重启，计时保持暂停；请核对实际时间");write(c,t);
            } else if(System.currentTimeMillis()>=t.optLong("segmentDeadlineWall")||!AppRules.allowed(LocalDateTime.now())) {
                t.put("accumulatedMs",t.optLong("accumulatedMs")+segment(t));
                t.put("running",false).put("message","已到休息时段，计时已暂停");write(c,t);
            } else if(SystemClock.elapsedRealtime()-t.optLong("segmentStartElapsed")>=60000) {
                // Keep a recoverable checkpoint without assuming any time spent after a reboot.
                t.put("accumulatedMs",t.optLong("accumulatedMs")+segment(t));
                t.put("segmentStartElapsed",SystemClock.elapsedRealtime()).put("segmentStartWall",System.currentTimeMillis());write(c,t);
            }
        }
        return t;
    }
    private static JSONObject view(JSONObject t) throws Exception {
        if(t==null)return new JSONObject().put("active",false);
        long ms=t.optLong("accumulatedMs")+(t.optBoolean("running")?segment(t):0);
        return new JSONObject().put("active",true).put("subjectId",t.getString("subjectId")).put("subjectName",t.getString("subjectName"))
            .put("date",t.getString("date")).put("running",t.getBoolean("running")).put("elapsedMs",ms).put("message",t.optString("message",""));
    }
    public static JSONObject snapshot(Context c) {
        synchronized(DataStore.LOCK) {try {DataStore.requireNoPendingRecovery(c);return view(checked(c));}catch(Exception e){return error(e);}}
    }
    public static JSONObject start(Context c,String id,String name,String day) {
        synchronized(DataStore.LOCK) {try {
            DataStore.requireNoPendingRecovery(c);
            if(checked(c)!=null)throw new Exception("请先结束或取消当前计时");
            if(!LocalDate.now().toString().equals(day))throw new Exception("计时用于今天；其他日期请手动补记");
            if(!AppRules.allowed(LocalDateTime.now()))throw new Exception(AppRules.restReason(LocalDateTime.now()));
            JSONObject state=DataStore.load(c),p=state.getJSONObject("plan");
            if(day.compareTo(p.getString("startDate"))<0||day.compareTo(p.getString("endDate"))>0)throw new Exception("今天不在计划范围内，请先调整计划日期");
            JSONObject subject=activeTimerSubject(state,id,LocalDate.parse(day));if("vocab".equals(subject.getString("kind")))throw new Exception("单词按词数记录");String actualName=subject.getString("name");
            JSONObject t=new JSONObject().put("id",UUID.randomUUID().toString()).put("subjectId",id).put("subjectName",actualName).put("date",day)
                .put("accumulatedMs",0).put("message","");begin(c,t);write(c,t);return view(t);
        }catch(Exception e){return error(e);}}
    }
    private static void begin(Context c,JSONObject t)throws Exception {
        t.put("running",true).put("bootCount",boot(c)).put("segmentStartElapsed",SystemClock.elapsedRealtime())
            .put("segmentStartWall",System.currentTimeMillis()).put("segmentDeadlineWall",AppRules.cutoffMillis(ZonedDateTime.now())).put("message","");
    }
    private static JSONObject activeTimerSubject(JSONObject state,String id,LocalDate date)throws Exception {
        JSONArray subjects=state.getJSONObject("plan").getJSONArray("subjects");
        for(int i=0;i<subjects.length();i++){JSONObject subject=subjects.getJSONObject(i);if(subject.getString("id").equals(id)){if(!DataStore.activeSubject(subject,date))throw new Exception("该科目已归档");return subject;}}
        throw new Exception("计时科目不存在");
    }
    public static JSONObject action(Context c,String action) {
        synchronized(DataStore.LOCK) {try {
            DataStore.requireNoPendingRecovery(c);
            JSONObject t=checked(c);if(t==null)throw new Exception("当前没有计时");
            if("pause".equals(action)) {
                if(t.optBoolean("running")) {t.put("accumulatedMs",t.optLong("accumulatedMs")+segment(t));t.put("running",false).put("message","");write(c,t);}return view(t);
            }
            if("resume".equals(action)) {
                if(!t.getString("date").equals(LocalDate.now().toString()))throw new Exception("这是之前日期的计时，请结束保存后开始今天的计时");
                if(!AppRules.allowed(LocalDateTime.now()))throw new Exception(AppRules.restReason(LocalDateTime.now())+"，计时保持暂停");
                activeTimerSubject(DataStore.load(c),t.getString("subjectId"),LocalDate.now());
                if(!t.optBoolean("running")){begin(c,t);write(c,t);}return view(t);
            }
            if("discard".equals(action)){write(c,null);return view(null);}
            if(!"finish".equals(action))throw new Exception("计时操作无效");
            long ms=t.optLong("accumulatedMs")+(t.optBoolean("running")?segment(t):0);
            t.put("accumulatedMs",ms).put("running",false);write(c,t);
            // Persist the session identifier before clearing the timer: retries cannot double-count.
            JSONObject state=DataStore.load(c);JSONArray sessions=state.optJSONArray("sessions");if(sessions==null){sessions=new JSONArray();state.put("sessions",sessions);}
            for(int i=0;i<sessions.length();i++)if(sessions.getJSONObject(i).getString("id").equals(t.getString("id"))){write(c,null);return new JSONObject().put("finished",true).put("date",t.getString("date")).put("subjectId",t.getString("subjectId")).put("seconds",ms/1000.0).put("minutes",ms/60000.0);}
            String date=t.getString("date"),id=t.getString("subjectId");JSONObject records=state.getJSONObject("records"),r=records.optJSONObject(date);
            if(r==null){r=new JSONObject().put("subjects",new JSONObject()).put("status",JSONObject.NULL).put("restKept",JSONObject.NULL).put("note","");records.put(date,r);}
            JSONObject subjectRecords=r.getJSONObject("subjects"),s=subjectRecords.optJSONObject(id);
            if(s==null){s=new JSONObject().put("minutes",JSONObject.NULL).put("content","").put("problem","").put("newWords",JSONObject.NULL).put("reviewWords",JSONObject.NULL).put("forgotWords","");subjectRecords.put(id,s);}
            double minutes=s.optDouble("minutes",0);if(Double.isNaN(minutes))minutes=0;
            double sum=minutes+ms/60000.0;if(sum>1440)throw new Exception("当天该科累计超过1440分钟，请核对手动记录后再保存计时");
            s.put("minutes",sum);if(r.isNull("status")||!r.has("status"))r.put("status","正常参考");
            sessions.put(new JSONObject().put("id",t.getString("id")).put("date",date).put("subjectId",id).put("seconds",ms/1000.0).put("endedAt",Instant.now().toString()));
            DataStore.save(c,state);write(c,null);
            return new JSONObject().put("finished",true).put("date",date).put("subjectId",id).put("seconds",ms/1000.0).put("minutes",ms/60000.0);
        }catch(Exception e){return error(e);}}
    }
    private static JSONObject error(Exception e) {try{return new JSONObject().put("error",e.getMessage()==null?"计时操作失败":e.getMessage());}catch(Exception ignored){return new JSONObject();}}
}
