package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/** Dated timetable revisions and independent, explicitly saved review observations. */
final class Courses {
    private Courses() {}
    private static void require(boolean b,String s)throws Exception{if(!b)throw new Exception(s);}
    private static void keys(JSONObject o,String...fields)throws Exception{require(o!=null&&o.length()==fields.length,"课程字段无效");for(String f:fields)require(o.has(f),"课程缺少字段 "+f);}
    private static String text(JSONObject o,String f,int max)throws Exception{Object v=o.get(f);require(v instanceof String&&((String)v).length()<=max,"课程文字超出长度限制");return (String)v;}
    private static String id(JSONObject o,String f)throws Exception{String s=text(o,f,64);require(s.matches("[A-Za-z][A-Za-z0-9_-]{0,63}")&&!Arrays.asList("constructor","prototype","__proto__").contains(s),"课程标识无效");return s;}
    private static int integer(JSONObject o,String f,int min,int max)throws Exception{Object n=o.get(f);require(n instanceof Number,"课程数字无效");double d=((Number)n).doubleValue();require(Double.isFinite(d)&&d==Math.floor(d)&&d>=min&&d<=max,"课程数字超出范围");return (int)d;}
    private static LocalDate date(String s)throws Exception{require(s.matches("\\d{4}-\\d{2}-\\d{2}"),"课程日期无效");LocalDate d=LocalDate.parse(s);require(d.getYear()>=1900&&d.getYear()<=2100,"课程日期超出范围");return d;}
    static void validate(JSONObject state)throws Exception{
        JSONObject plan=state.getJSONObject("plan");
        if(plan.has("courseSchedule")){
            JSONObject s=plan.getJSONObject("courseSchedule");keys(s,"versions","changes");JSONArray versions=s.getJSONArray("versions"),changes=s.getJSONArray("changes");require(versions.length()>0&&versions.length()<=100&&changes.length()<=2000,"课表数量超出限制");String previous="";
            for(int i=0;i<versions.length();i++){
                JSONObject v=versions.getJSONObject(i);keys(v,"from","anchor","startWeek","courses");String from=text(v,"from",10);date(from);LocalDate anchor=date(text(v,"anchor",10));require(from.compareTo(previous)>0&&anchor.getDayOfWeek().getValue()==1,"课表生效日期或周一日期无效");previous=from;integer(v,"startWeek",1,999);JSONArray courses=v.getJSONArray("courses");require(courses.length()<=100,"每份课表最多 100 条课程");Set<String> seen=new HashSet<>();
                for(int j=0;j<courses.length();j++){JSONObject c=courses.getJSONObject(j);keys(c,"id","name","day","firstWeek","lastWeek","parity","slot");require(seen.add(id(c,"id")),"课程标识重复");require(!text(c,"name",80).trim().isEmpty(),"请填写课程名称");integer(c,"day",0,6);int first=integer(c,"firstWeek",1,999);integer(c,"lastWeek",first,999);require(Arrays.asList("all","odd","even").contains(text(c,"parity",4)),"单双周无效");text(c,"slot",80);}
            }
            Set<String> seen=new HashSet<>(),origins=new HashSet<>();for(int i=0;i<changes.length();i++){JSONObject c=changes.getJSONObject(i);keys(c,"id","courseId","fromDate","toDate","note");require(seen.add(id(c,"id")),"调课标识重复");String course=id(c,"courseId"),from=text(c,"fromDate",10);date(from);if(!c.isNull("toDate")){String to=text(c,"toDate",10);date(to);require(!to.equals(from),"调课日期相同");}require(origins.add(course+"@"+from),"同一课程不能重复调课");text(c,"note",1000);JSONArray source=base(state,date(from));boolean exists=false;for(int j=0;j<source.length();j++)if(source.getJSONObject(j).getString("id").equals(course))exists=true;require(exists,"调课缺少原课程");}
        }
        if(state.has("courseReviews")){
            JSONObject values=state.getJSONObject("courseReviews");require(values.length()<=10000,"课程复习日期过多");Iterator<String> dates=values.keys();while(dates.hasNext()){String d=dates.next();date(d);JSONArray rows=values.getJSONArray(d);require(rows.length()<=200,"每日课程复习最多 200 项");Set<String> seen=new HashSet<>();for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);keys(r,"key","courseId","name","slot","originDate","done","note","task");String course=id(r,"courseId"),origin=text(r,"originDate",10),key=text(r,"key",80);date(origin);require(key.equals(course+"@"+origin)&&seen.add(key),"复习课程标识无效");require(!text(r,"name",80).trim().isEmpty(),"复习课程名称为空");text(r,"slot",80);require(r.get("done") instanceof Boolean,"复习勾选无效");text(r,"note",3000);if(!r.isNull("task")){JSONObject t=r.getJSONObject("task");keys(t,"week","id","title");date(text(t,"week",10));id(t,"id");require(!text(t,"title",500).trim().isEmpty(),"关联任务为空");}}}
        }
    }
    static void initialize(JSONObject state)throws Exception{
        JSONObject p=state.getJSONObject("plan");if(p.has("courseSchedule"))return;JSONObject data=new JSONObject(CourseScheduleData.JSON);boolean original=p.getString("startDate").equals(data.getString("anchor"))&&p.getString("endDate").equals(data.getString("lastDate"))&&p.getInt("startWeek")==7;LocalDate start=date(p.getString("startDate"));
        JSONObject v=new JSONObject().put("from","1900-01-01").put("anchor",original?data.getString("anchor"):start.minusDays(start.getDayOfWeek().getValue()-1).toString()).put("startWeek",original?7:p.getInt("startWeek")).put("courses",original?new JSONArray(data.getJSONArray("courses").toString()):new JSONArray());p.put("courseSchedule",new JSONObject().put("versions",new JSONArray().put(v)).put("changes",new JSONArray()));
    }
    private static JSONArray base(JSONObject state,LocalDate d)throws Exception{
        JSONObject s=state.getJSONObject("plan").optJSONObject("courseSchedule");if(s==null){JSONObject copy=new JSONObject(state.toString());initialize(copy);s=copy.getJSONObject("plan").getJSONObject("courseSchedule");}
        JSONArray versions=s.getJSONArray("versions"),out=new JSONArray();JSONObject v=null;for(int i=0;i<versions.length();i++){JSONObject row=versions.getJSONObject(i);if(row.getString("from").compareTo(d.toString())<=0)v=row;}
        if(v==null)return out;long delta=ChronoUnit.DAYS.between(date(v.getString("anchor")),d);long week=v.getInt("startWeek")+Math.floorDiv(delta,7);JSONArray rows=v.getJSONArray("courses");for(int i=0;i<rows.length();i++){JSONObject c=rows.getJSONObject(i);String parity=c.getString("parity");if(c.getInt("day")==d.getDayOfWeek().getValue()-1&&c.getInt("firstWeek")<=week&&week<=c.getInt("lastWeek")&&(parity.equals("all")||parity.equals("odd")&&week%2==1||parity.equals("even")&&week%2==0))out.put(new JSONObject(c.toString()));}return out;
    }
    static JSONArray occurrences(JSONObject state,LocalDate d)throws Exception{
        JSONObject copy=state;if(!state.getJSONObject("plan").has("courseSchedule")){copy=new JSONObject().put("plan",new JSONObject(state.getJSONObject("plan").toString()));initialize(copy);}JSONArray changes=copy.getJSONObject("plan").getJSONObject("courseSchedule").getJSONArray("changes"),rows=base(copy,d),out=new JSONArray();
        for(int i=0;i<rows.length();i++){JSONObject c=rows.getJSONObject(i);boolean removed=false;for(int j=0;j<changes.length();j++){JSONObject x=changes.getJSONObject(j);if(x.getString("courseId").equals(c.getString("id"))&&x.getString("fromDate").equals(d.toString()))removed=true;}if(!removed)out.put(c);}
        for(int i=0;i<changes.length();i++){JSONObject x=changes.getJSONObject(i);if(d.toString().equals(x.optString("toDate",""))){JSONArray source=base(copy,date(x.getString("fromDate")));for(int j=0;j<source.length();j++)if(source.getJSONObject(j).getString("id").equals(x.getString("courseId")))out.put(source.getJSONObject(j));}}return out;
    }
    static String reviewText(JSONObject state,String day)throws Exception{
        JSONObject values=state.optJSONObject("courseReviews");JSONArray rows=values==null?null:values.optJSONArray(day);if(rows==null)return "";StringBuilder text=new StringBuilder();for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(i>0)text.append("；");text.append(r.getString("name")).append(r.getBoolean("done")?"：已复习":"：待复习");if(!r.getString("note").isEmpty())text.append(" · ").append(r.getString("note"));if(!r.isNull("task"))text.append(" · 周任务：").append(r.getJSONObject("task").getString("title"));}return text.toString();
    }
}
