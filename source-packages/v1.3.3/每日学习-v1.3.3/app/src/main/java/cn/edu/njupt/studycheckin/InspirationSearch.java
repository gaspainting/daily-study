package cn.edu.njupt.studycheckin;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.Normalizer;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;

/** Searches complete displayed-card history before applying page limits. */
public final class InspirationSearch {
    private InspirationSearch() {}

    public static JSONObject snapshot(Context context, String scope, int offset, int limit,
                                      String query, String theme, String language) throws Exception {
        if (!"daily".equals(scope) && !"history".equals(scope) && !"favorites".equals(scope) && !"startup".equals(scope)) {
            throw new Exception("图文分类无效");
        }
        query = bounded(query, 200, "搜索内容过长");
        theme = bounded(theme, 3000, "主题无效");
        language = bounded(language, 64, "语言无效");
        synchronized (InspirationStore.LOCK) {
            JSONObject state = InspirationStore.load(context);
            JSONObject result = InspirationStore.snapshot(context, state, scope, 0, 1);
            JSONObject cards = state.getJSONObject("cards");
            JSONArray events = state.getJSONArray("events");
            JSONArray items = new JSONArray();
            Set<String> favorites = new HashSet<>();
            String needle = normalized(query.trim());
            int total = 0, start = Math.max(0, offset), pageSize = Math.min(50, Math.max(1, limit));
            for (int i = events.length() - 1; i >= 0; i--) {
                JSONObject event = events.getJSONObject(i);
                JSONObject card = cards.getJSONObject(event.getString("cardId"));
                boolean include = scope.equals("favorites")
                        ? card.getBoolean("favorite") && favorites.add(card.getString("id"))
                        : event.getString("kind").equals(scope.equals("startup") ? "startup" : "daily");
                if (!include || !matches(card, needle, theme, language)) continue;
                if (total >= start && items.length() < pageSize) items.put(InspirationStore.entry(state, event));
                total++;
            }
            return result.put("items", items).put("total", total).put("offset", start);
        }
    }

    public static JSONObject facets(Context context) throws Exception {
        synchronized (InspirationStore.LOCK) {
            JSONObject state = InspirationStore.load(context), cards = state.getJSONObject("cards");
            JSONArray events = state.getJSONArray("events");
            Set<String> seen = new HashSet<>(), themes = new TreeSet<>(), languages = new TreeSet<>();
            for (int i = 0; i < events.length(); i++) {
                String id = events.getJSONObject(i).getString("cardId");
                if (!seen.add(id)) continue;
                JSONObject card = cards.getJSONObject(id);
                String theme = card.getString("theme"), language = card.getString("language");
                if (!theme.isEmpty()) themes.add(theme);
                if (!language.isEmpty()) languages.add(language);
            }
            return new JSONObject().put("themes", new JSONArray(themes)).put("languages", new JSONArray(languages));
        }
    }

    private static String bounded(String value, int max, String error) throws Exception {
        if (value == null || value.length() > max) throw new Exception(error);
        return value;
    }

    private static String normalized(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }

    private static boolean matches(JSONObject card, String needle, String theme, String language) throws Exception {
        if (!theme.isEmpty() && !theme.equals(card.getString("theme"))) return false;
        if (!language.isEmpty() && !language.equals(card.getString("language"))) return false;
        if (needle.isEmpty()) return true;
        for (String field : new String[]{"text", "translation", "imageTitle", "imageCaption", "imageAuthor", "imageSource", "textAuthor", "textSource"}) {
            if (normalized(card.optString(field, "")).contains(needle)) return true;
        }
        return false;
    }
}
