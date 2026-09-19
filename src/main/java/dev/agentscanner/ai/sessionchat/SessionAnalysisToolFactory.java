package dev.agentscanner.ai.sessionchat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.copilot.rpc.ToolDefinition;
import com.github.copilot.rpc.ToolInvocation;
import dev.agentscanner.analysis.SessionAnalysisQueryService;
import dev.agentscanner.store.ScannerStore;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;

@Component
final class SessionAnalysisToolFactory {
    private static final int MAX_RESULT_CHARACTERS = 96_000;
    static final Set<String> TOOL_NAMES = Set.of(
        "scanner_get_session_overview", "scanner_get_configuration", "scanner_list_interactions",
        "scanner_list_rounds", "scanner_get_round_evidence", "scanner_get_subagent_tree",
        "scanner_get_cost_summary", "scanner_search_session");

    private final SessionAnalysisQueryService queries;
    private final ScannerStore store;
    private final ObjectMapper mapper;

    SessionAnalysisToolFactory(SessionAnalysisQueryService queries, ScannerStore store, ObjectMapper mapper) {
        this.queries = queries;
        this.store = store;
        this.mapper = mapper;
    }

    List<ToolDefinition> create(SessionAnalysisQueryService.Scope scope, String chatId, String turnId) {
        AtomicInteger sequence = new AtomicInteger();
        return List.of(
            tool("scanner_get_session_overview", "Pobiera lekkie podsumowanie całej zapisanej sesji, coverage i ograniczenia.", schema(Map.of()),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.overview(scope)),
            tool("scanner_get_configuration", "Pobiera instrukcje, skille, custom agents, MCP i narzędzia dostępne oraz użyte w sesji.", schema(Map.of(
                "category", property("string", "Opcjonalna kategoria: instructions, skills, agents, mcp albo tools."))),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.configuration(scope)),
            tool("scanner_list_interactions", "Listuje prompty użytkownika i lekkie podsumowania interakcji z paginacją.", schema(Map.of(
                "cursor", property("integer", "Cursor kolejnej strony."), "limit", property("integer", "Liczba wyników, maksymalnie 50."))),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.listInteractions(scope, integer(arguments, "cursor", 0), integer(arguments, "limit", 25))),
            tool("scanner_list_rounds", "Listuje lekkie podsumowania rund całej sesji lub wskazanej interakcji/aktora.", schema(Map.of(
                "interactionRef", property("string", "Opcjonalne I1, I2 itd."), "actorRef", property("string", "Opcjonalny aktor."),
                "roundRefs", arrayProperty("Lista dokładnych roundRef."), "cursor", property("integer", "Cursor."),
                "limit", property("integer", "Liczba wyników, maksymalnie 50."))),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.listRounds(scope,
                    string(arguments, "interactionRef"), string(arguments, "actorRef"), strings(arguments, "roundRefs"),
                    integer(arguments, "cursor", 0), integer(arguments, "limit", 25))),
            tool("scanner_get_round_evidence", "Pobiera dokładny request, response, tool calls i wyniki jednej rundy wskazanej przez roundRef.", requiredSchema(Map.of(
                "roundRef", property("string", "Dokładny roundRef z bootstrapu albo listy rund."),
                "sections", arrayProperty("Opcjonalne sekcje materiału.")), List.of("roundRef")),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.roundEvidence(scope,
                    requiredString(arguments, "roundRef"), strings(arguments, "sections"))),
            tool("scanner_get_subagent_tree", "Pobiera deterministyczne drzewo głównego agenta i powiązanych subagentów.", schema(Map.of()),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.subagentTree(scope)),
            tool("scanner_get_cost_summary", "Sumuje emitowane tokeny, cache, czas i Copilot AI credits dla całej sesji lub listy rund wraz z coverage.", schema(Map.of(
                "roundRefs", arrayProperty("Opcjonalny zbiór dokładnych roundRef."))),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.costSummary(scope, strings(arguments, "roundRefs"))),
            tool("scanner_search_session", "Deterministycznie wyszukuje tekst, nazwy narzędzi i błędy w zamrożonej sesji.", requiredSchema(Map.of(
                "query", property("string", "Tekst od 1 do 200 znaków."), "cursor", property("integer", "Cursor."),
                "limit", property("integer", "Liczba wyników, maksymalnie 50.")), List.of("query")),
                scope, chatId, turnId, sequence, (arguments, invocation) -> queries.search(scope,
                    requiredString(arguments, "query"), integer(arguments, "cursor", 0), integer(arguments, "limit", 20)))
        );
    }

