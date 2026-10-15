package cn.edu.njupt.studycheckin;
import org.json.JSONArray;
import org.json.JSONObject;
final class TestSubjects {
    static JSONObject inState(JSONObject state,String id)throws Exception{return inPlan(state.getJSONObject("plan"),id);}
    static JSONObject inPlan(JSONObject plan,String id)throws Exception{
        JSONArray subjects=plan.getJSONArray("subjects");for(int i=0;i<subjects.length();i++)if(subjects.getJSONObject(i).getString("id").equals(id))return subjects.getJSONObject(i);
        throw new Exception("Missing test subject: "+id);
    }
}
