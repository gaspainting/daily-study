package cn.edu.njupt.studycheckin;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/** A request alone is not success. Only a verified launcher callback reports addition. */
public final class WidgetPinReceiver extends BroadcastReceiver {
    public static final String ACTION="cn.edu.njupt.studycheckin.WIDGET_PINNED";
    static boolean verified(Context c,Intent intent){
        if(intent==null||!ACTION.equals(intent.getAction()))return false;
        int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
        if(id==AppWidgetManager.INVALID_APPWIDGET_ID)return false;
        AppWidgetProviderInfo info=c.getSystemService(AppWidgetManager.class).getAppWidgetInfo(id);
        return info!=null&&new ComponentName(c,StudyWidget.class).equals(info.provider);
    }
    @Override public void onReceive(Context c,Intent intent){
        if(!verified(c,intent))return;
        StudyWidget.refreshAll(c);
        android.util.Log.i("DailyStudyWidget","Widget pin confirmed: "+intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,-1));
        Toast.makeText(c,"已添加到桌面",Toast.LENGTH_SHORT).show();
    }
}
