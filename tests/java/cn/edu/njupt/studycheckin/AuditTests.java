package cn.edu.njupt.studycheckin;
import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

final class AuditTests {
    interface Action{void run()throws Exception;}
    static void check(List<String> p,boolean yes,String text)throws Exception{if(!yes)throw new Exception("FAIL: "+text);p.add(text);}
    static void reject(List<String> p,Action run,String text)throws Exception{boolean rejected=false;try{run.run();}catch(Exception e){rejected=true;}check(p,rejected,text);}
    static void run(Context original,List<String> p)throws Exception{
        check(p,android.graphics.Typeface.createFromAsset(original.getAssets(),"report-font.ttf")!=null,"bundled report font loads through Android AssetManager");
        check(p,DataStore.readText(original.getAssets().open("report-font-OFL.txt")).contains("SIL OPEN FONT LICENSE"),"bundled font retains its readable redistribution license");
        JSONObject seed=new JSONObject(DataStore.readText(original.getAssets().open("seed.json")));
        seed.getJSONObject("plan").getJSONObject("weekGoals").put("2026-10-12","就业指导已结束；光电子学仍在；本周不排两处单周课。");
        seed.getJSONObject("plan").getJSONObject("weekHints").put("2026-10-12","极限运算与初等函数基础。");
        JSONObject migrated=DataStore.migrateState(seed);
        check(p,migrated.getJSONObject("plan").getJSONObject("weekGoals").has("2026-10-12")&&migrated.getJSONObject("plan").getJSONObject("weekHints").has("2026-10-12"),"weekly migration matches preset texts only within the corresponding field");
        migrated.getJSONObject("plan").getJSONArray("subjects").getJSONObject(1).put("wordSteps",new JSONArray("[1,5,10]"));DataStore.validate(migrated);
        check(p,migrated.getJSONObject("plan").getJSONArray("subjects").getJSONObject(1).getJSONArray("wordSteps").getInt(0)==1,"native vocabulary shortcuts preserve exact configuration");
        for(String raw:new String[]{"[]","[1,2]","[0,5,10]","[1,1,10]","[1.5,5,10]","[\"1\",5,10]","[1,5,100001]"}){
            JSONObject bad=new JSONObject(migrated.toString());bad.getJSONObject("plan").getJSONArray("subjects").getJSONObject(1).put("wordSteps",new JSONArray(raw));reject(p,()->DataStore.validate(bad),"native rejects invalid shortcut array "+raw);
        }
        JSONObject bad=new JSONObject(migrated.toString());bad.getJSONObject("plan").getJSONArray("subjects").getJSONObject(0).put("wordSteps",new JSONArray("[1,5,10]"));reject(p,()->DataStore.validate(bad),"native rejects word shortcuts on a timed subject");
        File dir=new File(original.getCacheDir(),"v133-audit-"+UUID.randomUUID());if(!dir.mkdirs())throw new Exception("test directory unavailable");
        Context c=new ContextWrapper(original){@Override public File getFilesDir(){return dir;}};
        try{
            DataStore.save(c,migrated);check(p,DataStore.load(c).getJSONObject("plan").getJSONArray("subjects").getJSONObject(1).getJSONArray("wordSteps").toString().equals("[1,5,10]"),"atomic study save verifies persisted shortcut bytes");
            JSONObject base=new JSONObject().put("newWords-vocab",""),values=new JSONObject().put("newWords-vocab","10");DraftStore.save(c,"main:daily:2026-10-14",base,values);
            JSONObject first=DraftStore.get(c,"main:daily:2026-10-14");byte[] before=InspirationStore.read(new FileInputStream(new File(dir,"drafts.json")),DraftStore.MAX_BYTES);
            android.os.SystemClock.sleep(10);DraftStore.save(c,"main:daily:2026-10-14",base,values);
            check(p,first.getString("updatedAt").equals(DraftStore.get(c,"main:daily:2026-10-14").getString("updatedAt"))&&java.util.Arrays.equals(before,InspirationStore.read(new FileInputStream(new File(dir,"drafts.json")),DraftStore.MAX_BYTES)),"unchanged draft saves preserve timestamp and file bytes");
            values.put("newWords-vocab","20");DraftStore.save(c,"main:daily:2026-10-14",base,values);check(p,DraftStore.get(c,"main:daily:2026-10-14").getJSONObject("values").getString("newWords-vocab").equals("20"),"changed draft values still persist");
            String longText=new String(new char[8000]).replace('\0','字');JSONObject longBase=new JSONObject().put("daily-note",longText),longValue=new JSONObject(longBase.toString()).put("newWords-vocab","10");
            DraftStore.save(c,"main:daily:2026-10-15",longBase,longValue);check(p,DraftStore.get(c,"main:daily:2026-10-15").getJSONObject("base").getString("daily-note").length()==8000,"legacy maximum length record text does not block quantity drafts");
            ByteArrayOutputStream zip=new ByteArrayOutputStream();BackupManager.export(c,zip);
            InputStream shortReads=new FilterInputStream(new ByteArrayInputStream(zip.toByteArray())){@Override public int read(byte[] b,int off,int len)throws IOException{return super.read(b,off,Math.min(1,len));}@Override public int available(){return 0;}};
            try(BackupManager.Imported imported=BackupManager.read(c,shortReads)){check(p,imported.allPlans()&&imported.study.getJSONObject("plan").getJSONArray("subjects").getJSONObject(1).getJSONArray("wordSteps").getInt(2)==10,"valid ZIP with one byte stream reads is recognized and retains shortcuts");}
            InputStream jsonReads=new FilterInputStream(new ByteArrayInputStream(migrated.toString().getBytes(StandardCharsets.UTF_8))){@Override public int read(byte[] b,int off,int len)throws IOException{return super.read(b,off,Math.min(1,len));}@Override public int available(){return 0;}};
            try(BackupManager.Imported imported=BackupManager.read(c,jsonReads)){check(p,!imported.complete()&&imported.study.getJSONObject("records").length()==0,"short read legacy JSON still imports without inventing actual records");}
            File pending=new File(dir,"plan-switch-journal.json");String beforeRecovery=DataStore.load(c).toString();
            try(FileOutputStream file=new FileOutputStream(pending)){file.write("{\"broken\":true}".getBytes(StandardCharsets.UTF_8));}
            reject(p,()->DataStore.readStable(c),"pending recovery blocks stable background record reads");
            check(p,TimerStore.snapshot(c).has("error")&&TimerStore.action(c,"discard").has("error")&&TimerStore.start(c,"math","高数",java.time.LocalDate.now().toString()).has("error"),"pending recovery also blocks background timer operations");
            check(p,DataStore.load(c).toString().equals(beforeRecovery),"recovery gate keeps original learning data unchanged");pending.delete();
        }finally{clean(dir);}
    }
    private static void clean(File file){File[] files=file.listFiles();if(files!=null)for(File child:files)clean(child);file.delete();}
}
