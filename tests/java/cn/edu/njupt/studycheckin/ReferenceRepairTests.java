package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.util.List;

final class ReferenceRepairTests {
    private static void check(List<String> passed,boolean yes,String name)throws Exception{if(!yes)throw new Exception("FAIL: "+name);passed.add(name);}
    private static JSONObject range(double min,double max)throws Exception{return new JSONObject().put("min",min).put("max",max);}
    private static JSONObject entry(Object minutes,Object words)throws Exception{return new JSONObject().put("minutes",minutes).put("content","").put("problem","").put("newWords",words).put("reviewWords",JSONObject.NULL).put("forgotWords","");}
    private static JSONObject total(JSONObject s,LocalDate date)throws Exception{JSONObject row=s.getJSONObject("plan").getJSONObject("targets").getJSONObject(date.toString());return range(Reference.min(row.get("math"))+Reference.min(row.get("course-review")),Reference.max(row.get("math"))+Reference.max(row.get("course-review")));}
    static void run(Context c,List<String> passed)throws Exception{
        JSONObject s=new JSONObject(DataStore.readText(c.getAssets().open("reference-legacy-v161.json"))),before=new JSONObject(s.toString());
        LocalDate date=LocalDate.of(2026,10,26),sat=LocalDate.of(2026,10,31),sun=sat.plusDays(1);JSONObject plan=s.getJSONObject("plan"),targets=plan.getJSONObject("targets");
        CourseSchedule.autoReferences(s,date);
        check(passed,Reference.text(total(s,date)).equals("60—120"),"native repairs v1.6.1 equal-endpoint weekday presets");
        check(passed,Reference.text(total(s,sat)).equals("240—360")&&Reference.text(total(s,sun)).equals("180—300"),"native repairs both old weekend course and math budgets");
        boolean past=true;for(LocalDate d=LocalDate.parse(plan.getString("startDate"));d.isBefore(date);d=d.plusDays(1))past&=targets.getJSONObject(d.toString()).toString().equals(before.getJSONObject("plan").getJSONObject("targets").getJSONObject(d.toString()).toString());
        check(passed,past&&s.getJSONObject("records").toString().equals(before.getJSONObject("records").toString()),"native reference repair preserves past references and actual records");
        JSONObject row=targets.getJSONObject(sat.toString());row.put("math",range(40,80)).put("course-review",range(20,40));CourseSchedule.autoReferences(s,date);
        check(passed,Reference.text(total(s,sat)).equals("240—360"),"native repairs weekday-shaped intervals accidentally assigned to Saturday");
        row.put("math",range(60,60)).put("course-review",range(30,30));s.put("version",8);plan.put("manualReferences",new JSONObject().put(sat.toString(),new JSONArray().put("math").put("course-review")));CourseSchedule.autoReferences(s,date);
        check(passed,Reference.text(total(s,sat)).equals("90")&&Reference.text(row.get("math")).equals("60"),"native explicit point references remain exact and display once");
        targets.getJSONObject(sun.toString()).put("math",17).put("course-review",range(7,19));CourseSchedule.autoReferences(s,date);
        check(passed,Reference.text(targets.getJSONObject(sun.toString()).get("math")).equals("17")&&Reference.text(targets.getJSONObject(sun.toString()).get("course-review")).equals("7—19"),"native retains nonpreset custom point and interval references");
        check(passed,Reference.text(range(0,0)).equals("0"),"native zero reference displays once without changing its value");
        DataStore.validate(s);String stable=s.toString();CourseSchedule.autoReferences(s,date);check(passed,s.toString().equals(stable),"native v1.6.2 reference repair is idempotent");
        for(JSONArray ids:new JSONArray[]{new JSONArray().put("vocab"),new JSONArray().put("missing"),new JSONArray().put("math").put("math"),new JSONArray().put(42)}){
            JSONObject invalid=new JSONObject(s.toString());invalid.getJSONObject("plan").put("manualReferences",new JSONObject().put(sat.toString(),ids));boolean rejected=false;try{DataStore.validate(invalid);}catch(Exception e){rejected=true;}check(passed,rejected,"native rejects invalid manual reference provenance "+ids);
        }
        JSONObject criteria=new JSONObject(before.toString());criteria.put("version",8);JSONObject record=new JSONObject().put("status","正常参考").put("restKept",JSONObject.NULL).put("note","").put("subjects",new JSONObject().put("math",entry(200,JSONObject.NULL)).put("course-review",entry(60,JSONObject.NULL)).put("vocab",entry(JSONObject.NULL,50)));
        criteria.getJSONObject("records").put(sat.toString(),record);Reference.preserve(criteria,criteria);String words=criteria.getJSONObject("assessmentBases").getJSONObject(sat.toString()).getJSONArray("words").toString(),observed=criteria.getJSONObject("records").toString();
        CourseSchedule.autoReferences(criteria,date);JSONObject result=Reference.assess(criteria,sat).getJSONObject("time");
        check(passed,result.getString("kind").equals("within")&&result.getDouble("min")==240&&result.getDouble("max")==360,"native repairs current saved preset criteria to the real weekend interval");
        check(passed,words.equals(criteria.getJSONObject("assessmentBases").getJSONObject(sat.toString()).getJSONArray("words").toString())&&observed.equals(criteria.getJSONObject("records").toString()),"native criteria repair retains saved word targets and actual observations");
        JSONObject historical=new JSONObject(before.toString());historical.getJSONObject("records").put(sat.toString(),record);Reference.preserve(historical,historical);String saved=historical.getJSONObject("assessmentBases").toString();CourseSchedule.autoReferences(historical,sun.plusDays(1));check(passed,saved.equals(historical.getJSONObject("assessmentBases").toString()),"native reference repair does not recalculate past assessments");
    }
}
