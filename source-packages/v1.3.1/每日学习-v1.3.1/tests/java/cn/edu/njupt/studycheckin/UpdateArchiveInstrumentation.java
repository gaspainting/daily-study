package cn.edu.njupt.studycheckin;

import android.app.Instrumentation;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.List;

public final class UpdateArchiveInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){List<String> passes=new ArrayList<>();Bundle results=new Bundle();int code=-1;
        try{UpdateArchiveTests.run(getTargetContext(),passes);results.putString("stream","PASS "+passes.size()+" signed archive checks\n"+String.join("\n",passes)+"\n");}
        catch(Exception e){results.putString("stream","FAILED after "+passes.size()+" signed archive checks: "+e+"\n");code=0;}
        finish(code,results);
    }
}
