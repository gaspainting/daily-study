package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.util.List;

final class BridgeContractTests {
    static void run(Context context, List<String> passed) throws Exception {
        JSONObject fixture=new JSONObject(DataStore.readText(context.getAssets().open("rule-contract-cases.json")));
        bridgeCases(fixture,passed);
        referenceCases(fixture,passed);
        courseCases(fixture,passed);
        migrationCases(context,fixture,passed);
    }

    private static void bridgeCases(JSONObject fixture,List<String> passed)throws Exception{
        JSONArray bridge=fixture.getJSONArray("bridgeCases");
        for(int i=0;i<bridge.length();i++){
            JSONObject sample=bridge.getJSONObject(i);
            JSONObject request=envelope(sample.getString("name")+"-request",sample.getString("operation"),sample.getString("planId"),sample.getLong("expectedRevision"),sample.getJSONObject("payload"));
            BridgeContract.Request parsed=BridgeContract.parse(request.toString());
            check(passed,parsed.operation.equals(sample.getString("operation"))&&parsed.planId.equals("main")&&parsed.expectedRevision==7,"native parses shared "+sample.getString("name")+" request");
            JSONObject accepted=BridgeContract.accepted(parsed,8,new JSONObject().put("version",9).put("_revision",8),false);
            check(passed,accepted.getBoolean("accepted")&&accepted.getInt("contractVersion")==1&&accepted.getString("requestId").equals(parsed.requestId),"native returns versioned "+sample.getString("name")+" result");
        }
        JSONObject valid=envelope("contract-reject","state.save","main",0,new JSONObject());
        for(Object version:new Object[]{1.5,"1",true}){JSONObject bad=new JSONObject(valid.toString()).put("contractVersion",version);reject(bad.toString(),"native rejects non-integer bridge version "+version);}
        reject(new JSONObject(valid.toString()).put("requestId",7).toString(),"native rejects non-string request id");
        reject(new JSONObject(valid.toString()).put("expectedRevision",1.5).toString(),"native rejects fractional revision");
        boolean missingState=false;try{BridgeContract.accepted(BridgeContract.parse(valid.toString()),1,null,false);}catch(Exception expected){missingState=true;}
        check(passed,missingState,"native success response requires canonical state");

        DispatcherFixture handler=new DispatcherFixture();BridgeDispatcher dispatcher=new BridgeDispatcher(4);
        JSONObject first=new JSONObject(dispatcher.dispatch(envelope("dispatch-once","state.save","main",5,new JSONObject().put("_revision",5).put("value",1)).toString(),handler));
        JSONObject reordered=envelope("dispatch-once","state.save","main",5,new JSONObject().put("value",1).put("_revision",5));
        JSONObject replay=new JSONObject(dispatcher.dispatch(reordered.toString(),handler));
        check(passed,handler.executions==1&&first.getLong("revision")==6&&replay.getBoolean("replayed"),"native replays a duplicate request despite JSON key order");
        JSONObject mismatchRequest=envelope("dispatch-once","state.save","main",5,new JSONObject().put("_revision",5).put("value",99));
        JSONObject mismatch=new JSONObject(dispatcher.dispatch(mismatchRequest.toString(),handler));
        check(passed,!mismatch.getBoolean("accepted")&&handler.executions==1,"native rejects changed content for a reused request id");
        JSONObject stalePlan=new JSONObject(dispatcher.dispatch(envelope("wrong-plan","state.save","other",6,new JSONObject().put("_revision",6)).toString(),handler));
        check(passed,!stalePlan.getBoolean("accepted")&&handler.executions==1,"native rejects a request for an inactive plan");
        JSONObject staleRevision=new JSONObject(dispatcher.dispatch(envelope("stale-revision","state.save","main",5,new JSONObject().put("_revision",5)).toString(),handler));
        check(passed,!staleRevision.getBoolean("accepted")&&handler.executions==1,"native rejects an outdated revision");
    }

