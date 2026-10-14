package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.HashMap;

/** Readable exports keep absent observations distinct from an observed zero. */
public final class ReportExport {
    private static final String[] HEADERS = {"日期", "科目", "参考时长（分钟）", "已记录（分钟）", "今日安排", "休息记录", "随记", "学习内容", "问题", "新词数", "复习词数", "生词", "计时次数", "计时秒数", "计划", "新学目标（个）", "计量方式"};
    private ReportExport() {}
    private static Typeface reportTypeface;
    private static synchronized Typeface font(Context context) {
        if(reportTypeface==null)reportTypeface=Typeface.createFromAsset(context.getAssets(),"report-font.ttf");
        return reportTypeface;
    }

    public static void write(Context context, JSONObject state, OutputStream output, String format, String start, String end, String subjectId) throws Exception {
        if (output == null) throw new Exception("无法写入所选文件");
        if (!"csv".equals(format) && !"pdf".equals(format)) throw new Exception("请选择 CSV 或 PDF");
        LocalDate first = date(start), last = date(end);
        long days = ChronoUnit.DAYS.between(first, last) + 1;
        if (days < 1 || days > 3660) throw new Exception("导出日期范围须为 1 至 3660 天");
        DataStore.validate(state);
        List<JSONObject> selected = new ArrayList<>();
        JSONArray subjects = state.getJSONObject("plan").getJSONArray("subjects");
        boolean all = subjectId == null || subjectId.isEmpty() || "all".equals(subjectId);
        for (int i = 0; i < subjects.length(); i++) {
            JSONObject subject = subjects.getJSONObject(i);
            if (all || subject.getString("id").equals(subjectId)) selected.add(subject);
        }
        if (selected.isEmpty()) throw new Exception("请选择有效科目");
        List<Row> rows = rows(state, first, last, selected);
        Map<String,Total> totals=totals(rows);
        if ("csv".equals(format)) csv(output, state.getJSONObject("plan").getString("title"), rows, totals, selected);
        else pdf(output, font(context), state.getJSONObject("plan").getString("title"), start, end, rows, totals, selected);
    }

