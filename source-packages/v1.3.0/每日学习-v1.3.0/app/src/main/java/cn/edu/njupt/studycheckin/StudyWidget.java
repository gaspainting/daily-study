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
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){for(int id:ids)update(c,manager,id);}
    public static void refreshAll(Context c){try{AppWidgetManager m=c.getSystemService(AppWidgetManager.class);for(int id:m.getAppWidgetIds(new ComponentName(c,StudyWidget.class)))update(c,m,id);}catch(Exception ignored){}}
    private static String minutes(double v){return v>0&&v<1?"不足1":v==Math.floor(v)?String.format(Locale.ROOT,"%.0f",v):String.format(Locale.ROOT,"%.1f",v);}
    static JSONObject content(JSONObject state,LocalDate now)throws Exception{
        String day=now.toString();JSONObject p=state.getJSONObject("plan"),record=state.getJSONObject("records").optJSONObject(day),targets=p.getJSONObject("targets").optJSONObject(day);
        boolean inside=day.compareTo(p.getString("startDate"))>=0&&day.compareTo(p.getString("endDate"))<=0;JSONArray subjects=p.getJSONArray("subjects");StringBuilder text=new StringBuilder();int recorded=0;
        for(int i=0;i<subjects.length();i++){
            JSONObject s=subjects.getJSONObject(i);String subjectId=s.getString("id");JSONObject actual=record==null?null:record.getJSONObject("subjects").optJSONObject(subjectId);
            boolean known=actual!=null&&actual.has("minutes")&&!actual.isNull("minutes");if(known)recorded++;
            if(i>=3)continue;
            String a=known?minutes(actual.getDouble("minutes"))+" 分钟":"未记录";
            double ref=targets!=null&&targets.has(subjectId)?targets.getDouble(subjectId):s.getJSONArray("defaults").getDouble(now.getDayOfWeek().getValue()-1);
            if(i>0)text.append("\n");String name=s.getString("name");if(name.length()>10)name=name.substring(0,10)+"…";
            text.append(name).append("  ").append(a).append(inside?" / 参考 "+minutes(ref)+" 分钟":" / 计划范围外");
        }
        if(subjects.length()>3)text.append("\n另有 ").append(subjects.length()-3).append(" 科");
        String status=recorded==0?"未记录":recorded+"/"+subjects.length()+" 科目已记录";
        if(record!=null&&!record.isNull("status"))status+=" · "+("正常参考".equals(record.getString("status"))?"照常":record.getString("status"));
        return new JSONObject().put("subjects",text.toString()).put("status",status).put("recorded",recorded);
    }
    private static void update(Context c,AppWidgetManager manager,int id){
        RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.widget_study);LocalDate now=LocalDate.now();String day=now.toString();
        v.setTextViewText(R.id.widget_date,now.getMonthValue()+"月"+now.getDayOfMonth()+"日 · 周"+"一二三四五六日".charAt(now.getDayOfWeek().getValue()-1));
        try{
            JSONObject content=content(DataStore.load(c),now);
            v.setTextViewText(R.id.widget_subjects,content.getString("subjects"));v.setTextViewText(R.id.widget_status,content.getString("status"));
        }catch(Exception e){v.setTextViewText(R.id.widget_subjects,"记录读取失败");v.setTextViewText(R.id.widget_status,"打开APP重试");}
        PendingIntent open=PendingIntent.getActivity(c,400+id,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root,open);v.setOnClickPendingIntent(R.id.widget_open,open);manager.updateAppWidget(id,v);
    }
}
