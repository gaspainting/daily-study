package cn.edu.njupt.studycheckin;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

/** Structural checks preserve artistic freedom; they do not filter mood, color or art style. */
public final class ImageChecks {
    public static String validate(byte[] bytes)throws Exception{
        if(bytes==null||bytes.length<512||bytes.length>InspirationStore.MAX_IMAGE_BYTES)throw new Exception("图片文件大小无效");
        boolean jpeg=(bytes[0]&255)==255&&(bytes[1]&255)==216;
        boolean png=(bytes[0]&255)==137&&bytes[1]==80&&bytes[2]==78&&bytes[3]==71;
        if(!jpeg&&!png)throw new Exception("来源返回的内容不是JPEG或PNG图片");
        if(jpeg&&((bytes[bytes.length-2]&255)!=255||(bytes[bytes.length-1]&255)!=217))throw new Exception("JPEG图片下载不完整");
        if(png&&(bytes.length<12||bytes[bytes.length-8]!=73||bytes[bytes.length-7]!=69||bytes[bytes.length-6]!=78||bytes[bytes.length-5]!=68))throw new Exception("PNG图片下载不完整");
        BitmapFactory.Options opts=new BitmapFactory.Options();opts.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,opts);
        if(Math.min(opts.outWidth,opts.outHeight)<240||Math.max(opts.outWidth,opts.outHeight)>10000||(long)opts.outWidth*opts.outHeight>24000000L)throw new Exception("图片尺寸不适合展示");
        opts.inSampleSize=Math.max(1,Math.max(opts.outWidth/1200,opts.outHeight/1200));opts.inJustDecodeBounds=false;Bitmap decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.length,opts);if(decoded==null)throw new Exception("图片无法完整解码");decoded.recycle();return png?"png":"jpg";
    }
}
