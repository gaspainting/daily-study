package cn.edu.njupt.studycheckin;

import android.app.Instrumentation;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.List;

/** Separate entry point so update tests can run without changing existing smoke assertions. */
public final class UpdateInstrumentation extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args){super.onCreate(args);arguments=args==null?new Bundle():args;start();}
    @Override public void onStart(){List<String> passes=new ArrayList<>();Bundle results=new Bundle();int code=-1;
        try{
            if("true".equals(arguments.getString("network"))){
                java.lang.reflect.Field generation=UpdateManager.class.getDeclaredField("generation");generation.setAccessible(true);
                java.lang.reflect.Method read=UpdateManager.class.getDeclaredMethod("readManifest",android.content.Context.class,long.class);read.setAccessible(true);
                org.json.JSONObject manifest=new org.json.JSONObject((String)read.invoke(null,getTargetContext(),generation.getLong(null)));
                UpdateManager.validateManifest(getTargetContext(),manifest);passes.add("actual native HTTPS transport and installed-signer validation accept the public manifest");
                if(manifest.getInt("versionCode")!=Integer.parseInt(arguments.getString("expectedCode")))throw new Exception("Unexpected public versionCode");passes.add("native public manifest has the expected latest build code");
                results.putString("publicManifest",manifest.toString());passes.add("public version URL size hash and signer are recorded");
            }else UpdateTests.run(getTargetContext(),passes);
            results.putString("stream","PASS "+passes.size()+" update checks\n"+String.join("\n",passes)+"\n");
        }
        catch(Exception e){results.putString("stream","FAILED after "+passes.size()+" update checks: "+e+"\n");code=0;}
        finish(code,results);
    }
}
