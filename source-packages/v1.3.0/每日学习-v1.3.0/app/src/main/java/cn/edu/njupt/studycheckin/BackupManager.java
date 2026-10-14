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

/** Versioned complete ZIP, legacy JSON import, and recoverable two-file restore. */
public final class BackupManager {
    private static final long MAX_TOTAL=512L*1024*1024;
    private static AtomicFile journal(Context c){return new AtomicFile(new File(c.getFilesDir(),"restore-journal.json"));}
    private static byte[] previous(Context c,String name,int max)throws Exception{AtomicFile f=new AtomicFile(new File(c.getFilesDir(),name));return f.getBaseFile().exists()||new File(f.getBaseFile()+".bak").exists()?InspirationStore.read(f.openRead(),max):null;}
    private static void write(AtomicFile f,byte[] bytes)throws Exception{FileOutputStream out=null;try{out=f.startWrite();out.write(bytes);f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}}
    private static void recoverFile(Context c,JSONObject j,String key,String name)throws Exception{AtomicFile f=new AtomicFile(new File(c.getFilesDir(),name));if(j.isNull(key))f.delete();else write(f,Base64.decode(j.getString(key),Base64.NO_WRAP));}
    public static void recover(Context c)throws Exception{synchronized(DataStore.LOCK){synchronized(InspirationStore.LOCK){AtomicFile f=journal(c);if(f.getBaseFile().exists()||new File(f.getBaseFile()+".bak").exists()){JSONObject j=new JSONObject(new String(InspirationStore.read(f.openRead(),40*1024*1024),StandardCharsets.UTF_8));recoverFile(c,j,"study","study-state.json");recoverFile(c,j,"inspiration","inspiration.json");f.delete();}}}}
    public static void export(Context c,OutputStream output)throws Exception{synchronized(DataStore.LOCK){synchronized(InspirationStore.LOCK){
        JSONObject study=DataStore.load(c),inspiration=InspirationStore.load(c);JSONObject manifest=new JSONObject().put("format","daily-study-complete").put("version",1).put("study",study).put("inspiration",inspiration);
        JSONObject cards=inspiration.getJSONObject("cards");Set<String> images=new TreeSet<>();for(Iterator<String> it=cards.keys();it.hasNext();)images.add(cards.getJSONObject(it.next()).getString("imageKey"));
        try(ZipOutputStream zip=new ZipOutputStream(new BufferedOutputStream(output))){zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifest.toString().getBytes(StandardCharsets.UTF_8));zip.closeEntry();long total=0;
            for(String key:images){File image=InspirationStore.media(c,key);if(!image.isFile())throw new Exception("历史图片缺失，请先处理后再导出完整备份");byte[] bytes=InspirationStore.read(new FileInputStream(image),InspirationStore.MAX_IMAGE_BYTES);if(!key.startsWith(InspirationStore.hash(bytes)+"."))throw new Exception("本地图片摘要不一致");total+=bytes.length;if(total>MAX_TOTAL)throw new Exception("完整备份超过512MB");zip.putNextEntry(new ZipEntry("media/"+key));zip.write(bytes);zip.closeEntry();}
        }
    }}}
    public static final class Imported implements AutoCloseable {
        public JSONObject study,inspiration;private File stage;
        public boolean complete(){return inspiration!=null;}
        @Override public void close(){if(stage!=null)cleanStage(stage);}
    }
    private static void cleanStage(File dir){File[] files=dir.listFiles();if(files!=null)for(File f:files)if(f.isFile())f.delete();dir.delete();}
    public static Imported read(Context c,InputStream input)throws Exception{
        Imported imported=new Imported();try(BufferedInputStream in=new BufferedInputStream(input)){
            in.mark(8);byte[] header=new byte[4];int n=in.read(header);in.reset();boolean isZip=n==4&&header[0]=='P'&&header[1]=='K'&&header[2]==3&&header[3]==4;
            if(!isZip){imported.study=new JSONObject(new String(InspirationStore.read(in,DataStore.MAX_BYTES),StandardCharsets.UTF_8));DataStore.validate(imported.study);return imported;}
            imported.stage=new File(c.getCacheDir(),"backup-"+UUID.randomUUID());if(!imported.stage.mkdirs())throw new Exception("备份临时目录无法创建");Set<String> seen=new HashSet<>();long total=0;JSONObject manifest=null;
            try(ZipInputStream zip=new ZipInputStream(in)){ZipEntry entry;while((entry=zip.getNextEntry())!=null){String name=entry.getName();if(entry.isDirectory()||!seen.add(name)||seen.size()>20002)throw new Exception("备份含重复或多余文件");
                if(name.equals("manifest.json")){byte[] bytes=readEntry(zip,InspirationStore.MAX_BYTES+DataStore.MAX_BYTES+2048);total+=bytes.length;manifest=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}
                else if(name.matches("media/[a-f0-9]{64}\\.(png|jpg)")){byte[] bytes=readEntry(zip,InspirationStore.MAX_IMAGE_BYTES);total+=bytes.length;String key=name.substring(6);if(!key.startsWith(InspirationStore.hash(bytes)+"."))throw new Exception("备份图片摘要不一致");if(!key.endsWith("."+ImageChecks.validate(bytes)))throw new Exception("图片后缀与实际格式不一致");try(OutputStream out=new FileOutputStream(new File(imported.stage,key))){out.write(bytes);}}
                else throw new Exception("备份包含不支持的文件路径");if(total>MAX_TOTAL)throw new Exception("备份解压超过512MB");zip.closeEntry();
            }}
            if(manifest==null||!manifest.optString("format").equals("daily-study-complete")||manifest.optInt("version",0)!=1)throw new Exception("完整备份格式或版本不支持");imported.study=manifest.getJSONObject("study");imported.inspiration=manifest.getJSONObject("inspiration");DataStore.validate(imported.study);InspirationStore.validate(imported.inspiration);
            JSONObject cards=imported.inspiration.getJSONObject("cards");Set<String> expected=new HashSet<>();expected.add("manifest.json");for(Iterator<String> it=cards.keys();it.hasNext();){String key=cards.getJSONObject(it.next()).getString("imageKey");if(!new File(imported.stage,key).isFile())throw new Exception("备份缺少历史图片");expected.add("media/"+key);}if(!expected.equals(seen))throw new Exception("备份含未引用的图片");return imported;
        }catch(Exception e){imported.close();throw e;}
    }
    private static byte[] readEntry(InputStream in,int max)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>max)throw new Exception("备份文件项过大");out.write(buffer,0,n);}return out.toByteArray();}
    public static void restore(Context c,Imported imported)throws Exception{synchronized(DataStore.LOCK){synchronized(InspirationStore.LOCK){
        if(TimerStore.snapshot(c).optBoolean("active"))throw new Exception("请先结束当前计时，再恢复备份");DataStore.validate(imported.study);
        if(!imported.complete()){DataStore.restore(c,imported.study);return;}
        InspirationStore.validate(imported.inspiration);JSONObject cards=imported.inspiration.getJSONObject("cards");Set<String> copied=new HashSet<>();for(Iterator<String> it=cards.keys();it.hasNext();){String key=cards.getJSONObject(it.next()).getString("imageKey");if(copied.add(key))InspirationStore.writeMedia(c,key,InspirationStore.read(new FileInputStream(new File(imported.stage,key)),InspirationStore.MAX_IMAGE_BYTES));}
        byte[] oldStudy=previous(c,"study-state.json",DataStore.MAX_BYTES),oldInspiration=previous(c,"inspiration.json",InspirationStore.MAX_BYTES);
        JSONObject before=new JSONObject().put("study",oldStudy==null?JSONObject.NULL:Base64.encodeToString(oldStudy,Base64.NO_WRAP)).put("inspiration",oldInspiration==null?JSONObject.NULL:Base64.encodeToString(oldInspiration,Base64.NO_WRAP));
        write(journal(c),before.toString().getBytes(StandardCharsets.UTF_8));
        try{DataStore.restore(c,imported.study);InspirationStore.save(c,imported.inspiration);journal(c).delete();}catch(Exception e){recover(c);throw e;}
    }}}
}
