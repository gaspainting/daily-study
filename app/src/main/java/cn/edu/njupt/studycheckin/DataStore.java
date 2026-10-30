package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.Arrays;

/** Private, atomic, versioned storage. Unknown/blank records are never converted to zero. */
public final class DataStore {
    public static final Object LOCK = new Object();
    public static final int MAX_BYTES = 4 * 1024 * 1024;
    private DataStore() {}
    private static AtomicFile file(Context c) { return new AtomicFile(new File(c.getFilesDir(), "study-state.json")); }
    static void requireNoPendingRecovery(Context c)throws Exception{
        for(String name:new String[]{"plan-switch-journal.json","restore-journal.json"})
            if(new File(c.getFilesDir(),name).exists()||new File(c.getFilesDir(),name+".bak").exists())throw new Exception("上次恢复未完成，请打开APP重新读取");
    }
    public static JSONObject readStable(Context c){
        synchronized(LOCK){try{requireNoPendingRecovery(c);return load(c);}catch(Exception e){throw new IllegalStateException(e.getMessage(),e);}}
    }
    public static String readText(InputStream in) throws Exception {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = stream.read(buffer)) != -1) {
                if (out.size() + n > MAX_BYTES) throw new Exception("文件超过4MB，请使用本应用导出的备份");
                out.write(buffer, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    public static JSONObject load(Context c) {
        synchronized (LOCK) {
            try {
                AtomicFile af = file(c);
                JSONObject state;
                if (af.getBaseFile().exists() || new File(af.getBaseFile().getPath()+".bak").exists()) {
                    state = new JSONObject(readText(af.openRead()));
                } else {
                    state = new JSONObject(readText(c.getAssets().open("seed.json")));
                }
                migrateInPlace(state);return state;
            } catch (Exception e) { throw new IllegalStateException("本地记录读取失败，未覆盖原文件："+e.getMessage(), e); }
        }
    }
    public static JSONObject readForUi(Context c)throws Exception {
        synchronized(LOCK){
            requireNoPendingRecovery(c);AtomicFile af=file(c);JSONObject state;
            if(af.getBaseFile().exists()||new File(af.getBaseFile().getPath()+".bak").exists())state=new JSONObject(readText(af.openRead()));else state=new JSONObject(readText(c.getAssets().open("seed.json")));
            int originalVersion=state.optInt("version");migrateInPlace(state);Evaluation.Clock clock=Evaluation.clock(state);JSONObject e=state.getJSONObject("evaluation");boolean dayChanged=clock.today.compareTo(e.getString("highWaterDate"))>0;if(dayChanged)e.put("highWaterDate",clock.today);
            if(originalVersion<9||dayChanged)write(c,state,state.optLong("_revision",0)+1);return state;
        }
    }
    public static void ensureEvaluationState(Context c)throws Exception {readForUi(c);}
    public static long saveEvaluationSchedule(Context c,JSONObject command)throws Exception {
        synchronized(LOCK){requireNoPendingRecovery(c);JSONObject previous=load(c);if(command.getLong("expectedRevision")!=previous.optLong("_revision",0))throw new Exception("记录已更新，请重新打开日程");JSONObject next=Evaluation.scheduleChange(previous,command,Evaluation.clock(previous));validate(next);long revision=previous.optLong("_revision",0)+1;write(c,next,revision);return revision;}
    }
    public static void save(Context c,JSONObject state)throws Exception{save(c,state,false);}
    public static void saveFromBridge(Context c,JSONObject state)throws Exception{save(c,state,true);}
    private static void save(Context c,JSONObject state,boolean checkRevision)throws Exception{
        synchronized(LOCK){migrateInPlace(state);JSONObject previous=load(c);if(checkRevision&&state.optLong("_revision",0)!=previous.optLong("_revision",0))throw new Exception("记录已更新，请刷新后再保存；当前编辑仍保留");Reference.preserve(previous,state);Evaluation.requireTimeCorrections(previous,state);Evaluation.reconcile(previous,state,Evaluation.clock(previous));validate(state);write(c,state,previous.optLong("_revision",0)+1);}
    }
    public static void restore(Context c, JSONObject state) throws Exception {
        synchronized (LOCK) {
            migrateInPlace(state);
            long next=1;
            try {next=load(c).optLong("_revision",0)+1;} catch(IllegalStateException ignored) {}
            write(c,state,next);
        }
    }
    private static void write(Context c,JSONObject state,long next) throws Exception {
            require(next<=9007199254740991L,"数据版本超出范围，请导出备份后恢复");
            state.put("_revision", next);
            byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_BYTES) throw new Exception("记录超过4MB，请先导出备份");
            AtomicFile af = file(c); FileOutputStream out = null;
            try { out = af.startWrite(); out.write(bytes); out.getFD().sync(); af.finishWrite(out); out = null; if (!Arrays.equals(bytes, readText(af.openRead()).getBytes(StandardCharsets.UTF_8))) throw new java.io.IOException("记录写入校验失败，请重试"); }
            catch (Exception e) { if (out != null) af.failWrite(out); throw e; }
    }
    private static void require(boolean yes, String reason) throws Exception { if (!yes) throw new Exception(reason); }
    private static void manualIds(JSONArray list,JSONArray subjects,Set<String> ids,Set<String> vocabIds)throws Exception{
        require(list.length()<=24,"手动参考标记无效");Set<String> seen=new HashSet<>();
        for(int i=0;i<list.length();i++){Object value=list.get(i);require(value instanceof String&&ids.contains(value),"手动参考科目无效");String id=(String)value;require(seen.add(id)&&!vocabIds.contains(id)&&!"quantity".equals(subjects.getJSONObject(indexOf(subjects,id)).optString("measure")),"手动参考科目无效");}
    }
    private static int indexOf(JSONArray subjects,String id) throws Exception { for(int i=0;i<subjects.length();i++) if(id.equals(subjects.getJSONObject(i).optString("id"))) return i; throw new Exception("科目不存在"); }
    private static void keys(JSONObject o,String[] required,String[] optional,String name) throws Exception {
        Set<String> allowed=new HashSet<>(Arrays.asList(required));allowed.addAll(Arrays.asList(optional));
        for(String key:required)require(o.has(key),name+"缺少字段"+key);
        Iterator<String> it=o.keys();while(it.hasNext()){String key=it.next();require(allowed.contains(key)&&!key.equals("__proto__")&&!key.equals("constructor")&&!key.equals("prototype"),name+"含未知字段"+key);}
    }
    private static String string(JSONObject o, String key, int max) throws Exception {
        Object v = o.opt(key); require(v instanceof String && ((String)v).length() <= max, "文字字段无效："+key); return (String)v;
    }
    private static LocalDate date(String value) throws Exception {
        require(value != null && value.matches("\\d{4}-\\d{2}-\\d{2}"), "日期格式应为YYYY-MM-DD");
        LocalDate d = LocalDate.parse(value);
        require(d.getYear() >= 1900 && d.getYear() <= 2100, "日期超出支持范围"); return d;
    }
    private static void number(Object v, double max, boolean integer, boolean nullable, String name) throws Exception {
        if (nullable && (v == null || v == JSONObject.NULL)) return;
        require(v instanceof Number, name+"应为数字或留空");
        double n = ((Number)v).doubleValue();
        require(!Double.isNaN(n) && !Double.isInfinite(n) && n >= 0 && n <= max && (!integer || Math.floor(n)==n), name+"超出范围");
    }
    private static void nullableBool(Object v, String name) throws Exception {
        require(v == null || v == JSONObject.NULL || v instanceof Boolean, name+"应为是/否/未填写");
    }
    private static void texts(JSONObject obj, int max) throws Exception {
        Iterator<String> keys = obj.keys();
        while (keys.hasNext()) { String key=keys.next(); date(key); string(obj,key,max); }
    }
    public static void validate(JSONObject state) throws Exception {
        keys(state,state.optInt("version")>=9?new String[]{"version","plan","records","reviews","settings","evaluation"}:new String[]{"version","plan","records","reviews","settings"},state.optInt("version")>=6?new String[]{"sessions","_revision","assessmentBases","courseReviews"}:state.optInt("version")>=5?new String[]{"sessions","_revision","assessmentBases"}:new String[]{"sessions","_revision"},"state");
        require(state != null && state.opt("version") instanceof Number && (state.getDouble("version")==1 || state.getDouble("version")==2 || state.getDouble("version")==3 || state.getDouble("version")==4 || state.getDouble("version")==5 || state.getDouble("version")==6 || state.getDouble("version")==7 || state.getDouble("version")==8 || state.getDouble("version")==9), "备份版本不支持");
        boolean current=state.getInt("version")>=2;
        if(state.has("_revision"))number(state.get("_revision"),9007199254740991d,true,false,"数据版本");
        JSONObject p = state.getJSONObject("plan");
        keys(p,new String[]{"title","startDate","endDate","startWeek","subjects","targets","weekGoals","weekHints"},state.getInt("version")>=8?new String[]{"wordTargets","manualWeekGoals","weekTasks","courseSchedule","quantityTargets","manualReferences","manualReferenceDefaults","quantityUnits"}:state.getInt("version")>=6?new String[]{"wordTargets","manualWeekGoals","weekTasks","courseSchedule","quantityTargets"}:state.getInt("version")>=3?new String[]{"wordTargets","manualWeekGoals","weekTasks"}:current?new String[]{"wordTargets","manualWeekGoals"}:new String[]{},"plan");
        require(!string(p,"title",128).trim().isEmpty(),"计划名不能为空");
        LocalDate start=date(string(p,"startDate",10)), end=date(string(p,"endDate",10));
        long days = ChronoUnit.DAYS.between(start,end)+1;
        require(days >= 1 && days <= 730, "计划需为1至730天");
        number(p.opt("startWeek"),999,true,false,"起始教学周"); require(p.getInt("startWeek")>=1,"教学周从1开始");
        JSONArray subjects = p.getJSONArray("subjects");
        require(subjects.length()>=1 && subjects.length()<=24,"科目数量需为1至24个");
        Set<String> ids = new HashSet<>(), vocabIds = new HashSet<>();
        for (int i=0;i<subjects.length();i++) {
            JSONObject s=subjects.getJSONObject(i); String id=string(s,"id",64);
            keys(s,new String[]{"id","name","kind","defaults"},current?new String[]{"activePeriods","wordGoal","wordSteps","measure","unit"}:new String[]{},"subject");
            require(id.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") && !id.equals("__proto__") && !id.equals("constructor") && !id.equals("prototype") && ids.add(id),"科目ID重复或无效");
            String name=string(s,"name",128); require(!name.trim().isEmpty(),"科目名不能为空");
            String kind=string(s,"kind",16); require(kind.equals("math")||kind.equals("vocab")||kind.equals("custom"),"科目类型无效");
            if(kind.equals("vocab"))vocabIds.add(id);
            if(s.has("wordGoal")){require(kind.equals("vocab"),"词数目标仅用于单词");number(s.get("wordGoal"),100000,true,false,"每日新学目标");}
            if(s.has("wordSteps")){require(kind.equals("vocab"),"快捷加数仅用于单词");JSONArray steps=s.getJSONArray("wordSteps");require(steps.length()==3,"快捷加数须为三个正整数");Set<Integer> seenSteps=new HashSet<>();for(int j=0;j<steps.length();j++){number(steps.get(j),100000,true,false,"快捷加数");require(steps.getInt(j)>=1&&seenSteps.add(steps.getInt(j)),"快捷加数须大于0且不能重复");}}
            boolean quantity="quantity".equals(s.optString("measure"));
            if(s.has("measure"))require(quantity,"科目计量方式无效");
            if(quantity){require(kind.equals("custom"),"数量科目须为自定义科目");String unit=string(s,"unit",32);require(!unit.trim().isEmpty(),"数量科目单位不能为空");}
            else require(!s.has("unit"),"分钟科目不能设置单位");
            JSONArray defaults=s.getJSONArray("defaults"); require(defaults.length()==7,"每日参考需为7个数字");
            for(int j=0;j<7;j++) {if(quantity){number(defaults.get(j),100000,true,false,"数量目标");}else Reference.validate(defaults.get(j),state.getInt("version")>=4&&!kind.equals("vocab"));}
            if(s.has("activePeriods")) {
                JSONArray periods=s.getJSONArray("activePeriods");require(periods.length()<=1000,"科目启用时段过多");LocalDate previous=null;
                for(int j=0;j<periods.length();j++) {JSONObject period=periods.getJSONObject(j);keys(period,new String[]{"from","to"},new String[]{},"activePeriod");LocalDate from=date(string(period,"from",10));LocalDate to=period.isNull("to")?null:date(string(period,"to",10));require(to==null||to.isAfter(from),"科目启用时段结束日期无效");require(j==0||previous!=null&&!from.isBefore(previous),"科目启用时段重叠或顺序无效");previous=to;}
            }
        }
        if(p.has("quantityUnits")){JSONObject units=p.getJSONObject("quantityUnits");require(units.length()<=100000,"数量单位日期过多");Iterator<String> dates=units.keys();while(dates.hasNext()){String day=dates.next();date(day);JSONObject row=units.getJSONObject(day);Iterator<String> names=row.keys();while(names.hasNext()){String id=names.next();require(ids.contains(id)&&"quantity".equals(subjects.getJSONObject(indexOf(subjects,id)).optString("measure")),"数量单位科目无效");require(!string(row,id,32).trim().isEmpty(),"数量单位不能为空");}}}
        if(p.has("manualReferenceDefaults"))manualIds(p.getJSONArray("manualReferenceDefaults"),subjects,ids,vocabIds);
        if(p.has("manualReferences")){JSONObject marked=p.getJSONObject("manualReferences");require(marked.length()<=100000,"手动参考日期过多");Iterator<String> it=marked.keys();while(it.hasNext()){String d=it.next();date(d);manualIds(marked.getJSONArray(d),subjects,ids,vocabIds);}}
        JSONObject targets=p.getJSONObject("targets"); Iterator<String> dates=targets.keys();
        while(dates.hasNext()) { String day=dates.next(); date(day); JSONObject t=targets.getJSONObject(day); Iterator<String> ss=t.keys();
            while(ss.hasNext()) {String id=ss.next();require(ids.contains(id),"参考量科目不存在");require(!"quantity".equals(subjects.getJSONObject(indexOf(subjects,id)).optString("measure")),"数量科目应使用数量目标"); Reference.validate(t.get(id),state.getInt("version")>=4&&!vocabIds.contains(id));}
        }
        if(p.has("quantityTargets")){JSONObject quantities=p.getJSONObject("quantityTargets");require(quantities.length()<=100000,"数量目标日期过多");Iterator<String> qd=quantities.keys();while(qd.hasNext()){String day=qd.next();date(day);JSONObject goals=quantities.getJSONObject(day);Iterator<String> qi=goals.keys();while(qi.hasNext()){String id=qi.next();require(ids.contains(id)&&"quantity".equals(subjects.getJSONObject(indexOf(subjects,id)).optString("measure")),"数量目标科目无效");number(goals.get(id),100000,true,false,"数量目标");}}}
        if(p.has("manualWeekGoals"))require(Boolean.TRUE.equals(p.get("manualWeekGoals")),"周目标模式无效");
        if(p.has("wordTargets")){JSONObject words=p.getJSONObject("wordTargets");require(words.length()<=100000,"词数目标日期过多");Iterator<String> wd=words.keys();while(wd.hasNext()){String day=wd.next();date(day);JSONObject goals=words.getJSONObject(day);Iterator<String> wi=goals.keys();while(wi.hasNext()){String id=wi.next();require(vocabIds.contains(id),"词数目标科目无效");number(goals.get(id),100000,true,false,"新学目标");}}}
        texts(p.getJSONObject("weekGoals"),8000); texts(p.getJSONObject("weekHints"),8000);
        WeeklyGoals.validate(p);Courses.validate(state);
        JSONObject records=state.getJSONObject("records"); Iterator<String> rd=records.keys();
        while(rd.hasNext()) {
            String day=rd.next();date(day);JSONObject r=records.getJSONObject(day);
            keys(r,new String[]{"subjects","status","restKept","note"},state.getInt("version")>=9?new String[]{"sessions","timeCorrections"}:new String[]{"sessions"},"record");
            Object status=r.opt("status");require(status==null||status==JSONObject.NULL||"正常参考".equals(status)||"减量".equals(status)||"仅回顾".equals(status)||"休息".equals(status),"当天状态无效");
            nullableBool(r.opt("restKept"),"休息边界"); if(r.has("note")) string(r,"note",8000);
            JSONObject subjectRecords=r.getJSONObject("subjects");Iterator<String> rs=subjectRecords.keys();
            while(rs.hasNext()) {String id=rs.next();require(ids.contains(id),"记录科目不存在");JSONObject s=subjectRecords.getJSONObject(id);
                keys(s,new String[]{"minutes","content","problem","newWords","reviewWords","forgotWords"},state.getInt("version")>=7?new String[]{"quantity","quantityUnit","wordLog"}:new String[]{"quantity","quantityUnit"},"record subject");
                number(s.opt("minutes"),1440,false,true,"实际分钟");
                if(s.has("quantity")){require("quantity".equals(subjects.getJSONObject(indexOf(subjects,id)).optString("measure")),"数量记录仅用于数量科目");number(s.opt("quantity"),100000,true,true,"实际数量");}
                if(s.has("quantityUnit")){String unit=string(s,"quantityUnit",32);require(!unit.trim().isEmpty(),"数量单位不能为空");}
                if("quantity".equals(subjects.getJSONObject(indexOf(subjects,id)).optString("measure"))&&!s.isNull("quantity")&&(!s.has("quantityUnit")||s.optString("quantityUnit").trim().isEmpty()))throw new Exception("数量记录缺少单位");
                for(String key:new String[]{"content","problem","forgotWords"}) if(s.has(key)) string(s,key,8000);
                number(s.opt("newWords"),100000,true,true,"新学词数"); number(s.opt("reviewWords"),100000,true,true,"复习词数");
                if(s.has("wordLog")){require(vocabIds.contains(id),"单词明细仅用于单词科目");WordLog.validate(s.getJSONObject("wordLog"),s);}
            }
            if(r.has("sessions"))sessions(r.getJSONArray("sessions"),ids);
            if(r.has("timeCorrections")){JSONObject corrections=r.getJSONObject("timeCorrections");for(Iterator<String> it=corrections.keys();it.hasNext();){String id=it.next();require(ids.contains(id),"计时修正科目不存在");JSONObject correction=corrections.getJSONObject(id);keys(correction,new String[]{"minutes","timerSeconds","at"},new String[]{},"timeCorrection");number(correction.get("minutes"),1440,false,true,"修正时长");number(correction.get("timerSeconds"),8640000000d,false,false,"计时修正依据");String stamp=correction.getString("at");require(stamp.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"),"计时修正时间无效");java.time.Instant.parse(stamp);}}

        }
        if(state.has("assessmentBases")){Set<String> quantityIds=new HashSet<>();for(int i=0;i<subjects.length();i++)if("quantity".equals(subjects.getJSONObject(i).optString("measure")))quantityIds.add(subjects.getJSONObject(i).getString("id"));JSONObject bases=state.getJSONObject("assessmentBases");Iterator<String> bd=bases.keys();while(bd.hasNext()){String day=bd.next();date(day);require(records.has(day),"评估依据缺少对应记录");Reference.validateBasis(bases.getJSONObject(day),ids,vocabIds,quantityIds);}}
        JSONObject reviews=state.getJSONObject("reviews");Iterator<String> wk=reviews.keys();
        while(wk.hasNext()) {String key=wk.next();date(key);JSONObject r=reviews.getJSONObject(key);
            keys(r,new String[]{"load","mathProblem","vocabReview","adjustment","reason","halfDayRest"},current?new String[]{"subjects"}:new String[]{},"review");
            for(String f:new String[]{"load","mathProblem","vocabReview","adjustment","reason"}) if(r.has(f)) string(r,f,8000);
            nullableBool(r.opt("halfDayRest"),"半天休息");
            if(r.has("subjects")) {JSONObject text=r.getJSONObject("subjects");Iterator<String> subjectIds=text.keys();while(subjectIds.hasNext()){String id=subjectIds.next();require(ids.contains(id),"复盘科目不存在");string(text,id,8000);}}
        }
        keys(state.getJSONObject("settings"),new String[]{"reminders"},new String[]{"restHours"},"settings");
        if(state.getJSONObject("settings").has("restHours")) {
            JSONObject rest=state.getJSONObject("settings").getJSONObject("restHours");
            keys(rest,new String[]{"weekdayEnd","weekendStart","weekendEnd"},new String[]{},"restHours");
            int weekdayEnd=clockMinutes(string(rest,"weekdayEnd",5)), weekendStart=clockMinutes(string(rest,"weekendStart",5)), weekendEnd=clockMinutes(string(rest,"weekendEnd",5));
            require(weekdayEnd>0,"工作日结束时间须晚于00:00"); require(weekendStart<weekendEnd,"周末开始时间须早于结束时间");
        }
        JSONObject reminder=state.getJSONObject("settings").getJSONObject("reminders");
        keys(reminder,new String[]{"enabled","weekdayTime","weekendTime"},new String[]{},"reminders");
        require(reminder.opt("enabled") instanceof Boolean,"提醒开关无效");
        for(String key:new String[]{"weekdayTime","weekendTime"}) {
            String t=string(reminder,key,5);require(t.matches("([01]\\d|2[0-3]):[0-5]\\d"),"提醒时间格式无效");
            int hour=Integer.parseInt(t.substring(0,2)),min=Integer.parseInt(t.substring(3));
            LocalDate d=LocalDate.of(2026,10,key.equals("weekdayTime")?12:17);
            require(AppRules.allowedTime(state,d,hour,min),"提醒时间超出允许学习时段");
        }
        if(state.has("sessions")) {
            sessions(state.getJSONArray("sessions"),ids);
        }
        if(state.getInt("version")>=9){Evaluation.validate(state);JSONObject e=state.getJSONObject("evaluation");if(!e.isNull("transitionLegacy")){JSONObject old=new JSONObject(state.toString()),saved=e.getJSONObject("transitionLegacy");old.remove("evaluation");old.put("version",8).put("records",new JSONObject().put(e.getString("transitionDate"),saved.getJSONObject("record"))).put("assessmentBases",saved.isNull("basis")?new JSONObject():new JSONObject().put(e.getString("transitionDate"),saved.getJSONObject("basis")));validate(old);}}
    }
    private static final Set<String> LEGACY_GOALS=new HashSet<>(Arrays.asList("函数与极限符号、已忘基础定位。","极限运算与初等函数基础。","常见极限与连续性。","导数定义与基本求导。","求导法则、复合函数。","高阶导数与微分（选做隐函数）。","中值定理直观与条件。","单调性、极值与最值。","函数、极限、导数的综合回顾。","小检查和寒假起点；积分仅可选接触。"));
    private static final Set<String> LEGACY_HINTS=new HashSet<>(Arrays.asList("周四3—4节、周五1—2节有单周课；周一就业指导、光电子学仍在。","本周不排周四3—4节、周五1—2节的单周课；就业指导、光电子学仍在。空课用于替换自习或休息。","就业指导已结束；光电子学仍在；周四3—4节、周五1—2节有单周课。","就业指导已结束；光电子学仍在；本周不排两处单周课。","光电子学固定课已结束；周四3—4节、周五1—2节有单周课；给习概实践、实验和作业留余量。","光电子学固定课已结束；本周不排两处单周课；空课优先兼顾作业、实验和休息。","光电子学固定课已结束；周四3—4节、周五1—2节有单周课；继续预留实践和作业时间。","光电子学固定课已结束；本周不排两处单周课；空课不自动转为额外考研任务。","周四3—4节、周五1—2节有单周课；如临近期末课程任务增加，可以减量。","本周不排两处单周课；完成短时检查并确定寒假起点，允许继续停在导数。"));
    private static void clearPresetWeeks(JSONObject plan)throws Exception{
        if(plan.optBoolean("manualWeekGoals",false))return;
        for(String field:new String[]{"weekGoals","weekHints"}){JSONObject values=plan.getJSONObject(field);java.util.ArrayList<String> remove=new java.util.ArrayList<>();Iterator<String> days=values.keys();while(days.hasNext()){String day=days.next();if(("weekGoals".equals(field)?LEGACY_GOALS:LEGACY_HINTS).contains(values.getString(day)))remove.add(day);}for(String day:remove)values.remove(day);}
        plan.put("manualWeekGoals",true);
    }
    public static int wordTarget(JSONObject state,String day,String id)throws Exception{
        date(day);JSONObject plan=state.getJSONObject("plan");JSONArray subjects=plan.getJSONArray("subjects");
        for(int i=0;i<subjects.length();i++){JSONObject subject=subjects.getJSONObject(i);if(subject.getString("id").equals(id)){require("vocab".equals(subject.getString("kind")),"该科目使用分钟");JSONObject words=plan.optJSONObject("wordTargets"),daily=words==null?null:words.optJSONObject(day);return daily!=null&&daily.has(id)?daily.getInt(id):subject.optInt("wordGoal",50);}}
        throw new Exception("科目不存在");
    }
    public static JSONObject migrateState(JSONObject state) throws Exception {
        JSONObject result=new JSONObject(state.toString());migrateInPlace(result);return result;
    }
    private static void migrateInPlace(JSONObject state) throws Exception {
        validate(state);
        int originalVersion=state.getInt("version");if(originalVersion==9)return;
        state.put("version",9);Courses.initialize(state);clearPresetWeeks(state.getJSONObject("plan"));
        JSONObject settings=state.getJSONObject("settings");if(!settings.has("restHours"))settings.put("restHours",new JSONObject().put("weekdayEnd",AppRules.DEFAULT_WEEKDAY_END).put("weekendStart",AppRules.DEFAULT_WEEKEND_START).put("weekendEnd",AppRules.DEFAULT_WEEKEND_END));
        boolean hasQuantity=false;JSONArray qSubjects=state.getJSONObject("plan").getJSONArray("subjects");for(int i=0;i<qSubjects.length();i++)if("quantity".equals(qSubjects.getJSONObject(i).optString("measure")))hasQuantity=true;if(hasQuantity&&!state.getJSONObject("plan").has("quantityTargets"))state.getJSONObject("plan").put("quantityTargets",new JSONObject());
        if(!state.getJSONObject("plan").has("weekTasks"))state.getJSONObject("plan").put("weekTasks",new JSONObject());
        JSONArray subjects=state.getJSONObject("plan").getJSONArray("subjects");JSONObject reviews=state.getJSONObject("reviews");Iterator<String> dates=reviews.keys();
        while(dates.hasNext()) {JSONObject review=reviews.getJSONObject(dates.next());JSONObject text=review.optJSONObject("subjects");if(text==null){text=new JSONObject();review.put("subjects",text);}for(int i=0;i<subjects.length();i++){JSONObject subject=subjects.getJSONObject(i);String kind=subject.getString("kind"),field=kind.equals("math")?"mathProblem":kind.equals("vocab")?"vocabReview":null;String id=subject.getString("id");if(field!=null&&!text.has(id))text.put(id,review.getString(field));}}
        LocalDate now=LocalDate.now();if(originalVersion<9){CourseSchedule.upgrade(state,now);CourseSchedule.autoReferences(state,now);Reference.upgrade(state,now);}
        if(!state.has("evaluation")){Evaluation.Clock clock=Evaluation.clock(state);if(clock.today.compareTo("2026-10-26")<0)clock=new Evaluation.Clock("2026-10-26","2026-10-26T12:00:00.000Z",clock.timezone);Evaluation.initialize(state,clock);}
        validate(state);
    }
    public static boolean activeSubject(JSONObject subject,LocalDate day) throws Exception {
        if(!subject.has("activePeriods"))return true;
        JSONArray periods=subject.getJSONArray("activePeriods");
        for(int i=0;i<periods.length();i++){JSONObject period=periods.getJSONObject(i);LocalDate from=date(period.getString("from"));LocalDate to=period.isNull("to")?null:date(period.getString("to"));if(!day.isBefore(from)&&(to==null||day.isBefore(to)))return true;}
        return false;
    }
    private static void sessions(JSONArray sessions,Set<String> ids)throws Exception {
        require(sessions.length()<=100000,"计时记录数量过大");Set<String> seen=new HashSet<>();
        for(int i=0;i<sessions.length();i++) {JSONObject s=sessions.getJSONObject(i);keys(s,new String[]{"id","date","subjectId","seconds","endedAt"},new String[]{},"session");require(seen.add(string(s,"id",128)),"计时记录重复");date(string(s,"date",10));require(ids.contains(string(s,"subjectId",64)),"计时科目不存在");number(s.opt("seconds"),86400,false,false,"计时秒数");Instant.parse(string(s,"endedAt",64));}
    }
    private static int clockMinutes(String value)throws Exception {
        require(value.matches("([01]\\d|2[0-3]):[0-5]\\d"),"时间格式无效");
        return Integer.parseInt(value.substring(0,2))*60+Integer.parseInt(value.substring(3,5));
    }
}
