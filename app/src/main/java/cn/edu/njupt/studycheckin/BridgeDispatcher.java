package cn.edu.njupt.studycheckin;

import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.Map;

/** Serializes native commands, rejects stale plan/revision contexts and replays recent requests. */
public final class BridgeDispatcher {
    public interface Handler {
        String activePlanId() throws Exception;
        JSONObject currentState() throws Exception;
        JSONObject execute(BridgeContract.Request request) throws Exception;
    }
    private static final class Cached {
        final String fingerprint;
        final String response;
        Cached(String fingerprint,String response){this.fingerprint=fingerprint;this.response=response;}
    }
    private final LinkedHashMap<String,Cached> cache=new LinkedHashMap<>();
    private final int capacity;
    public BridgeDispatcher(){this(32);}
    BridgeDispatcher(int capacity){this.capacity=Math.max(1,capacity);}

    public synchronized String dispatch(String raw,Handler handler){
        BridgeContract.Request request=null;
        try{
            request=BridgeContract.parse(raw);String fingerprint=request.fingerprint();Cached cached=cache.get(request.requestId);
            if(cached!=null){if(!cached.fingerprint.equals(fingerprint))return BridgeContract.rejected(request,"重复请求内容不一致").toString();return new JSONObject(cached.response).put("replayed",true).toString();}
            if(!request.planId.equals(handler.activePlanId()))throw new Exception("计划已切换，请重新打开");
            JSONObject current=handler.currentState();if(current.optLong("_revision",0)!=request.expectedRevision)throw new Exception("记录已更新，请重新打开");
            JSONObject next=handler.execute(request);long revision=next.optLong("_revision",-1);if(revision<=request.expectedRevision)throw new Exception("保存结果未更新，请重新读取");
            JSONObject response=BridgeContract.accepted(request,revision,next,false);String text=response.toString();cache.put(request.requestId,new Cached(fingerprint,text));
            while(cache.size()>capacity){String first=cache.keySet().iterator().next();cache.remove(first);}return text;
        }catch(Exception error){try{if(request!=null)return BridgeContract.rejected(request,error.getMessage()).toString();}catch(Exception ignored){}return "{\"contractVersion\":1,\"accepted\":false,\"error\":\"桥接请求无效\"}";}
    }
}
