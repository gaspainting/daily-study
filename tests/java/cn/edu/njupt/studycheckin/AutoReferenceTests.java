package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONObject;
import java.time.LocalDate;
import java.util.List;

final class AutoReferenceTests {
    private static void check(List<String> passed,boolean yes,String name)throws Exception{if(!yes)throw new Exception("FAIL: "+name);passed.add(name);}
    static void run(Context c,List<String> passed)throws Exception{
        JSONObject s=new JSONObject(DataStore.readText(c.getAssets().open("seed.json")));CourseSchedule.apply(s,LocalDate.of(2026,10,15),true);s=DataStore.migrateState(s);
        LocalDate date=LocalDate.of(2026,10,21);String day=date.toString();JSONObject row=s.getJSONObject("plan").getJSONObject("targets").getJSONObject(day);row.put("math",60).put("course-review",30);
        String observations=s.getJSONObject("records").toString();CourseSchedule.autoReferences(s,date);
        check(passed,Reference.text(row.get("math")).equals("40—80")&&Reference.text(row.get("course-review")).equals("20—40"),"native automatically generates weekday subject ranges");
        row.put("math",17);CourseSchedule.autoReferences(s,date);check(passed,Reference.min(row.get("math"))==17&&Reference.max(row.get("math"))==17,"native custom scalar retains its exact point target");
        row.put("math",new JSONObject().put("min",7).put("max",19));CourseSchedule.autoReferences(s,date);check(passed,Reference.text(row.get("math")).equals("7—19"),"native explicit interval remains unchanged");
        JSONObject weekend=s.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-24");weekend.put("course-review",90).put("math",210);CourseSchedule.autoReferences(s,date);
        check(passed,Reference.text(weekend.get("course-review")).equals("60—120")&&Reference.text(weekend.get("math")).equals("180—240"),"native weekend reference generation preserves confirmed budgets");
        check(passed,observations.equals(s.getJSONObject("records").toString()),"native automatic references never write learning observations");
        row.put("math",60).put("course-review",30);JSONObject entries=new JSONObject();
        for(String id:new String[]{"math","course-review","vocab"})entries.put(id,new JSONObject().put("minutes",id.equals("math")?60:id.equals("course-review")?30:JSONObject.NULL).put("content","").put("problem","").put("newWords",id.equals("vocab")?50:JSONObject.NULL).put("reviewWords",JSONObject.NULL).put("forgotWords",""));
        s.getJSONObject("records").put(day,new JSONObject().put("subjects",entries).put("status","正常参考").put("restKept",JSONObject.NULL).put("note",""));Reference.preserve(s,s);
        check(passed,Reference.assess(s,date).getJSONObject("time").getString("kind").equals("within"),"native legacy positive targets assess as point intervals");
        String words=s.getJSONObject("assessmentBases").getJSONObject(day).getJSONArray("words").toString(),records=s.getJSONObject("records").toString();CourseSchedule.autoReferences(s,date);Reference.upgrade(s,date);
        JSONObject result=Reference.assess(s,date);check(passed,result.getJSONObject("time").getDouble("min")==60&&result.getJSONObject("time").getDouble("max")==120&&result.getJSONObject("time").getString("kind").equals("within"),"native current legacy basis repairs to generated interval");
        check(passed,words.equals(s.getJSONObject("assessmentBases").getJSONObject(day).getJSONArray("words").toString())&&records.equals(s.getJSONObject("records").toString()),"native repair retains frozen word criteria and every observation");
        String stable=s.toString();Reference.upgrade(s,date);CourseSchedule.autoReferences(s,date);check(passed,stable.equals(s.toString()),"native automatic reference repair is idempotent");
        row.put("math",new JSONObject().put("min",200).put("max",300));Reference.upgrade(s,date);check(passed,Reference.assess(s,date).getJSONObject("time").getString("kind").equals("within"),"native existing valid criteria survive changed current intervals");
        s.getJSONObject("assessmentBases").getJSONObject(day).getJSONArray("time").getJSONObject(0).put("reference",0);s.getJSONObject("assessmentBases").getJSONObject(day).getJSONArray("time").getJSONObject(1).put("reference",0);
        Reference.upgrade(s,date.plusDays(1));check(passed,Reference.assess(s,date).getJSONObject("time").getString("kind").equals("range"),"native automatic repair leaves elapsed saved bases unchanged");
        Reference.upgrade(s,date);check(passed,Reference.assess(s,date).getJSONObject("time").getString("kind").equals("below"),"native current zero basis repairs when positive current ranges exist");
        DataStore.validate(s);
    }
}
