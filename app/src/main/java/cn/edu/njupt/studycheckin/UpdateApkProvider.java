package cn.edu.njupt.studycheckin;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import org.json.JSONObject;
import java.io.File;
import java.io.FileNotFoundException;

/** Read-only access only to the APK whose complete validation succeeded. */
public final class UpdateApkProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    private File resolve(Uri uri)throws FileNotFoundException{
        try{
            String name=uri.getLastPathSegment();
            if(!"content".equals(uri.getScheme())||!(getContext().getPackageName()+".updates").equals(uri.getAuthority())||uri.getPathSegments().size()!=1||uri.getQuery()!=null||uri.getFragment()!=null||name==null||!name.matches("update-[0-9]+-[a-f0-9]{64}\\.apk"))throw new Exception();
            JSONObject verified=UpdateManager.persisted(getContext());
            if(!UpdateManager.fileName(verified).equals(name))throw new Exception();
            File file=new File(UpdateManager.directory(getContext()),name);
            if(!file.getCanonicalFile().getParentFile().equals(UpdateManager.directory(getContext()).getCanonicalFile()))throw new Exception();
            UpdateManager.verifyDownloaded(getContext(),verified,file);return file;
        }catch(Exception e){throw new FileNotFoundException("更新安装包不可用，请重新下载");}
    }
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException("仅允许读取");return ParcelFileDescriptor.open(resolve(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
    @Override public String getType(Uri uri){return "application/vnd.android.package-archive";}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
        try{File file=resolve(uri);String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor result=new MatrixCursor(columns);Object[] row=new Object[columns.length];for(int i=0;i<columns.length;i++)row[i]=OpenableColumns.DISPLAY_NAME.equals(columns[i])?file.getName():OpenableColumns.SIZE.equals(columns[i])?file.length():null;result.addRow(row);return result;}catch(FileNotFoundException e){return null;}
    }
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
}
