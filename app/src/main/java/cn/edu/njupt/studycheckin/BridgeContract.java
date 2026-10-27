package cn.edu.njupt.studycheckin;

import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.TreeSet;
import java.math.BigDecimal;

/** Versioned command envelope shared by the WebView and native storage boundary. */
public final class BridgeContract {
    public static final int VERSION = 1;
    private static final Set<String> OPERATIONS = new HashSet<>(Arrays.asList("state.save", "evaluation.schedule.save"));
    private BridgeContract() {}

    public static final class Request {
        public final String requestId;
        public final String operation;
        public final String planId;
        public final long expectedRevision;
        public final JSONObject payload;
        private Request(String requestId, String operation, String planId, long expectedRevision, JSONObject payload) {
            this.requestId=requestId; this.operation=operation; this.planId=planId; this.expectedRevision=expectedRevision; this.payload=payload;
        }
        public String fingerprint() throws Exception { return operation+"|"+planId+"|"+expectedRevision+"|"+canonical(payload); }
    }

    public static Request parse(String raw) throws Exception {
        if (raw == null) throw new Exception("桥接请求缺失");
        JSONObject value = new JSONObject(raw);
        exact(value, "contractVersion", "requestId", "operation", "planId", "expectedRevision", "payload");
        Object version=value.opt("contractVersion");
        if (!(version instanceof Number) || !Double.isFinite(((Number)version).doubleValue()) || ((Number)version).doubleValue()!=VERSION) throw new Exception("桥接版本不兼容");
        Object requestIdValue=value.opt("requestId"),operationValue=value.opt("operation"),planIdValue=value.opt("planId");
        if(!(requestIdValue instanceof String)||!(operationValue instanceof String)||!(planIdValue instanceof String))throw new Exception("桥接请求字段无效");
        String requestId = (String)requestIdValue, operation = (String)operationValue, planId = (String)planIdValue;
        if (!requestId.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,95}")) throw new Exception("请求标识无效");
        if (!OPERATIONS.contains(operation)) throw new Exception("桥接操作无效");
        if (!planId.matches("[A-Za-z][A-Za-z0-9_-]{0,63}")) throw new Exception("计划标识无效");
        Object revision=value.opt("expectedRevision");
        if (!(revision instanceof Number) || ((Number)revision).doubleValue()<0 || Math.floor(((Number)revision).doubleValue())!=((Number)revision).doubleValue()) throw new Exception("修订号无效");
        long expected=((Number)revision).longValue(); if (expected<0 || expected>9007199254740991L) throw new Exception("修订号无效");
        JSONObject payload=value.optJSONObject("payload"); if(payload==null) throw new Exception("桥接内容无效");
        return new Request(requestId,operation,planId,expected,new JSONObject(payload.toString()));
    }

    public static JSONObject accepted(Request request, long revision, JSONObject state, boolean replayed) throws Exception {
        if(state==null)throw new Exception("桥接状态缺失");
        JSONObject out=new JSONObject().put("contractVersion",VERSION).put("requestId",request.requestId).put("operation",request.operation).put("planId",request.planId).put("accepted",true).put("revision",revision);
        out.put("state",new JSONObject(state.toString())); if(replayed)out.put("replayed",true); return out;
    }
    public static JSONObject rejected(Request request,String message) throws Exception { return new JSONObject().put("contractVersion",VERSION).put("requestId",request.requestId).put("operation",request.operation).put("planId",request.planId).put("accepted",false).put("error",message==null?"操作未完成":message); }
    private static void exact(JSONObject value,String... keys)throws Exception{Set<String> expected=new HashSet<>(Arrays.asList(keys));if(value.length()!=expected.size())throw new Exception("桥接请求字段无效");Iterator<String> it=value.keys();while(it.hasNext())if(!expected.contains(it.next()))throw new Exception("桥接请求字段无效");}
    private static String canonical(Object value)throws Exception{
        if(value instanceof JSONObject){JSONObject object=(JSONObject)value;Set<String> keys=new TreeSet<>();Iterator<String> iterator=object.keys();while(iterator.hasNext())keys.add(iterator.next());StringBuilder out=new StringBuilder("{");boolean first=true;for(String key:keys){if(!first)out.append(',');first=false;out.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key)));}return out.append('}').toString();}
        if(value instanceof org.json.JSONArray){org.json.JSONArray array=(org.json.JSONArray)value;StringBuilder out=new StringBuilder("[");for(int i=0;i<array.length();i++){if(i>0)out.append(',');out.append(canonical(array.get(i)));}return out.append(']').toString();}
        if(value instanceof Number)return new BigDecimal(value.toString()).stripTrailingZeros().toPlainString();
        if(value instanceof String)return JSONObject.quote((String)value);
        return String.valueOf(value);
    }
}
