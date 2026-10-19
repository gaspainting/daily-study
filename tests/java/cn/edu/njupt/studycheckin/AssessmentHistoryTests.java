package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONObject;
import org.json.JSONArray;
import java.time.LocalDate;
import java.util.List;
import java.util.HashSet;
import java.util.Arrays;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

final class AssessmentHistoryTests {
    private static void check(List<String> passed,boolean yes,String name)throws Exception{if(!yes)throw new Exception("FAIL: "+name);passed.add(name);}
    private static JSONObject entry(Object minutes,Object words)throws Exception{return new JSONObject().put("minutes",minutes).put("content","").put("problem","").put("newWords",words).put("reviewWords",JSONObject.NULL).put("forgotWords","");}
    static void run(Context c,List<String> passed)throws Exception{
        JSONObject original=DataStore.load(c);LocalDate date=LocalDate.of(2026,10,19);String day=date.toString();
        try{
            JSONObject s=new JSONObject(DataStore.readText(c.getAssets().open("seed.json")));CourseSchedule.apply(s,LocalDate.of(2026,10,16),true);
            s.getJSONObject("plan").getJSONObject("targets").getJSONObject(day).put("math",new JSONObject().put("min",30).put("max",70)).put("course-review",new JSONObject().put("min",30).put("max",50));
            s.getJSONObject("records").put(day,new JSONObject().put("status","正常参考").put("restKept",JSONObject.NULL).put("note","保留历史实际").put("subjects",new JSONObject().put("math",entry(30,JSONObject.NULL)).put("course-review",entry(30,JSONObject.NULL)).put("vocab",entry(JSONObject.NULL,50))));
            DataStore.restore(c,s);s=DataStore.load(c);String observations=s.getJSONObject("records").toString();
            check(passed,!s.has("assessmentBases")&&Reference.assess(s,date).getJSONObject("basis").getString("source").equals("current"),"legacy restore does not invent original assessment criteria");
            s.getJSONObject("plan").getJSONObject("targets").getJSONObject(day).put("math",new JSONObject().put("min",200).put("max",300));
            s.getJSONObject("plan").put("wordTargets",new JSONObject().put(day,new JSONObject().put("vocab",80)));DataStore.save(c,s);s=DataStore.load(c);
            JSONObject a=Reference.assess(s,date),b=s.getJSONObject("assessmentBases").getJSONObject(day);
            check(passed,a.getJSONObject("time").getString("kind").equals("within")&&a.getJSONArray("words").getJSONObject(0).getString("kind").equals("within"),"native save freezes prior time interval and vocabulary goal before target changes");
            check(passed,b.getString("source").equals("existing")&&observations.equals(s.getJSONObject("records").toString()),"first retention is labelled existing and preserves actual observations");
            check(passed,StudyWidget.content(s,date).getString("status").contains("按原区间完成"),"widget distinguishes retained assessment from changed current reference");
            String retained=b.toString();DataStore.save(c,s);s=DataStore.load(c);check(passed,s.getJSONObject("assessmentBases").getJSONObject(day).toString().equals(retained),"repeated native save keeps retained criteria timestamp and fields");
            JSONObject newRecord=new JSONObject(s.getJSONObject("records").getJSONObject(day).toString());newRecord.put("status","休息");newRecord.getJSONObject("subjects").getJSONObject("math").put("minutes",0);s.getJSONObject("records").put("2026-10-20",newRecord);DataStore.save(c,s);s=DataStore.load(c);
            check(passed,s.getJSONObject("assessmentBases").getJSONObject("2026-10-20").getString("source").equals("record")&&Reference.assess(s,LocalDate.of(2026,10,20)).getJSONObject("time").getString("kind").equals("rest"),"new native record captures its own criteria while zero and rest remain explicit");
            JSONObject basis=Reference.capture(s,date,"recalculated","2026-10-19T02:00:00.000Z");s.getJSONObject("assessmentBases").put(day,basis);DataStore.validate(s);
            check(passed,Reference.assess(s,date).getJSONObject("time").getString("kind").equals("below")&&Reference.assess(s,date).getJSONArray("words").getJSONObject(0).getString("kind").equals("below"),"native explicit recalculation uses current interval and word goal independently");
            HashSet<String> ids=new HashSet<>(Arrays.asList("math","course-review","vocab")),vocab=new HashSet<>(Arrays.asList("vocab"));
            for(int i=0;i<8;i++){JSONObject bad=new JSONObject(basis.toString());if(i==0)bad.put("rule",2);if(i==1)bad.put("source","current");if(i==2)bad.put("extra",true);if(i==3)bad.put("capturedAt","2026-02-30T02:00:00.000Z");if(i==4)bad.put("inside","true");if(i==5)bad.getJSONArray("time").getJSONObject(0).put("reference",new JSONObject().put("min",5).put("max",1));if(i==6)bad.getJSONArray("time").getJSONObject(0).put("id","__proto__");if(i==7)bad.getJSONArray("words").getJSONObject(0).put("goal",0.5);boolean rejected=false;try{Reference.validateBasis(bad,ids,vocab);}catch(Exception expected){rejected=true;}check(passed,rejected,"native rejects malformed assessment basis case "+i);}
            // Export retained criteria alongside changed current targets.
            s.getJSONObject("assessmentBases").put(day,new JSONObject(retained));DataStore.save(c,s);s=DataStore.load(c);ByteArrayOutputStream csv=new ByteArrayOutputStream();ReportExport.write(c,s,csv,"csv",day,day,"all");String text=csv.toString("UTF-8");
            check(passed,text.contains("首次留存参考")&&text.contains("学习时长 60—120")&&text.contains("评估新学目标（个）"),"CSV exports retained effective interval source and separate assessed vocabulary goal");
            ByteArrayOutputStream pdf=new ByteArrayOutputStream();ReportExport.write(c,s,pdf,"pdf",day,day,"all");check(passed,pdf.size()>1000,"PDF exports retained assessment criteria");
            try(java.io.FileOutputStream f=new java.io.FileOutputStream(new java.io.File(c.getCacheDir(),"history-validation.csv"))){f.write(csv.toByteArray());}try(java.io.FileOutputStream f=new java.io.FileOutputStream(new java.io.File(c.getCacheDir(),"history-validation.pdf"))){f.write(pdf.toByteArray());}
            JSONObject roundtrip=DataStore.migrateState(new JSONObject(s.toString()));check(passed,roundtrip.getJSONObject("assessmentBases").toString().equals(s.getJSONObject("assessmentBases").toString()),"schema5 backup roundtrip retains criteria exactly");
            String stable=s.toString(),savedBases=s.getJSONObject("assessmentBases").toString();ByteArrayOutputStream archive=new ByteArrayOutputStream();BackupManager.export(c,archive);
            try(BackupManager.Imported imported=BackupManager.read(c,new ByteArrayInputStream(archive.toByteArray()))){check(passed,imported.study.getJSONObject("assessmentBases").toString().equals(savedBases),"complete ZIP carries retained schema5 criteria");}
            check(passed,DataStore.load(c).toString().equals(stable),"cancelling criteria backup preview changes no stored field");
            JSONObject malformed=new JSONObject(s.toString());malformed.getJSONObject("assessmentBases").getJSONObject(day).put("rule",2);boolean invalid=false;try(BackupManager.Imported ignored=BackupManager.read(c,new ByteArrayInputStream(malformed.toString().getBytes(StandardCharsets.UTF_8)))){}catch(Exception expected){invalid=true;}
            check(passed,invalid&&DataStore.load(c).toString().equals(stable),"invalid assessment backup is rejected without changing original records");
            try(BackupManager.Imported imported=BackupManager.read(c,new ByteArrayInputStream(archive.toByteArray()))){BackupManager.restore(c,imported);}
            check(passed,DataStore.load(c).getJSONObject("assessmentBases").toString().equals(savedBases),"confirmed complete backup restoration retains frozen criteria");
        }finally{DataStore.restore(c,original);}
    }
}
