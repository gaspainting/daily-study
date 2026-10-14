package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/** Independent media state: adding daily cards never rewrites study records. */
public final class InspirationStore {
    public static final Object LOCK=new Object();
    public static final int MAX_BYTES=24*1024*1024,MAX_IMAGE_BYTES=8*1024*1024;
    public static final class NoImageException extends Exception{public NoImageException(){super("还没有可用的联网图片，请连接网络后准备图文；当天抽签机会仍保留");}}
    private static final Random RANDOM=new java.security.SecureRandom();
    private static AtomicFile file(Context c){return new AtomicFile(new File(c.getFilesDir(),"inspiration.json"));}
    public static File mediaDir(Context c){File d=new File(c.getFilesDir(),"inspiration-media");d.mkdirs();return d;}
    public static File media(Context c,String key)throws Exception{
        if(key==null||!key.matches("[a-f0-9]{64}\\.(png|jpg)"))throw new Exception("图片标识无效");
        return new File(mediaDir(c),key);
    }
    public static byte[] read(InputStream stream,int max)throws Exception{
        if(stream==null)throw new Exception("文件无法读取");
        try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1){if(out.size()+n>max)throw new Exception("文件超过支持大小");out.write(b,0,n);}return out.toByteArray();
        }
    }
    public static String hash(byte[] bytes)throws Exception{
        StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();
    }
    public static String textHash(String text)throws Exception{
        String v=Normalizer.normalize(text,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        StringBuilder s=new StringBuilder();v.codePoints().filter(Character::isLetterOrDigit).forEach(s::appendCodePoint);
        return hash(s.toString().getBytes(StandardCharsets.UTF_8));
    }
    private static JSONObject empty()throws Exception{return new JSONObject().put("version",1).put("cards",new JSONObject()).put("events",new JSONArray()).put("daily",new JSONObject()).put("imageUse",new JSONObject()).put("textUse",new JSONObject()).put("settings",new JSONObject().put("online",true)).put("lastFetchAt","").put("lastFetchMessage","");}
    public static JSONObject load(Context c){synchronized(LOCK){try{
        AtomicFile f=file(c);JSONObject s=f.getBaseFile().exists()||new File(f.getBaseFile()+".bak").exists()?new JSONObject(new String(read(f.openRead(),MAX_BYTES),StandardCharsets.UTF_8)):empty();validate(s);return s;
    }catch(Exception e){throw new IllegalStateException("图文记录读取失败，原文件已保留："+e.getMessage(),e);}}}
    public static void save(Context c,JSONObject s)throws Exception{synchronized(LOCK){validate(s);byte[] b=s.toString().getBytes(StandardCharsets.UTF_8);if(b.length>MAX_BYTES)throw new Exception("图文历史过大，请先备份");AtomicFile f=file(c);FileOutputStream out=null;try{out=f.startWrite();out.write(b);f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}}}
    public static void validate(JSONObject s)throws Exception{
        require(s!=null&&s.optInt("version",0)==1,"图文备份版本不支持");
        JSONObject cards=s.getJSONObject("cards"),daily=s.getJSONObject("daily");JSONArray events=s.getJSONArray("events");
        require(cards.length()<=20000&&events.length()<=100000,"图文历史超过支持大小");
        require(s.getJSONObject("settings").get("online") instanceof Boolean,"联网设置无效");
        s.getJSONObject("imageUse");s.getJSONObject("textUse");
        for(Iterator<String> it=cards.keys();it.hasNext();){String id=it.next();require(id.matches("[a-zA-Z0-9_-]{1,100}"),"卡片ID无效");JSONObject card=cards.getJSONObject(id);require(id.equals(card.getString("id")),"卡片ID不一致");validateCard(card);}
        Set<String> ids=new HashSet<>(),dailyDates=new HashSet<>();Map<String,JSONObject> lookup=new HashMap<>();
        for(int i=0;i<events.length();i++){JSONObject e=events.getJSONObject(i);String id=e.getString("id");require(id.matches("[a-zA-Z0-9_-]{1,100}")&&ids.add(id),"历史ID无效或重复");require(cards.has(e.getString("cardId")),"历史缺少卡片");require(Arrays.asList("startup","daily").contains(e.getString("kind")),"历史类型无效");date(e.getString("date"));if(e.getString("kind").equals("daily")){require(dailyDates.add(e.getString("date")),"同一天含多张日签");require(daily.optString(e.getString("date")).equals(id),"日签缺少当天索引");}Instant.parse(e.getString("at"));require(e.get("imageRepeat") instanceof Boolean&&e.get("textRepeat") instanceof Boolean,"重复记录无效");lookup.put(id,e);}
        for(Iterator<String> it=daily.keys();it.hasNext();){String day=it.next();date(day);JSONObject e=lookup.get(daily.getString(day));require(e!=null&&e.getString("kind").equals("daily")&&e.getString("date").equals(day),"每日抽签记录不一致");}
        // Never trust imported counters. Every event is the source of truth for deduplication.
        rebuildUse(s);
    }
    private static void date(String s)throws Exception{require(s.matches("\\d{4}-\\d{2}-\\d{2}"),"日期无效");LocalDate.parse(s);}
    private static void require(boolean b,String m)throws Exception{if(!b)throw new Exception(m);}
    private static String bounded(JSONObject o,String k,int max)throws Exception{Object v=o.opt(k);require(v instanceof String&&((String)v).length()<=max,"图文文字无效："+k);return(String)v;}
    public static void validateCard(JSONObject c)throws Exception{
        require(!bounded(c,"text",100000).trim().isEmpty(),"文字不能为空");
        String language=bounded(c,"language",64);String translation=bounded(c,"translation",100000);
        require(language.startsWith("zh")||!translation.trim().isEmpty(),"外文需要中文释义");
        require(c.getString("imageKey").matches("[a-f0-9]{64}\\.(png|jpg)"),"图片文件名无效");
        require(c.getString("imageHash").matches("[a-f0-9]{64}")&&c.getString("imageKey").startsWith(c.getString("imageHash")+"."),"图片摘要无效");
        require(c.getString("textHash").equals(textHash(c.getString("text"))),"文字摘要无效");
        for(String k:new String[]{"imageId","imageSource","imageAuthor","imageTitle","imagePage","imageLicense","textId","textSource","textAuthor","textPage","textLicense","translationSource","theme","origin"})bounded(c,k,3000);
        require(c.get("favorite") instanceof Boolean&&c.get("ai") instanceof Boolean,"图文标记无效");Instant.parse(c.getString("createdAt"));
    }
    private static void bump(JSONObject use,String key,String at)throws Exception{JSONObject v=use.optJSONObject(key);if(v==null)v=new JSONObject().put("count",0);v.put("count",v.getInt("count")+1).put("lastAt",at);use.put(key,v);}
    static void rebuildUse(JSONObject s)throws Exception{
        JSONObject iu=new JSONObject(),tu=new JSONObject(),cards=s.getJSONObject("cards");JSONArray events=s.getJSONArray("events");
        for(int i=0;i<events.length();i++){JSONObject e=events.getJSONObject(i),c=cards.getJSONObject(e.getString("cardId"));String at=e.getString("at");bump(iu,c.getString("imageHash"),at);bump(iu,"id:"+c.getString("imageId"),at);bump(tu,c.getString("textHash"),at);}
        s.put("imageUse",iu).put("textUse",tu);
    }
    public static boolean imageSeen(JSONObject s,JSONObject c)throws Exception{return s.getJSONObject("imageUse").has(c.getString("imageHash"))||s.getJSONObject("imageUse").has("id:"+c.getString("imageId"));}
    public static boolean textSeen(JSONObject s,JSONObject c)throws Exception{return s.getJSONObject("textUse").has(c.getString("textHash"));}
    public static boolean imageIdSeen(JSONObject s,String id)throws Exception{return s.getJSONObject("imageUse").has("id:"+id);}
    private static boolean usable(Context c,JSONObject card)throws Exception{return card.getString("imageId").matches("(picsum:[0-9]+|met:[0-9]+)")&&media(c,card.getString("imageKey")).isFile();}
    private static JSONObject select(Context c,JSONObject s)throws Exception{
        List<JSONObject> ready=new ArrayList<>();JSONObject cards=s.getJSONObject("cards");
        List<JSONObject> cached=new ArrayList<>();
        for(Iterator<String> it=cards.keys();it.hasNext();){JSONObject card=cards.getJSONObject(it.next());if(usable(c,card)){cached.add(card);if(!imageSeen(s,card)&&!textSeen(s,card))ready.add(card);}}
        if(!ready.isEmpty())return ready.get(RANDOM.nextInt(ready.size()));
        if(cached.isEmpty())throw new NoImageException();
        // Reuse only genuine downloaded images, and choose the least recently exposed one.
        Collections.shuffle(cached,RANDOM);cached.sort((a,b)->{try{JSONObject x=s.getJSONObject("imageUse").optJSONObject("id:"+a.getString("imageId")),y=s.getJSONObject("imageUse").optJSONObject("id:"+b.getString("imageId"));return (x==null?"":x.optString("lastAt")).compareTo(y==null?"":y.optString("lastAt"));}catch(Exception e){return 0;}});JSONObject picture=cached.get(0);
        JSONArray library=new JSONArray(new String(read(c.getAssets().open("inspiration-library.json"),2*1024*1024),StandardCharsets.UTF_8));
        List<Integer> unused=new ArrayList<>();
        for(int i=0;i<library.length();i++){JSONObject t=library.getJSONObject(i);if(!s.getJSONObject("textUse").has(textHash(t.getString("text"))))unused.add(i);}
        int index;
        if(!unused.isEmpty())index=unused.get(RANDOM.nextInt(unused.size()));
        else {
            // Once the finite offline library is exhausted, prefer the oldest exposure.
            long oldest=Long.MAX_VALUE;List<Integer> oldestItems=new ArrayList<>();
            for(int i=0;i<library.length();i++){JSONObject u=s.getJSONObject("textUse").optJSONObject(textHash(library.getJSONObject(i).getString("text")));long time=u==null?0:Instant.parse(u.getString("lastAt")).toEpochMilli();if(time<oldest){oldest=time;oldestItems.clear();oldestItems.add(i);}else if(time==oldest)oldestItems.add(i);}
            index=oldestItems.get(RANDOM.nextInt(oldestItems.size()));
        }
        String id="cached_"+index+"_"+picture.getString("imageHash").substring(0,16);JSONObject card=cards.optJSONObject(id);
        if(card==null){JSONObject t=library.getJSONObject(index);card=baseCard(id,t.getString("text"),t.optString("language","zh"),t.optString("translation",""),t.optString("theme","心情"));for(String k:new String[]{"imageKey","imageHash","imageId","imageSource","imageAuthor","imageTitle","imagePage","imageLicense"})card.put(k,picture.getString(k));card.put("textId","original_"+index).put("textSource","每日学习原创文字（AI辅助）").put("textAuthor","每日学习").put("textPage","").put("textLicense","原创内容，允许个人保存和分享").put("translationSource",t.optString("translation","").isEmpty()?"":"每日学习原创中文释义").put("origin","cached").put("ai",true);cards.put(id,card);}
        return card;
    }
    public static JSONObject baseCard(String id,String text,String language,String translation,String theme)throws Exception{return new JSONObject().put("id",id).put("text",text).put("textHash",textHash(text)).put("language",language).put("translation",translation).put("theme",theme).put("ai",false).put("favorite",false).put("createdAt",Instant.now().toString());}
    public static void writeMedia(Context c,String key,byte[] bytes)throws Exception{require(bytes.length<=MAX_IMAGE_BYTES,"图片过大");require(key.startsWith(hash(bytes)+"."),"图片摘要不一致");AtomicFile f=new AtomicFile(media(c,key));FileOutputStream out=null;try{out=f.startWrite();out.write(bytes);f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}}
    static JSONObject event(JSONObject s,String id)throws Exception{JSONArray a=s.getJSONArray("events");for(int i=a.length()-1;i>=0;i--)if(a.getJSONObject(i).getString("id").equals(id))return a.getJSONObject(i);throw new Exception("没有找到这张图文记录");}
    public static JSONObject entry(JSONObject s,JSONObject e)throws Exception{return new JSONObject(e.toString()).put("card",new JSONObject(s.getJSONObject("cards").getJSONObject(e.getString("cardId")).toString()));}
    public static JSONObject record(Context c,String kind,String day)throws Exception{synchronized(LOCK){date(day);JSONObject s=load(c);if(kind.equals("daily")&&s.getJSONObject("daily").has(day))return entry(s,event(s,s.getJSONObject("daily").getString(day)));
        require(kind.equals("startup")||kind.equals("daily"),"展示类型无效");JSONObject card=select(c,s);JSONObject e=new JSONObject().put("id",UUID.randomUUID().toString()).put("cardId",card.getString("id")).put("kind",kind).put("date",day).put("at",Instant.now().toString()).put("imageRepeat",imageSeen(s,card)).put("textRepeat",textSeen(s,card));
        s.getJSONArray("events").put(e);if(kind.equals("daily"))s.getJSONObject("daily").put(day,e.getString("id"));save(c,s);return entry(s,e);
    }}
    public static JSONObject snapshot(Context c,String scope,int offset,int limit)throws Exception{synchronized(LOCK){JSONObject s=load(c);String day=LocalDate.now().toString();JSONObject result=new JSONObject().put("today",day).put("online",s.getJSONObject("settings").getBoolean("online")).put("lastFetchAt",s.getString("lastFetchAt")).put("lastFetchMessage",s.getString("lastFetchMessage")).put("items",new JSONArray());
        if(s.getJSONObject("daily").has(day))result.put("daily",entry(s,event(s,s.getJSONObject("daily").getString(day))));else result.put("daily",JSONObject.NULL);
        JSONArray a=s.getJSONArray("events");int total=0,favs=0,ready=0,cached=0;Set<String> favCards=new HashSet<>();JSONObject cards=s.getJSONObject("cards");
        for(Iterator<String> it=cards.keys();it.hasNext();){JSONObject card=cards.getJSONObject(it.next());if(card.getBoolean("favorite"))favs++;if(usable(c,card)){cached++;if(!imageSeen(s,card)&&!textSeen(s,card))ready++;}}
        for(int i=a.length()-1;i>=0;i--){JSONObject e=a.getJSONObject(i),card=cards.getJSONObject(e.getString("cardId"));boolean include=scope.equals("favorites")?card.getBoolean("favorite")&&favCards.add(card.getString("id")):e.getString("kind").equals(scope.equals("startup")?"startup":"daily");if(include){if(total>=Math.max(0,offset)&&result.getJSONArray("items").length()<Math.min(50,Math.max(1,limit)))result.getJSONArray("items").put(entry(s,e));total++;}}
        long bytes=0;File[] files=mediaDir(c).listFiles();if(files!=null)for(File f:files)if(f.isFile())bytes+=f.length();
        return result.put("total",total).put("favorites",favs).put("ready",ready).put("cached",cached).put("mediaBytes",bytes).put("events",a.length()).put("offset",Math.max(0,offset));
    }}
    public static JSONObject getEntry(Context c,String id)throws Exception{synchronized(LOCK){JSONObject s=load(c);return entry(s,event(s,id));}}
    public static void favorite(Context c,String id,boolean value)throws Exception{synchronized(LOCK){JSONObject s=load(c);JSONObject e=event(s,id);s.getJSONObject("cards").getJSONObject(e.getString("cardId")).put("favorite",value);save(c,s);}}
    public static void online(Context c,boolean enabled)throws Exception{synchronized(LOCK){JSONObject s=load(c);s.getJSONObject("settings").put("online",enabled);save(c,s);}}
    public static void addCandidate(Context c,JSONObject card)throws Exception{synchronized(LOCK){validateCard(card);require(media(c,card.getString("imageKey")).isFile(),"候选图片尚未就绪");JSONObject s=load(c);s.getJSONObject("cards").put(card.getString("id"),card);save(c,s);}}
    public static void fetchStatus(Context c,String message)throws Exception{synchronized(LOCK){JSONObject s=load(c);s.put("lastFetchAt",Instant.now().toString()).put("lastFetchMessage",message);save(c,s);}}
    public static int cleanPending(Context c)throws Exception{synchronized(LOCK){JSONObject s=load(c),cards=s.getJSONObject("cards");Set<String> kept=new HashSet<>();JSONArray events=s.getJSONArray("events");for(int i=0;i<events.length();i++)kept.add(events.getJSONObject(i).getString("cardId"));List<String> remove=new ArrayList<>();for(Iterator<String> it=cards.keys();it.hasNext();){String id=it.next();if(!kept.contains(id)&&!cards.getJSONObject(id).getBoolean("favorite"))remove.add(id);}for(String id:remove)cards.remove(id);save(c,s);Set<String> keys=new HashSet<>();for(Iterator<String> it=cards.keys();it.hasNext();)keys.add(cards.getJSONObject(it.next()).getString("imageKey"));int n=0;File[] files=mediaDir(c).listFiles();if(files!=null)for(File f:files)if(f.getName().matches("[a-f0-9]{64}\\.(png|jpg)")&&!keys.contains(f.getName())&&f.delete())n++;return n;}}
}