    private static void referenceCases(JSONObject fixture,List<String> passed)throws Exception{
        JSONArray cases=fixture.getJSONArray("referenceCases");
        for(int i=0;i<cases.length();i++){
            JSONObject sample=cases.getJSONObject(i);Object value=sample.get("value");Reference.validate(value,true);
            check(passed,Reference.min(value)==sample.getDouble("min")&&Reference.max(value)==sample.getDouble("max")&&Reference.midpoint(value)==sample.getDouble("midpoint")&&Reference.text(value).equals(sample.getString("text")),"native normalizes shared reference "+sample.getString("name"));
        }

        JSONObject sample=fixture.getJSONObject("captureCase"),state=sampleState(sample,new JSONObject());
        JSONObject basis=Reference.capture(state,LocalDate.parse(sample.getString("date")),"record","2026-10-27T12:00:00.000Z"),expected=sample.getJSONObject("expected");
        compareTime(basis.getJSONArray("time"),expected.getJSONArray("time"),passed);
        compareWords(basis.getJSONArray("words"),expected.getJSONArray("words"),passed);
        compareQuantities(basis.getJSONArray("quantities"),expected.getJSONArray("quantities"),passed);
        compareUnitMappings(basis,fixture.getJSONArray("unitCases"),passed);
        assessRecordCases(fixture,sample,passed);
    }

    private static JSONObject sampleState(JSONObject sample,JSONObject records)throws Exception{
        String date=sample.getString("date");JSONObject plan=new JSONObject().put("startDate",date).put("endDate",date).put("subjects",sample.getJSONArray("subjects"))
            .put("targets",new JSONObject().put(date,sample.getJSONObject("targets")))
            .put("wordTargets",new JSONObject().put(date,sample.getJSONObject("wordTargets")))
            .put("quantityTargets",new JSONObject().put(date,sample.getJSONObject("quantityTargets")));
        return new JSONObject().put("version",9).put("plan",plan).put("records",records);
    }

    private static void assessRecordCases(JSONObject fixture,JSONObject sample,List<String> passed)throws Exception{
        JSONArray cases=fixture.getJSONArray("recordCases");
        for(int i=0;i<cases.length();i++){
            JSONObject item=cases.getJSONObject(i),subjects=new JSONObject().put("math",new JSONObject().put("minutes",item.isNull("value")?JSONObject.NULL:item.get("value")))
                .put("course-review",new JSONObject().put("minutes",JSONObject.NULL));
            JSONObject record=new JSONObject().put("status","正常参考").put("subjects",subjects),records=new JSONObject().put(sample.getString("date"),record);
            JSONObject state=sampleState(sample,records),time=Reference.assess(state,LocalDate.parse(sample.getString("date"))).getJSONObject("time");
            boolean same=time.getString("kind").equals(item.getString("kind"))&&time.getInt("missing")==item.getInt("missing");
            Object actual=item.get("actual");same&=actual==JSONObject.NULL?time.isNull("actual"):!time.isNull("actual")&&time.getDouble("actual")==item.getDouble("actual");
            check(passed,same,"native assessment preserves shared "+item.getString("name")+" state");
        }
    }

    private static void compareTime(JSONArray actual,JSONArray expected,List<String> passed)throws Exception{
        boolean same=actual.length()==expected.length();
        for(int i=0;same&&i<actual.length();i++){
            JSONObject a=actual.getJSONObject(i),e=expected.getJSONObject(i);Object ref=a.get("reference");
            same=a.getString("id").equals(e.getString("id"))&&a.getString("kind").equals(e.getString("kind"))&&Reference.min(ref)==e.getDouble("min")&&Reference.max(ref)==e.getDouble("max");
        }
        check(passed,same,"native captures shared minute references as normalized ranges");
    }
    private static void compareWords(JSONArray actual,JSONArray expected,List<String> passed)throws Exception{
        boolean same=actual.length()==expected.length();
        for(int i=0;same&&i<actual.length();i++){
            JSONObject a=actual.getJSONObject(i),e=expected.getJSONObject(i);
            same=a.getString("id").equals(e.getString("id"))&&a.getInt("goal")==e.getInt("goal");
        }
        check(passed,same,"native captures shared vocabulary target");
    }
    private static void compareQuantities(JSONArray actual,JSONArray expected,List<String> passed)throws Exception{
        boolean same=actual.length()==expected.length();
        for(int i=0;same&&i<actual.length();i++){JSONObject a=actual.getJSONObject(i),e=expected.getJSONObject(i);same=a.getString("id").equals(e.getString("id"))&&a.getInt("goal")==e.getInt("goal")&&a.getString("unit").equals(e.getString("unit"));}
        check(passed,same,"native captures shared quantity target and unit");
    }
    private static void compareUnitMappings(JSONObject basis,JSONArray cases,List<String> passed)throws Exception{
        boolean same=true;
        for(int i=0;same&&i<cases.length();i++){
            JSONObject item=cases.getJSONObject(i);JSONArray rows="words".equals(item.getString("measure"))?basis.getJSONArray("words"):"time".equals(item.getString("measure"))?basis.getJSONArray("time"):basis.getJSONArray("quantities");
            JSONObject row=null;for(int j=0;j<rows.length();j++)if(rows.getJSONObject(j).getString("id").equals(item.getString("id")))row=rows.getJSONObject(j);
            same=row!=null;
            if(same&&"quantity".equals(item.getString("measure")))same=row.getString("unit").equals(item.getString("unit"));
        }
        check(passed,same,"native groups shared word, minute, and quantity measures by rule type");
    }