    private ToolDefinition tool(String name, String description, Map<String, Object> schema,
                                SessionAnalysisQueryService.Scope scope, String chatId, String turnId,
                                AtomicInteger sequence,
                                BiFunction<Map<String, Object>, ToolInvocation, Map<String, Object>> operation) {
        return ToolDefinition.createSkipPermission(name, description, schema, invocation -> {
            if (!TOOL_NAMES.contains(invocation.getToolName()) || !name.equals(invocation.getToolName()))
                return CompletableFuture.failedFuture(new SecurityException("Narzędzie nie jest dozwolone."));
            Map<String, Object> arguments = invocation.getArguments() == null ? Map.of() : invocation.getArguments();
            String callId = UUID.randomUUID().toString();
            String argumentsJson = json(arguments);
            store.startSessionChatToolCall(callId, chatId, turnId, invocation.getToolCallId(), sequence.incrementAndGet(),
                name, argumentsJson, queries.hash(arguments), Instant.now());
            try {
                Map<String, Object> result = bounded(operation.apply(arguments, invocation));
                String resultJson = json(result);
                boolean truncated = containsTruncation(mapper.valueToTree(result));
                store.completeSessionChatToolCall(callId, resultJson, queries.hash(result), resultJson.length(), truncated, Instant.now());
                for (String ref : evidenceRefs(result)) store.saveSessionChatEvidence(chatId, ref, name, turnId);
                return CompletableFuture.completedFuture(resultJson);
            } catch (Exception failure) {
                store.failSessionChatToolCall(callId, safeMessage(failure), Instant.now());
                return CompletableFuture.failedFuture(failure);
            }
        });
    }

    private Map<String, Object> bounded(Map<String, Object> result) {
        String full = json(result);
        if (full.length() <= MAX_RESULT_CHARACTERS) return result;
        Map<String, Object> limited = new java.util.LinkedHashMap<>();
        limited.put("contract", "scanner-tool-result-limit");
        limited.put("truncated", true);
        limited.put("originalCharacters", full.length());
        limited.put("maxCharacters", MAX_RESULT_CHARACTERS);
        limited.put("message", "Wynik był zbyt duży. Zawęź filtry, użyj mniejszego limitu albo pobierz jedną rundę.");
        return limited;
    }

    private Set<String> evidenceRefs(Object value) {
        Set<String> refs = new LinkedHashSet<>();
        collectRefs(mapper.valueToTree(value), null, refs, 0);
        return refs;
    }

    private void collectRefs(JsonNode node, String key, Set<String> refs, int depth) {
        if (node == null || depth > 30) return;
        if (node.isTextual() && key != null && (key.equals("roundRef") || key.equals("evidenceRef") || key.equals("ref"))) {
            String value = node.asText(); if (value.contains("/")) refs.add(value); return;
        }
        if (node.isArray()) { node.forEach(child -> collectRefs(child, key, refs, depth + 1)); return; }
        if (node.isObject()) node.fields().forEachRemaining(entry -> collectRefs(entry.getValue(), entry.getKey(), refs, depth + 1));
    }

    private boolean containsTruncation(JsonNode node) {
        if (node == null) return false;
        if (node.isObject()) {
            if (node.path("truncated").asBoolean(false)) return true;
            var fields = node.fields(); while (fields.hasNext()) if (containsTruncation(fields.next().getValue())) return true;
        } else if (node.isArray()) for (JsonNode child : node) if (containsTruncation(child)) return true;
        return false;
    }

    private Map<String, Object> schema(Map<String, Object> properties) {
        return requiredSchema(properties, List.of());
    }

    private Map<String, Object> requiredSchema(Map<String, Object> properties, List<String> required) {
        return Map.of("type", "object", "properties", properties, "required", required, "additionalProperties", false);
    }

    private Map<String, Object> property(String type, String description) {
        return Map.of("type", type, "description", description);
    }

    private Map<String, Object> arrayProperty(String description) {
        return Map.of("type", "array", "items", Map.of("type", "string"), "description", description);
    }

    private int integer(Map<String, Object> values, String key, int fallback) {
        Object value = values.get(key); return value instanceof Number number ? number.intValue() : fallback;
    }

    private String string(Map<String, Object> values, String key) {
        Object value = values.get(key); return value instanceof String text && !text.isBlank() ? text : null;
    }

    private String requiredString(Map<String, Object> values, String key) {
        String value = string(values, key); if (value == null) throw new IllegalArgumentException("Brakuje parametru " + key + "."); return value;
    }

    private List<String> strings(Map<String, Object> values, String key) {
        Object value = values.get(key); if (!(value instanceof List<?> source)) return List.of();
        List<String> result = new ArrayList<>(); for (Object item : source) if (item instanceof String text && !text.isBlank()) result.add(text); return result;
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (Exception failure) { throw new IllegalStateException("Nie udało się zapisać wyniku narzędzia.", failure); }
    }

    private String safeMessage(Exception failure) {
        if (failure instanceof IllegalArgumentException || failure instanceof SecurityException) return failure.getMessage();
        return "Narzędzie Scannera nie zakończyło odczytu danych.";
    }
}
