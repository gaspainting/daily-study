package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;

/** Reference-only curriculum allocation; observations and user goals remain intact. */
final class CourseSchedule {
    private static final JSONObject DATA;
    static {try{DATA=new JSONObject(CourseScheduleData.JSON);}catch(Exception e){throw new ExceptionInInitializerError(e);}}
    private CourseSchedule() {}
    private static JSONObject fallback(int weekday,String key)throws Exception{
        if(weekday<5)return new JSONObject(DATA.getJSONObject("weekdayRanges").getJSONObject("light").getJSONObject(key).toString());
        JSONArray limits=DATA.getJSONObject("weekendRanges").getJSONObject(weekday==5?"saturday":"sunday").getJSONArray(key.equals("review")?"morning":"afternoon");return new JSONObject().put("min",limits.get(0)).put("max",limits.get(1));
    }
    static JSONObject day(LocalDate date)throws Exception{
        JSONObject known=DATA.getJSONObject("days").optJSONObject(date.toString());
        if(known!=null)return new JSONObject(known.toString());
        int weekday=date.getDayOfWeek().getValue()-1;
        int review=DATA.getInt(weekday==5?"saturdayReview":weekday==6?"sundayReview":"lightReview");
        int budget=DATA.getInt(weekday==5?"saturdayBudget":weekday==6?"sundayBudget":"weekdayBudget");
        return new JSONObject().put("weekday",weekday).put("courses",JSONObject.NULL).put("review",review).put("math",budget-review).put("reviewRange",fallback(weekday,"review")).put("mathRange",fallback(weekday,"math"));
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
    private static void preserveDefaults(JSONObject plan,JSONObject course,JSONObject math,LocalDate first)throws Exception{
        JSONObject targets=plan.getJSONObject("targets");for(LocalDate date=LocalDate.parse(plan.getString("startDate"));date.isBefore(first)&&!date.isAfter(LocalDate.parse(plan.getString("endDate")));date=date.plusDays(1)){
            JSONObject row=targets.optJSONObject(date.toString());if(row==null){row=new JSONObject();targets.put(date.toString(),row);}
            for(JSONObject s:new JSONObject[]{course,math})if(DataStore.activeSubject(s,date)&&!row.has(s.getString("id")))row.put(s.getString("id"),s.getJSONArray("defaults").get(date.getDayOfWeek().getValue()-1));
        }
    }
    static JSONObject apply(JSONObject state,LocalDate now,boolean force)throws Exception{
        if(!canApply(state,now))throw new Exception("当前计划无法应用课程优先安排");
        JSONObject plan=state.getJSONObject("plan"),math=find(plan,"math"),course=find(plan,DATA.getString("subjectId"));LocalDate first=from(plan,now);
        boolean defaults=math.getJSONArray("defaults").toString().equals(DATA.getJSONArray("legacyMathDefaults").toString());
        if(defaults){JSONObject targets=plan.getJSONObject("targets");for(LocalDate old=LocalDate.parse(plan.getString("startDate"));old.isBefore(first);old=old.plusDays(1)){String key=old.toString();JSONObject row=targets.optJSONObject(key);if(row==null){row=new JSONObject();targets.put(key,row);}if(!row.has("math"))row.put("math",math.getJSONArray("defaults").get(old.getDayOfWeek().getValue()-1));}}
        if(course==null){JSONArray values=new JSONArray();for(int d=0;d<7;d++)values.put(fallback(d,"review"));course=new JSONObject().put("id",DATA.getString("subjectId")).put("name",DATA.getString("subjectName")).put("kind","custom").put("defaults",values).put("activePeriods",new JSONArray().put(new JSONObject().put("from",first.toString()).put("to",JSONObject.NULL)));}
        JSONArray ordered=new JSONArray().put(course),subjects=plan.getJSONArray("subjects");for(int i=0;i<subjects.length();i++){JSONObject subject=subjects.getJSONObject(i);if(!subject.getString("id").equals(course.getString("id")))ordered.put(subject);}plan.put("subjects",ordered);
        JSONObject targets=plan.getJSONObject("targets");LocalDate last=LocalDate.parse(plan.getString("endDate"));
        for(LocalDate date=first;!date.isAfter(last);date=date.plusDays(1)){
            String key=date.toString();JSONObject row=day(date);if(plan.has("courseSchedule")&&date.getDayOfWeek().getValue()<6){JSONArray meetings=Courses.occurrences(state,date);JSONObject limits=DATA.getJSONObject("weekdayRanges").getJSONObject(meetings.length()>=DATA.getInt("busyCourseCount")?"busy":"light");row.put("reviewRange",limits.getJSONObject("review")).put("mathRange",limits.getJSONObject("math"));}JSONObject stored=targets.optJSONObject(key);if(stored==null){stored=new JSONObject();targets.put(key,stored);}
            if(force||(row.has("legacyMath")&&(stored.has("math")?stored.opt("math") instanceof Number&&stored.getDouble("math")==row.getDouble("legacyMath"):defaults)))stored.put("math",row.getJSONObject("mathRange"));
            if(force||!stored.has(course.getString("id")))stored.put(course.getString("id"),row.getJSONObject("reviewRange"));
        }
        if(force){preserveDefaults(plan,course,math,first);JSONArray values=new JSONArray();for(int d=0;d<7;d++)values.put(fallback(d,"review"));course.put("defaults",values);}
        if(defaults||force){JSONArray values=new JSONArray();for(int d=0;d<7;d++)values.put(fallback(d,"math"));math.put("defaults",values);}
        if(plan.getString("title").equals(DATA.getString("legacyTitle")))plan.put("title",DATA.getString("title"));state.put("version",Math.max(state.getInt("version"),4));return state;
    }
    static void upgrade(JSONObject state,LocalDate now)throws Exception{
        JSONObject plan=state.getJSONObject("plan");
        if(plan.getString("startDate").equals(DATA.getString("anchor"))&&plan.getString("endDate").equals(DATA.getString("lastDate"))&&plan.getInt("startWeek")==7&&find(plan,DATA.getString("subjectId"))==null&&canApply(state,now))apply(state,now,false);
    }
}
