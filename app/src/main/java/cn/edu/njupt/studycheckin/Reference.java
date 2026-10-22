package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Set;
import java.util.HashSet;
import java.util.Iterator;

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
    private static boolean quantity(JSONObject subject){return "quantity".equals(subject.optString("measure"));}
    static int quantityTarget(JSONObject state,LocalDate date,JSONObject subject)throws Exception{JSONObject plan=state.getJSONObject("plan"),goals=plan.optJSONObject("quantityTargets"),daily=goals==null?null:goals.optJSONObject(date.toString());return daily!=null&&daily.has(subject.getString("id"))?daily.getInt(subject.getString("id")):subject.getJSONArray("defaults").getInt(date.getDayOfWeek().getValue()-1);}
    private static String grade(double actual,double min,double max){return actual<min-1e-9?"below":actual>max+1e-9?"above":"within";}
    private static String label(String kind){switch(kind){case "empty":return "未记录";case "arrangement":return "未选择安排";case "partial":return "待补全时长";case "range":return "未安排时长";case "review":return "未设置课程复习";case "outside":return "计划范围外";case "rest":return "休息日";case "below":return "未完成（不合格）";case "within":return "完成（合格）";case "above":return "超额完成";default:throw new IllegalArgumentException(kind);}}
    static String timestamp(){return DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC).format(Instant.now());}
    static JSONObject capture(JSONObject state,LocalDate date,String source,String at)throws Exception{
        JSONObject plan=state.getJSONObject("plan");JSONArray time=new JSONArray(),words=new JSONArray(),quantities=new JSONArray(),subjects=plan.getJSONArray("subjects");
        for(int i=0;i<subjects.length();i++){JSONObject s=subjects.getJSONObject(i);if(!DataStore.activeSubject(s,date))continue;String id=s.getString("id");JSONObject e=new JSONObject().put("id",id).put("name",s.getString("name"));
            if(s.getString("kind").equals("vocab")){e.put("goal",DataStore.wordTarget(state,date.toString(),id));words.put(e);}
            else if(quantity(s)){e.put("unit",s.getString("unit")).put("goal",quantityTarget(state,date,s));quantities.put(e);}
            else{Object ref=value(plan,s,date);e.put("kind",s.getString("kind")).put("reference",ref instanceof JSONObject?new JSONObject(ref.toString()):ref);time.put(e);}}
        return new JSONObject().put("rule",1).put("source",source).put("capturedAt",at==null?JSONObject.NULL:at).put("inside",date.toString().compareTo(plan.getString("startDate"))>=0&&date.toString().compareTo(plan.getString("endDate"))<=0).put("time",time).put("words",words).put("quantities",quantities);
    }
    static JSONObject basis(JSONObject state,LocalDate date)throws Exception{JSONObject bases=state.optJSONObject("assessmentBases"),saved=bases==null?null:bases.optJSONObject(date.toString());return saved==null?capture(state,date,"current",null):saved;}
    static String sourceLabel(String source){switch(source){case "record":return "保存时参考";case "existing":return "首次留存参考";case "recalculated":return "重评时参考";default:return "当前参考（未留存）";}}
    static void preserve(JSONObject previous,JSONObject next)throws Exception{
        next.put("version",Math.max(next.getInt("version"),5));JSONObject bases=next.optJSONObject("assessmentBases");if(bases==null){bases=new JSONObject();next.put("assessmentBases",bases);}JSONObject older=previous.optJSONObject("assessmentBases"),records=next.getJSONObject("records");String at=timestamp();Iterator<String> days=records.keys();
        while(days.hasNext()){String day=days.next();if(bases.has(day))continue;if(older!=null&&older.has(day))bases.put(day,new JSONObject(older.getJSONObject(day).toString()));else{boolean existed=previous.getJSONObject("records").has(day);bases.put(day,capture(existed?previous:next,LocalDate.parse(day),existed?"existing":"record",at));}}
    }
    private static void exact(JSONObject value,String... fields)throws Exception{if(value.length()!=fields.length)throw new Exception("评估依据字段无效");for(String key:fields)if(!value.has(key))throw new Exception("评估依据字段无效");}
    static void validateBasis(JSONObject b,Set<String> ids,Set<String> vocabIds)throws Exception{ validateBasis(b,ids,vocabIds,null); }
    static void validateBasis(JSONObject b,Set<String> ids,Set<String> vocabIds,Set<String> quantityIds)throws Exception{
        boolean hasQuantities=b.has("quantities");if(hasQuantities)exact(b,"rule","source","capturedAt","inside","time","words","quantities");else exact(b,"rule","source","capturedAt","inside","time","words");String source=b.optString("source"),at=b.optString("capturedAt");
        if(!(b.opt("rule") instanceof Number)||b.getDouble("rule")!=1||!(source.equals("record")||source.equals("existing")||source.equals("recalculated"))||!(b.opt("inside") instanceof Boolean)||!(b.opt("capturedAt") instanceof String)||!at.matches("\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{3}Z"))throw new Exception("评估依据版本或时间无效");
        Instant.parse(at);int year=LocalDate.parse(at.substring(0,10)).getYear();if(year<1900||year>2100)throw new Exception("评估依据时间超出范围");
        JSONArray time=b.getJSONArray("time"),words=b.getJSONArray("words"),quantities=hasQuantities?b.getJSONArray("quantities"):new JSONArray();if(time.length()+words.length()+quantities.length()>24)throw new Exception("评估依据科目无效");Set<String> seen=new HashSet<>();
        for(int which=0;which<3;which++){JSONArray entries=which==0?time:which==1?words:quantities;for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);if(which==0)exact(e,"id","name","kind","reference");else if(which==1)exact(e,"id","name","goal");else exact(e,"id","name","unit","goal");
            if(!(e.opt("id") instanceof String)||!ids.contains(e.getString("id"))||!seen.add(e.getString("id"))||!(e.opt("name") instanceof String)||e.getString("name").trim().isEmpty()||e.getString("name").length()>128||vocabIds.contains(e.getString("id"))!=(which==1))throw new Exception("评估依据科目无效");
            if(which==0){if(!( "math".equals(e.opt("kind"))||"custom".equals(e.opt("kind"))))throw new Exception("评估依据科目类型无效");validate(e.get("reference"),true);}
            else{Object goal=e.get("goal");if(which==2){String unit=e.optString("unit");if(unit.trim().isEmpty()||unit.length()>32||vocabIds.contains(e.getString("id"))||quantityIds!=null&&!quantityIds.contains(e.getString("id")))throw new Exception("评估依据数量科目无效");}if(!(goal instanceof Number)||!Double.isFinite(((Number)goal).doubleValue())||e.getDouble("goal")<0||e.getDouble("goal")>100000||Math.floor(e.getDouble("goal"))!=e.getDouble("goal"))throw new Exception("评估依据目标无效");}}}
    }
    private static final String UPGRADE_AT=timestamp();
    static void upgrade(JSONObject state,LocalDate now)throws Exception{
        JSONObject bases=state.optJSONObject("assessmentBases"),plan=state.getJSONObject("plan");if(bases==null)return;Iterator<String> days=bases.keys();
        while(days.hasNext()){String day=days.next();if(day.compareTo(now.toString())<0||day.compareTo(plan.getString("startDate"))<0||day.compareTo(plan.getString("endDate"))>0)continue;
            JSONObject old=bases.getJSONObject(day);JSONArray time=old.getJSONArray("time");boolean positive=false,legacy=false;
            for(int i=0;i<time.length();i++){Object r=time.getJSONObject(i).get("reference");positive|=max(r)>0;legacy|=r instanceof Number&&max(r)>0;}
            if(positive&&!legacy)continue;JSONObject next=capture(state,LocalDate.parse(day),"recalculated",UPGRADE_AT);JSONArray replacement=next.getJSONArray("time");boolean useful=false;
            for(int i=0;i<replacement.length();i++)useful|=max(replacement.getJSONObject(i).get("reference"))>0;
            if(useful){old.put("time",replacement).put("source","recalculated").put("capturedAt",UPGRADE_AT);}
        }
    }
    static JSONObject assess(JSONObject state,LocalDate date)throws Exception{
        JSONObject plan=state.getJSONObject("plan"),record=state.getJSONObject("records").optJSONObject(date.toString()),entries=record==null?new JSONObject():record.getJSONObject("subjects");
        JSONObject b=basis(state,date);String status=record==null||record.isNull("status")?"":record.getString("status");boolean inside=b.getBoolean("inside");
        JSONArray subjects=new JSONArray(),words=new JSONArray(),quantityResults=new JSONArray(),timeBasis=b.getJSONArray("time"),wordBasis=b.getJSONArray("words"),quantityBasis=b.optJSONArray("quantities");for(int i=0;i<timeBasis.length();i++)subjects.put(timeBasis.getJSONObject(i));for(int i=0;i<wordBasis.length();i++)subjects.put(new JSONObject(wordBasis.getJSONObject(i).toString()).put("kind","vocab"));double lower=0,upper=0,actual=0;int known=0,missing=0,targets=0,selected=0;
        for(int i=0;i<subjects.length();i++){
            JSONObject s=subjects.getJSONObject(i);String id=s.getString("id");JSONObject entry=entries.optJSONObject(id);
            if("vocab".equals(s.getString("kind"))){int goal=s.getInt("goal");boolean learned=entry!=null&&!entry.isNull("newWords");String kind=!inside?"outside":"休息".equals(status)?"rest":!learned?"empty":goal==0?"range":grade(entry.getDouble("newWords"),goal,goal);
                words.put(new JSONObject().put("id",id).put("name",s.getString("name")).put("goal",inside?goal:JSONObject.NULL).put("newWords",learned?entry.get("newWords"):JSONObject.NULL).put("reviewWords",entry!=null&&!entry.isNull("reviewWords")?entry.get("reviewWords"):JSONObject.NULL).put("kind",kind).put("label","range".equals(kind)?"未设置新学目标":label(kind)));continue;}
            if("仅回顾".equals(status)&&!("course-review".equals(id)&&"custom".equals(s.getString("kind"))))continue;
            selected++;Object r=s.get("reference");boolean written=entry!=null&&!entry.isNull("minutes");if(written){actual+=entry.getDouble("minutes");known++;}if(max(r)<=0)continue;targets++;lower+=min(r);upper+=max(r);if(!written)missing++;
        }
        if("减量".equals(status)){lower*=.5;upper*=.5;}
        String kind=!inside?"outside":record==null?"empty":status.isEmpty()?"arrangement":"休息".equals(status)?"rest":"仅回顾".equals(status)&&selected==0?"review":targets==0?"range":missing>0?(known>0?"partial":"empty"):grade(actual,lower,upper);
        JSONObject time=new JSONObject().put("kind",kind).put("label",label(kind)).put("actual",known>0?actual:JSONObject.NULL).put("min",lower).put("max",upper).put("missing",missing).put("count",targets).put("scope","仅回顾".equals(status)?"课程复习":"学习时长").put("status",status.isEmpty()?JSONObject.NULL:status);
        if("above".equals(kind))time.put("excess",actual-upper);if("below".equals(kind))time.put("shortfall",lower-actual);
        if(quantityBasis!=null)for(int i=0;i<quantityBasis.length();i++){JSONObject q=quantityBasis.getJSONObject(i),entry=entries.optJSONObject(q.getString("id"));int goal=q.getInt("goal"),actualQ=entry==null||entry.isNull("quantity")?-1:entry.getInt("quantity");String qkind=!inside?"outside":"休息".equals(status)?"rest":"仅回顾".equals(status)?"review":actualQ<0?"empty":goal==0?"range":grade(actualQ,"减量".equals(status)?goal*.5:goal,"减量".equals(status)?goal*.5:goal);if("减量".equals(status))goal=(int)Math.round(goal*.5);quantityResults.put(new JSONObject().put("id",q.getString("id")).put("name",q.getString("name")).put("unit",q.getString("unit")).put("goal",inside?goal:JSONObject.NULL).put("quantity",actualQ<0?JSONObject.NULL:actualQ).put("kind",qkind).put("label","range".equals(qkind)?"未设置数量目标":"review".equals(qkind)?"仅回顾":label(qkind)));}
        return new JSONObject().put("time",time).put("words",words).put("quantities",quantityResults).put("basis",new JSONObject().put("saved",!b.getString("source").equals("current")).put("source",b.get("source")).put("capturedAt",b.get("capturedAt")).put("rule",b.get("rule")));
    }
}
