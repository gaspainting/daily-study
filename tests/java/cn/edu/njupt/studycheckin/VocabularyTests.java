package cn.edu.njupt.studycheckin;
import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONObject;
import org.json.JSONArray;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.util.List;
import java.util.UUID;

final class VocabularyTests {
    interface Action{void run()throws Exception;}
    static void check(List<String> p,boolean value,String label)throws Exception{if(!value)throw new Exception("FAIL: "+label);p.add(label);}
    static void reject(List<String> p,Action a,String label)throws Exception{boolean rejected=false;try{a.run();}catch(Exception e){rejected=true;}check(p,rejected,label);}
    static void run(Context original,List<String> p)throws Exception{
        JSONObject raw=new JSONObject(DataStore.readText(original.getAssets().open("seed.json")));
        check(p,raw.getJSONObject("plan").getJSONObject("weekGoals").length()==0&&raw.getJSONObject("plan").getJSONObject("weekHints").length()==0,"fresh seed has no prescribed weekly goal or textbook hint");
        raw.getJSONObject("plan").getJSONObject("weekGoals").put("2026-10-12","函数与极限符号、已忘基础定位。").put("2026-10-19","我的教材第六章");
        raw.getJSONObject("plan").getJSONObject("weekHints").put("2026-10-12","就业指导已结束；光电子学仍在；本周不排两处单周课。");
        String rawBefore=raw.toString();JSONObject state=DataStore.migrateState(raw),plan=state.getJSONObject("plan");
        check(p,raw.toString().equals(rawBefore),"weekly migration clones input instead of overwriting source");
        check(p,!plan.getJSONObject("weekGoals").has("2026-10-12")&&plan.getJSONObject("weekGoals").getString("2026-10-19").equals("我的教材第六章")&&plan.getJSONObject("weekHints").length()==0,"migration removes built in material and retains user written weekly goal");
        plan.getJSONObject("weekGoals").put("2026-10-12","函数与极限符号、已忘基础定位。");
        check(p,DataStore.migrateState(state).getJSONObject("plan").getJSONObject("weekGoals").has("2026-10-12"),"manual week marker preserves a deliberately reentered goal");
        String day="2026-10-14";
        check(p,DataStore.wordTarget(state,day,"vocab")==50&&plan.getJSONObject("targets").getJSONObject(day).getInt("vocab")==20,"new word goal defaults to fifty without converting legacy minutes");
        TestSubjects.inPlan(plan,"vocab").put("wordGoal",80);
        plan.put("wordTargets",new JSONObject().put(day,new JSONObject().put("vocab",0)));
        DataStore.validate(state);
        check(p,DataStore.wordTarget(state,day,"vocab")==0&&DataStore.wordTarget(state,"2026-10-15","vocab")==80,"per day zero word goal and daily default stay distinct");
        JSONObject entry=new JSONObject().put("minutes",JSONObject.NULL).put("newWords",0).put("reviewWords",JSONObject.NULL).put("content","").put("problem","").put("forgotWords","");
        state.getJSONObject("records").put(day,new JSONObject().put("subjects",new JSONObject().put("vocab",entry)).put("status",JSONObject.NULL).put("restKept",JSONObject.NULL).put("note",""));
        JSONObject widget=StudyWidget.content(state,LocalDate.parse(day));
        check(p,widget.getInt("recorded")==1&&widget.getString("status").equals("1/2 科目已记录"),"widget counts vocabulary zero separately from unknown timed subject");
        check(p,widget.getString("subjects").contains("新学 0 个 / 0 个")&&widget.getString("subjects").contains("复习 未记录"),"widget shows new learning target and unknown review without invented zero");
        entry.put("newWords",20).put("reviewWords",100).put("minutes",7.5);
        widget=StudyWidget.content(state,LocalDate.parse(day));
        check(p,widget.getString("subjects").contains("新学 20")&&widget.getString("subjects").contains("复习 100 个")&&widget.getString("subjects").contains("时长 7.5 分钟"),"widget distinguishes new review and retained legacy time");
        ByteArrayOutputStream out=new ByteArrayOutputStream();ReportExport.write(original,state,out,"csv",day,day,"vocab");String csv=new String(out.toByteArray(),StandardCharsets.UTF_8);
        check(p,csv.contains("新学目标（个）")&&csv.contains("计量方式")&&csv.contains("\"词数\"")&&csv.contains("\"20\",\"100\""),"CSV exposes count goal and new versus review fields");
        check(p,csv.contains("\"7.5\"")&&entry.getInt("newWords")==20&&entry.getInt("reviewWords")==100,"report retains legacy time and never turns reviews into new words");
        try(BackupManager.Imported imported=BackupManager.read(original,new ByteArrayInputStream(state.toString().getBytes(StandardCharsets.UTF_8)))){check(p,DataStore.wordTarget(imported.study,day,"vocab")==0&&imported.study.getJSONObject("records").getJSONObject(day).getJSONObject("subjects").getJSONObject("vocab").getInt("reviewWords")==100,"JSON backup read preserves count goal zero and review quantity");}
        for(Object bad:new Object[]{-1,0.5,"50",100001,JSONObject.NULL}){JSONObject invalid=new JSONObject(state.toString());TestSubjects.inState(invalid,"vocab").put("wordGoal",bad);reject(p,()->DataStore.validate(invalid),"reject invalid word goal "+bad);}
        JSONObject invalid=new JSONObject(state.toString());invalid.getJSONObject("plan").getJSONObject("wordTargets").getJSONObject(day).put("math",50);reject(p,()->DataStore.validate(invalid),"reject word target on timed subject");
        File dir=new File(original.getCacheDir(),"v132-words-"+UUID.randomUUID());dir.mkdirs();String prefs="v132-words-"+UUID.randomUUID();
        Context context=new ContextWrapper(original){@Override public File getFilesDir(){return dir;}@Override public android.content.SharedPreferences getSharedPreferences(String n,int m){return original.getSharedPreferences(prefs+n,m);}};
        try{String today=LocalDate.now().toString();JSONObject timer=DataStore.migrateState(raw);timer.getJSONObject("plan").put("startDate",today).put("endDate",today);DataStore.save(context,timer);if(AppRules.allowed(LocalDateTime.now())){check(p,TimerStore.start(context,"vocab","单词",today).optString("error").equals("单词按词数记录")&&!TimerStore.snapshot(context).optBoolean("active"),"native start rejects new vocabulary timer without creating a session");check(p,!TimerStore.start(context,"math","高数",today).has("error"),"timed subject still starts normally");TimerStore.action(context,"discard");}}finally{TimerStore.action(context,"discard");for(File f:dir.listFiles())f.delete();dir.delete();original.getSharedPreferences(prefs+"stopwatch",Context.MODE_PRIVATE).edit().clear().commit();}
    }
}
