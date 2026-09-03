package dev.agentscanner.api;

import java.sql.Clob;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class ApiView {
    private ApiView() {}

    static List<Map<String, Object>> rows(List<Map<String, Object>> rows) {
        return rows.stream().map(ApiView::row).toList();
    }

    static Map<String, Object> row(Map<String, Object> source) {
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, value) -> result.put(camel(key), value(value)));
        return result;
    }

    private static Object value(Object value) {
        if (value instanceof Clob clob) {
            try { return clob.getSubString(1, Math.toIntExact(clob.length())); }
            catch (SQLException exception) { throw new IllegalStateException("Cannot read stored text", exception); }
        }
        return value;
    }

    private static String camel(String key) {
        if (!key.contains("_") && !key.equals(key.toUpperCase(Locale.ROOT))) {
            return Character.toLowerCase(key.charAt(0)) + key.substring(1);
        }
        String lower = key.toLowerCase(Locale.ROOT);
        StringBuilder result = new StringBuilder();
        boolean upperNext = false;
        for (char c : lower.toCharArray()) {
            if (c == '_') upperNext = true;
            else if (upperNext) { result.append(Character.toUpperCase(c)); upperNext = false; }
            else result.append(c);
        }
        return result.toString();
    }
}
