package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.Intent;
import android.appwidget.AppWidgetManager;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** Presentation contracts using real Android JSON, widget and export code. No release test hooks. */
final class ReleasePolishTests {
    private static void check(List<String> passes,boolean condition,String name)throws Exception{if(!condition)throw new Exception("FAIL: "+name);passes.add(name);}
    private static JSONObject subject(Object value)throws Exception{return new JSONObject().put("minutes",value).put("content","").put("problem","").put("newWords",JSONObject.NULL).put("reviewWords",JSONObject.NULL).put("forgotWords","");}
    static void run(Context c,List<String> passes)throws Exception{
        JSONObject state=new JSONObject(DataStore.readText(c.getAssets().open("seed.json")));LocalDate day=LocalDate.of(2026,10,14);
        JSONObject r=new JSONObject().put("subjects",new JSONObject().put("math",subject(JSONObject.NULL)).put("vocab",subject(JSONObject.NULL))).put("status",JSONObject.NULL).put("restKept",JSONObject.NULL).put("note","");
        state.getJSONObject("records").put(day.toString(),r);
        JSONObject view=StudyWidget.content(state,day);
        check(passes,view.getInt("recorded")==0&&view.getString("status").equals("未记录"),"widget both unknown has no zero or inferred daily outcome");
        r.getJSONObject("subjects").getJSONObject("vocab").put("minutes",0);view=StudyWidget.content(state,day);
        check(passes,view.getString("status").equals("1/2 科目已记录"),"widget zero plus unknown remains partial record");
        check(passes,view.getString("subjects").contains("0 分钟")&&view.getString("subjects").contains("未记录"),"widget exposes explicit zero and unknown separately");
        r.put("status","休息");String before=state.toString();view=StudyWidget.content(state,day);
        check(passes,view.getString("status").equals("1/2 科目已记录 · 休息")&&before.equals(state.toString()),"rest status does not fill or alter actual values");
        r.getJSONObject("subjects").getJSONObject("math").put("minutes",0);view=StudyWidget.content(state,day);
        check(passes,view.getInt("recorded")==2&&view.getString("status").startsWith("2/2"),"widget two explicit zeros count as two records");
        r.getJSONObject("subjects").getJSONObject("math").put("minutes",12.5);r.put("status","正常参考");view=StudyWidget.content(state,day);
        check(passes,view.getString("subjects").contains("12.5 分钟")&&view.getString("status").endsWith("照常"),"widget shows real fraction and maps enum only for display");
        check(passes,r.getString("status").equals("正常参考"),"widget display label leaves stored enum unchanged");
        JSONObject card=InspirationStore.baseCard("test-attribution","quote","en","中文释义","原创").put("textId","hitokoto:test").put("textSource","句子出处").put("textAuthor","文字作者").put("textPage","https://example.org/words").put("imageSource","图片来源").put("imageAuthor","摄影师").put("imageTitle","作品名称").put("imagePage","https://example.org/photo").put("imageLicense","CC0").put("translationSource","译者");
        String export=InspirationPoster.textForExport(card);
        check(passes,export.contains("文字：文字作者 · 句子出处")&&export.contains("图片：摄影师 · 图片来源"),"poster text distinguishes quote and picture authors");
        check(passes,export.contains("CC0")&&export.contains("中文释义")&&export.contains("释义：译者"),"poster and share text retain license and translation");
        check(passes,!export.contains("含AI辅助原创内容")&&!export.contains("联网图片，本地留存"),"poster has no generic originality or cache explanation");
        card.put("textAuthor","");export=InspirationPoster.textForExport(card);
        check(passes,export.contains("文字：句子出处")&&!export.contains("佚名")&&!export.contains("文字：每日学习"),"missing author is not fabricated from source category");
        card.put("textId","original_1").put("textAuthor","每日学习").put("textSource","每日学习原创文字（AI辅助）").put("ai",true);export=InspirationPoster.textForExport(card);
        check(passes,export.contains("文字：每日学习 · 每日学习原创文字（AI辅助）")&&export.contains("图片：摄影师"),"AI assistance is assigned to words without claiming picture authorship");
        check(passes,!WidgetPinReceiver.verified(c,null)&&!WidgetPinReceiver.verified(c,new Intent(WidgetPinReceiver.ACTION)),"widget success callback without real widget ID is rejected");
        check(passes,!WidgetPinReceiver.verified(c,new Intent("other").putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,1)),"widget success callback wrong action is rejected");
        check(passes,AppRules.allowed(LocalDateTime.of(2026,10,18,18,59))&&!AppRules.allowed(LocalDateTime.of(2026,10,18,19,0)),"weekend end boundary remains eighteen fifty nine versus nineteen");
        check(passes,AppRules.allowed(LocalDateTime.of(2026,10,19,0,0))&&!AppRules.allowed(LocalDateTime.of(2026,10,18,0,0)),"weekend rule is not widened across Monday");
        check(passes,AppRules.restReason(LocalDateTime.of(2026,10,17,9,29)).contains("09:30")&&AppRules.restReason(LocalDateTime.of(2026,10,17,19,0)).contains("19:00"),"timer refusal explains the actual weekend boundary");
        check(passes,AppRules.restReason(LocalDateTime.of(2026,10,14,20,30)).contains("20:30"),"timer refusal explains the actual weekday boundary");
        DataStore.validate(state);
    }
}
