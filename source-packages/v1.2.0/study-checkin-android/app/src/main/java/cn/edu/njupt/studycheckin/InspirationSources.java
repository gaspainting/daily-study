package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.graphics.BitmapFactory;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** HTTPS-only native fetching. The WebView never loads arbitrary internet content. */
public final class InspirationSources {
    private static final Random RANDOM=new Random();
    private static final Set<String> HOSTS=new HashSet<>(Arrays.asList("v1.hitokoto.cn","picsum.photos","fastly.picsum.photos","collectionapi.metmuseum.org","images.metmuseum.org"));
    private static final int[] ART_IDS={436535,437133,437127,438817,436524,436532,437853,459055,437874,435882,438821,437980,436121,437654,437921,436987,437131,436105,436089,437056,437261,437881,437404,436528};
    public static byte[] download(String address,int max)throws Exception{
        URL url=new URL(address);
        for(int redirect=0;redirect<5;redirect++){
            if(!url.getProtocol().equals("https")||!HOSTS.contains(url.getHost().toLowerCase(Locale.ROOT))||url.getUserInfo()!=null||(url.getPort()!=-1&&url.getPort()!=443))throw new Exception("素材地址不属于已支持的HTTPS来源");
            HttpURLConnection h=(HttpURLConnection)url.openConnection();h.setInstanceFollowRedirects(false);h.setConnectTimeout(7000);h.setReadTimeout(9000);h.setRequestProperty("User-Agent","DailyStudyPersonal");h.setRequestProperty("Accept","application/json,image/*");
            try{int status=h.getResponseCode();if(status>=300&&status<400){String target=h.getHeaderField("Location");if(target==null)throw new Exception("来源重定向无效");url=new URL(url,target);continue;}if(status!=200)throw new Exception("素材来源暂不可用（"+status+"）");long length=h.getContentLengthLong();if(length>max)throw new Exception("素材文件过大");byte[] bytes=InspirationStore.read(h.getInputStream(),max);if(length>=0&&bytes.length!=length)throw new Exception("素材下载未完成");return bytes;}finally{h.disconnect();}
        }throw new Exception("素材重定向过多");
    }
    private static JSONObject json(String url)throws Exception{return new JSONObject(new String(download(url,512*1024),StandardCharsets.UTF_8));}
    private static JSONObject originalText(Context c,JSONObject s)throws Exception{
        JSONArray a=new JSONArray(new String(InspirationStore.read(c.getAssets().open("inspiration-library.json"),2*1024*1024),StandardCharsets.UTF_8));List<Integer> choices=new ArrayList<>();for(int i=0;i<a.length();i++)if(!s.getJSONObject("textUse").has(InspirationStore.textHash(a.getJSONObject(i).getString("text"))))choices.add(i);
        int i=choices.isEmpty()?RANDOM.nextInt(a.length()):choices.get(RANDOM.nextInt(choices.size()));JSONObject t=a.getJSONObject(i);
        return InspirationStore.baseCard("online_"+UUID.randomUUID(),t.getString("text"),t.optString("language","zh"),t.optString("translation",""),t.optString("theme","心情")).put("textId","original_"+i).put("textSource","每日学习原创文字（AI辅助）").put("textAuthor","每日学习").put("textPage","").put("textLicense","原创内容，允许个人保存和分享").put("translationSource",t.optString("translation","").isEmpty()?"":"每日学习原创中文释义").put("ai",true);
    }
    private static JSONObject onlineText(Context c,JSONObject s)throws Exception{
        try{JSONObject q=json("https://v1.hitokoto.cn/?encode=json");String text=q.getString("hitokoto");boolean han=text.codePoints().anyMatch(cp->Character.UnicodeScript.of(cp)==Character.UnicodeScript.HAN);
            boolean foreign=text.codePoints().anyMatch(cp->Character.isLetter(cp)&&Character.UnicodeScript.of(cp)!=Character.UnicodeScript.HAN);
            if(!han||foreign||text.length()>100000||s.getJSONObject("textUse").has(InspirationStore.textHash(text)))return originalText(c,s);
            String type=q.optString("type","");String theme=new HashMap<String,String>(){{put("a","动漫");put("b","漫画");put("c","游戏");put("d","文学");put("e","原创");put("f","网络");put("g","其他");put("h","影视");put("i","诗词");put("j","音乐");put("k","哲学");put("l","心情");}}.getOrDefault(type,"心情");
            return InspirationStore.baseCard("online_"+UUID.randomUUID(),text,"zh","",theme).put("textId","hitokoto:"+q.optString("uuid",q.optString("id",""))).put("textSource","一言 · "+q.optString("from","未注明出处")).put("textAuthor",q.isNull("from_who")?"":q.optString("from_who","")).put("textPage","https://hitokoto.cn/").put("textLicense","一言来源协议；保留作者与出处").put("translationSource","");
        }catch(Exception unavailable){return originalText(c,s);}
    }
    private static JSONObject photo(JSONObject s)throws Exception{
        int page=1+RANDOM.nextInt(32);JSONArray a=new JSONArray(new String(download("https://picsum.photos/v2/list?page="+page+"&limit=30",512*1024),StandardCharsets.UTF_8));List<JSONObject> choices=new ArrayList<>();
        for(int i=0;i<a.length();i++){JSONObject p=a.getJSONObject(i);if(p.getString("id").matches("[0-9]+")&&Math.min(p.optInt("width"),p.optInt("height"))>=480&&!InspirationStore.imageIdSeen(s,"picsum:"+p.getString("id")))choices.add(p);}
        if(choices.isEmpty())throw new Exception("这一批照片已展示过");JSONObject x=choices.get(RANDOM.nextInt(choices.size()));
        return new JSONObject().put("imageId","picsum:"+x.getString("id")).put("imageSource","Lorem Picsum / Unsplash").put("imageAuthor",x.optString("author","")).put("imageTitle","摄影").put("imagePage",x.optString("url","https://picsum.photos/")).put("imageLicense","Unsplash License").put("download","https://picsum.photos/id/"+x.getString("id")+"/1000/750");
    }
    private static JSONObject art(JSONObject s)throws Exception{
        List<Integer> ids=new ArrayList<>();for(int id:ART_IDS)if(!InspirationStore.imageIdSeen(s,"met:"+id))ids.add(id);Collections.shuffle(ids);
        for(int i=0;i<Math.min(3,ids.size());i++){JSONObject x=json("https://collectionapi.metmuseum.org/public/collection/v1/objects/"+ids.get(i));String image=x.optString("primaryImageSmall","");if(!x.optBoolean("isPublicDomain")||image.isEmpty())continue;
            return new JSONObject().put("imageId","met:"+x.getInt("objectID")).put("imageSource","The Metropolitan Museum of Art").put("imageAuthor",x.optString("artistDisplayName","")).put("imageTitle",x.optString("title","")).put("imagePage",x.optString("objectURL","")).put("imageLicense","CC0 / Public Domain").put("download",image);
        }throw new Exception("这批开放艺术作品暂无可用图片");
    }
    public static String refresh(Context c)throws Exception{return refresh(c,null);}
    public static String refresh(Context c,Runnable onCandidate)throws Exception{
        if(!InspirationStore.load(c).getJSONObject("settings").getBoolean("online"))return "联网素材已关闭";
        int added=0;String last="";
        for(int round=0;round<3;round++){
            JSONObject s=InspirationStore.load(c);if(!s.getJSONObject("settings").getBoolean("online"))break;
            if(InspirationStore.snapshot(c,"daily",0,1).getInt("ready")>=8)break;
            try{
                JSONObject image;try{image=round%2==0?photo(s):art(s);}catch(Exception primary){image=round%2==0?art(s):photo(s);}
                byte[] bytes=download(image.getString("download"),InspirationStore.MAX_IMAGE_BYTES);String extension=ImageChecks.validate(bytes);
                // The first downloaded image need not wait on a second remote text service.
                JSONObject card=InspirationStore.snapshot(c,"daily",0,1).getInt("cached")==0?originalText(c,s):onlineText(c,s);String digest=InspirationStore.hash(bytes);String key=digest+"."+extension;InspirationStore.writeMedia(c,key,bytes);
                for(String k:new String[]{"imageId","imageSource","imageAuthor","imageTitle","imagePage","imageLicense"})card.put(k,image.getString(k));card.put("imageHash",digest).put("imageKey",key).put("origin","online");
                InspirationStore.addCandidate(c,card);added++;if(onCandidate!=null)onCandidate.run();Thread.sleep(650);
            }catch(Exception e){last=e.getMessage()==null?"网络暂不可用":e.getMessage();}
        }
        String message=added>0?"已准备 "+added+" 张图文":last.isEmpty()?"图文已就绪":"图文获取失败："+last;
        InspirationStore.fetchStatus(c,message);return message;
    }
}
