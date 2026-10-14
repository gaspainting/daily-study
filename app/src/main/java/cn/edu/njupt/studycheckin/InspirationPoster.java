package cn.edu.njupt.studycheckin;

import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.*;
import org.json.JSONObject;
import java.io.*;
import java.util.*;

/** Readable full-text posters, split at line boundaries instead of truncating long quotes. */
public final class InspirationPoster {
    private static final int WIDTH=1080,MARGIN=76,IMAGE_HEIGHT=680,MAX_HEIGHT=3900;
    private static StaticLayout layout(CharSequence text,int size,int color){TextPaint p=new TextPaint(Paint.ANTI_ALIAS_FLAG);p.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));p.setTextSize(size);p.setColor(color);return StaticLayout.Builder.obtain(text,0,text.length(),p,WIDTH-2*MARGIN).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).setLineSpacing(10,1.1f).setBreakStrategy(Layout.BREAK_STRATEGY_HIGH_QUALITY).build();}
    static String textForExport(JSONObject card)throws Exception{
        StringBuilder body=new StringBuilder(card.getString("text"));if(!card.getString("translation").isEmpty())body.append("\n\n中文释义\n").append(card.getString("translation"));
        body.append("\n\n——\n文字：");if(!card.getString("textAuthor").isEmpty())body.append(card.getString("textAuthor")).append(" · ");body.append(card.getString("textSource"));
        if(!card.getString("textPage").isEmpty())body.append("\n").append(card.getString("textPage"));
        body.append("\n图片：");if(!card.getString("imageAuthor").isEmpty())body.append(card.getString("imageAuthor")).append(" · ");body.append(card.getString("imageSource"));
        if(!card.getString("imageTitle").isEmpty())body.append("\n").append(card.getString("imageTitle"));if(!card.getString("imagePage").isEmpty())body.append("\n").append(card.getString("imagePage"));
        if(!card.getString("imageLicense").isEmpty())body.append("\n").append(card.getString("imageLicense"));
        if(!card.getString("translationSource").isEmpty())body.append("\n释义：").append(card.getString("translationSource"));
        if(card.getBoolean("ai")&&!card.getString("textId").startsWith("original_"))body.append("\n素材标记：含AI辅助内容");
        return body.toString();
    }
    public static ArrayList<File> render(Context c,String eventId)throws Exception{
        JSONObject entry=InspirationStore.getEntry(c,eventId),card=entry.getJSONObject("card");
        String body=textForExport(card);
        StaticLayout text=layout(body,38,0xff20201e);BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;File source=InspirationStore.media(c,card.getString("imageKey"));BitmapFactory.decodeFile(source.getPath(),options);options.inSampleSize=Math.max(1,Math.max(options.outWidth/1200,options.outHeight/1000));options.inJustDecodeBounds=false;Bitmap image=BitmapFactory.decodeFile(source.getPath(),options);if(image==null)throw new Exception("历史图片缺失，无法生成完整图文");
        List<int[]> portions=new ArrayList<>();int start=0;
        while(start<text.getLineCount()){int base=text.getLineTop(start),end=start;while(end<text.getLineCount()&&text.getLineBottom(end)-base<MAX_HEIGHT-IMAGE_HEIGHT-350)end++;if(end==start)end++;portions.add(new int[]{start,end});start=end;}
        File dir=exportDir(c);ArrayList<File> files=new ArrayList<>();String token=UUID.randomUUID().toString();
        try{for(int i=0;i<portions.size();i++){
            int[] span=portions.get(i);int top=text.getLineTop(span[0]),height=text.getLineBottom(span[1]-1)-top;Bitmap poster=Bitmap.createBitmap(WIDTH,IMAGE_HEIGHT+height+330,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(poster);canvas.drawColor(0xfff8f7f3);Paint p=new Paint(3);
            p.setColor(0xff20201e);p.setTextSize(29);p.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));canvas.drawText("每日学习  /  "+(entry.getString("kind").equals("daily")?"日签":"开屏回看"),MARGIN,65,p);p.setTextSize(25);canvas.drawText(entry.getString("date").replace('-','.'),MARGIN,112,p);
            RectF frame=new RectF(MARGIN,150,WIDTH-MARGIN,IMAGE_HEIGHT+80);float scale=Math.min(frame.width()/image.getWidth(),frame.height()/image.getHeight());float w=image.getWidth()*scale,h=image.getHeight()*scale;canvas.drawBitmap(image,null,new RectF(frame.centerX()-w/2,frame.centerY()-h/2,frame.centerX()+w/2,frame.centerY()+h/2),p);
            canvas.save();canvas.translate(MARGIN,IMAGE_HEIGHT+120);canvas.clipRect(0,0,WIDTH-2*MARGIN,height+3);canvas.translate(0,-top);text.draw(canvas);canvas.restore();
            p.setColor(0xff66655f);p.setTextSize(24);canvas.drawText("排版：每日学习",MARGIN,poster.getHeight()-70,p);canvas.drawText((i+1)+" / "+portions.size(),WIDTH-MARGIN-80,poster.getHeight()-70,p);
            File output=new File(dir,"card-"+token+"-"+(i+1)+".png");try(OutputStream out=new FileOutputStream(output)){if(!poster.compress(Bitmap.CompressFormat.PNG,100,out))throw new Exception("图片生成失败");}finally{poster.recycle();}files.add(output);
        }}finally{image.recycle();}
        return files;
    }
    public static File exportDir(Context c){File d=new File(c.getCacheDir(),"shared-cards");d.mkdirs();return d;}
    public static void cleanOldExports(Context c){File[] files=exportDir(c).listFiles();if(files!=null)for(File f:files)if(f.getName().matches("card-[a-f0-9-]+-[0-9]+\\.png")&&System.currentTimeMillis()-f.lastModified()>7L*24*3600*1000)f.delete();}
    public static int saveToGallery(Context c,ArrayList<File> files)throws Exception{
        if(Build.VERSION.SDK_INT<29)throw new Exception("此系统请通过分享面板将图文保存到文件");
        ArrayList<Uri> inserted=new ArrayList<>();try{for(int i=0;i<files.size();i++){
            ContentValues v=new ContentValues();v.put(MediaStore.Images.Media.DISPLAY_NAME,"每日学习_"+System.currentTimeMillis()+"_"+(i+1)+".png");v.put(MediaStore.Images.Media.MIME_TYPE,"image/png");v.put(MediaStore.Images.Media.RELATIVE_PATH,Environment.DIRECTORY_PICTURES+"/每日学习");v.put(MediaStore.Images.Media.IS_PENDING,1);
            Uri uri=c.getContentResolver().insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),v);if(uri==null)throw new Exception("相册无法创建图片");inserted.add(uri);
            try(OutputStream out=c.getContentResolver().openOutputStream(uri);InputStream in=new FileInputStream(files.get(i))){if(out==null)throw new Exception("相册无法写入图片");byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
        }for(Uri uri:inserted){ContentValues done=new ContentValues();done.put(MediaStore.Images.Media.IS_PENDING,0);if(c.getContentResolver().update(uri,done,null,null)!=1)throw new Exception("相册图片发布失败");}return inserted.size();
        }catch(Exception e){for(Uri uri:inserted)try{c.getContentResolver().delete(uri,null,null);}catch(Exception ignored){}throw e;}
    }
    public static Intent share(Context c,ArrayList<File> files,String id)throws Exception{
        JSONObject e=InspirationStore.getEntry(c,id),card=e.getJSONObject("card");ArrayList<Uri> uris=new ArrayList<>();for(File f:files)uris.add(Uri.parse("content://"+c.getPackageName()+".cards/"+f.getName()));
        Intent intent=new Intent(uris.size()==1?Intent.ACTION_SEND:Intent.ACTION_SEND_MULTIPLE).setType("image/png").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if(uris.size()==1)intent.putExtra(Intent.EXTRA_STREAM,uris.get(0));else intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris);
        ClipData clip=ClipData.newUri(c.getContentResolver(),"每日学习图文",uris.get(0));for(int i=1;i<uris.size();i++)clip.addItem(new ClipData.Item(uris.get(i)));intent.setClipData(clip);
        intent.putExtra(Intent.EXTRA_TEXT,textForExport(card)+"\n\n排版：每日学习");return Intent.createChooser(intent,"分享图文");
    }
}
