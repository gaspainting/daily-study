package cn.edu.njupt.studycheckin;
import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.util.List;

final class CourseScheduleTests {
    static void check(List<String> p,boolean yes,String text)throws Exception{if(!yes)throw new Exception("FAIL: "+text);p.add(text);}
    static void run(Context c,List<String> p)throws Exception{
        JSONObject raw=new JSONObject(DataStore.readText(c.getAssets().open("seed.json")));
        LocalDate first=LocalDate.of(2026,10,12),effective=LocalDate.of(2026,10,15);
        for(int i=0;i<70;i++){
            LocalDate date=first.plusDays(i);JSONObject row=CourseSchedule.day(date);int weekday=date.getDayOfWeek().getValue()-1;
            check(p,row.getInt("review")+row.getInt("math")== (weekday<5?90:weekday==5?90:60)&&row.getInt("legacyMath")==raw.getJSONObject("plan").getJSONObject("targets").getJSONObject(date.toString()).getInt("math"),"course budget and original provenance "+date);
        }
        check(p,CourseSchedule.day(effective).getInt("review")==40&&CourseSchedule.day(effective.plusDays(7)).getInt("review")==30,"native odd/even teaching week allocation");
        check(p,CourseSchedule.day(LocalDate.of(2026,11,11)).getJSONArray("courses").length()==0&&CourseSchedule.day(LocalDate.of(2026,11,10)).getJSONArray("courses").toString().contains("习概"),"native course end weeks and politics transition");
        JSONObject old=new JSONObject(raw.toString());old.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-15").put("math",17);
        old.getJSONObject("plan").getJSONObject("weekGoals").put("2026-10-12","我的教材");String records=old.getJSONObject("records").toString();
        CourseSchedule.upgrade(old,effective);DataStore.validate(old);
        check(p,old.getJSONObject("plan").getJSONArray("subjects").getJSONObject(0).getString("id").equals("course-review")&&TestSubjects.inState(old,"course-review").getJSONArray("activePeriods").getJSONObject(0).getString("from").equals("2026-10-15"),"native adds course first from effective day only");
        check(p,old.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-15").getInt("math")==17&&old.getJSONObject("records").toString().equals(records)&&old.getJSONObject("plan").getJSONObject("weekGoals").getString("2026-10-12").equals("我的教材"),"native automatic allocation retains custom reference records and goal");
        String upgraded=old.toString();CourseSchedule.upgrade(old,effective.plusDays(1));check(p,old.toString().equals(upgraded),"native course migration is idempotent");
        CourseSchedule.apply(old,effective.plusDays(1),true);
        check(p,old.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-15").getInt("math")==17&&old.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-16").getInt("math")==50,"native explicit allocation respects its start date");
        JSONObject late=new JSONObject(raw.toString());late.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-12").remove("math");CourseSchedule.upgrade(late,LocalDate.of(2026,10,20));
        check(p,late.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-12").getInt("math")==40&&late.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-19").getInt("math")==raw.getJSONObject("plan").getJSONObject("targets").getJSONObject("2026-10-19").getInt("math"),"native late migration retains historical fallback and references");
        TestSubjects.inState(late,"course-review").put("activePeriods",new JSONArray());String archived=late.toString();CourseSchedule.upgrade(late,LocalDate.of(2026,10,21));check(p,archived.equals(late.toString()),"native archived course is not resurrected");
        JSONObject custom=new JSONObject(raw.toString());custom.getJSONObject("plan").put("startWeek",8);CourseSchedule.upgrade(custom,effective);check(p,custom.getJSONObject("plan").getJSONArray("subjects").length()==2,"native leaves custom plans unchanged until explicit application");
        JSONObject ended=new JSONObject(raw.toString());CourseSchedule.upgrade(ended,LocalDate.of(2026,12,21));check(p,ended.getJSONObject("plan").getJSONArray("subjects").length()==2,"native leaves ended plans unchanged");
        JSONObject widget=DataStore.migrateState(raw),record=new JSONObject().put("subjects",new JSONObject().put("course-review",new JSONObject().put("minutes",0).put("content","").put("problem","").put("newWords",JSONObject.NULL).put("reviewWords",JSONObject.NULL).put("forgotWords",""))).put("status","休息").put("restKept",true).put("note","");
        String today=LocalDate.now().toString();widget.getJSONObject("records").put(today,record);DataStore.validate(widget);
        JSONObject summary=StudyWidget.content(widget,LocalDate.now());check(p,summary.getString("subjects").startsWith("课程复习  0 分钟")&&summary.getString("subjects").contains("高数  未记录")&&summary.getString("subjects").contains("新学 未记录"),"widget exposes course zero and unknown calculus and vocabulary independently");
        check(p,summary.getString("status").equals("1/3 科目已记录 · 休息"),"widget partial course zero is not interpreted as all-day zero");
    }
}
