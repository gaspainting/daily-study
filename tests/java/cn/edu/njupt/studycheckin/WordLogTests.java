package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.List;
import java.util.UUID;

final class WordLogTests {
    private static void check(List<String> p,boolean condition,String name)throws Exception{if(!condition)throw new Exception("FAIL: "+name);p.add(name);}
    static void run(Context c,List<String> passes)throws Exception{
        JSONArray cases=new JSONArray(DataStore.readText(c.getAssets().open("word-log-test-cases.json")));
        for(int i=0;i<cases.length();i++){
            JSONObject item=cases.getJSONObject(i),log=item.getJSONObject("log");boolean accepted=true;
            try{JSONObject total=WordLog.totals(log);WordLog.validate(log,item.getJSONObject("totals"));}catch(Exception e){accepted=false;}
            check(passes,accepted==item.getBoolean("valid"),"word log JS/Java parity: "+item.getString("name"));
        }
        File folder=new File(c.getCacheDir(),"word-log-test-"+UUID.randomUUID());folder.mkdirs();
        Context isolated=new ContextWrapper(c){@Override public File getFilesDir(){return folder;}};
        try{
            JSONObject legacy=new JSONObject(DataStore.readText(c.getAssets().open("seed.json"))),state=DataStore.migrateState(legacy);
            JSONObject subject=new JSONObject().put("minutes",JSONObject.NULL).put("content","").put("problem","").put("newWords",30).put("reviewWords",7).put("forgotWords","");
            JSONObject log=cases.getJSONObject(2).getJSONObject("log");subject.put("wordLog",new JSONObject(log.toString()));
            JSONObject record=new JSONObject().put("subjects",new JSONObject().put("vocab",subject)).put("status","正常参考").put("restKept",JSONObject.NULL).put("note","");
            state.getJSONObject("records").put("2026-10-25",record);DataStore.save(isolated,state);JSONObject loaded=DataStore.load(isolated);
            check(passes,loaded.getInt("version")==9&&loaded.getJSONObject("records").getJSONObject("2026-10-25").getJSONObject("subjects").getJSONObject("vocab").getJSONObject("wordLog").getJSONArray("entries").length()==3,"atomic state save retains all word batches and current schema");
            long revision=loaded.getLong("_revision");DataStore.save(isolated,loaded);JSONObject again=DataStore.load(isolated);
            check(passes,again.getJSONObject("records").toString().equals(loaded.getJSONObject("records").toString()),"repeat native save retains word IDs and counts without appending");
            JSONObject bad=new JSONObject(again.toString());bad.getJSONObject("records").getJSONObject("2026-10-25").getJSONObject("subjects").getJSONObject("vocab").put("newWords",31);
            boolean rejected=false;try{DataStore.save(isolated,bad);}catch(Exception expected){rejected=true;}
            check(passes,rejected&&DataStore.load(isolated).toString().equals(again.toString()),"mismatched imported word totals rejected without changing saved records");
            String field=Reference.assess(again,java.time.LocalDate.parse("2026-10-25")).getJSONArray("words").getJSONObject(0).getString("kind");
            check(passes,field.equals("below")&&StudyWidget.content(again,java.time.LocalDate.parse("2026-10-25")).getString("subjects").contains("新学 30"),"native assessment and widget use totals once rather than recounting batches");
            ByteArrayOutputStream csv=new ByteArrayOutputStream();ReportExport.write(c,again,csv,"csv","2026-10-25","2026-10-25","vocab");String text=csv.toString("UTF-8");
            check(passes,text.contains("单词分次记录")&&text.contains("快捷累加")&&text.contains("2026-10-25T03:04:05.000Z"),"CSV includes word event quantities timestamps and sources");
            ByteArrayOutputStream pdf=new ByteArrayOutputStream();ReportExport.write(c,again,pdf,"pdf","2026-10-25","2026-10-25","vocab");check(passes,pdf.size()>1000,"PDF renders saved word batches");
            ByteArrayOutputStream zip=new ByteArrayOutputStream();BackupManager.export(isolated,zip);
            try(BackupManager.Imported backup=BackupManager.read(isolated,new java.io.ByteArrayInputStream(zip.toByteArray()))){
                check(passes,backup.allPlans()&&backup.study.getJSONObject("records").toString().equals(again.getJSONObject("records").toString()),"complete ZIP round trip retains word IDs and totals");
                BackupManager.restore(isolated,backup);check(passes,DataStore.load(isolated).getJSONObject("records").toString().equals(again.getJSONObject("records").toString()),"confirmed complete backup restoration retains word batches");
            }
            JSONObject old=DataStore.migrateState(legacy);check(passes,old.getJSONObject("records").length()==0,"legacy backup migration does not invent word batches");
        }finally{for(File f:folder.listFiles())f.delete();folder.delete();}
    }
}