    private static void courseCases(JSONObject fixture,List<String> passed)throws Exception{
        JSONArray cases=fixture.getJSONArray("courseCases");
        for(int i=0;i<cases.length();i++){
            JSONObject sample=cases.getJSONObject(i),row=CourseSchedule.day(LocalDate.parse(sample.getString("date")));
            JSONArray actualCourses=row.getJSONArray("courses"),expectedCourses=sample.getJSONArray("courses");boolean same=row.getInt("weekday")==sample.getInt("weekday")&&actualCourses.length()==expectedCourses.length();
            for(int c=0;same&&c<actualCourses.length();c++)same=actualCourses.getString(c).equals(expectedCourses.getString(c));
            JSONObject review=row.getJSONObject("reviewRange"),math=row.getJSONObject("mathRange");
            same&=review.getDouble("min")==sample.getDouble("reviewMin")&&review.getDouble("max")==sample.getDouble("reviewMax")&&math.getDouble("min")==sample.getDouble("mathMin")&&math.getDouble("max")==sample.getDouble("mathMax");
            check(passed,same,"native course schedule matches shared sample "+sample.getString("date"));
        }
    }

    private static void migrationCases(Context context,JSONObject fixture,List<String> passed)throws Exception{
        JSONObject sample=fixture.getJSONArray("migrationCases").getJSONObject(0),legacy=new JSONObject(DataStore.readText(context.getAssets().open(sample.getString("fixture")))),before=new JSONObject(legacy.toString());
        JSONObject migrated=DataStore.migrateState(legacy);
        check(passed,migrated.getInt("version")==sample.getInt("expectedSchema")&&migrated.getJSONObject("records").toString().equals(before.getJSONObject("records").toString())&&legacy.toString().equals(before.toString()),"native migration fixture preserves historical records and source input");
        JSONArray wordLog=new JSONArray(DataStore.readText(context.getAssets().open("word-log-test-cases.json")));
        check(passed,wordLog.length()>0,"native shared word-detail fixture is available");
    }

    private static JSONObject envelope(String id,String operation,String plan,long revision,JSONObject payload)throws Exception{return new JSONObject().put("contractVersion",1).put("requestId",id).put("operation",operation).put("planId",plan).put("expectedRevision",revision).put("payload",payload);}
    private static void reject(String raw,String name)throws Exception{boolean rejected=false;try{BridgeContract.parse(raw);}catch(Exception expected){rejected=true;}if(!rejected)throw new Exception("FAIL: "+name);}
    private static void check(List<String> passed,boolean condition,String name)throws Exception{if(!condition)throw new Exception("FAIL: "+name);passed.add(name);}
    private static final class DispatcherFixture implements BridgeDispatcher.Handler{
        int executions;JSONObject state;
        DispatcherFixture()throws Exception{state=new JSONObject().put("_revision",5).put("value",0);}
        public String activePlanId(){return "main";}
        public JSONObject currentState()throws Exception{return new JSONObject(state.toString());}
        public JSONObject execute(BridgeContract.Request request)throws Exception{executions++;state=new JSONObject(request.payload.toString()).put("_revision",request.expectedRevision+1);return currentState();}
    }
}
