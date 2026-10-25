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
            if(force){JSONObject manual=plan.optJSONObject("manualReferences");JSONArray marked=manual==null?null:manual.optJSONArray(key);if(marked!=null){JSONArray keep=new JSONArray();for(int i=0;i<marked.length();i++)if(!marked.getString(i).equals("math")&&!marked.getString(i).equals(course.getString("id")))keep.put(marked.get(i));if(keep.length()==0)manual.remove(key);else manual.put(key,keep);}}
        }
        if(force){preserveDefaults(plan,course,math,first);JSONArray values=new JSONArray();for(int d=0;d<7;d++)values.put(fallback(d,"review"));course.put("defaults",values);}
        if(defaults||force){JSONArray values=new JSONArray();for(int d=0;d<7;d++)values.put(fallback(d,"math"));math.put("defaults",values);}
        if(plan.getString("title").equals(DATA.getString("legacyTitle")))plan.put("title",DATA.getString("title"));state.put("version",Math.max(state.getInt("version"),4));return state;
    }
    private static final String REFERENCE_UPGRADE_AT=Reference.timestamp();
    private static boolean same(Object a,Object b)throws Exception{return Reference.min(a)==Reference.min(b)&&Reference.max(a)==Reference.max(b);}
    private static boolean manual(JSONObject plan,String day,String id,Object value,JSONObject subject,int weekday)throws Exception{
        JSONObject dates=plan.optJSONObject("manualReferences");JSONArray marked=dates==null?null:dates.optJSONArray(day),defaults=plan.optJSONArray("manualReferenceDefaults");
        if(marked!=null)for(int i=0;i<marked.length();i++)if(id.equals(marked.getString(i)))return true;
        if(defaults!=null)for(int i=0;i<defaults.length();i++)if(id.equals(defaults.getString(i))&&same(value,subject.getJSONArray("defaults").get(weekday)))return true;
        return false;
    }
    private static boolean oldPreset(Object value,String key,int weekday)throws Exception{
        double min=Reference.min(value),max=Reference.max(value);if(max<=0)return false;
        if(min==max){int[] values=key.equals("review")?new int[]{30,40,60,90}:new int[]{25,30,35,40,50,55,60,90,150,210};for(int v:values)if(min==v)return true;return false;}
        if(weekday>=5)for(String load:new String[]{"busy","light"})if(same(value,DATA.getJSONObject("weekdayRanges").getJSONObject(load).getJSONObject(key)))return true;
        return false;
    }
    private static JSONObject automaticRange(JSONObject plan,String date,JSONObject subject,Object value,JSONObject row)throws Exception{
        String id=subject.getString("id"),kind=subject.getString("kind");int weekday=row.getInt("weekday");if(manual(plan,date,id,value,subject,weekday))return null;
        String key=id.equals(DATA.getString("subjectId"))&&kind.equals("custom")?"review":id.equals("math")&&kind.equals("math")?"math":null;
        return key!=null&&oldPreset(value,key,weekday)?row.getJSONObject(key+"Range"):null;
    }
    static void autoReferences(JSONObject state,LocalDate now)throws Exception{
        JSONObject plan=state.getJSONObject("plan"),targets=plan.getJSONObject("targets");JSONArray subjects=plan.getJSONArray("subjects");LocalDate first=LocalDate.parse(plan.getString("startDate")),last=LocalDate.parse(plan.getString("endDate"));if(now.isAfter(first))first=now;
        for(LocalDate date=first;!date.isAfter(last);date=date.plusDays(1)){
            String key=date.toString();JSONObject row=day(date),stored=targets.optJSONObject(key);if(stored==null){stored=new JSONObject();targets.put(key,stored);}
            if(plan.has("courseSchedule")&&date.getDayOfWeek().getValue()<6){JSONArray meetings=Courses.occurrences(state,date);JSONObject limits=DATA.getJSONObject("weekdayRanges").getJSONObject(meetings.length()>=DATA.getInt("busyCourseCount")?"busy":"light");row.put("reviewRange",limits.getJSONObject("review")).put("mathRange",limits.getJSONObject("math"));}
            for(int i=0;i<subjects.length();i++){
                JSONObject s=subjects.getJSONObject(i);String id=s.getString("id");if(s.getString("kind").equals("vocab")||"quantity".equals(s.optString("measure"))||!DataStore.activeSubject(s,date))continue;
                Object value=stored.has(id)?stored.get(id):s.getJSONArray("defaults").get(row.getInt("weekday"));JSONObject recommended=automaticRange(plan,key,s,value,row);
                if(recommended!=null)stored.put(id,new JSONObject(recommended.toString()));else if(value instanceof Number)stored.put(id,new JSONObject().put("min",value).put("max",value));
            }
            JSONObject bases=state.optJSONObject("assessmentBases"),basis=bases==null?null:bases.optJSONObject(key);boolean changed=false;
            if(basis!=null){JSONArray time=basis.getJSONArray("time");for(int i=0;i<time.length();i++){
                JSONObject e=time.getJSONObject(i),s=find(plan,e.getString("id"));if(s==null||!DataStore.activeSubject(s,date)||"quantity".equals(s.optString("measure")))continue;
                JSONObject recommended=automaticRange(plan,key,s,e.get("reference"),row);
                if(recommended!=null&&stored.has(e.getString("id"))&&same(stored.get(e.getString("id")),recommended)&&!same(e.get("reference"),recommended)){e.put("reference",new JSONObject(recommended.toString()));changed=true;}
            }if(changed)basis.put("source","recalculated").put("capturedAt",REFERENCE_UPGRADE_AT);}
        }
    }
    static void upgrade(JSONObject state,LocalDate now)throws Exception{
        JSONObject plan=state.getJSONObject("plan");
        if(plan.getString("startDate").equals(DATA.getString("anchor"))&&plan.getString("endDate").equals(DATA.getString("lastDate"))&&plan.getInt("startWeek")==7&&find(plan,DATA.getString("subjectId"))==null&&canApply(state,now))apply(state,now,false);
    }
}
