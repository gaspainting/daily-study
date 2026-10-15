package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class ReportTests {
    private interface Action { void run() throws Exception; }
    private static void check(List<String> passes, boolean condition, String name) throws Exception { if (!condition) throw new Exception("FAIL: " + name); passes.add(name); }
    private static void rejects(List<String> passes, Action action, String name) throws Exception { boolean failed = false; try { action.run(); } catch (Exception expected) { failed = true; } check(passes, failed, name); }
    private static JSONObject entry(Object value) throws Exception { return new JSONObject().put("minutes", value).put("content", "").put("problem", "").put("newWords", JSONObject.NULL).put("reviewWords", JSONObject.NULL).put("forgotWords", ""); }
    private static JSONObject record(JSONObject subjects, Object status, String note) throws Exception { return new JSONObject().put("subjects", subjects).put("status", status).put("restKept", JSONObject.NULL).put("note", note); }
    static void run(Context original, List<String> passes) throws Exception {
        String stateBefore = DataStore.load(original).toString();
        JSONObject state = new JSONObject(DataStore.readText(original.getAssets().open("seed.json")));
        JSONObject entries = new JSONObject().put("math", entry(JSONObject.NULL)).put("vocab", entry(0));
        entries.getJSONObject("math").put("content", "第一行,含逗号\n第二行\"引号\"").put("problem", "  @SUM(1,2)");
        state.getJSONObject("records").put("2026-10-14", record(entries, "休息", "=SUM(1,2)"));
        JSONObject session = new JSONObject().put("id", "session-report").put("date", "2026-10-14").put("subjectId", "vocab").put("seconds", 75.5).put("endedAt", "2026-10-14T10:00:00Z");
        state.put("sessions", new JSONArray().put(session)); state.getJSONObject("records").getJSONObject("2026-10-14").put("sessions", new JSONArray().put(new JSONObject(session.toString())));
        String inputBefore = state.toString();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ReportExport.write(original, state, output, "csv", "2026-10-14", "2026-10-15", "all");
        byte[] bytes = output.toByteArray(); String csv = new String(bytes, StandardCharsets.UTF_8); List<String[]> rows = parse(csv);
        check(passes, bytes.length > 3 && (bytes[0] & 255) == 239 && (bytes[1] & 255) == 187 && (bytes[2] & 255) == 191, "CSV has UTF8 BOM for Chinese Excel text");
        check(passes, rows.size() == 7 && rows.get(0)[2].equals("参考时长（分钟）") && rows.get(0)[3].equals("已记录（分钟）"), "CSV has separate reference and observed headers with daily rows and subject totals");
        check(passes, rows.get(1)[3].equals("未记录") && rows.get(2)[3].equals("0"), "CSV distinguishes unrecorded and explicit zero in a partial rest day");
        check(passes, rows.get(1)[4].equals("休息") && rows.get(2)[4].equals("休息") && rows.get(1)[5].equals("未记录"), "CSV rest label leaves unknown rest and time values unknown");
        check(passes, rows.get(1)[7].equals("第一行,含逗号\n第二行\"引号\""), "CSV quoted comma multiline and quote roundtrip without corruption");
        check(passes, rows.get(1)[6].equals("'=SUM(1,2)") && rows.get(1)[8].equals("'  @SUM(1,2)"), "CSV neutralizes formula content after leading whitespace");
        check(passes, rows.get(2)[12].equals("1") && rows.get(2)[13].equals("75.5"), "CSV counts duplicated legacy and root session ID once using stored net seconds");
        check(passes, rows.get(1)[14].equals(state.getJSONObject("plan").getString("title")), "CSV rows retain actual plan title to distinguish independent plan reports");
        check(passes, rows.get(5)[3].equals("未记录") && rows.get(5)[4].equals("0/2 天已记录") && rows.get(6)[3].equals("0") && rows.get(6)[4].equals("1/2 天已记录"), "CSV totals distinguish no observations from an observed zero");
        check(passes, inputBefore.equals(state.toString()), "CSV export does not change input state or infer actual minutes");
        output.reset(); ReportExport.write(original, state, output, "csv", "2026-10-14", "2026-10-14", "vocab"); rows = parse(new String(output.toByteArray(), StandardCharsets.UTF_8));
        check(passes, rows.size() == 3 && rows.get(1)[1].equals("单词"), "CSV selected subject does not emit unrelated subjects");
        output.reset(); ReportExport.write(original, state, output, "csv", "2026-10-11", "2026-10-11", "math"); rows = parse(new String(output.toByteArray(), StandardCharsets.UTF_8));
        check(passes, rows.get(1)[2].equals("—") && rows.get(2)[2].equals("—") && rows.get(1)[3].equals("未记录"), "CSV outside plan has no invented reference or actual zero");
        JSONObject archived = DataStore.migrateState(state); TestSubjects.inState(archived,"vocab").put("activePeriods", new JSONArray().put(new JSONObject().put("from", "1900-01-01").put("to", "2026-10-14")));
        output.reset(); ReportExport.write(original, archived, output, "csv", "2026-10-14", "2026-10-15", "vocab"); rows = parse(new String(output.toByteArray(), StandardCharsets.UTF_8));
        check(passes, rows.size() == 3 && rows.get(1)[3].equals("0") && rows.get(1)[2].equals("—") && rows.get(2)[4].equals("1/1 天已记录"), "CSV retains archived historical actual and skips inactive empty dates");
        JSONObject noteOnly = DataStore.migrateState(state);
        for (int i = 0; i < noteOnly.getJSONObject("plan").getJSONArray("subjects").length(); i++) noteOnly.getJSONObject("plan").getJSONArray("subjects").getJSONObject(i).put("activePeriods", new JSONArray().put(new JSONObject().put("from", "1900-01-01").put("to", "2026-10-14")));
        noteOnly.getJSONObject("records").put("2026-10-15", new JSONObject().put("subjects", new JSONObject()).put("status", "休息").put("restKept", true).put("note", "归档后仍保留随记"));
        output.reset(); ReportExport.write(original, noteOnly, output, "csv", "2026-10-15", "2026-10-15", "all"); rows = parse(new String(output.toByteArray(), StandardCharsets.UTF_8));
        check(passes, rows.size() == 2+noteOnly.getJSONObject("plan").getJSONArray("subjects").length() && rows.get(1)[1].equals("—") && rows.get(1)[6].equals("归档后仍保留随记") && rows.get(1)[4].equals("休息") && rows.get(1)[5].equals("是") && rows.get(1)[3].equals("未记录") && rows.get(1)[16].equals("—"), "CSV keeps day level notes and rest when all subjects are inactive without inventing time");
        final JSONObject valid = state;
        String[][] badRanges = {{"2026-10-15", "2026-10-14"}, {"2026-02-30", "2026-03-01"}, {"1899-01-01", "1899-01-02"}, {"2000-01-01", "2026-10-14"}};
        for (int i = 0; i < badRanges.length; i++) { final String[] range = badRanges[i]; rejects(passes, () -> ReportExport.write(original, valid, new ByteArrayOutputStream(), "csv", range[0], range[1], "all"), "report rejects invalid date range " + i); }
        rejects(passes, () -> ReportExport.write(original, valid, new ByteArrayOutputStream(), "xlsx", "2026-10-14", "2026-10-14", "all"), "report rejects unsupported format before writing");
        rejects(passes, () -> ReportExport.write(original, valid, new ByteArrayOutputStream(), "csv", "2026-10-14", "2026-10-14", "missing"), "report rejects nonexistent subject");
        File pdf = new File(original.getCacheDir(), "report-test-" + UUID.randomUUID() + ".pdf");
        JSONObject longState = new JSONObject(state.toString()); StringBuilder content = new StringBuilder(); for (int i = 0; i < 130; i++) content.append("分页记录：这是一行用于核对中文换行与分页的学习内容。\n");
        StringBuilder longTitle = new StringBuilder(); for (int i = 0; i < 30; i++) longTitle.append("长计划名"); longState.getJSONObject("plan").put("title", longTitle.toString());
        longState.getJSONObject("records").getJSONObject("2026-10-14").getJSONObject("subjects").getJSONObject("math").put("content", content.toString());
        try {
            try (FileOutputStream file = new FileOutputStream(pdf)) { ReportExport.write(original, longState, file, "pdf", "2026-10-14", "2026-10-14", "math"); }
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY); PdfRenderer renderer = new PdfRenderer(descriptor)) {
                check(passes, renderer.getPageCount() >= 3, "PDF real renderer opens multiple wrapped Chinese pages");
                try (PdfRenderer.Page page = renderer.openPage(renderer.getPageCount() - 1)) {
                    check(passes, page.getWidth() == 595 && page.getHeight() == 842, "PDF final page is a valid A4 page");
                    Bitmap bitmap = Bitmap.createBitmap(595, 842, Bitmap.Config.ARGB_8888); bitmap.eraseColor(Color.WHITE); page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    boolean ink = false; for (int y = 150; y < 790 && !ink; y++) for (int x = 40; x < 555; x += 3) if (bitmap.getPixel(x, y) != Color.WHITE) { ink = true; break; }
                    check(passes, ink, "PDF final page contains rendered text rather than an empty overflow page"); bitmap.recycle();
                }
            }
        } finally { pdf.delete(); }
        String preferenceName = "report-test-" + UUID.randomUUID();
        Context context = new ContextWrapper(original) { @Override public SharedPreferences getSharedPreferences(String name, int mode) { return original.getSharedPreferences(preferenceName + "-" + name, mode); } };
        try {
            JSONObject initial = BackupStatus.get(context);
            check(passes, initial.isNull("lastExportAt") && !initial.getBoolean("reminderEnabled") && initial.isNull("nextReminderAt"), "backup status initially has no completion date and reminder is off");
            rejects(passes, () -> BackupStatus.set(context, true, 1), "backup reminder rejects unsupported interval without changing status");
            check(passes, !BackupStatus.get(context).getBoolean("reminderEnabled"), "invalid backup interval leaves reminder disabled");
            rejects(passes, () -> ReportExport.write(context, valid, new java.io.OutputStream() { @Override public void write(int value) throws IOException { throw new IOException("fixture unavailable"); } }, "csv", "2026-10-14", "2026-10-14", "all"), "report propagates actual output failure");
            check(passes, BackupStatus.get(context).isNull("lastExportAt"), "failed or readable report exports do not mark a full backup complete");
            long before = System.currentTimeMillis(); BackupStatus.markExportSuccess(context); JSONObject marked = BackupStatus.get(context);
            check(passes, Instant.parse(marked.getString("lastExportAt")).toEpochMilli() >= before, "full backup completion stores an actual persisted timestamp");
            BackupStatus.set(context, true, 14); check(passes, BackupStatus.get(context).getBoolean("reminderEnabled") && BackupStatus.get(context).getInt("reminderDays") == 14, "backup reminder accepts and persists selected interval");
            BackupStatus.set(context, false, 14); BackupStatus.schedule(context); check(passes, !BackupStatus.get(context).getBoolean("reminderEnabled") && BackupStatus.get(context).isNull("nextReminderAt"), "disabled backup reminder cancels scheduled metadata");
            ZoneId zone = ZoneId.of("Asia/Shanghai"); ZonedDateTime base = ZonedDateTime.of(2026, 10, 10, 19, 0, 0, 0, zone);
            ZonedDateTime slot = Instant.ofEpochMilli(BackupStatus.nextSlot(base.toInstant().toEpochMilli(), 7, base)).atZone(zone);
            check(passes, slot.toLocalDate().toString().equals("2026-10-17") && slot.getHour() == 18 && AppRules.allowed(slot.toLocalDateTime()), "backup reminder weekly slot respects weekend rest boundaries");
            ZonedDateTime late = ZonedDateTime.of(2026, 10, 17, 20, 0, 0, 0, zone); slot = Instant.ofEpochMilli(BackupStatus.nextSlot(base.toInstant().toEpochMilli(), 7, late)).atZone(zone);
            check(passes, slot.toLocalDate().toString().equals("2026-10-18") && slot.getHour() == 18 && AppRules.allowed(slot.toLocalDateTime()), "late backup reminder does not deliver during rest and schedules a future allowed slot");
            check(passes, stateBefore.equals(DataStore.load(original).toString()), "report and backup status operations leave saved learning data unchanged");
        } finally { BackupStatus.set(context, false, 7); context.getSharedPreferences(BackupStatus.PREFS, Context.MODE_PRIVATE).edit().clear().commit(); BackupStatus.schedule(original); }
    }
    private static List<String[]> parse(String csv) {
        List<String[]> rows = new ArrayList<>(); List<String> row = new ArrayList<>(); StringBuilder field = new StringBuilder(); boolean quoted = false;
        for (int i = csv.charAt(0) == '\ufeff' ? 1 : 0; i < csv.length(); i++) {
            char c = csv.charAt(i);
            if (c == '"') { if (quoted && i + 1 < csv.length() && csv.charAt(i + 1) == '"') { field.append('"'); i++; } else quoted = !quoted; }
            else if (c == ',' && !quoted) { row.add(field.toString()); field.setLength(0); }
            else if ((c == '\r' || c == '\n') && !quoted) { if (c == '\r' && i + 1 < csv.length() && csv.charAt(i + 1) == '\n') i++; row.add(field.toString()); field.setLength(0); rows.add(row.toArray(new String[0])); row.clear(); }
            else field.append(c);
        }
        return rows;
    }
}
