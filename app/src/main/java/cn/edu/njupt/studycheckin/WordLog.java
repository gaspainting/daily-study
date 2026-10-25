package cn.edu.njupt.studycheckin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/** Validates word events and replays the same aggregate as the WebView. */
final class WordLog {
    private WordLog() {}
    private static void require(boolean ok,String message)throws Exception{if(!ok)throw new Exception(message);}
    private static void keys(JSONObject value,String[] required,String... optional)throws Exception{
        require(value!=null,"单词明细格式无效");
        for(String key:required)require(value.has(key),"单词明细字段缺失");
        Set<String> allowed=new HashSet<>(Arrays.asList(required));allowed.addAll(Arrays.asList(optional));
        Iterator<String> it=value.keys();while(it.hasNext())require(allowed.contains(it.next()),"单词明细字段无效");
    }
    private static Integer count(Object value,boolean nullable)throws Exception{
        if(nullable&&value==JSONObject.NULL)return null;
        require(value instanceof Number,"单词数量须为整数");double n=((Number)value).doubleValue();
        require(Double.isFinite(n)&&n>=0&&n<=100000&&n==Math.rint(n),"单词数量须为 0 至 100000 的整数");return (int)n;
    }
    private static void timestamp(Object value)throws Exception{
        require(value instanceof String,"单词记录时间无效");String text=(String)value;
        require(text.matches("\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$"),"单词记录时间无效");
        LocalDate day=LocalDate.parse(text.substring(0,10));require(day.getYear()>=1900&&day.getYear()<=2100,"单词记录日期无效");
        int end=text.endsWith("Z")?text.length()-1:text.length()-6;
        LocalDateTime.parse(text.substring(0,end));
    }
    static JSONObject totals(JSONObject log)throws Exception{
        keys(log,new String[]{"base","entries"});JSONObject base=log.getJSONObject("base");keys(base,new String[]{"newWords","reviewWords"});
        Integer learned=count(base.get("newWords"),true),reviewed=count(base.get("reviewWords"),true);
        JSONArray entries=log.getJSONArray("entries");require(entries.length()<=1000,"每天每科最多记录 1000 条单词明细");Set<String> seen=new HashSet<>();
        for(int i=0;i<entries.length();i++){
            JSONObject e=entries.getJSONObject(i);keys(e,new String[]{"id","kind","operation","count","at","source"},"editedAt");
            Object identifier=e.get("id");require(identifier instanceof String&&((String)identifier).matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")&&seen.add((String)identifier),"单词明细标识无效或重复");
            Object kind=e.get("kind"),operation=e.get("operation"),source=e.get("source");
            require(("new".equals(kind)||"review".equals(kind))&&("add".equals(operation)||"set".equals(operation))&&("quick".equals(source)||"manual".equals(source)),"单词明细类型无效");
            timestamp(e.get("at"));if(e.has("editedAt"))timestamp(e.get("editedAt"));
            Integer n=count(e.get("count"),"set".equals(operation));require(!"add".equals(operation)||n!=null&&n>0,"单词累加数量须大于 0");require(!"quick".equals(source)||"add".equals(operation),"单词明细来源无效");
            Integer before="new".equals(kind)?learned:reviewed,after;
            if("set".equals(operation))after=n;else after=(before==null?0:before)+n;
            require(after==null||after<=100000,"单词数量超过 100000");if("new".equals(kind))learned=after;else reviewed=after;
        }
        return new JSONObject().put("newWords",learned==null?JSONObject.NULL:learned).put("reviewWords",reviewed==null?JSONObject.NULL:reviewed);
    }
    static void validate(JSONObject log,JSONObject record)throws Exception{
        JSONObject total=totals(log);
        for(String field:new String[]{"newWords","reviewWords"}){
            Integer a=count(total.get(field),true),b=count(record.get(field),true);
            require(a==null?b==null:a.equals(b),"单词明细与每日总数不一致");
        }
    }
}
