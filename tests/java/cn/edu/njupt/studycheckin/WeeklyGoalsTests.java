package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

final class WeeklyGoalsTests {
    interface Action { void run() throws Exception; }
    static void check(List<String> passes, boolean yes, String name) throws Exception { if(!yes)throw new Exception("FAIL: "+name);passes.add(name); }
    static void rejects(List<String> passes, Action action, String name) throws Exception {boolean failed=false;try{action.run();}catch(Exception expected){failed=true;}check(passes,failed,name);}
    static JSONObject task(String id) throws Exception {return new JSONObject().put("id","task_"+id).put("title","用户教材第三章").put("subjectId","math").put("done",true).put("updatedAt","2026-10-18T10:00:00.000Z");}
    static void run(Context original,List<String> passes)throws Exception{
        File directory=new File(original.getCacheDir(),"weekly-goals-"+UUID.randomUUID());if(!directory.mkdir())throw new Exception("Cannot create weekly test directory");
        Context c=new ContextWrapper(original){@Override public File getFilesDir(){return directory;}};
        try{
            JSONObject legacy=new JSONObject(DataStore.readText(c.getAssets().open("seed.json")));legacy.getJSONObject("plan").getJSONObject("weekGoals").put("2026-10-12","自填教材\n不拆成任务");
            String old=legacy.toString();JSONObject state=DataStore.migrateState(legacy);
            check(passes,legacy.toString().equals(old)&&state.getInt("version")==7,"weekly migration clones legacy input and selects current schema");
            check(passes,state.getJSONObject("plan").getJSONObject("weekGoals").getString("2026-10-12").equals("自填教材\n不拆成任务")&&state.getJSONObject("plan").getJSONObject("weekTasks").length()==0,"legacy free text is retained without inferred tasks");
            JSONObject plan=state.getJSONObject("plan");plan.getJSONObject("weekTasks").put("2026-10-12",new JSONArray().put(task("one")));
            String records=state.getJSONObject("records").toString(),sessions=state.optJSONArray("sessions").toString();DataStore.save(c,state);
            JSONObject read=DataStore.load(c);check(passes,WeeklyGoals.tasks(read.getJSONObject("plan"),"2026-10-12").getJSONObject(0).getBoolean("done"),"weekly checked task survives actual atomic file roundtrip");
            check(passes,read.getJSONObject("records").toString().equals(records)&&read.optJSONArray("sessions").toString().equals(sessions),"task storage does not create study observations or timer sessions");
            plan.put("startDate","2026-10-13").put("endDate","2026-10-20").put("startWeek",20);DataStore.save(c,state);
            check(passes,WeeklyGoals.keys(DataStore.load(c).getJSONObject("plan")).contains("2026-10-12"),"changing plan dates and labels retains original target date group");
            JSONObject archived=DataStore.load(c);TestSubjects.inState(archived,"math").put("activePeriods",new JSONArray());DataStore.save(c,archived);
            rejects(passes,()->PlanStore.create(c,archived),"creating another plan rejects already completed task history");
            check(passes,WeeklyGoals.subjectName(archived.getJSONObject("plan"),"math").equals("高数"),"archiving associated subject retains task attribution");
            JSONObject[][] bad=new JSONObject[8][1];for(int i=0;i<bad.length;i++)bad[i][0]=new JSONObject(archived.toString());
            WeeklyGoals.tasks(bad[0][0].getJSONObject("plan"),"2026-10-12").getJSONObject(0).put("done","true");
            WeeklyGoals.tasks(bad[1][0].getJSONObject("plan"),"2026-10-12").getJSONObject(0).put("subjectId","absent");
            WeeklyGoals.tasks(bad[2][0].getJSONObject("plan"),"2026-10-12").getJSONObject(0).put("updatedAt","yesterday");
            WeeklyGoals.tasks(bad[3][0].getJSONObject("plan"),"2026-10-12").getJSONObject(0).put("extra",1);
            bad[4][0].getJSONObject("plan").getJSONObject("weekTasks").put("2026-10-19",new JSONArray().put(task("one")));
            JSONArray many=new JSONArray();for(int i=0;i<51;i++)many.put(task("n"+i));bad[5][0].getJSONObject("plan").getJSONObject("weekTasks").put("2026-10-12",many);
            bad[6][0].put("version",2);WeeklyGoals.tasks(bad[7][0].getJSONObject("plan"),"2026-10-12").getJSONObject(0).put("title","");
            for(int i=0;i<bad.length;i++){final JSONObject invalid=bad[i][0];rejects(passes,()->DataStore.validate(invalid),"native weekly schema rejects invalid task variant "+i);}
            String before=DataStore.load(c).toString();rejects(passes,()->DataStore.restore(c,bad[0][0]),"invalid task restore rejects before replacing saved state");check(passes,DataStore.load(c).toString().equals(before),"failed task restore preserves all original state bytes");
            JSONArray draftTasks=new JSONArray();for(int i=0;i<50;i++){JSONObject t=task("draft"+i);t.put("title",String.join("",java.util.Collections.nCopies(500,"字")));draftTasks.put(t);}
            String raw=draftTasks.toString();DraftStore.save(c,"main:week:2026-10-12",new JSONObject().put("week-tasks","[]"),new JSONObject().put("week-tasks",raw));
            check(passes,raw.length()>8000&&DraftStore.get(c,"main:week:2026-10-12").getJSONObject("values").getString("week-tasks").equals(raw),"fifty long draft tasks survive scoped draft size allowance");
            ByteArrayOutputStream zip=new ByteArrayOutputStream();BackupManager.export(c,zip);
            try(BackupManager.Imported imported=BackupManager.read(c,new ByteArrayInputStream(zip.toByteArray()))){check(passes,WeeklyGoals.tasks(imported.study.getJSONObject("plan"),"2026-10-12").length()==1,"complete ZIP validates and carries weekly tasks");}
            check(passes,DataStore.load(c).toString().equals(before),"inspecting and cancelling task backup leaves saved records unchanged");
            try(BackupManager.Imported imported=BackupManager.read(c,new ByteArrayInputStream(zip.toByteArray()))){DataStore.save(c,DataStore.migrateState(legacy));BackupManager.restore(c,imported);}
            check(passes,WeeklyGoals.tasks(DataStore.load(c).getJSONObject("plan"),"2026-10-12").length()==1,"confirmed ZIP restoration restores weekly tasks");
            try(BackupManager.Imported imported=BackupManager.read(c,new ByteArrayInputStream(old.getBytes(StandardCharsets.UTF_8)))){BackupManager.restore(c,imported);}
            check(passes,DataStore.load(c).getInt("version")==7&&DataStore.load(c).getJSONObject("plan").getJSONObject("weekGoals").getString("2026-10-12").equals("自填教材\n不拆成任务"),"legacy JSON restore retains own goals and migrates without artificial tasks");
            JSONObject report=new JSONObject(archived.toString());File pdf=new File(original.getCacheDir(),"weekly-goals-validation.pdf");
            try(FileOutputStream output=new FileOutputStream(pdf)){ReportExport.write(c,report,output,"pdf","2026-10-12","2026-10-18","all");}
            check(passes,pdf.length()>1000,"weekly target PDF export completes with actual task state and original text");
        }finally{delete(directory);}
    }
    static void delete(File file){File[]children=file.listFiles();if(children!=null)for(File child:children)delete(child);file.delete();}
}
