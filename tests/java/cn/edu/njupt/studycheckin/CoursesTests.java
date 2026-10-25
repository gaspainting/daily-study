package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.io.File;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

final class CoursesTests {
    interface Action{void run()throws Exception;}
    private static void check(List<String> p,boolean b,String n)throws Exception{if(!b)throw new Exception("FAIL: "+n);p.add(n);}
    private static void rejects(List<String> p,Action f,String n)throws Exception{boolean rejected=false;try{f.run();}catch(Exception e){rejected=true;}check(p,rejected,n);}
    static void run(Context original,List<String> p)throws Exception{
        File dir=new File(original.getCacheDir(),"courses-"+UUID.randomUUID());if(!dir.mkdir())throw new Exception("Create course fixture directory failed");Context c=new ContextWrapper(original){@Override public File getFilesDir(){return dir;}};
        try{
            JSONObject legacy=new JSONObject(DataStore.readText(c.getAssets().open("seed.json"))),s=DataStore.migrateState(legacy);String old=legacy.toString();LocalDate day=LocalDate.of(2026,10,19);String date=day.toString();JSONObject schedule=s.getJSONObject("plan").getJSONObject("courseSchedule");
            check(p,s.getInt("version")==8&&schedule.getJSONArray("versions").getJSONObject(0).getJSONArray("courses").length()==16,"current schema adds verified original timetable without rewriting legacy input");check(p,legacy.toString().equals(old),"course migration does not mutate caller state");
            check(p,Courses.occurrences(s,day).length()==3&&Courses.occurrences(s,LocalDate.of(2026,10,22)).length()==2,"native course lookup respects teaching-week parity and course end weeks");
            JSONObject custom=new JSONObject(legacy.toString());custom.getJSONObject("plan").put("endDate","2026-12-19");custom=DataStore.migrateState(custom);check(p,Courses.occurrences(custom,day).length()==0,"new independent plans do not inherit the university timetable");
            JSONObject v=new JSONObject(schedule.getJSONArray("versions").getJSONObject(0).toString()).put("from",date);v.getJSONArray("courses").getJSONObject(0).put("name","新课程名");schedule.getJSONArray("versions").put(v);DataStore.validate(s);
            check(p,Courses.occurrences(s,day).getJSONObject(0).getString("name").equals("新课程名")&&Courses.occurrences(s,LocalDate.of(2026,10,12)).getJSONObject(0).getString("name").equals("光电子学"),"effective timetable revision preserves earlier course names");
            String id=Courses.occurrences(s,day).getJSONObject(0).getString("id");JSONObject change=new JSONObject().put("id","change_1").put("courseId",id).put("fromDate",date).put("toDate","2026-10-21").put("note","补课");schedule.getJSONArray("changes").put(change);DataStore.validate(s);
            check(p,Courses.occurrences(s,day).length()==2&&Courses.occurrences(s,LocalDate.of(2026,10,21)).length()==2,"native one-day move removes only source occurrence and adds the destination");
            JSONObject review=new JSONObject().put("key",id+"@"+date).put("courseId",id).put("name","原课程快照").put("slot","3—4节").put("originDate",date).put("done",true).put("note","复习例题").put("task",new JSONObject().put("week","2026-10-19").put("id","task_1").put("title","本周教材"));s.put("courseReviews",new JSONObject().put(date,new JSONArray().put(review)));DataStore.validate(s);
            rejects(p,()->PlanStore.create(c,s),"new plan API refuses inherited course review history");
            String records=s.getJSONObject("records").toString(),tasks=s.getJSONObject("plan").getJSONObject("weekTasks").toString();DataStore.restore(c,s);JSONObject loaded=DataStore.load(c);check(p,loaded.getJSONObject("courseReviews").toString().equals(s.getJSONObject("courseReviews").toString())&&loaded.getJSONObject("plan").getJSONObject("courseSchedule").toString().equals(schedule.toString()),"native atomic restore roundtrips timetable moves notes and historical task link");
            check(p,loaded.getJSONObject("records").toString().equals(records)&&loaded.getJSONObject("plan").getJSONObject("weekTasks").toString().equals(tasks),"course checklist never manufactures actual minutes or completes weekly tasks");
            ByteArrayOutputStream zip=new ByteArrayOutputStream();BackupManager.export(c,zip);try(BackupManager.Imported imported=BackupManager.read(c,new ByteArrayInputStream(zip.toByteArray()))){check(p,imported.study.getJSONObject("courseReviews").toString().equals(s.getJSONObject("courseReviews").toString()),"complete ZIP retains per-course review snapshots and task links");}
            ByteArrayOutputStream csv=new ByteArrayOutputStream();ReportExport.write(c,loaded,csv,"csv",date,date,"all");String text=new String(csv.toByteArray(),StandardCharsets.UTF_8);check(p,text.contains("逐门课程复习")&&text.contains("原课程快照：已复习")&&text.contains("周任务：本周教材"),"CSV includes course review notes and truthful task attribution");
            try(java.io.FileOutputStream output=new java.io.FileOutputStream(new File(original.getCacheDir(),"courses-validation.pdf"))){ReportExport.write(c,loaded,output,"pdf",date,date,"all");}check(p,new File(original.getCacheDir(),"courses-validation.pdf").length()>1000,"PDF report renders per-course review section");
            for(int n=0;n<11;n++){JSONObject bad=new JSONObject(s.toString()),sc=bad.getJSONObject("plan").getJSONObject("courseSchedule"),row=sc.getJSONArray("versions").getJSONObject(0).getJSONArray("courses").getJSONObject(0);switch(n){case 0:sc.put("extra",true);break;case 1:sc.put("versions",new JSONArray());break;case 2:sc.getJSONArray("versions").getJSONObject(0).put("anchor","2026-10-13");break;case 3:row.put("id","constructor");break;case 4:row.put("parity","any");break;case 5:row.put("lastWeek",0);break;case 6:row.put("day",1.5);break;case 7:bad.getJSONObject("courseReviews").getJSONArray(date).getJSONObject(0).put("done",1);break;case 8:bad.getJSONObject("courseReviews").getJSONArray(date).getJSONObject(0).put("key","wrong");break;case 9:sc.getJSONArray("changes").put(new JSONObject(change.toString()).put("id","another"));break;default:bad.getJSONObject("courseReviews").getJSONArray(date).getJSONObject(0).getJSONObject("task").put("extra",1);}
                rejects(p,()->DataStore.validate(bad),"native rejects corrupt course fixture "+n);
            }
            DataStore.restore(c,legacy);check(p,DataStore.load(c).getInt("version")==8&&!DataStore.load(c).has("courseReviews"),"old JSON restore gains course editing without invented review history");
        }finally{File[] files=dir.listFiles();if(files!=null)for(File file:files)file.delete();dir.delete();}
    }
}
