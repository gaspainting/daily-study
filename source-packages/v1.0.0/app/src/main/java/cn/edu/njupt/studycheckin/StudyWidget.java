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
    private static void update(Context c,AppWidgetManager manager,int id){
        RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.widget_study);LocalDate now=LocalDate.now();String day=now.toString();
        v.setTextViewText(R.id.widget_date,now.getMonthValue()+"月"+now.getDayOfMonth()+"日 · 周"+"一二三四五六日".charAt(now.getDayOfWeek().getValue()-1));
        try{
            JSONObject state=DataStore.load(c),p=state.getJSONObject("plan"),record=state.getJSONObject("records").optJSONObject(day),targets=p.getJSONObject("targets").optJSONObject(day);
            boolean inside=day.compareTo(p.getString("startDate"))>=0&&day.compareTo(p.getString("endDate"))<=0;JSONArray subjects=p.getJSONArray("subjects");StringBuilder text=new StringBuilder();
            for(int i=0;i<Math.min(subjects.length(),3);i++){
                JSONObject s=subjects.getJSONObject(i);String subjectId=s.getString("id");JSONObject actual=record==null?null:record.getJSONObject("subjects").optJSONObject(subjectId);
                String a=actual==null||actual.isNull("minutes")?"未记录":minutes(actual.getDouble("minutes"))+"分";
                double ref=targets!=null&&targets.has(subjectId)?targets.getDouble(subjectId):s.getJSONArray("defaults").getDouble(now.getDayOfWeek().getValue()-1);
                if(i>0)text.append("\n");String name=s.getString("name");if(name.length()>10)name=name.substring(0,10)+"…";
                text.append(name).append("  ").append(a).append(inside?" / 参考"+minutes(ref)+"分":" / 计划范围外");
            }
            if(subjects.length()>3)text.append("\n另有").append(subjects.length()-3).append("科，打开查看");
            v.setTextViewText(R.id.widget_subjects,text.toString());String status=record==null||record.isNull("status")?"按今天的状态慢慢来":record.getString("status");v.setTextViewText(R.id.widget_status,status);
        }catch(Exception e){v.setTextViewText(R.id.widget_subjects,"打开APP核对本地记录");v.setTextViewText(R.id.widget_status,"记录未被替换");}
        PendingIntent open=PendingIntent.getActivity(c,400+id,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root,open);v.setOnClickPendingIntent(R.id.widget_open,open);manager.updateAppWidget(id,v);
    }
}
