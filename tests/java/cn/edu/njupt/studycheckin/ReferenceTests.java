package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONObject;
import org.json.JSONArray;
import java.time.LocalDate;
import java.util.List;
import java.io.ByteArrayOutputStream;

final class ReferenceTests {
    private static JSONObject entry(Object minutes,Object learned,Object reviewed)throws Exception{return new JSONObject().put("minutes",minutes).put("content","").put("problem","").put("newWords",learned).put("reviewWords",reviewed).put("forgotWords","");}
    private static void check(List<String> passed,boolean yes,String name)throws Exception{if(!yes)throw new Exception("FAIL: "+name);passed.add(name);}
    static void run(Context context,List<String> passed)throws Exception{
        JSONArray cases=new JSONArray(DataStore.readText(context.getAssets().open("assessment-test-cases.json")));LocalDate date=LocalDate.of(2026,10,19);
        for(int i=0;i<cases.length();i++){
            JSONObject c=cases.getJSONObject(i),s=new JSONObject(DataStore.readText(context.getAssets().open("seed.json")));CourseSchedule.apply(s,LocalDate.of(2026,10,15),true);
            if(c.optBoolean("outsidePlan"))s.getJSONObject("plan").put("endDate","2026-10-18");
            JSONObject row=s.getJSONObject("plan").getJSONObject("targets").getJSONObject(date.toString()),expect=c.getJSONObject("expected");
            row.put("math",c.optBoolean("legacy")?50:new JSONObject().put("min",30).put("max",70));row.put("course-review",c.optBoolean("legacy")?40:new JSONObject().put("min",30).put("max",50));
            if(c.optBoolean("zeroTargets")){row.put("math",new JSONObject().put("min",0).put("max",0));row.put("course-review",new JSONObject().put("min",0).put("max",0));}
            JSONArray subjects=s.getJSONObject("plan").getJSONArray("subjects");for(int j=0;j<subjects.length();j++){JSONObject item=subjects.getJSONObject(j);if(c.optBoolean("noCourse")&&item.getString("id").equals("course-review"))item.put("activePeriods",new JSONArray());if(c.optBoolean("zeroWordGoal")&&item.getString("id").equals("vocab"))item.put("wordGoal",0);}
            JSONObject record=new JSONObject().put("status",c.get("status")).put("restKept",JSONObject.NULL).put("note","").put("subjects",new JSONObject().put("math",entry(c.get("math"),JSONObject.NULL,JSONObject.NULL)).put("course-review",entry(c.get("course"),JSONObject.NULL,JSONObject.NULL)).put("vocab",entry(JSONObject.NULL,c.get("newWords"),c.get("reviewWords"))));s.getJSONObject("records").put(date.toString(),record);DataStore.validate(s);String before=s.toString();
            JSONObject result=Reference.assess(s,date),time=result.getJSONObject("time");
            boolean actual=time.isNull("actual")?expect.isNull("actual"):!expect.isNull("actual")&&Math.abs(time.getDouble("actual")-expect.getDouble("actual"))<1e-8;
            check(passed,time.getString("kind").equals(expect.getString("kind"))&&actual&&time.getDouble("min")==expect.getDouble("min")&&time.getDouble("max")==expect.getDouble("max")&&result.getJSONArray("words").getJSONObject(0).getString("kind").equals(expect.getString("word")),"native interval assessment "+c.getString("id"));
            check(passed,before.equals(s.toString()),"native assessment does not mutate "+c.getString("id"));
            JSONObject widget=StudyWidget.content(s,date);check(passed,widget.getString("subjects").contains(c.optBoolean("outsidePlan")?"计划范围外":c.optBoolean("legacy")?"参考 40 分钟":c.optBoolean("zeroTargets")?"参考 0—0 分钟":c.optBoolean("noCourse")?"参考 30—70 分钟":"参考 30—50 分钟"),"widget interval reference "+c.getString("id"));
            if(i==0){
                ByteArrayOutputStream csv=new ByteArrayOutputStream();ReportExport.write(context,s,csv,"csv",date.toString(),date.toString(),"all");String text=csv.toString("UTF-8");check(passed,text.contains("30—50")&&text.contains("完成（合格）")&&text.contains("评估区间（分钟）"),"CSV keeps interval references and confirmed assessment");
                ByteArrayOutputStream pdf=new ByteArrayOutputStream();ReportExport.write(context,s,pdf,"pdf",date.toString(),date.toString(),"all");check(passed,pdf.size()>1000,"PDF exports interval references and assessment");
                try(java.io.FileOutputStream f=new java.io.FileOutputStream(new java.io.File(context.getCacheDir(),"reference-validation.pdf"))){f.write(pdf.toByteArray());}
                try(java.io.FileOutputStream f=new java.io.FileOutputStream(new java.io.File(context.getCacheDir(),"reference-validation.csv"))){f.write(csv.toByteArray());}
            }
        }
        JSONObject invalid=new JSONObject().put("min",50).put("max",30);boolean rejected=false;try{Reference.validate(invalid,true);}catch(Exception e){rejected=true;}check(passed,rejected,"native rejects reversed reference interval");
        rejected=false;try{Reference.validate(new JSONObject().put("min",0).put("max",30),false);}catch(Exception e){rejected=true;}check(passed,rejected,"native legacy schemas reject unsupported interval references");
    }
}
