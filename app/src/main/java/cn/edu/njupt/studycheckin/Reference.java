package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.math.BigDecimal;

/** Interval references and saved-record assessment. Legacy scalar targets stay intact. */
final class Reference {
    private Reference() {}
    static void validate(Object value,boolean ranges)throws Exception{
        if(value instanceof Number){validNumber(value);return;}
        if(!ranges||!(value instanceof JSONObject))throw new Exception("参考区间须含下限和上限");
        JSONObject r=(JSONObject)value;if(r.length()!=2||!r.has("min")||!r.has("max"))throw new Exception("参考区间须含下限和上限");
        validNumber(r.get("min"));validNumber(r.get("max"));if(r.getDouble("min")>r.getDouble("max"))throw new Exception("参考下限不能超过上限");
    }
    private static void validNumber(Object v)throws Exception{if(!(v instanceof Number)||!Double.isFinite(((Number)v).doubleValue())||((Number)v).doubleValue()<0||((Number)v).doubleValue()>1440)throw new Exception("参考区间须在0—1440分钟之间");}
    static double min(Object value)throws Exception{return value instanceof Number?((Number)value).doubleValue():((JSONObject)value).getDouble("min");}
    static double max(Object value)throws Exception{return value instanceof Number?((Number)value).doubleValue():((JSONObject)value).getDouble("max");}
    static double midpoint(Object value)throws Exception{return (min(value)+max(value))/2;}
    static String decimal(double value){return BigDecimal.valueOf(Math.round(value*1000000d)/1000000d).stripTrailingZeros().toPlainString();}
    static String text(Object value)throws Exception{return value instanceof Number?decimal(min(value)):decimal(min(value))+"—"+decimal(max(value));}
    static Object value(JSONObject plan,JSONObject subject,LocalDate date)throws Exception{
        JSONObject row=plan.getJSONObject("targets").optJSONObject(date.toString());String id=subject.getString("id");
        return row!=null&&row.has(id)?row.get(id):subject.getJSONArray("defaults").get(date.getDayOfWeek().getValue()-1);
    }
    private static String grade(double actual,double min,double max){return actual<min-1e-9?"below":actual>max+1e-9?"above":"within";}
    private static String label(String kind){switch(kind){case "empty":return "未记录";case "arrangement":return "未选择安排";case "partial":return "待补全时长";case "range":return "未设置参考区间";case "review":return "未设置课程复习";case "outside":return "计划范围外";case "rest":return "休息日";case "below":return "未完成（不合格）";case "within":return "完成（合格）";case "above":return "超额完成";default:throw new IllegalArgumentException(kind);}}
    static JSONObject assess(JSONObject state,LocalDate date)throws Exception{
        JSONObject plan=state.getJSONObject("plan"),record=state.getJSONObject("records").optJSONObject(date.toString()),entries=record==null?new JSONObject():record.getJSONObject("subjects");
        String status=record==null||record.isNull("status")?"":record.getString("status");boolean inside=date.toString().compareTo(plan.getString("startDate"))>=0&&date.toString().compareTo(plan.getString("endDate"))<=0;
        JSONArray subjects=plan.getJSONArray("subjects"),words=new JSONArray();double lower=0,upper=0,actual=0;int known=0,missing=0,targets=0,selected=0;boolean legacy=false;
        for(int i=0;i<subjects.length();i++){
            JSONObject s=subjects.getJSONObject(i);if(!DataStore.activeSubject(s,date))continue;String id=s.getString("id");JSONObject entry=entries.optJSONObject(id);
            if("vocab".equals(s.getString("kind"))){int goal=DataStore.wordTarget(state,date.toString(),id);boolean learned=entry!=null&&!entry.isNull("newWords");String kind=!inside?"outside":"休息".equals(status)?"rest":!learned?"empty":goal==0?"range":grade(entry.getDouble("newWords"),goal,goal);
                words.put(new JSONObject().put("id",id).put("name",s.getString("name")).put("goal",inside?goal:JSONObject.NULL).put("newWords",learned?entry.get("newWords"):JSONObject.NULL).put("reviewWords",entry!=null&&!entry.isNull("reviewWords")?entry.get("reviewWords"):JSONObject.NULL).put("kind",kind).put("label","range".equals(kind)?"未设置新学目标":label(kind)));continue;}
            if("仅回顾".equals(status)&&!("course-review".equals(id)&&"custom".equals(s.getString("kind"))))continue;
            selected++;Object r=value(plan,s,date);if(max(r)<=0)continue;targets++;lower+=min(r);upper+=max(r);legacy|=r instanceof Number;
            if(entry!=null&&!entry.isNull("minutes")){actual+=entry.getDouble("minutes");known++;}else missing++;
        }
        if("减量".equals(status)){lower*=.5;upper*=.5;}
        String kind=!inside?"outside":record==null?"empty":status.isEmpty()?"arrangement":"休息".equals(status)?"rest":"仅回顾".equals(status)&&selected==0?"review":targets==0||legacy?"range":missing>0?(known>0?"partial":"empty"):grade(actual,lower,upper);
        JSONObject time=new JSONObject().put("kind",kind).put("label",label(kind)).put("actual",known>0?actual:JSONObject.NULL).put("min",lower).put("max",upper).put("missing",missing).put("count",targets).put("scope","仅回顾".equals(status)?"课程复习":"学习时长").put("status",status.isEmpty()?JSONObject.NULL:status);
        if("above".equals(kind))time.put("excess",actual-upper);if("below".equals(kind))time.put("shortfall",lower-actual);
        return new JSONObject().put("time",time).put("words",words);
    }
}
