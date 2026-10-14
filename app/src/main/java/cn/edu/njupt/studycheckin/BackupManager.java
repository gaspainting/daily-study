package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Base64;
import android.graphics.BitmapFactory;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.*;

/** Complete ZIP includes every plan; legacy imports replace the current plan only. */
public final class BackupManager {
    private static final long MAX_TOTAL=512L*1024*1024;
    private static AtomicFile journal(Context c){return new AtomicFile(new File(c.getFilesDir(),"restore-journal.json"));}
    private static byte[] previous(Context c,String name,int max)throws Exception{AtomicFile f=new AtomicFile(new File(c.getFilesDir(),name));return f.getBaseFile().exists()||new File(f.getBaseFile()+".bak").exists()?InspirationStore.read(f.openRead(),max):null;}
    private static void write(AtomicFile f,byte[] bytes)throws Exception{FileOutputStream out=null;try{out=f.startWrite();out.write(bytes);f.finishWrite(out);out=null;if(!Arrays.equals(bytes,InspirationStore.read(f.openRead(),bytes.length+1)))throw new IOException("备份恢复写入失败");}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}}
    private static void clearJournal(Context c)throws Exception{AtomicFile file=journal(c);file.delete();if(file.getBaseFile().exists()||new File(file.getBaseFile()+".bak").exists())throw new IOException("备份恢复失败");}
    private static void recoverFile(Context c,JSONObject j,String key,String name)throws Exception{AtomicFile f=new AtomicFile(new File(c.getFilesDir(),name));if(j.isNull(key))f.delete();else write(f,Base64.decode(j.getString(key),Base64.NO_WRAP));}
    private static void checkJournal(JSONObject journal,String key,int max)throws Exception{if(!journal.has(key)||(!journal.isNull(key)&&!(journal.opt(key) instanceof String)))throw new Exception("恢复信息不完整");if(!journal.isNull(key)&&Base64.decode(journal.getString(key),Base64.NO_WRAP).length>max)throw new Exception("恢复信息超过支持大小");}
    public static void recover(Context c)throws Exception{synchronized(DataStore.LOCK){synchronized(InspirationStore.LOCK){AtomicFile f=journal(c);if(f.getBaseFile().exists()||new File(f.getBaseFile()+".bak").exists()){JSONObject j=new JSONObject(new String(InspirationStore.read(f.openRead(),64*1024*1024),StandardCharsets.UTF_8));checkJournal(j,"study",DataStore.MAX_BYTES);checkJournal(j,"inspiration",InspirationStore.MAX_BYTES);if(j.has("plans"))checkJournal(j,"plans",PlanStore.MAX_BYTES);recoverFile(c,j,"study","study-state.json");recoverFile(c,j,"inspiration","inspiration.json");if(j.has("plans"))recoverFile(c,j,"plans","plans.json");clearJournal(c);}}}}
    public static void export(Context c,OutputStream output)throws Exception{synchronized(DataStore.LOCK){synchronized(InspirationStore.LOCK){
        PlanStore.recover(c);recover(c);JSONObject plans=PlanStore.backupSnapshot(c),study=DataStore.load(c),inspiration=InspirationStore.load(c);JSONObject manifest=new JSONObject().put("format","daily-study-complete").put("version",2).put("study",study).put("inspiration",inspiration).put("plans",plans);
        JSONObject cards=inspiration.getJSONObject("cards");Set<String> images=new TreeSet<>();for(Iterator<String> it=cards.keys();it.hasNext();)images.add(cards.getJSONObject(it.next()).getString("imageKey"));
        try(ZipOutputStream zip=new ZipOutputStream(new BufferedOutputStream(output))){zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifest.toString().getBytes(StandardCharsets.UTF_8));zip.closeEntry();long total=0;
            for(String key:images){File image=InspirationStore.media(c,key);if(!image.isFile())throw new Exception("历史图片缺失，请先处理后再导出完整备份");byte[] bytes=InspirationStore.read(new FileInputStream(image),InspirationStore.MAX_IMAGE_BYTES);if(!key.startsWith(InspirationStore.hash(bytes)+"."))throw new Exception("本地图片摘要不一致");total+=bytes.length;if(total>MAX_TOTAL)throw new Exception("完整备份超过512MB");zip.putNextEntry(new ZipEntry("media/"+key));zip.write(bytes);zip.closeEntry();}
        }
    }}}
    public static final class Imported implements AutoCloseable {
        public JSONObject study,inspiration,plans;private File stage;
        public boolean complete(){return inspiration!=null;}
        public boolean allPlans(){return plans!=null;}
        public int planCount(){return plans==null?1:plans.optJSONArray("items").length();}
        @Override public void close(){if(stage!=null)cleanStage(stage);}
    }
    private static void cleanStage(File dir){File[] files=dir.listFiles();if(files!=null)for(File f:files)if(f.isFile())f.delete();dir.delete();}
    public static Imported read(Context c,InputStream input)throws Exception{
        Imported imported=new Imported();try(BufferedInputStream in=new BufferedInputStream(input)){
            in.mark(8);byte[] header=new byte[4];int n=0,read;while(n<header.length&&(read=in.read(header,n,header.length-n))!=-1){if(read==0)continue;n+=read;}in.reset();boolean isZip=n==4&&header[0]=='P'&&header[1]=='K'&&header[2]==3&&header[3]==4;
            if(!isZip){imported.study=new JSONObject(new String(InspirationStore.read(in,DataStore.MAX_BYTES),StandardCharsets.UTF_8));DataStore.validate(imported.study);return imported;}
            imported.stage=new File(c.getCacheDir(),"backup-"+UUID.randomUUID());if(!imported.stage.mkdirs())throw new Exception("备份临时目录无法创建");Set<String> seen=new HashSet<>();long total=0;JSONObject manifest=null;
            try(ZipInputStream zip=new ZipInputStream(in)){ZipEntry entry;while((entry=zip.getNextEntry())!=null){String name=entry.getName();if(entry.isDirectory()||!seen.add(name)||seen.size()>20002)throw new Exception("备份含重复或多余文件");
                if(name.equals("manifest.json")){byte[] bytes=readEntry(zip,InspirationStore.MAX_BYTES+DataStore.MAX_BYTES+PlanStore.MAX_BYTES+4096);total+=bytes.length;manifest=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}
                else if(name.matches("media/[a-f0-9]{64}\\.(png|jpg)")){byte[] bytes=readEntry(zip,InspirationStore.MAX_IMAGE_BYTES);total+=bytes.length;String key=name.substring(6);if(!key.startsWith(InspirationStore.hash(bytes)+"."))throw new Exception("备份图片摘要不一致");if(!key.endsWith("."+ImageChecks.validate(bytes)))throw new Exception("图片后缀与实际格式不一致");try(OutputStream out=new FileOutputStream(new File(imported.stage,key))){out.write(bytes);}}
                else throw new Exception("备份包含不支持的文件路径");if(total>MAX_TOTAL)throw new Exception("备份解压超过512MB");zip.closeEntry();
            }}
            if(manifest==null||!manifest.optString("format").equals("daily-study-complete")||!(manifest.opt("version") instanceof Number)||(manifest.getDouble("version")!=1&&manifest.getDouble("version")!=2))throw new Exception("完整备份格式或版本不支持");imported.study=manifest.getJSONObject("study");imported.inspiration=manifest.getJSONObject("inspiration");DataStore.validate(imported.study);InspirationStore.validate(imported.inspiration);
            if(manifest.getInt("version")==2){imported.plans=manifest.getJSONObject("plans");PlanStore.validateBackup(imported.plans,imported.study);}else if(manifest.has("plans"))throw new Exception("旧版备份含不支持的计划信息");
            JSONObject cards=imported.inspiration.getJSONObject("cards");Set<String> expected=new HashSet<>();expected.add("manifest.json");for(Iterator<String> it=cards.keys();it.hasNext();){String key=cards.getJSONObject(it.next()).getString("imageKey");if(!new File(imported.stage,key).isFile())throw new Exception("备份缺少历史图片");expected.add("media/"+key);}if(!expected.equals(seen))throw new Exception("备份含未引用的图片");return imported;
        }catch(Exception e){imported.close();throw e;}
    }
    private static byte[] readEntry(InputStream in,int max)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>max)throw new Exception("备份文件项过大");out.write(buffer,0,n);}return out.toByteArray();}
    public static void restore(Context c,Imported imported)throws Exception{synchronized(DataStore.LOCK){synchronized(InspirationStore.LOCK){
        PlanStore.recover(c);recover(c);JSONObject timer=TimerStore.snapshot(c);if(timer.has("error"))throw new Exception(timer.getString("error"));if(timer.optBoolean("active"))throw new Exception("请先结束当前计时，再恢复备份");DataStore.validate(imported.study);if(imported.allPlans())PlanStore.validateBackup(imported.plans,imported.study);
        JSONObject incomingStudy=DataStore.migrateState(imported.study),incomingInspiration=imported.complete()?new JSONObject(imported.inspiration.toString()):null;
        if(imported.complete()){InspirationStore.validate(incomingInspiration);JSONObject cards=incomingInspiration.getJSONObject("cards");Set<String> copied=new HashSet<>();for(Iterator<String> it=cards.keys();it.hasNext();){String key=cards.getJSONObject(it.next()).getString("imageKey");if(copied.add(key))InspirationStore.writeMedia(c,key,InspirationStore.read(new FileInputStream(new File(imported.stage,key)),InspirationStore.MAX_IMAGE_BYTES));}}
        byte[] oldStudy=previous(c,"study-state.json",DataStore.MAX_BYTES),oldInspiration=previous(c,"inspiration.json",InspirationStore.MAX_BYTES),oldPlans=previous(c,"plans.json",PlanStore.MAX_BYTES);
        JSONObject before=new JSONObject().put("study",oldStudy==null?JSONObject.NULL:Base64.encodeToString(oldStudy,Base64.NO_WRAP)).put("inspiration",oldInspiration==null?JSONObject.NULL:Base64.encodeToString(oldInspiration,Base64.NO_WRAP)).put("plans",oldPlans==null?JSONObject.NULL:Base64.encodeToString(oldPlans,Base64.NO_WRAP));
        write(journal(c),before.toString().getBytes(StandardCharsets.UTF_8));
        try{DataStore.restore(c,incomingStudy);if(!PlanStore.equivalent(DataStore.load(c),incomingStudy))throw new IOException("备份恢复写入失败");if(imported.allPlans())PlanStore.restoreBackup(c,imported.plans);if(imported.complete()){InspirationStore.save(c,incomingInspiration);if(!PlanStore.equivalent(InspirationStore.load(c),incomingInspiration))throw new IOException("备份恢复写入失败");}clearJournal(c);}catch(Exception e){try{recover(c);}catch(Exception recovery){e.addSuppressed(recovery);}throw e;}
    }}}
}