    private static LocalDate date(String value) throws Exception {
        if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}")) throw new Exception("日期格式应为 YYYY-MM-DD");
        try {
            LocalDate date = LocalDate.parse(value);
            if (date.getYear() < 1900 || date.getYear() > 2100) throw new Exception("日期超出支持范围");
            return date;
        } catch (java.time.DateTimeException e) { throw new Exception("日期不存在"); }
    }
    private static String text(JSONObject object, String key) {
        return object == null || object.isNull(key) ? "" : object.optString(key, "");
    }
    private static Double number(JSONObject object, String key) {
        return object == null || object.isNull(key) || !object.has(key) ? null : object.optDouble(key);
    }
    private static String quantity(Double value) { return value == null ? "未记录" : decimal(value); }
    private static String decimal(double value) { return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString(); }
    private static String rest(JSONObject record) {
        return record == null || record.isNull("restKept") ? "未记录" : record.optBoolean("restKept") ? "是" : "否";
    }
    private static final class Row {
        String day, id, name, status, rest, note, content, problem, forgot;
        Double reference, minutes, newWords, reviewWords, wordGoal;
        boolean wordBased;
        int sessionCount;
        double sessionSeconds;
        String[] cells() { return new String[]{day, name, reference == null ? "—" : decimal(reference), quantity(minutes), status, rest, note, content, problem, quantity(newWords), quantity(reviewWords), forgot, Integer.toString(sessionCount), decimal(sessionSeconds)}; }
    }
    private static List<Row> rows(JSONObject state, LocalDate first, LocalDate last, List<JSONObject> subjects) throws Exception {
        List<Row> rows = new ArrayList<>();
        JSONObject plan = state.getJSONObject("plan"), records = state.getJSONObject("records"), targets = plan.getJSONObject("targets");
        LocalDate planStart = LocalDate.parse(plan.getString("startDate")), planEnd = LocalDate.parse(plan.getString("endDate"));
        JSONObject byDate = sessions(state, first, last);
        for (LocalDate date = first; !date.isAfter(last); date = date.plusDays(1)) {
            String day = date.toString();
            int rowsBefore = rows.size();
            JSONObject record = records.optJSONObject(day), subjectRecords = record == null ? null : record.optJSONObject("subjects"), dailyTargets = targets.optJSONObject(day);
            for (JSONObject subject : subjects) {
                Row row = new Row(); row.day = day; row.id = subject.getString("id"); row.name = subject.getString("name"); row.wordBased="vocab".equals(subject.getString("kind"));
                JSONObject entry = subjectRecords == null ? null : subjectRecords.optJSONObject(row.id);
                row.minutes = number(entry, "minutes"); row.newWords = number(entry, "newWords"); row.reviewWords = number(entry, "reviewWords");
                row.content = text(entry, "content"); row.problem = text(entry, "problem"); row.forgot = text(entry, "forgotWords");
                row.status = text(record, "status"); row.note = text(record, "note"); row.rest = rest(record);
                boolean active = DataStore.activeSubject(subject, date);
                if (active && !date.isBefore(planStart) && !date.isAfter(planEnd)) row.reference = dailyTargets != null && dailyTargets.has(row.id) ? dailyTargets.getDouble(row.id) : subject.getJSONArray("defaults").getDouble(date.getDayOfWeek().getValue() - 1);
                if(row.wordBased&&active&&!date.isBefore(planStart)&&!date.isAfter(planEnd))row.wordGoal=(double)DataStore.wordTarget(state,day,row.id);
                JSONObject daySessions = byDate.optJSONObject(day), count = daySessions == null ? null : daySessions.optJSONObject(row.id);
                if (count != null) { row.sessionCount = count.getInt("count"); row.sessionSeconds = count.getDouble("seconds"); }
                if (!active && row.minutes == null && row.newWords == null && row.reviewWords == null && row.content.isEmpty() && row.problem.isEmpty() && row.forgot.isEmpty() && row.sessionCount == 0) continue;
                rows.add(row);
            }
            if (rows.size() == rowsBefore && record != null && (!text(record, "note").isEmpty() || !record.isNull("status") || !record.isNull("restKept"))) {
                Row row = new Row(); row.day = day; row.id = ""; row.name = "—"; row.status = text(record, "status"); row.note = text(record, "note"); row.rest = rest(record); row.content = row.problem = row.forgot = ""; rows.add(row);
            }
        }
        return rows;
    }
    private static JSONObject sessions(JSONObject state, LocalDate first, LocalDate last) throws Exception {
        JSONObject result = new JSONObject(); Set<String> seen = new HashSet<>();
        addSessions(result, seen, state.optJSONArray("sessions"), first, last);
        JSONObject records = state.getJSONObject("records"); Iterator<String> keys = records.keys();
        while (keys.hasNext()) {
            String day = keys.next(); LocalDate date = LocalDate.parse(day);
            if (!date.isBefore(first) && !date.isAfter(last)) addSessions(result, seen, records.getJSONObject(day).optJSONArray("sessions"), first, last);
        }
        return result;
    }
    private static void addSessions(JSONObject result, Set<String> seen, JSONArray sessions, LocalDate first, LocalDate last) throws Exception {
        if (sessions == null) return;
        for (int i = 0; i < sessions.length(); i++) {
            JSONObject session = sessions.getJSONObject(i); String id = session.getString("id"), day = session.getString("date"), subject = session.getString("subjectId");
            LocalDate date = LocalDate.parse(day);
            if (date.isBefore(first) || date.isAfter(last) || !seen.add(id)) continue;
            if (!result.has(day)) result.put(day, new JSONObject());
            JSONObject daily = result.getJSONObject(day);
            if (!daily.has(subject)) daily.put(subject, new JSONObject().put("count", 0).put("seconds", 0));
            JSONObject count = daily.getJSONObject(subject); count.put("count", count.getInt("count") + 1).put("seconds", count.getDouble("seconds") + session.getDouble("seconds"));
        }
    }
    private static final class Total {
        double actual, reference, learned, reviewed, wordGoal; int recorded, referenceDays, days, newDays, reviewDays, goalDays;
    }
    private static Map<String,Total> totals(List<Row> rows) {
        Map<String,Total> result=new HashMap<>();
        for (Row row : rows) {
            Total total=result.get(row.id);if(total==null){total=new Total();result.put(row.id,total);}
            total.days++;
            if(row.newWords!=null){total.learned+=row.newWords;total.newDays++;}if(row.reviewWords!=null){total.reviewed+=row.reviewWords;total.reviewDays++;}if(row.wordGoal!=null){total.wordGoal+=row.wordGoal;total.goalDays++;}
            if (row.minutes != null) { total.actual += row.minutes; total.recorded++; }
            if (row.reference != null) { total.reference += row.reference; total.referenceDays++; }
        }
        return result;
    }
    private static void csv(OutputStream output, String title, List<Row> rows, Map<String,Total> totals, List<JSONObject> subjects) throws Exception {
        OutputStreamWriter writer = new OutputStreamWriter(output, StandardCharsets.UTF_8); writer.write('\ufeff');
        csvLine(writer, HEADERS);
        for (Row row : rows) { String[] cells = java.util.Arrays.copyOf(row.cells(), HEADERS.length); cells[14] = title; cells[15]=row.wordGoal==null?"—":decimal(row.wordGoal);cells[16]=row.id.isEmpty()?"—":row.wordBased?"词数":"分钟";csvLine(writer, cells); }
        for (JSONObject subject : subjects) {
            Total total = totals.getOrDefault(subject.getString("id"),new Total());
            String[] cells = new String[HEADERS.length]; java.util.Arrays.fill(cells, "");
            cells[0] = "合计"; cells[1] = subject.getString("name"); cells[2] = total.referenceDays == 0 ? "—" : decimal(total.reference); cells[3] = total.recorded == 0 ? "未记录" : decimal(total.actual); cells[4] = total.recorded + "/" + total.days + " 天已记录";
            cells[9]=total.newDays==0?"未记录":decimal(total.learned);cells[10]=total.reviewDays==0?"未记录":decimal(total.reviewed);cells[15]=total.goalDays==0?"—":decimal(total.wordGoal);cells[16]="vocab".equals(subject.getString("kind"))?"词数":"分钟";
            cells[14] = title;
            csvLine(writer, cells);
        }
        writer.flush();
    }
    private static void csvLine(OutputStreamWriter writer, String[] values) throws Exception {
        for (int i = 0; i < values.length; i++) {
            if (i > 0) writer.write(','); String value = csvSafe(values[i]); writer.write('"'); writer.write(value.replace("\"", "\"\"")); writer.write('"');
        }
        writer.write("\r\n");
    }
    private static String csvSafe(String value) {
        if (value == null) return "";
        int index = 0;
        while (index < value.length() && (Character.isWhitespace(value.charAt(index)) || Character.isSpaceChar(value.charAt(index)) || value.charAt(index) < 32)) index++;
        if (index < value.length() && "=+-@".indexOf(value.charAt(index)) >= 0) return "'" + value;
        return value;
    }
    private static void pdf(OutputStream output, Typeface font, String title, String start, String end, List<Row> rows, Map<String,Total> totals, List<JSONObject> subjects) throws Exception {
        PdfDocument document = new PdfDocument();
        try {
            Pages pages = new Pages(document, font, title, start + " 至 " + end);
            for (JSONObject subject : subjects) {
                Total total = totals.getOrDefault(subject.getString("id"),new Total());
                if("vocab".equals(subject.getString("kind"))){pages.paragraph(subject.getString("name")+" · 新学 "+(total.newDays==0?"未记录":decimal(total.learned)+" 个")+" / 目标 "+(total.goalDays==0?"—":decimal(total.wordGoal)+" 个")+" · 复习 "+(total.reviewDays==0?"未记录":decimal(total.reviewed)+" 个"),true);pages.paragraph("新学记录 "+total.newDays+"/"+total.days+" 天 · 复习记录 "+total.reviewDays+"/"+total.days+" 天",false);if(total.recorded>0)pages.paragraph("历史时长："+decimal(total.actual)+" 分钟",false);}
                else pages.paragraph(subject.getString("name") + " · 参考 " + (total.referenceDays == 0 ? "—" : decimal(total.reference) + " 分钟") + " · 已记录 " + (total.recorded == 0 ? "未记录" : decimal(total.actual) + " 分钟") + " · " + total.recorded + "/" + total.days + " 天", true);
            }
            pages.gap(8);
            for (Row row : rows) {
                pages.keep(row.wordBased?3:2);
                pages.paragraph(row.day + "  " + row.name, true);
                if(row.wordBased){pages.paragraph("新学："+quantity(row.newWords)+(row.newWords==null?"":" 个")+"    目标："+(row.wordGoal==null?"—":decimal(row.wordGoal)+" 个"),false);pages.paragraph("复习："+quantity(row.reviewWords)+(row.reviewWords==null?"":" 个"),false);if(row.minutes!=null)pages.paragraph("历史时长："+decimal(row.minutes)+" 分钟",false);}
                else pages.paragraph("参考时长：" + (row.reference == null ? "—" : decimal(row.reference) + " 分钟") + "    已记录：" + (row.minutes == null ? "未记录" : decimal(row.minutes) + " 分钟"), false);
                if (!row.status.isEmpty()) pages.paragraph("今日安排：" + row.status, false);
                if (!"未记录".equals(row.rest)) pages.paragraph("休息记录：" + row.rest, false);
                field(pages, "学习内容", row.content); field(pages, "问题", row.problem);
                if (!row.wordBased && (row.newWords != null || row.reviewWords != null)) pages.paragraph("新词数：" + quantity(row.newWords) + "    复习词数：" + quantity(row.reviewWords), false);
                field(pages, "生词", row.forgot); field(pages, "随记", row.note);
                if (row.sessionCount > 0) pages.paragraph("计时：" + row.sessionCount + " 次 · " + decimal(row.sessionSeconds) + " 秒", false);
                pages.rule();
            }
            pages.finish(); document.writeTo(output); output.flush();
        } finally { document.close(); }
    }
    private static void field(Pages pages, String label, String value) { if (!value.isEmpty()) pages.paragraph(label + "：" + value, false); }
    private static final class Pages {
        final PdfDocument document; final Typeface font; final String title, range; final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        PdfDocument.Page page; Canvas canvas; int pageNumber; float y;
        static final float LEFT = 42, RIGHT = 553, BOTTOM = 790, LEADING = 18;
        Pages(PdfDocument document, Typeface font, String title, String range) { this.document = document; this.font=font;this.title = title; this.range = range; paint.setColor(Color.BLACK);paint.setTypeface(font);line.setColor(Color.GRAY); line.setStrokeWidth(0.5f); newPage(); }
        void newPage() {
            if (page != null) endPage();
            if (pageNumber >= 1000) throw new IllegalStateException("PDF 内容较多，请缩小日期范围或选择科目");
            page = document.startPage(new PdfDocument.PageInfo.Builder(595, 842, ++pageNumber).create()); canvas = page.getCanvas();
            paint.setFakeBoldText(true); paint.setTextSize(16); canvas.drawText("学习记录", LEFT, 44, paint);
            paint.setFakeBoldText(false); paint.setTextSize(11); float headerY = 65;
            for (String part : title.replaceAll("\\s+", " ").trim().split("\n", -1)) {
                int offset = 0;
                if (part.isEmpty()) { headerY += 16; continue; }
                while (offset < part.length()) {
                    int count = paint.breakText(part, offset, part.length(), true, RIGHT - LEFT, null);
                    if (count < 1) count = Character.charCount(part.codePointAt(offset));
                    if (offset + count < part.length() && Character.isHighSurrogate(part.charAt(offset + count - 1))) count--;
                    if (count < 1) count = Character.charCount(part.codePointAt(offset));
                    canvas.drawText(part.substring(offset, offset + count), LEFT, headerY, paint); headerY += 16; offset += count;
                }
            }
            paint.setTextSize(10); canvas.drawText(range, LEFT, headerY + 4, paint); y = headerY + 29;
        }
        void endPage() { paint.setFakeBoldText(false); paint.setTextSize(9); canvas.drawText(Integer.toString(pageNumber), RIGHT - 20, 818, paint); document.finishPage(page); page = null; }
        void paragraph(String text, boolean bold) {
            paint.setFakeBoldText(bold); paint.setTextSize(bold ? 11 : 10);
            String[] paragraphs = text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
            for (String paragraph : paragraphs) {
                if (paragraph.isEmpty()) { writeLine("", bold); continue; }
                int offset = 0;
                while (offset < paragraph.length()) {
                    int count = paint.breakText(paragraph, offset, paragraph.length(), true, RIGHT - LEFT, null);
                    if (count < 1) count = Character.charCount(paragraph.codePointAt(offset));
                    if (offset + count < paragraph.length() && Character.isHighSurrogate(paragraph.charAt(offset + count - 1))) count--;
                    if (count < 1) count = Character.charCount(paragraph.codePointAt(offset));
                    writeLine(paragraph.substring(offset, offset + count), bold); offset += count;
                }
            }
        }
        void writeLine(String text, boolean bold) {
            if (y + LEADING > BOTTOM) newPage();
            paint.setFakeBoldText(bold); paint.setTextSize(bold ? 11 : 10); canvas.drawText(text, LEFT, y, paint); y += LEADING;
        }
        void gap(float amount) { if (y + amount > BOTTOM) newPage(); else y += amount; }
        void keep(int lines) { if(y + LEADING * lines > BOTTOM) newPage(); }
        void rule() { if(y + 24 > BOTTOM){y=BOTTOM;return;}y+=4;canvas.drawLine(LEFT,y,RIGHT,y,line);y+=20; }
        void finish() { if (page != null) endPage(); }
    }
}
