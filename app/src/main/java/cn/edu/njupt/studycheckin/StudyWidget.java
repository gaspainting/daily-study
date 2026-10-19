package cn.edu.njupt.studycheckin;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.util.Locale;

public final class StudyWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){updateAll(c,manager,ids);}
    public static void refreshAll(Context c){try{AppWidgetManager m=c.getSystemService(AppWidgetManager.class);updateAll(c,m,m.getAppWidgetIds(new ComponentName(c,StudyWidget.class)));}catch(Exception ignored){}}
    private static void updateAll(Context c,AppWidgetManager manager,int[] ids){
        if(ids.length==0)return;
        LocalDate now=LocalDate.now();JSONObject value=null;
        try{value=content(DataStore.readStable(c),now);}catch(Exception ignored){}
        for(int id:ids)update(c,manager,id,now,value);
    }
    private static String minutes(double v){return v>0&&v<1?"不足1":v==Math.floor(v)?String.format(Locale.ROOT,"%.0f",v):String.format(Locale.ROOT,"%.1f",v);}
    static JSONObject content(JSONObject state,LocalDate now)throws Exception{
        String day=now.toString();JSONObject p=state.getJSONObject("plan"),record=state.getJSONObject("records").optJSONObject(day),targets=p.getJSONObject("targets").optJSONObject(day);
        boolean inside=day.compareTo(p.getString("startDate"))>=0&&day.compareTo(p.getString("endDate"))<=0;JSONArray subjects=p.getJSONArray("subjects");StringBuilder text=new StringBuilder();int recorded=0,total=0,shown=0;
        for(int i=0;i<subjects.length();i++){
            JSONObject s=subjects.getJSONObject(i);String subjectId=s.getString("id");JSONObject actual=record==null?null:record.getJSONObject("subjects").optJSONObject(subjectId);
            boolean active=DataStore.activeSubject(s,now);
            if(!active&&!meaningful(actual))continue;
            total++;
            boolean known=actual!=null&&actual.has("minutes")&&!actual.isNull("minutes"),words="vocab".equals(s.getString("kind")),learned=actual!=null&&!actual.isNull("newWords"),reviewed=actual!=null&&!actual.isNull("reviewWords");if(known||words&&(learned||reviewed))recorded++;
            if(shown>=3)continue;
            String a=known?minutes(actual.getDouble("minutes"))+" 分钟":"未记录";
            Object ref=Reference.value(p,s,now);
            if(shown>0)text.append("\n");shown++;String name=s.getString("name");if(name.length()>10)name=name.substring(0,10)+"…";
            if(words){text.append(name).append("  新学 ").append(learned?actual.getInt("newWords")+" 个":"未记录").append(inside&&active?" / "+DataStore.wordTarget(state,day,subjectId)+" 个":"");text.append("\n复习 ").append(reviewed?actual.getInt("reviewWords")+" 个":"未记录");if(known)text.append(" · 时长 ").append(a);}
            else text.append(name).append("  ").append(a).append(!inside?" / 计划范围外":active?" / 参考 "+Reference.text(ref)+" 分钟":"");
        }
        if(total>3)text.append("\n另有 ").append(total-3).append(" 科");
        if(total==0)text.append("暂无科目");
        String status=recorded==0?"未记录":recorded+"/"+total+" 科目已记录";
        if(record!=null&&!record.isNull("status"))status+=" · "+("正常参考".equals(record.getString("status"))?"照常":"休息".equals(record.getString("status"))?"休息日":record.getString("status"));
        JSONObject assessed=Reference.assess(state,now).getJSONObject("time");String kind=assessed.getString("kind");
        if(kind.equals("below")||kind.equals("within")||kind.equals("above")||kind.equals("partial")){
            String assessmentLabel=assessed.getString("label");JSONObject basis=Reference.basis(state,now),current=Reference.capture(state,now,"current",null);
            if(!kind.equals("partial")&&!basis.getString("source").equals("current")&&(!basis.getJSONArray("time").toString().equals(current.getJSONArray("time").toString())||basis.getBoolean("inside")!=current.getBoolean("inside")))assessmentLabel="按原区间"+(kind.equals("within")?"完成":kind.equals("above")?"超额":"未完成");
            status+=" · "+assessmentLabel;
        }
        return new JSONObject().put("subjects",text.toString()).put("status",status).put("recorded",recorded).put("totalSubjects",total);
    }
    private static boolean meaningful(JSONObject record) throws Exception {
        if(record==null)return false;
        for(String field:new String[]{"minutes","newWords","reviewWords"})if(record.has(field)&&!record.isNull(field))return true;
        for(String field:new String[]{"content","problem","forgotWords"})if(!record.optString(field,"").isEmpty())return true;
        return false;
    }
    private static void update(Context c,AppWidgetManager manager,int id,LocalDate now,JSONObject value){
        RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.widget_study);
        v.setTextViewText(R.id.widget_date,now.getMonthValue()+"月"+now.getDayOfMonth()+"日 · 周"+"一二三四五六日".charAt(now.getDayOfWeek().getValue()-1));
        try{
            if(value==null)throw new Exception("记录读取失败");
            v.setTextViewText(R.id.widget_subjects,value.getString("subjects"));v.setTextViewText(R.id.widget_status,value.getString("status"));
        }catch(Exception e){v.setTextViewText(R.id.widget_subjects,"记录读取失败");v.setTextViewText(R.id.widget_status,"打开APP重试");}
        PendingIntent open=PendingIntent.getActivity(c,400+id,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root,open);v.setOnClickPendingIntent(R.id.widget_open,open);manager.updateAppWidget(id,v);
    }
}
