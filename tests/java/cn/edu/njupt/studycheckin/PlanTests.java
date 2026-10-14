package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

final class PlanTests {
    private interface Action { void run() throws Exception; }
    private static void check(List<String> passes, boolean condition, String name) throws Exception { if (!condition) throw new Exception("FAIL: " + name); passes.add(name); }
    private static void rejects(List<String> passes, Action action, String name) throws Exception { boolean failed = false; try { action.run(); } catch (Exception expected) { failed = true; } check(passes, failed, name); }
    private static JSONObject entry(Object value) throws Exception { return new JSONObject().put("minutes", value).put("content", "").put("problem", "").put("newWords", JSONObject.NULL).put("reviewWords", JSONObject.NULL).put("forgotWords", ""); }
    private static JSONObject record(Object math, Object vocab, String note) throws Exception { return new JSONObject().put("subjects", new JSONObject().put("math", entry(math)).put("vocab", entry(vocab))).put("status", "休息").put("restKept", JSONObject.NULL).put("note", note); }
    private static JSONObject seed(Context context, String name) throws Exception { JSONObject seed = new JSONObject(DataStore.readText(context.getAssets().open("seed.json"))); seed.getJSONObject("plan").put("title", name); return seed; }
    static void run(Context original, List<String> passes) throws Exception {
        String originalState = DataStore.load(original).toString(); String suffix = UUID.randomUUID().toString();
        File directory = new File(original.getCacheDir(), "plan-test-" + suffix), cache = new File(directory, "cache");
        if (!directory.mkdir() || !cache.mkdir()) throw new Exception("Plan fixture directory creation failed");
        Context context = new ContextWrapper(original) {
            @Override public File getFilesDir() { return directory; }
            @Override public File getCacheDir() { return cache; }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { return original.getSharedPreferences("plan-test-" + suffix + "-" + name, mode); }
        };
        try {
            JSONObject listing = PlanStore.list(context);
            check(passes, listing.getString("activeId").equals("main") && listing.getJSONArray("plans").length() == 1 && !new File(directory, "plans.json").exists(), "missing plan catalog exposes original plan without rewriting records");
            JSONObject main = seed(context, "原计划"), primary = record(JSONObject.NULL, 0, "主计划随记"); main.getJSONObject("records").put("2026-10-14", primary);
            main.put("sessions", new JSONArray().put(new JSONObject().put("id", "primary-session").put("date", "2026-10-14").put("subjectId", "vocab").put("seconds", 75.5).put("endedAt", "2026-10-14T10:00:00Z")));
            main.getJSONObject("reviews").put("2026-10-12", new JSONObject().put("load", "主计划负荷").put("mathProblem", "主计划数学问题").put("vocabReview", "主计划词汇复盘").put("adjustment", "减量").put("reason", "课程").put("halfDayRest", true));
            DataStore.save(context, main); JSONObject blank = seed(context, "第二计划"); String secondId = PlanStore.create(context, blank);
            check(passes, PlanStore.list(context).getJSONArray("plans").length() == 2 && PlanStore.activeId(context).equals("main") && DataStore.load(context).getJSONObject("records").getJSONObject("2026-10-14").getString("note").equals("主计划随记"), "create stores a clean independent plan without switching or modifying active records");
            PlanStore.switchTo(context, secondId); JSONObject second = DataStore.load(context);
            check(passes, PlanStore.activeId(context).equals(secondId) && second.getJSONObject("records").length() == 0 && second.getJSONObject("reviews").length() == 0 && second.getJSONArray("sessions").length() == 0, "switch to new plan shows empty observations and reviews");
            second.getJSONObject("records").put("2026-10-14", record(42, JSONObject.NULL, "第二计划随记")); DataStore.save(context, second);
            PlanStore.switchTo(context, "main"); JSONObject restored = DataStore.load(context), restoredRecord = restored.getJSONObject("records").getJSONObject("2026-10-14");
            check(passes, restoredRecord.getJSONObject("subjects").getJSONObject("math").isNull("minutes") && restoredRecord.getJSONObject("subjects").getJSONObject("vocab").getDouble("minutes") == 0 && restoredRecord.getString("status").equals("休息"), "plan switch preserves null explicit zero and rest selection");
            check(passes, restoredRecord.getString("note").equals("主计划随记") && restored.getJSONArray("sessions").getJSONObject(0).getDouble("seconds") == 75.5 && restored.getJSONObject("reviews").getJSONObject("2026-10-12").getString("mathProblem").equals("主计划数学问题"), "plan switch preserves notes timer net seconds and weekly reviews");
            check(passes, restored.getJSONObject("reviews").getJSONObject("2026-10-12").getJSONObject("subjects").getString("math").equals("主计划数学问题"), "old review fields migrate into per subject reviews across plan switch");
            long revision = restored.getLong("_revision"); PlanStore.switchTo(context, "main"); check(passes, DataStore.load(context).getLong("_revision") == revision, "switching to already active plan avoids a duplicate data write");
            restored.getJSONObject("plan").put("title", "改名后的主计划"); DataStore.save(context, restored);
            check(passes, PlanStore.list(context).getJSONArray("plans").getJSONObject(0).getString("name").equals("改名后的主计划"), "plan listing takes current title from actual active records");
            String preserved = PlanStore.backupSnapshot(context).toString();
            rejects(passes, () -> PlanStore.switchTo(context, "missing"), "switch rejects nonexistent plan");
            final JSONObject withRecords = DataStore.load(context); rejects(passes, () -> PlanStore.create(context, withRecords), "new plan cannot silently duplicate previous actual records");
            check(passes, PlanStore.backupSnapshot(context).toString().equals(preserved), "invalid plan actions leave catalog and learning data intact");
            JSONObject snapshot = PlanStore.backupSnapshot(context), invalid = new JSONObject(snapshot.toString());
            invalid.getJSONArray("items").getJSONObject(1).put("id", "main"); final JSONObject duplicate = invalid;
            rejects(passes, () -> PlanStore.validateBackup(duplicate, DataStore.load(context)), "plan backup rejects duplicate identifiers");
            invalid = new JSONObject(snapshot.toString()); invalid.getJSONArray("items").getJSONObject(0).getJSONObject("state").getJSONObject("records").getJSONObject("2026-10-14").put("note", "不一致"); final JSONObject disagreement = invalid;
            rejects(passes, () -> PlanStore.validateBackup(disagreement, DataStore.load(context)), "plan backup rejects mismatched active study snapshot before restore");
            invalid = new JSONObject(snapshot.toString()); invalid.getJSONArray("items").getJSONObject(1).put("state", JSONObject.NULL); final JSONObject missing = invalid;
            rejects(passes, () -> PlanStore.validateBackup(missing, DataStore.load(context)), "plan backup rejects missing inactive records");
            JSONObject paused = new JSONObject().put("id", "paused-plan-test").put("date", LocalDate.now().toString()).put("subjectId", "math").put("subjectName", "高数").put("running", false).put("accumulatedMs", 30_000).put("message", "");
            context.getSharedPreferences("stopwatch", Context.MODE_PRIVATE).edit().putString("timer", paused.toString()).commit();
            try {
                rejects(passes, () -> PlanStore.switchTo(context, secondId), "paused unsaved timer blocks plan switch");
                rejects(passes, () -> PlanStore.create(context, blank), "unsaved timer blocks plan creation");
            } finally { context.getSharedPreferences("stopwatch", Context.MODE_PRIVATE).edit().clear().commit(); }
            byte[] beforeStudy = bytes(new File(directory, "study-state.json")), beforeCatalog = bytes(new File(directory, "plans.json")); File journal = new File(directory, "plan-switch-journal.json");
            JSONObject rollback = new JSONObject().put("study", Base64.encodeToString(beforeStudy, Base64.NO_WRAP)).put("plans", Base64.encodeToString(beforeCatalog, Base64.NO_WRAP));
            write(journal, rollback.toString().getBytes(StandardCharsets.UTF_8)); DataStore.restore(context, blank); write(new File(directory, "plans.json"), "{incomplete".getBytes(StandardCharsets.UTF_8)); PlanStore.recover(context);
            check(passes, Arrays.equals(bytes(new File(directory, "study-state.json")), beforeStudy) && Arrays.equals(bytes(new File(directory, "plans.json")), beforeCatalog) && !journal.exists(), "interrupted switch rolls both active state and catalog back from journal");
            File blocked = new File(directory, "plans.json.new"); if (!blocked.mkdir()) throw new Exception("Plan failure fixture creation failed"); write(new File(blocked, "keep"), new byte[]{1});
            try {
                rejects(passes, () -> PlanStore.switchTo(context, secondId), "real catalog write failure reports a failed plan switch");
                check(passes, Arrays.equals(bytes(new File(directory, "study-state.json")), beforeStudy) && Arrays.equals(bytes(new File(directory, "plans.json")), beforeCatalog), "failed switch preserves original study and catalog bytes");
            } finally { remove(blocked); PlanStore.recover(context); }
            check(passes, PlanStore.activeId(context).equals("main") && !journal.exists(), "failed plan switch can recover after filesystem write access returns");
            byte[] photo = photo(); String hash = InspirationStore.hash(photo), imageKey = hash + ".png"; InspirationStore.writeMedia(context, imageKey, photo);
            JSONObject card = InspirationStore.baseCard("plan-image", "计划图片测试", "zh", "", "测试").put("imageKey", imageKey).put("imageHash", hash).put("imageId", "picsum:90005").put("imageSource", "test fixture").put("imageAuthor", "").put("imageTitle", "fixture").put("imagePage", "").put("imageLicense", "test only").put("textId", "plan-test-text").put("textSource", "test fixture").put("textAuthor", "").put("textPage", "").put("textLicense", "test only").put("translationSource", "").put("origin", "online"); InspirationStore.addCandidate(context, card);
            ByteArrayOutputStream output = new ByteArrayOutputStream(); BackupManager.export(context, output); byte[] complete = output.toByteArray(); JSONObject exportedManifest = manifest(complete);
            check(passes, exportedManifest.getInt("version") == 2 && exportedManifest.getJSONObject("plans").getJSONArray("items").length() == 2, "complete backup version two contains every named plan");
            String allBefore = PlanStore.backupSnapshot(context).toString(), inspirationBefore = InspirationStore.load(context).toString();
            try (BackupManager.Imported imported = BackupManager.read(context, new ByteArrayInputStream(complete))) { check(passes, imported.complete() && imported.allPlans() && imported.planCount() == 2, "import identifies complete all plan backup scope"); }
            check(passes, PlanStore.backupSnapshot(context).toString().equals(allBefore) && InspirationStore.load(context).toString().equals(inspirationBefore), "canceling a validated all plan restore does not change records or images");
            JSONObject legacy = seed(context, "旧版导入计划"); legacy.getJSONObject("records").put("2026-10-14", record(0, JSONObject.NULL, "旧记录"));
            try (BackupManager.Imported imported = BackupManager.read(context, new ByteArrayInputStream(legacy.toString().getBytes(StandardCharsets.UTF_8)))) { check(passes, !imported.allPlans() && !imported.complete(), "legacy JSON retains current plan only restore scope"); BackupManager.restore(context, imported); }
            check(passes, PlanStore.list(context).getJSONArray("plans").length() == 2 && PlanStore.activeId(context).equals("main") && PlanStore.list(context).getJSONArray("plans").getJSONObject(0).getString("name").equals("旧版导入计划"), "legacy JSON replaces active records and leaves inactive plans intact");
            PlanStore.switchTo(context, secondId); check(passes, DataStore.load(context).getJSONObject("records").getJSONObject("2026-10-14").getString("note").equals("第二计划随记"), "inactive plan history survives a legacy JSON import");
            JSONObject emptyInspiration = new JSONObject().put("version", 1).put("cards", new JSONObject()).put("events", new JSONArray()).put("daily", new JSONObject()).put("imageUse", new JSONObject()).put("textUse", new JSONObject()).put("settings", new JSONObject().put("online", false)).put("lastFetchAt", "").put("lastFetchMessage", "");
            byte[] oldZip = zip(new JSONObject().put("format", "daily-study-complete").put("version", 1).put("study", legacy).put("inspiration", emptyInspiration));
            try (BackupManager.Imported imported = BackupManager.read(context, new ByteArrayInputStream(oldZip))) { check(passes, imported.complete() && !imported.allPlans(), "version one ZIP remains accepted with single active plan scope"); BackupManager.restore(context, imported); }
            check(passes, PlanStore.list(context).getJSONArray("plans").length() == 2 && PlanStore.activeId(context).equals(secondId), "old ZIP restore keeps other plans and current plan identifier");
            InspirationStore.media(context, imageKey).delete();
            try (BackupManager.Imported imported = BackupManager.read(context, new ByteArrayInputStream(complete))) { BackupManager.restore(context, imported); }
            check(passes, PlanStore.activeId(context).equals("main") && PlanStore.list(context).getJSONArray("plans").length() == 2 && DataStore.load(context).getJSONObject("records").getJSONObject("2026-10-14").getString("note").equals("主计划随记"), "version two ZIP restores catalog active identifier and original observations");
            check(passes, InspirationStore.load(context).getJSONObject("cards").has("plan-image") && Arrays.equals(InspirationStore.read(new FileInputStream(InspirationStore.media(context, imageKey)), InspirationStore.MAX_IMAGE_BYTES), photo), "all plan ZIP restores global daily card metadata and exact media bytes");
            JSONObject tampered = manifest(complete); tampered.getJSONObject("plans").getJSONArray("items").getJSONObject(0).getJSONObject("state").getJSONObject("records").getJSONObject("2026-10-14").put("note", "恶意冲突"); byte[] invalidZip = zip(tampered);
            String stateBeforeInvalid = DataStore.load(context).toString(), catalogBeforeInvalid = PlanStore.backupSnapshot(context).toString();
            rejects(passes, () -> { try (BackupManager.Imported imported = BackupManager.read(context, new ByteArrayInputStream(invalidZip))) { } }, "conflicting all plan backup rejected during reading before overwrite");
            check(passes, DataStore.load(context).toString().equals(stateBeforeInvalid) && PlanStore.backupSnapshot(context).toString().equals(catalogBeforeInvalid), "invalid all plan restore leaves current records and catalog unchanged");
            byte[] restoreBeforeStudy = bytes(new File(directory, "study-state.json")), restoreBeforeCatalog = bytes(new File(directory, "plans.json")), restoreBeforeInspiration = bytes(new File(directory, "inspiration.json"));
            if (!blocked.mkdir()) throw new Exception("Restore failure fixture creation failed"); write(new File(blocked, "keep"), new byte[]{1});
            try (BackupManager.Imported imported = BackupManager.read(context, new ByteArrayInputStream(complete))) {
                String importedBefore = imported.study.toString();
                try { rejects(passes, () -> BackupManager.restore(context, imported), "all plan restore propagates actual catalog write failure"); }
                finally { remove(blocked); BackupManager.recover(context); }
                check(passes, Arrays.equals(bytes(new File(directory, "study-state.json")), restoreBeforeStudy) && Arrays.equals(bytes(new File(directory, "plans.json")), restoreBeforeCatalog) && Arrays.equals(bytes(new File(directory, "inspiration.json")), restoreBeforeInspiration), "failed all plan restore recovers study catalog and daily card files together");
                check(passes, imported.study.toString().equals(importedBefore), "restore failure leaves validated imported study snapshot unchanged for retry");
                BackupManager.restore(context, imported);
                check(passes, PlanStore.activeId(context).equals("main") && DataStore.load(context).getJSONObject("records").getJSONObject("2026-10-14").getString("note").equals("主计划随记"), "validated all plan restore can retry successfully after real filesystem failure");
            } finally { remove(blocked); }
            while (PlanStore.list(context).getJSONArray("plans").length() < PlanStore.MAX_PLANS) PlanStore.create(context, blank);
            final String limitBefore = PlanStore.backupSnapshot(context).toString(); rejects(passes, () -> PlanStore.create(context, blank), "plan count limit rejects a ninth plan");
            check(passes, PlanStore.backupSnapshot(context).toString().equals(limitBefore), "plan limit does not evict existing saved plans");
            check(passes, DataStore.load(original).toString().equals(originalState), "isolated multi plan tests never replace user's saved learning records");
        } finally { context.getSharedPreferences("stopwatch", Context.MODE_PRIVATE).edit().clear().commit(); remove(directory); }
    }
    private static byte[] photo() {
        Bitmap bitmap = Bitmap.createBitmap(600, 400, Bitmap.Config.ARGB_8888); Paint paint = new Paint(); paint.setShader(new LinearGradient(0, 0, 600, 400, 0xff526576, 0xffbbdac7, Shader.TileMode.CLAMP)); new Canvas(bitmap).drawRect(0, 0, 600, 400, paint); ByteArrayOutputStream output = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle(); return output.toByteArray();
    }
    private static byte[] bytes(File file) throws Exception { return InspirationStore.read(new FileInputStream(file), 64 * 1024 * 1024); }
    private static void write(File file, byte[] bytes) throws Exception { try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); } }
    private static byte[] zip(JSONObject manifest) throws Exception { ByteArrayOutputStream output = new ByteArrayOutputStream(); try (ZipOutputStream zip = new ZipOutputStream(output)) { zip.putNextEntry(new ZipEntry("manifest.json")); zip.write(manifest.toString().getBytes(StandardCharsets.UTF_8)); zip.closeEntry(); } return output.toByteArray(); }
    private static JSONObject manifest(byte[] bytes) throws Exception {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) { ZipEntry entry; while ((entry = zip.getNextEntry()) != null) if (entry.getName().equals("manifest.json")) return new JSONObject(new String(InspirationStore.read(zip, 64 * 1024 * 1024), StandardCharsets.UTF_8)); }
        throw new Exception("Test backup manifest missing");
    }
    private static void remove(File directory) { File[] children = directory.listFiles(); if (children != null) for (File child : children) { if (child.isDirectory()) remove(child); else child.delete(); } directory.delete(); }
}
