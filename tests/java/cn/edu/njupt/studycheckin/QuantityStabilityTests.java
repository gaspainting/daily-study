package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

final class QuantityStabilityTests {
    private static void check(List<String> p,boolean yes,String name)throws Exception{if(!yes)throw new Exception("FAIL: "+name);p.add(name);}
    private static JSONObject record(JSONObject s,String unit,Object quantity)throws Exception{
        JSONObject entries=new JSONObject();JSONArray subjects=s.getJSONObject("plan").getJSONArray("subjects");
        for(int i=0;i<subjects.length();i++){JSONObject subject=subjects.getJSONObject(i),entry=new JSONObject().put("minutes",JSONObject.NULL).put("content","").put("problem","").put("newWords",JSONObject.NULL).put("reviewWords",JSONObject.NULL).put("forgotWords","");if(subject.getString("id").equals("quantity-review"))entry.put("quantity",quantity).put("quantityUnit",unit);entries.put(subject.getString("id"),entry);}
        return new JSONObject().put("subjects",entries).put("status","正常参考").put("restKept",JSONObject.NULL).put("note","");
    }
    private static void remove(File f,String root)throws Exception{if(!f.getCanonicalPath().startsWith(root+File.separator)&&!f.getCanonicalPath().equals(root))throw new Exception("Unexpected test cleanup path");if(f.isDirectory())for(File child:f.listFiles())remove(child,root);f.delete();}
    static void run(Context c,List<String> passed)throws Exception{
        File folder=new File(c.getCacheDir(),"quantity-test-"+UUID.randomUUID());folder.mkdirs();String owned=folder.getCanonicalPath();
        Context isolated=new ContextWrapper(c){@Override public File getFilesDir(){return folder;}};
        try{
            JSONObject s=DataStore.migrateState(new JSONObject(DataStore.readText(c.getAssets().open("seed.json")))),plan=s.getJSONObject("plan"),units=new JSONObject(),goals=plan.optJSONObject("quantityTargets");if(goals==null){goals=new JSONObject();plan.put("quantityTargets",goals);}
            JSONArray defaults=new JSONArray();for(int i=0;i<7;i++)defaults.put(10);JSONObject q=new JSONObject().put("id","quantity-review").put("name","数量复习").put("kind","custom").put("measure","quantity").put("unit","组").put("defaults",defaults);plan.getJSONArray("subjects").put(q);plan.put("quantityUnits",units);
            for(LocalDate d=LocalDate.parse(plan.getString("startDate")),end=LocalDate.parse(plan.getString("endDate"));!d.isAfter(end);d=d.plusDays(1)){String day=d.toString();JSONObject row=goals.optJSONObject(day);if(row==null){row=new JSONObject();goals.put(day,row);}row.put("quantity-review",10);units.put(day,new JSONObject().put("quantity-review",day.compareTo("2026-10-21")<=0?"题":"组"));}
            JSONObject records=s.getJSONObject("records");records.put("2026-10-21",record(s,"题",12)).put("2026-10-22",record(s,"组",3)).put("2026-10-23",record(s,"组",0)).put("2026-10-24",record(s,"组",JSONObject.NULL));Reference.preserve(s,s);DataStore.validate(s);
            check(passed,Reference.quantityUnit(s,LocalDate.of(2026,10,21),q).equals("题")&&Reference.quantityUnit(s,LocalDate.of(2026,10,22),q).equals("组"),"native preserves date-specific quantity target units");
            JSONObject assessed=Reference.assess(s,LocalDate.of(2026,10,21)).getJSONArray("quantities").getJSONObject(0);check(passed,assessed.getString("kind").equals("above")&&assessed.getString("unit").equals("题")&&assessed.getString("actualUnit").equals("题"),"native quantity grading uses the historical target and actual unit");
            JSONObject mismatch=new JSONObject(s.toString());mismatch.getJSONObject("records").getJSONObject("2026-10-21").getJSONObject("subjects").getJSONObject("quantity-review").put("quantityUnit","组");check(passed,Reference.assess(mismatch,LocalDate.of(2026,10,21)).getJSONArray("quantities").getJSONObject(0).getString("kind").equals("unit"),"native never grades mismatched quantity units");
            JSONObject reduced=new JSONObject(s.toString());reduced.getJSONObject("records").getJSONObject("2026-10-22").put("status","减量");reduced.getJSONObject("assessmentBases").getJSONObject("2026-10-22").getJSONArray("quantities").getJSONObject(0).put("goal",5);JSONObject half=Reference.assess(reduced,LocalDate.of(2026,10,22)).getJSONArray("quantities").getJSONObject(0);check(passed,half.getDouble("goal")==2.5&&half.getString("kind").equals("above"),"native odd quantity goal halves without rounding the displayed criterion");
            for(String id:new String[]{"math","vocab","missing"}){JSONObject bad=new JSONObject(s.toString());bad.getJSONObject("plan").getJSONObject("quantityUnits").put("2026-10-21",new JSONObject().put(id,"题"));boolean rejected=false;try{DataStore.validate(bad);}catch(Exception e){rejected=true;}check(passed,rejected,"native rejects quantity-unit provenance for "+id);}
            JSONObject bad=new JSONObject(s.toString());bad.getJSONObject("plan").getJSONObject("quantityUnits").getJSONObject("2026-10-21").put("quantity-review","");boolean rejected=false;try{DataStore.validate(bad);}catch(Exception e){rejected=true;}check(passed,rejected,"native rejects blank quantity target units");
            ByteArrayOutputStream csv=new ByteArrayOutputStream();ReportExport.write(isolated,s,csv,"csv","2026-10-21","2026-10-24","quantity-review");List<String[]> rows=ReportTests.parse(new String(csv.toByteArray(),StandardCharsets.UTF_8));check(passed,rows.get(0)[25].equals("目标单位")&&rows.get(0)[3].equals("已记录"),"CSV quantity values have generic headers and an explicit target unit");
            check(passed,rows.get(1)[3].equals("12")&&rows.get(1)[16].equals("题")&&rows.get(1)[25].equals("题")&&rows.get(2)[3].equals("3")&&rows.get(2)[16].equals("组"),"CSV preserves each daily quantity and historical unit");
            check(passed,rows.get(1)[26].equals("超额完成")&&rows.get(1)[27].equals("10")&&rows.get(1)[28].equals("题"),"CSV includes quantity assessment and its frozen goal unit");
            boolean question=false,set=false;int totals=0;for(String[] row:rows)if(row[0].equals("合计")){totals++;question|=row[16].equals("题")&&row[3].equals("12");set|=row[16].equals("组")&&row[3].equals("3");}check(passed,totals==2&&question&&set,"CSV totals separate questions and sets instead of summing them");
            check(passed,rows.get(3)[3].equals("0")&&rows.get(4)[3].equals("未记录"),"CSV quantity rows distinguish explicit zero from unknown");
            ByteArrayOutputStream pdf=new ByteArrayOutputStream();ReportExport.write(isolated,s,pdf,"pdf","2026-10-21","2026-10-24","quantity-review");check(passed,pdf.size()>1000&&new String(pdf.toByteArray(),0,4,StandardCharsets.US_ASCII).equals("%PDF"),"PDF generates with unit-separated quantity summaries");
            java.nio.file.Files.write(new File(c.getCacheDir(),"quantity-validation.csv").toPath(),csv.toByteArray());java.nio.file.Files.write(new File(c.getCacheDir(),"quantity-validation.pdf").toPath(),pdf.toByteArray());
            DataStore.save(isolated,s);String original=DataStore.load(isolated).getJSONObject("records").toString();ByteArrayOutputStream zip=new ByteArrayOutputStream();BackupManager.export(isolated,zip);
            try(BackupManager.Imported backup=BackupManager.read(isolated,new ByteArrayInputStream(zip.toByteArray()))){check(passed,backup.study.getJSONObject("plan").getJSONObject("quantityUnits").toString().equals(units.toString()),"complete ZIP retains historical target units");BackupManager.restore(isolated,backup);check(passed,DataStore.load(isolated).getJSONObject("records").toString().equals(original),"complete quantity backup restoration retains all actual values and units");}
            JSONObject old=new JSONObject(s.toString());old.put("version",7).getJSONObject("plan").remove("quantityUnits");JSONObject migrated=DataStore.migrateState(old);check(passed,migrated.getJSONObject("records").toString().equals(s.getJSONObject("records").toString())&&Reference.quantityUnit(migrated,LocalDate.of(2026,10,21),q).equals("题"),"old schema7 backups preserve quantity records and use saved unit criteria");
        }finally{remove(folder,owned);}
    }
}
