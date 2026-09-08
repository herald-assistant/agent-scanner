package dev.agentscanner.ai.discussion;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.agentscanner.ai.advisory.OptimizationAdvice;
import dev.agentscanner.store.ScannerStore;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

@Service
final class RoundDiscussionEvidenceService {
    private static final Pattern SECRET = Pattern.compile(
            "(?i)(?:\\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}\\b|\\bBearer\\s+[A-Za-z0-9._~+/=-]{12,}\\b|(?:api[_-]?key|token|password|secret|authorization)\\s*[:=]\\s*[^\\s,;\"']{6,})"
    );
    private final ObjectMapper mapper;
    private final Validator validator;
    private final ScannerStore store;

    RoundDiscussionEvidenceService(ObjectMapper mapper, Validator validator, ScannerStore store) {
        this.mapper = mapper;
        this.validator = validator;
        this.store = store;
    }

    RoundDiscussion.CreateRequest readAndValidate(JsonNode body) {
        if (body == null || !body.isObject()) badRequest("Konfiguracja rozmowy musi być obiektem JSON.");
        RoundDiscussion.CreateRequest request;
        try {
            request = mapper.readerFor(RoundDiscussion.CreateRequest.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readValue(body);
        } catch (Exception failure) {
            throw new RoundDiscussionException(HttpStatus.BAD_REQUEST,
                    "Konfiguracja rozmowy ma niepoprawną strukturę albo zawiera nieznane pola.");
        }
        Set<ConstraintViolation<RoundDiscussion.CreateRequest>> violations = validator.validate(request);
        if (!violations.isEmpty()) badRequest("Konfiguracja rozmowy jest niekompletna albo ma niepoprawne pola.");
        validate(request);
        return request;
    }

    RoundDiscussion.TurnRequest readTurn(JsonNode body) {
        if (body == null || !body.isObject()) badRequest("Pytanie musi być obiektem JSON.");
        RoundDiscussion.TurnRequest request;
        try {
            request = mapper.readerFor(RoundDiscussion.TurnRequest.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readValue(body);
        } catch (Exception failure) {
            throw new RoundDiscussionException(HttpStatus.BAD_REQUEST,
                    "Pytanie ma niepoprawną strukturę albo zawiera nieznane pola.");
        }
        if (!validator.validate(request).isEmpty()) badRequest("Pytanie jest puste albo ma niepoprawny identyfikator.");
        return request;
    }

    void revalidate(long sessionId, RoundDiscussion.EvidenceSnapshot snapshot) {
        if (snapshot.selection().rootSessionId() != sessionId) conflict("Migawka wskazuje inną sesję główną.");
        validateSnapshot(snapshot);
    }

    String snapshotJson(RoundDiscussion.EvidenceSnapshot snapshot) {
        try {
            return mapper.writeValueAsString(snapshot);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Nie udało się zapisać migawki rozmowy.", failure);
        }
    }

    RoundDiscussion.EvidenceSnapshot readSnapshot(String json) {
        try {
            return mapper.readerFor(RoundDiscussion.EvidenceSnapshot.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readValue(json);
        } catch (Exception failure) {
            throw new IllegalStateException("Zapisana migawka rozmowy jest uszkodzona.", failure);
        }
    }

    private void validate(RoundDiscussion.CreateRequest request) {
        if (!RoundDiscussion.VERSION.equals(request.version())) conflict("Wersja rozmowy nie jest obsługiwana.");
        validateSnapshot(request.snapshot());
    }

    private void validateSnapshot(RoundDiscussion.EvidenceSnapshot snapshot) {
        RoundDiscussion.Selection selection = snapshot.selection();
        if (!RoundDiscussion.EVIDENCE_VERSION.equals(snapshot.version())
                || !RoundDiscussion.REDACTION_VERSION.equals(snapshot.redactionVersion())) {
            conflict("Wersja dowodów lub redakcji rozmowy nie jest obsługiwana.");
        }
        if (!Set.of("UNVERIFIED", "TRUNCATED").contains(snapshot.upstreamCompleteness())) {
            badRequest("Nieznany stan kompletności telemetrii.");
        }
        try {
            Instant.parse(snapshot.capturedAt());
        } catch (RuntimeException failure) {
            badRequest("Czas utworzenia migawki jest niepoprawny.");
        }
        if (store.session(selection.rootSessionId()).isEmpty()) notFound("Nie znaleziono sesji głównej.");
        if (!snapshot.contentHash().equals(contentHash(snapshot))) {
            conflict("Hash migawki nie zgadza się z jej zawartością. Wybierz zakres ponownie.");
        }

        List<String> selectedRefs = selection.roundRefs();
        if (new LinkedHashSet<>(selectedRefs).size() != selectedRefs.size()
                || !selection.startRoundRef().equals(selectedRefs.get(0))
                || !selection.endRoundRef().equals(selectedRefs.get(selectedRefs.size() - 1))) {
            badRequest("Początek, koniec i lista rund nie opisują jednego zakresu.");
        }
        if (!snapshot.rounds().stream().map(RoundDiscussion.RoundEvidence::roundRef).toList().equals(selectedRefs)) {
            badRequest("Dowody rund nie odpowiadają dokładnie wybranemu zakresowi.");
        }
        if (snapshot.rounds().stream().map(RoundDiscussion.RoundEvidence::sequenceIndex).distinct().count()
                != snapshot.rounds().size()) {
            badRequest("Kolejność rund zawiera powtórzone pozycje.");
        }

        Map<String, ScannerStore.GuidanceSpanSource> sources = new LinkedHashMap<>();
        for (RoundDiscussion.RoundEvidence round : snapshot.rounds()) {
            ScannerStore.GuidanceSpanSource source = validateSource(round.source(), sources);
            if (!round.roundRef().equals(round.source().roundRef())
                    || !round.roundRef().equals(source.traceId() + "/" + source.spanId())
                    || !selection.interactionTraceId().equals(source.traceId())
                    || !"chat".equals(source.operationName())) {
                conflict("Jedna z wybranych rund nie wskazuje dokładnego wywołania modelu.");
            }
        }
        long sourceSessionId = snapshot.rounds().get(0).source().sessionId();
        if (snapshot.rounds().stream().anyMatch(round -> round.source().sessionId() != sourceSessionId)) {
            badRequest("Zakres rozmowy może obejmować tylko jeden ciąg rund tego samego agenta.");
        }
        for (RoundDiscussion.Boundary boundary : snapshot.boundaries()) {
            if (!selectedRefs.contains(boundary.roundRef()) || !boundary.roundRef().equals(boundary.source().roundRef())) {
                badRequest("Granica przepływu nie należy do wybranego zakresu rund.");
            }
            ScannerStore.GuidanceSpanSource source = validateSource(boundary.source(), sources);
            if (source.sessionId() != sourceSessionId || !selection.interactionTraceId().equals(source.traceId())) {
                badRequest("Granica przepływu wskazuje dane spoza wybranego ciągu rund.");
            }
        }
        if (snapshot.boundaries().stream().map(RoundDiscussion.Boundary::id).collect(java.util.stream.Collectors.toSet()).size()
                != snapshot.boundaries().size()) {
            badRequest("Identyfikatory granic przepływu muszą być unikalne.");
        }

        validateOwnership(selection.rootSessionId(), sourceSessionId);
        validateContinuity(selection, sourceSessionId, sources.get(sourceSessionId + ":" + snapshot.rounds().get(0).source().spanId()));
        validateInitialPrompt(selection, sourceSessionId);
        validatePrivacy(snapshot);
    }

    private ScannerStore.GuidanceSpanSource validateSource(OptimizationAdvice.SourceRef ref,
                                                            Map<String, ScannerStore.GuidanceSpanSource> cache) {
        String key = ref.sessionId() + ":" + ref.spanId();
        ScannerStore.GuidanceSpanSource source = cache.computeIfAbsent(key, ignored ->
                store.guidanceSpanSource(ref.sessionId(), ref.spanId()).orElseThrow(() ->
                        new RoundDiscussionException(HttpStatus.NOT_FOUND,
                                "Nie znaleziono jednego ze źródeł rozmowy. Odśwież dane sesji.")));
        if (source.signalId() != ref.signalId() || !source.traceId().equals(ref.traceId())
                || !source.spanId().equals(ref.rawSpanId())) {
            conflict("Referencja źródła nie zgadza się z utrwalonym spanem.");
        }
        if (!rawContainsSpan(source.rawJson(), ref.traceId(), ref.rawSpanId())) {
            conflict("Źródłowy span nie występuje w zadeklarowanym raw signal.");
        }
        String pointer = "normalized:span:" + ref.spanId() + (ref.attribute() == null ? "" : "#" + ref.attribute());
        if (!pointer.equals(ref.sourcePointer())) badRequest("Nieznany format wskaźnika źródła.");
        if (!sourceContentHash(source).equals(ref.sourceContentHash())) {
            conflict("Źródło zmieniło się od wybrania rund. Wybierz zakres ponownie.");
        }
        return source;
    }

    private void validateContinuity(RoundDiscussion.Selection selection, long sourceSessionId,
                                    ScannerStore.GuidanceSpanSource firstSource) {
        List<String> all = store.spans(sourceSessionId).stream()
                .filter(row -> selection.interactionTraceId().equals(text(row, "trace_id")))
                .filter(row -> "chat".equals(text(row, "operation_name")))
                .filter(row -> Objects.equals(normalized(text(row, "agent_name")), normalized(firstSource.agentName())))
                .filter(row -> Objects.equals(normalized(text(row, "conversation_id")), normalized(firstSource.conversationId())))
                .map(row -> text(row, "trace_id") + "/" + text(row, "span_id"))
                .toList();
        int start = all.indexOf(selection.startRoundRef());
        int end = all.indexOf(selection.endRoundRef());
        if (start < 0 || end < start || !all.subList(start, end + 1).equals(selection.roundRefs())) {
            badRequest("Można wysłać tylko jeden ciąg sąsiednich rund bez przerw.");
        }
    }

    private String normalized(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private void validateOwnership(long rootSessionId, long sourceSessionId) {
        if (rootSessionId == sourceSessionId) return;
        Map<Long, String> conversations = new LinkedHashMap<>();
        for (Map<String, Object> row : store.sessions()) {
            Object id = column(row, "id");
            if (id instanceof Number number) conversations.put(number.longValue(), text(row, "conversation_id"));
        }
        Set<Long> authorized = new LinkedHashSet<>(List.of(rootSessionId));
        boolean changed;
        do {
            changed = false;
            for (Map.Entry<Long, String> candidate : conversations.entrySet()) {
                if (authorized.contains(candidate.getKey()) || candidate.getValue().isBlank()) continue;
                boolean linked = authorized.stream().flatMap(id -> store.spans(id).stream()).anyMatch(span ->
                        candidate.getValue().equals(parse(text(span, "attributes_json")).path("gen_ai.tool.call.id").asText()));
                if (linked) {
                    authorized.add(candidate.getKey());
                    changed = true;
                }
            }
        } while (changed);
        if (!authorized.contains(sourceSessionId)) {
            badRequest("Wybrany agent nie jest dokładnie powiązany z sesją główną.");
        }
    }

    private void validateInitialPrompt(RoundDiscussion.Selection selection, long sourceSessionId) {
        String prompt = selection.initialPrompt();
        if (prompt == null || prompt.isBlank()) return;
        Set<Long> sessions = new LinkedHashSet<>(List.of(selection.rootSessionId(), sourceSessionId));
        boolean found = sessions.stream().flatMap(id -> store.spans(id).stream())
                .filter(span -> selection.interactionTraceId().equals(text(span, "trace_id")))
                .anyMatch(span -> prompt.equals(parse(text(span, "attributes_json"))
                        .path("copilot_chat.user_request").asText(null)));
        if (!found) conflict("Początkowe zlecenie zmieniło się albo nie pochodzi z wybranej interakcji.");
    }

    private void validatePrivacy(RoundDiscussion.EvidenceSnapshot snapshot) {
        String json;
        try {
            json = mapper.writeValueAsString(snapshot);
        } catch (JsonProcessingException failure) {
            badRequest("Nie udało się odczytać treści migawki.");
            return;
        }
        if (SECRET.matcher(json).find()) badRequest("Migawka nadal zawiera rozpoznaną wartość tajną.");
        for (RoundDiscussion.Boundary boundary : snapshot.boundaries()) {
            if (containsForbiddenMessage(boundary.value())) {
                badRequest("Migawka zawiera instrukcję systemową, deweloperską albo jawne rozumowanie modelu.");
            }
        }
    }

    private boolean containsForbiddenMessage(JsonNode node) {
        if (node == null) return false;
        if (node.isObject()) {
            String role = node.path("role").asText("");
            if ("system".equalsIgnoreCase(role) || "developer".equalsIgnoreCase(role)) return true;
            var fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (field.getKey().matches("(?i)^(reasoning|reasoning_content|thinking)$")
                        || containsForbiddenMessage(field.getValue())) return true;
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) if (containsForbiddenMessage(child)) return true;
        }
        return false;
    }

    String contentHash(RoundDiscussion.EvidenceSnapshot snapshot) {
        ObjectNode material = mapper.createObjectNode();
        material.put("version", snapshot.version());
        material.set("selection", mapper.valueToTree(snapshot.selection()));
        material.set("rounds", mapper.valueToTree(snapshot.rounds()));
        material.set("boundaries", mapper.valueToTree(snapshot.boundaries()));
        material.put("redactionVersion", snapshot.redactionVersion());
        material.put("upstreamCompleteness", snapshot.upstreamCompleteness());
        return sha256(canonical(material));
    }

    private String sourceContentHash(ScannerStore.GuidanceSpanSource source) {
        ObjectNode snapshot = mapper.createObjectNode();
        snapshot.set("attributes", parse(source.attributesJson()));
        snapshot.set("events", parse(source.eventsJson()));
        ArrayNode messages = snapshot.putArray("messages");
        store.guidanceMessages(source.id()).stream()
                .sorted(Comparator.comparing(ScannerStore.GuidanceMessageSource::direction)
                        .thenComparingInt(ScannerStore.GuidanceMessageSource::sequenceNo)
                        .thenComparingLong(ScannerStore.GuidanceMessageSource::id))
                .forEach(message -> {
                    ObjectNode item = messages.addObject();
                    item.put("id", message.id());
                    item.put("direction", message.direction());
                    item.put("sequenceNo", message.sequenceNo());
                    if (message.roleName() == null) item.putNull("roleName"); else item.put("roleName", message.roleName());
                    item.put("content", message.content());
                    item.put("sourceKind", message.sourceKind());
                });
        return sha256(canonical(snapshot));
    }

    private boolean rawContainsSpan(String rawJson, String traceId, String spanId) {
        return rawContainsSpan(parse(rawJson), traceId, spanId);
    }

    private boolean rawContainsSpan(JsonNode node, String traceId, String spanId) {
        if (node.isObject() && identifierMatches(firstText(node, "traceId", "trace_id"), traceId)
                && identifierMatches(firstText(node, "spanId", "span_id"), spanId)) return true;
        if (node.isContainerNode()) for (JsonNode child : node) if (rawContainsSpan(child, traceId, spanId)) return true;
        return false;
    }

    private String firstText(JsonNode node, String first, String second) {
        JsonNode value = node.get(first);
        if (value == null) value = node.get(second);
        return value == null ? "" : value.asText("");
    }

    private boolean identifierMatches(String rawValue, String normalizedHex) {
        if (rawValue.equalsIgnoreCase(normalizedHex)) return true;
        try {
            return HexFormat.of().formatHex(Base64.getDecoder().decode(rawValue)).equalsIgnoreCase(normalizedHex);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private JsonNode parse(String value) {
        try {
            return mapper.readTree(value);
        } catch (JsonProcessingException failure) {
            return mapper.getNodeFactory().textNode(value == null ? "" : value);
        }
    }

    private Object column(Map<String, Object> row, String name) {
        if (row.containsKey(name)) return row.get(name);
        if (row.containsKey(name.toUpperCase())) return row.get(name.toUpperCase());
        return row.get(name.toLowerCase());
    }

    private String text(Map<String, Object> row, String name) {
        Object value = column(row, name);
        return value == null ? "" : value.toString();
    }

    private String canonical(JsonNode node) {
        if (node == null || node.isNull()) return "null";
        if (node.isArray()) {
            List<String> values = new ArrayList<>();
            node.forEach(child -> values.add(canonical(child)));
            return "[" + String.join(",", values) + "]";
        }
        if (node.isObject()) {
            List<String> names = new ArrayList<>();
            node.fieldNames().forEachRemaining(names::add);
            return "{" + names.stream().sorted().map(name -> jsonString(name) + ":" + canonical(node.get(name)))
                    .collect(java.util.stream.Collectors.joining(",")) + "}";
        }
        if (node.isTextual()) return jsonString(node.textValue());
        if (node.isBoolean()) return Boolean.toString(node.booleanValue());
        if (node.isNumber()) return javascriptNumber(node.doubleValue());
        return node.toString();
    }

    private String javascriptNumber(double value) {
        if (!Double.isFinite(value)) badRequest("Migawka zawiera niepoprawną liczbę.");
        if (value == 0) return "0";
        double absolute = Math.abs(value);
        BigDecimal decimal = BigDecimal.valueOf(value).stripTrailingZeros();
        if (absolute >= 0.000_001 && absolute < 1e21) return decimal.toPlainString();
        return decimal.toString().replace('E', 'e');
    }

    private String jsonString(String value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("Nie udało się skanonizować tekstu.", failure);
        }
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new IllegalStateException("Brak algorytmu SHA-256.", failure);
        }
    }

    private void badRequest(String message) {
        throw new RoundDiscussionException(HttpStatus.BAD_REQUEST, message);
    }

    private void conflict(String message) {
        throw new RoundDiscussionException(HttpStatus.CONFLICT, message);
    }

    private void notFound(String message) {
        throw new RoundDiscussionException(HttpStatus.NOT_FOUND, message);
    }
}
