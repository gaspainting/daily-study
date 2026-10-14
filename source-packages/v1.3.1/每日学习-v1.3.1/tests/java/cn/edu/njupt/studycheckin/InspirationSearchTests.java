package cn.edu.njupt.studycheckin;

import android.content.Context;
import android.content.ContextWrapper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Full stored-history filtering, independent from daily drawing and network providers. */
final class InspirationSearchTests {
    private interface Action { void run() throws Exception; }
    private static void check(List<String> passes, boolean condition, String name) throws Exception {
        if (!condition) throw new Exception("FAIL: " + name);
        passes.add(name);
    }
    private static void rejects(List<String> passes, Action action, String name) throws Exception {
        boolean rejected = false;
        try { action.run(); } catch (Exception expected) { rejected = true; }
        check(passes, rejected, name);
    }
    private static JSONObject search(Context context, String scope, int offset, int limit, String query, String theme, String language) throws Exception {
        return InspirationSearch.snapshot(context, scope, offset, limit, query, theme, language);
    }
    static void run(Context original, List<String> passes) throws Exception {
        File directory = new File(original.getCacheDir(), "inspiration-search-test-" + UUID.randomUUID());
        if (!directory.mkdir()) throw new Exception("Search fixture directory creation failed");
        Context context = new ContextWrapper(original) { @Override public File getFilesDir() { return directory; } };
        String originalRecords = DataStore.load(original).toString();
        try {
            check(passes, search(context, "history", 0, 20, "", "", "").getInt("total") == 0, "empty inspiration search has no fabricated results");
            JSONObject state = InspirationStore.load(context);
            JSONObject cards = state.getJSONObject("cards"), daily = state.getJSONObject("daily");
            JSONArray events = state.getJSONArray("events");
            String hash = InspirationStore.hash(new byte[]{1}), now = Instant.now().toString();
            for (int i = 0; i < 35; i++) {
                String id = "card_" + i, text = "图文 " + i;
                if (i == 33) text = "A long quote " + new String(new char[300]).replace('\0', 'x') + " ＮＥＥＤＬＥ";
                String language = i % 3 == 0 ? "en" : "zh", theme = i % 2 == 0 ? "青春" : "心情";
                JSONObject card = InspirationStore.baseCard(id, text, language, language.equals("en") ? "晨光 中文释义 " + i : "", theme)
                        .put("imageKey", hash + ".jpg").put("imageHash", hash).put("imageId", "picsum:" + i)
                        .put("imageSource", "图片来源").put("imageAuthor", "摄影师 " + i).put("imageTitle", "海边 " + i)
                        .put("imagePage", "https://example.org/photo/" + i).put("imageLicense", "测试")
                        .put("textId", "quote_" + i).put("textSource", "文字来源").put("textAuthor", "作者 " + i)
                        .put("textPage", "https://example.org/text/" + i).put("textLicense", "测试").put("translationSource", "释义来源").put("origin", "test")
                        .put("favorite", i == 0 || i == 33);
                cards.put(id, card);
                String day = LocalDate.now().minusDays(34 - i).toString();
                JSONObject event = new JSONObject().put("id", "event_" + i).put("cardId", id).put("kind", "daily")
                        .put("date", day).put("at", now).put("imageRepeat", false).put("textRepeat", false);
                events.put(event);
                daily.put(day, event.getString("id"));
            }
            JSONObject newestStartup = new JSONObject().put("id", "startup_0").put("cardId", "card_0").put("kind", "startup")
                    .put("date", LocalDate.now().toString()).put("at", now).put("imageRepeat", true).put("textRepeat", true);
            events.put(newestStartup);
            // A not-yet-displayed candidate must not invent an available filter option.
            JSONObject pending = new JSONObject(cards.getJSONObject("card_0").toString()).put("id", "pending")
                    .put("theme", "未展示主题").put("language", "fr").put("translation", "候选释义").put("favorite", false);
            cards.put("pending", pending);
            InspirationStore.save(context, state);
            String stateBefore = InspirationStore.load(context).toString();
            JSONObject all = search(context, "history", 0, 20, "", "", "");
            check(passes, all.getInt("total") == 35 && all.getJSONArray("items").length() == 20 && all.getJSONArray("items").getJSONObject(0).getString("id").equals("event_34"), "history returns true total and preserves latest-first page order");
            JSONObject older = search(context, "history", 20, 20, "", "", "");
            check(passes, older.getJSONArray("items").length() == 15 && older.getJSONArray("items").getJSONObject(0).getString("id").equals("event_14"), "history pagination runs after full stored-event selection");
            JSONObject beyondPage = search(context, "history", 0, 20, "摄影师 0", "", "");
            check(passes, beyondPage.getInt("total") == 1 && beyondPage.getJSONArray("items").getJSONObject(0).getString("id").equals("event_0"), "search reaches older history outside first page");
            check(passes, search(context, "history", 0, 20, " needle ", "", "").getInt("total") == 1, "quote search covers full text and normalizes case width and query whitespace");
            check(passes, search(context, "history", 0, 20, "晨光", "", "").getInt("total") == 12, "foreign quote search includes Chinese gloss");
            check(passes, search(context, "history", 0, 20, "海边 34", "", "").getInt("total") == 1 && search(context, "history", 0, 20, "作者 34", "", "").getInt("total") == 1, "image caption and real author metadata are searchable");
            check(passes, search(context, "history", 0, 20, "", "青春", "").getInt("total") == 18, "theme filter uses exact stored theme");
            check(passes, search(context, "history", 0, 20, "", "", "en").getInt("total") == 12, "language filter uses exact stored language");
            check(passes, search(context, "history", 0, 20, "晨光", "青春", "en").getInt("total") == 6, "keyword theme and language combine rather than replace each other");
            check(passes, search(context, "history", 0, 20, "", "青", "").getInt("total") == 0 && search(context, "history", 0, 20, "missing", "", "").getInt("total") == 0, "no match remains empty without loosening filters");
            JSONObject favorites = search(context, "favorites", 0, 20, "", "", "");
            check(passes, favorites.getInt("total") == 2 && favorites.getJSONArray("items").getJSONObject(0).getString("id").equals("startup_0"), "favorites show each card once using its latest displayed event");
            check(passes, search(context, "favorites", 0, 20, "needle", "心情", "en").getInt("total") == 1 && search(context, "favorites", 0, 20, "海边 34", "", "").getInt("total") == 0, "favorite search retains collection membership while filtering");
            check(passes, search(context, "startup", 0, 20, "摄影师 0", "青春", "en").getInt("total") == 1 && search(context, "startup", 0, 20, "needle", "", "").getInt("total") == 0, "startup filter preserves startup-only scope");
            JSONObject facets = InspirationSearch.facets(context);
            check(passes, facets.getJSONArray("themes").length() == 2 && facets.getJSONArray("languages").length() == 2 && !facets.toString().contains("未展示主题") && !facets.toString().contains("fr"), "filter options come from displayed metadata and exclude pending cards");
            check(passes, search(context, "history", -4, 500, "", "", "").getJSONArray("items").length() == 35 && search(context, "history", 99, 20, "", "", "").getJSONArray("items").length() == 0, "page bounds clamp without inventing results");
            String dailyId = all.getJSONObject("daily").getString("id");
            check(passes, search(context, "favorites", 0, 20, "missing", "", "").getJSONObject("daily").getString("id").equals(dailyId), "search never replaces or clears fixed current-day card");
            rejects(passes, () -> search(context, "unknown", 0, 20, "", "", ""), "search rejects unknown card scope");
            rejects(passes, () -> search(context, "history", 0, 20, new String(new char[201]), "", ""), "search rejects oversized query");
            check(passes, InspirationStore.load(context).toString().equals(stateBefore) && DataStore.load(original).toString().equals(originalRecords), "filtering facets and pagination do not write card events favorites or study records");
        } finally {
            new File(directory, "inspiration.json").delete();
            new File(directory, "inspiration.json.bak").delete();
            new File(directory, "inspiration.json.new").delete();
            new File(directory, "inspiration-media").delete();
            directory.delete();
        }
    }
}
