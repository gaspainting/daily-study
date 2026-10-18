package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;

/** Reference-only curriculum allocation; observations and user goals remain intact. */
final class CourseSchedule {
    private static final JSONObject DATA;
    static {try{DATA=new JSONObject(CourseScheduleData.JSON);}catch(Exception e){throw new ExceptionInInitializerError(e);}}
    private CourseSchedule() {}
    static JSONObject day(LocalDate date)throws Exception{
        JSONObject known=DATA.getJSONObject("days").optJSONObject(date.toString());
        if(known!=null)return new JSONObject(known.toString());
        int weekday=date.getDayOfWeek().getValue()-1;
        int review=DATA.getInt(weekday==5?"saturdayReview":weekday==6?"sundayReview":"lightReview");
        int budget=DATA.getInt(weekday==5?"saturdayBudget":weekday==6?"sundayBudget":"weekdayBudget");
        return new JSONObject().put("weekday",weekday).put("courses",JSONObject.NULL).put("review",review).put("math",budget-review);
    }
    private static JSONObject find(JSONObject plan,String id)throws Exception{
        JSONArray subjects=plan.getJSONArray("subjects");for(int i=0;i<subjects.length();i++)if(id.equals(subjects.getJSONObject(i).getString("id")))return subjects.getJSONObject(i);return null;
    }
    static LocalDate from(JSONObject plan,LocalDate now)throws Exception{
        LocalDate first=LocalDate.parse(DATA.getString("effectiveFrom")),start=LocalDate.parse(plan.getString("startDate"));
        if(now.isAfter(first))first=now;if(start.isAfter(first))first=start;return first;
    }
    static boolean canApply(JSONObject state,LocalDate now)throws Exception{
        JSONObject plan=state.getJSONObject("plan"),math=find(plan,"math"),vocab=find(plan,"vocab"),course=find(plan,DATA.getString("subjectId"));LocalDate first=from(plan,now);
        return !first.isAfter(LocalDate.parse(plan.getString("endDate")))&&math!=null&&"math".equals(math.getString("kind"))&&DataStore.activeSubject(math,first)&&vocab!=null&&"vocab".equals(vocab.getString("kind"))&&(course==null?plan.getJSONArray("subjects").length()<24:"custom".equals(course.getString("kind"))&&DataStore.activeSubject(course,first));
    }
    static JSONObject apply(JSONObject state,LocalDate now,boolean force)throws Exception{
        if(!canApply(state,now))throw new Exception("当前计划无法应用课程优先安排");
        JSONObject plan=state.getJSONObject("plan"),math=find(plan,"math"),course=find(plan,DATA.getString("subjectId"));LocalDate first=from(plan,now);
        boolean defaults=math.getJSONArray("defaults").toString().equals(DATA.getJSONArray("legacyMathDefaults").toString());
        if(defaults){JSONObject targets=plan.getJSONObject("targets");for(LocalDate old=LocalDate.parse(plan.getString("startDate"));old.isBefore(first);old=old.plusDays(1)){String key=old.toString();JSONObject row=targets.optJSONObject(key);if(row==null){row=new JSONObject();targets.put(key,row);}if(!row.has("math"))row.put("math",math.getJSONArray("defaults").get(old.getDayOfWeek().getValue()-1));}}
        if(course==null){JSONArray values=new JSONArray();for(int d=0;d<7;d++)values.put(DATA.getInt(d==5?"saturdayReview":d==6?"sundayReview":"lightReview"));course=new JSONObject().put("id",DATA.getString("subjectId")).put("name",DATA.getString("subjectName")).put("kind","custom").put("defaults",values).put("activePeriods",new JSONArray().put(new JSONObject().put("from",first.toString()).put("to",JSONObject.NULL)));}
        JSONArray ordered=new JSONArray().put(course),subjects=plan.getJSONArray("subjects");for(int i=0;i<subjects.length();i++){JSONObject subject=subjects.getJSONObject(i);if(!subject.getString("id").equals(course.getString("id")))ordered.put(subject);}plan.put("subjects",ordered);
        JSONObject targets=plan.getJSONObject("targets");LocalDate last=LocalDate.parse(plan.getString("endDate"));
        for(LocalDate date=first;!date.isAfter(last);date=date.plusDays(1)){
            String key=date.toString();JSONObject row=day(date),stored=targets.optJSONObject(key);if(stored==null){stored=new JSONObject();targets.put(key,stored);}
            if(force||(row.has("legacyMath")&&(stored.has("math")?stored.getDouble("math")==row.getDouble("legacyMath"):defaults)))stored.put("math",row.getInt("math"));
            if(force||!stored.has(course.getString("id")))stored.put(course.getString("id"),row.getInt("review"));
        }
        if(defaults){JSONArray values=new JSONArray();for(int d=0;d<7;d++)values.put(DATA.getInt(d==5?"saturdayBudget":d==6?"sundayBudget":"weekdayBudget")-DATA.getInt(d==5?"saturdayReview":d==6?"sundayReview":"lightReview"));math.put("defaults",values);}
        if(plan.getString("title").equals(DATA.getString("legacyTitle")))plan.put("title",DATA.getString("title"));state.put("version",Math.max(state.getInt("version"),2));return state;
    }
    static void upgrade(JSONObject state,LocalDate now)throws Exception{
        JSONObject plan=state.getJSONObject("plan");
        if(plan.getString("startDate").equals(DATA.getString("anchor"))&&plan.getString("endDate").equals(DATA.getString("lastDate"))&&plan.getInt("startWeek")==7&&find(plan,DATA.getString("subjectId"))==null&&canApply(state,now))apply(state,now,false);
    }
}
