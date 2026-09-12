package dev.agentscanner.ai.advisory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.agentscanner.optimization.TechniqueCatalog;
import dev.agentscanner.store.ScannerStore;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.io.IOException;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Clob;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import static dev.agentscanner.ai.advisory.OptimizationAdvice.*;

@Service
public final class OptimizationAdvicePreparationService {
    private static final Duration PREVIEW_TTL = Duration.ofMinutes(30);
    private static final Pattern SECRET = Pattern.compile(
            "(?i)(?:\\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}\\b|\\bBearer\\s+[A-Za-z0-9._~+/=-]{12,}\\b|(?:api[_-]?key|token|password|secret|authorization)\\s*[:=]\\s*[^\\s,;\"']{6,})"
    );
    private static final Set<String> ACTIONS = Set.of(
            "GENERAL", "ACQUIRE_DATA", "MODIFY", "WRITE_INTERMEDIATE", "WRITE_FINAL", "VALIDATE",
            "DELEGATE", "MANAGE_CONTEXT", "RESPOND", "OTHER", "UNKNOWN", "CONTEXT_COMPACTION",
            "UNMAPPED", "UNATTRIBUTED"
    );

    private final ObjectMapper mapper;
    private final Validator validator;
    private final ScannerStore store;
    private final TechniqueCatalog techniqueCatalog;

    public OptimizationAdvicePreparationService(ObjectMapper mapper, Validator validator, ScannerStore store,
                                                TechniqueCatalog techniqueCatalog) {
        this.mapper = mapper;
        this.validator = validator;
        this.store = store;
        this.techniqueCatalog = techniqueCatalog;
    }

    public PreparedPreview prepare(long sessionId, JsonNode body) {
        Request request = readStrict(body);
        validateBean(request);
        validateContract(sessionId, request, body);

        Map<String, ScannerStore.GuidanceSpanSource> sources = validateSources(request);
        validateSourceOwnership(sessionId, request, sources.values());
        validateMetrics(request, sources);

        String canonicalRequest = canonical(mapper.valueToTree(request));
        String requestHash = sha256(canonicalRequest);
        // H2 TIMESTAMP WITH TIME ZONE does not preserve arbitrary nanosecond precision.
        // Keep the timestamp embedded in the signed preview identical to its persisted value,
        // otherwise an immediately loaded preview can fail its own integrity check.
        Instant preparedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        Instant expiresAt = preparedAt.plus(PREVIEW_TTL);
        String previewId = UUID.randomUUID().toString();
        int contentFragments = (int) request.observations().stream().filter(this::isContentFragment).count();
        int selectedRounds = "phase".equals(request.scope().kind()) ? request.scope().roundRefs().size() : 0;
        List<String> warnings = new ArrayList<>();
        if ("TRUNCATED".equals(request.manifest().upstreamCompleteness())) {
            warnings.add("Źródłowa telemetria oznacza niepełny zakres nadrzędny.");
        }
        if (request.observations().stream().anyMatch(item -> item.provenance() == Provenance.MISSING)) {
            warnings.add("Pakiet zawiera brakujące wartości; nie zostały zastąpione zerami.");
        }
        warnings.add("Backend potwierdził referencje w raw telemetry i znormalizowanym modelu. Model AI nie został uruchomiony.");
        PreparedPreview preview = new PreparedPreview(
                new Preparation(previewId, preparedAt.toString(), expiresAt.toString(), requestHash, "RAW_AND_NORMALIZED"),
                request,
                new Summary(selectedRounds, request.manifest().supportingRefs().size(), request.observations().size(),
                        contentFragments, canonicalRequest.length(), (int) Math.ceil(canonicalRequest.length() / 4.25), false),
                List.copyOf(warnings)
        );
        try {
            store.saveOptimizationAdvicePreview(previewId, sessionId, requestHash,
                    request.manifest().dataFingerprint(), preparedAt, expiresAt, mapper.writeValueAsString(preview));
        } catch (IOException failure) {
            throw new IllegalStateException("Nie udało się zapisać zweryfikowanego podglądu.", failure);
        }
        return preview;
    }

    public PreparedPreview loadAndRevalidate(long sessionId, String previewId) {
        ScannerStore.OptimizationAdvicePreviewSource stored = store.optimizationAdvicePreview(sessionId, previewId)
                .orElseThrow(() -> new AdvicePreparationException(HttpStatus.NOT_FOUND,
                        "Nie znaleziono zweryfikowanej migawki. Przygotuj podgląd ponownie."));
        if (stored.expiresAt().isBefore(Instant.now())) {
            conflict("Migawka wygasła. Przygotuj podgląd ponownie przed uruchomieniem AI.");
        }
        PreparedPreview preview;
        try {
            preview = mapper.readerFor(PreparedPreview.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readValue(stored.previewJson());
        } catch (IOException failure) {
            throw new IllegalStateException("Zapisana migawka jest uszkodzona.", failure);
        }
        Preparation preparation = preview.preparation();
        if (preparation == null || !previewId.equals(preparation.previewId())
                || !stored.requestHash().equals(preparation.requestHash())
                || !stored.dataFingerprint().equals(preview.request().manifest().dataFingerprint())
                || !stored.preparedAt().equals(Instant.parse(preparation.preparedAt()))
                || !stored.expiresAt().equals(Instant.parse(preparation.expiresAt()))
                || !"RAW_AND_NORMALIZED".equals(preparation.sourceValidation())) {
            conflict("Zapisana migawka nie zgadza się z jej manifestem. Przygotuj podgląd ponownie.");
        }
        revalidate(sessionId, preview);
        return preview;
    }

    public void revalidate(long sessionId, PreparedPreview preview) {
        if (preview.preparation() != null && Instant.parse(preview.preparation().expiresAt()).isBefore(Instant.now())) {
            conflict("Migawka wygasła w trakcie analizy. Przygotuj ją ponownie przed kolejną próbą.");
        }
        Request request = preview.request();
        validateBean(request);
        JsonNode body = mapper.valueToTree(request);
        validateContract(sessionId, request, body);
        String requestHash = sha256(canonical(body));
        if (preview.preparation() == null || !requestHash.equals(preview.preparation().requestHash())) {
            conflict("Hash migawki nie zgadza się z jej zawartością. Przygotuj podgląd ponownie.");
        }
        Map<String, ScannerStore.GuidanceSpanSource> sources = validateSources(request);
        validateSourceOwnership(sessionId, request, sources.values());
        validateMetrics(request, sources);
    }

    private Request readStrict(JsonNode body) {
        if (body == null || !body.isObject()) badRequest("Pakiet doradczy musi być obiektem JSON.");
        try {
            return mapper.readerFor(Request.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .readValue(body);
        } catch (IOException failure) {
            throw new AdvicePreparationException(HttpStatus.BAD_REQUEST,
                    "Pakiet doradczy ma niepoprawną strukturę albo zawiera nieznane pola.");
        }
    }

    private void validateBean(Request request) {
        Set<ConstraintViolation<Request>> violations = validator.validate(request);
        if (!violations.isEmpty()) badRequest("Pakiet doradczy jest niekompletny albo ma niepoprawne pola.");
    }

    private void validateContract(long sessionId, Request request, JsonNode body) {
        if (store.session(sessionId).isEmpty()) notFound("Nie znaleziono sesji wskazanej dla podglądu.");
        if (!VERSION.equals(request.version())) conflict("Wersja pakietu doradczego nie jest obsługiwana.");
        if (!techniqueCatalog.document().version().equals(request.catalogVersion())) {
            conflict("Katalog technik zmienił się. Odśwież podgląd przed dalszą pracą.");
        }
        if (!EVIDENCE_VERSION.equals(request.manifest().evidenceVersion())
                || !REDACTION_VERSION.equals(request.manifest().redactionVersion())) {
            conflict("Wersja dowodów lub redakcji nie jest obsługiwana.");
        }
        if (!Set.of("UNVERIFIED", "TRUNCATED").contains(request.manifest().upstreamCompleteness())) {
            badRequest("Nieznany stan kompletności telemetrii.");
        }
        try { Instant.parse(request.manifest().capturedAt()); }
        catch (RuntimeException failure) { badRequest("Czas utworzenia manifestu jest niepoprawny."); }
        if (!Set.of("ONE_OFF", "RECURRING", "UNKNOWN").contains(request.userContext().frequency())
                || !Set.of("SMALL_TRIAL", "WORKFLOW_CHANGE", "BUILD_TOOL", "UNKNOWN").contains(request.userContext().effort())) {
            badRequest("Nieznana preferencja częstotliwości lub nakładu.");
        }
        if (request.scope().rootSessionId() != sessionId) badRequest("Zakres wskazuje inną sesję główną.");
        validateScope(request.scope(), request.manifest());
        validateClassificationFingerprint(sessionId, request.manifest().classificationFingerprint());

        Set<String> allowedIds = techniqueCatalog.document().techniques().stream()
                .map(TechniqueCatalog.Technique::id).collect(java.util.stream.Collectors.toSet());
        if (new HashSet<>(request.candidateTechniqueIds()).size() != request.candidateTechniqueIds().size()
                || !allowedIds.containsAll(request.candidateTechniqueIds())) {
            badRequest("Pakiet zawiera powtórzoną albo nieznaną technikę optymalizacji.");
        }
        if (request.scope().actions() != null && (!ACTIONS.containsAll(request.scope().actions())
                || new HashSet<>(request.scope().actions()).size() != request.scope().actions().size())) {
            badRequest("Zakres zawiera nieznaną albo powtórzoną kategorię działania.");
        }
        if (unique(request.observations().stream().map(Observation::id).toList()).size() != request.observations().size()) {
            badRequest("Identyfikatory obserwacji muszą być unikalne.");
        }
        validatePrivacy(request);

        String expectedFingerprint = dataFingerprint(body);
        if (!expectedFingerprint.equals(request.manifest().dataFingerprint())) {
            conflict("Fingerprint pakietu nie zgadza się z jego zawartością. Odśwież podgląd.");
        }
    }

    private void validateScope(Scope scope, Manifest manifest) {
        if (unique(manifest.selectedRefs()).size() != manifest.selectedRefs().size()
                || unique(manifest.supportingRefs()).size() != manifest.supportingRefs().size()) {
            badRequest("Referencje zakresu i kontekstu wspierającego muszą być unikalne.");
        }
        if ("phase".equals(scope.kind())) {
            if (scope.interactionTraceId() == null || scope.interactionTraceId().isBlank()
                    || scope.roundRefs() == null || scope.roundRefs().isEmpty()
                    || scope.actions() == null || scope.actions().isEmpty()
                    || scope.compactionRef() != null) {
                badRequest("Zakres fazy wymaga trace ID i co najmniej jednej rundy.");
            }
            if (!scope.roundRefs().equals(manifest.selectedRefs())) {
                badRequest("Manifest nie opisuje dokładnie rund wybranej fazy.");
            }
        } else if ("compaction".equals(scope.kind())) {
            if (scope.compactionRef() == null || scope.compactionRef().isBlank()
                    || scope.roundRefs() != null && !scope.roundRefs().isEmpty()
                    || !manifest.selectedRefs().equals(List.of(scope.compactionRef()))) {
                badRequest("Zakres kompaktowania musi wskazywać dokładnie jedno zdarzenie.");
            }
        } else {
            badRequest("Podgląd obsługuje wyłącznie jedną fazę albo jedno kompaktowanie.");
        }
    }

    private Map<String, ScannerStore.GuidanceSpanSource> validateSources(Request request) {
        Map<String, ScannerStore.GuidanceSpanSource> result = new LinkedHashMap<>();
        for (SourceRef ref : request.observations().stream().flatMap(item -> item.sources().stream()).toList()) {
            String key = sourceKey(ref);
            ScannerStore.GuidanceSpanSource source = result.get(key);
            if (source == null) {
                source = store.guidanceSpanSource(ref.sessionId(), ref.spanId())
                        .orElseThrow(() -> new AdvicePreparationException(HttpStatus.NOT_FOUND,
                                "Nie znaleziono jednego ze źródeł podglądu. Odśwież dane sesji."));
                result.put(key, source);
            }
            if (source.signalId() != ref.signalId() || !source.traceId().equals(ref.traceId())
                    || !source.spanId().equals(ref.rawSpanId())) {
                conflict("Referencja źródła nie zgadza się z utrwalonym spanem.");
            }
            if (!rawContainsSpan(source.rawJson(), ref.traceId(), ref.rawSpanId())) {
                conflict("Źródłowy span nie występuje w zadeklarowanym raw signal.");
            }
            if (!ref.sourcePointer().equals("normalized:span:" + ref.spanId()
                    + (ref.attribute() == null ? "" : "#" + ref.attribute()))) {
                badRequest("Nieznany format wskaźnika źródła.");
            }
            String actualHash = sourceContentHash(source);
            if (!actualHash.equals(ref.sourceContentHash())) {
                conflict("Źródło zmieniło się od utworzenia podglądu. Odśwież migawkę.");
            }
        }
        validateSelectedRefs(request, result.values());
        return result;
    }

    private void validateSelectedRefs(Request request, Collection<ScannerStore.GuidanceSpanSource> sources) {
        List<SourceRef> references = request.observations().stream().flatMap(item -> item.sources().stream()).toList();
        for (String selected : request.manifest().selectedRefs()) {
            boolean found;
            if ("phase".equals(request.scope().kind())) {
                found = references.stream().filter(ref -> selected.equals(ref.roundRef()))
                        .map(ref -> sources.stream().filter(source -> sourceKey(ref).equals(source.sessionId() + ":" + source.id()))
                                .findFirst().orElse(null))
                        .anyMatch(source -> source != null && selected.equals(source.traceId() + "/" + source.spanId())
                                && "chat".equals(source.operationName()));
            } else {
                found = sources.stream().anyMatch(source -> selected.equals(source.sessionId() + "/" + source.id())
                        && "chat".equals(source.operationName()));
            }
            if (!found) notFound("Wybrany zakres nie ma dokładnego źródła modelowego.");
        }
        for (String supporting : request.manifest().supportingRefs()) {
            boolean found = references.stream().filter(ref -> supporting.equals(ref.roundRef()))
                    .anyMatch(ref -> supporting.equals(ref.traceId() + "/" + ref.rawSpanId()));
            if (!found) notFound("Kontekst wspierający nie ma dokładnej referencji źródłowej.");
        }
    }

    private void validateSourceOwnership(long rootSessionId, Request request,
                                         Collection<ScannerStore.GuidanceSpanSource> sources) {
        Set<Long> requestedSessions = sources.stream().map(ScannerStore.GuidanceSpanSource::sessionId)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        Set<Long> authorized = new LinkedHashSet<>(List.of(rootSessionId));
        Map<Long, String> conversationIds = new HashMap<>();
        for (Long candidate : requestedSessions) {
            Map<String, Object> row = store.session(candidate).orElseThrow(() ->
                    new AdvicePreparationException(HttpStatus.NOT_FOUND, "Nie znaleziono sesji źródłowej."));
            conversationIds.put(candidate, textColumn(row, "conversation_id"));
        }
        String rootConversationId = textColumn(store.session(rootSessionId).orElseThrow(), "conversation_id");
        boolean changed;
        do {
            changed = false;
            for (Long candidate : requestedSessions) {
                if (!authorized.contains(candidate) && referencesConversation(authorized, conversationIds.get(candidate))) {
                    authorized.add(candidate);
                    changed = true;
                }
            }
        } while (changed);

        if ("compaction".equals(request.scope().kind())) {
            for (ScannerStore.GuidanceSpanSource source : sources) {
                if (!authorized.contains(source.sessionId()) && isCompactor(source)
                        && containsIdentifierReference(sourceSnapshot(source), rootConversationId)) {
                    authorized.add(source.sessionId());
                }
            }
        }
        if (!authorized.containsAll(requestedSessions)) {
            badRequest("Pakiet wskazuje źródło, którego nie powiązano z wybraną sesją.");
        }
    }

    private boolean referencesConversation(Set<Long> sessionIds, String conversationId) {
        if (conversationId == null || conversationId.isBlank()) return false;
        for (Long id : sessionIds) {
            for (Map<String, Object> span : store.spans(id)) {
                JsonNode attributes = parse(storedText(column(span, "attributes_json")));
                if (conversationId.equals(attributes.path("gen_ai.tool.call.id").asText())) return true;
            }
        }
        return false;
    }

    private boolean containsIdentifierReference(JsonNode node, String expected) {
        if (node == null || expected == null || expected.isBlank()) return false;
        if (node.isTextual()) {
            String value = node.textValue();
            if (expected.equals(value) || containsDelimited(value, expected)) return true;
            try { return containsIdentifierReference(mapper.readTree(value), expected); }
            catch (JsonProcessingException ignored) { return false; }
        }
        if (node.isContainerNode()) {
            for (JsonNode child : node) if (containsIdentifierReference(child, expected)) return true;
        }
        return false;
    }

    private boolean containsDelimited(String value, String expected) {
        int index = value.indexOf(expected);
        while (index >= 0) {
            int before = index - 1;
            int after = index + expected.length();
            if ((before < 0 || !identifierCharacter(value.charAt(before)))
                    && (after >= value.length() || !identifierCharacter(value.charAt(after)))) return true;
            index = value.indexOf(expected, index + 1);
        }
        return false;
    }

    private boolean identifierCharacter(char value) {
        return Character.isLetterOrDigit(value) || value == '_' || value == '-';
    }

    private boolean isCompactor(ScannerStore.GuidanceSpanSource source) {
        String name = source.agentName() == null ? "" : source.agentName().toLowerCase(Locale.ROOT);
        JsonNode attributes = parse(source.attributesJson());
        String emitted = attributes.path("gen_ai.agent.name").asText("").toLowerCase(Locale.ROOT);
        return name.contains("summarizeconversationhistory") || emitted.contains("summarizeconversationhistory");
    }

    private void validateMetrics(Request request, Map<String, ScannerStore.GuidanceSpanSource> sources) {
        for (Observation observation : request.observations()) {
            if ("ROUND_COST_SUMMARY".equals(observation.kind())) {
                validateRoundCostSummary(request, observation, sources.get(sourceKey(observation.sources().get(0))));
                continue;
            }
            Metric metric = observation.metric();
            if (metric == null) continue;
            if (metric.covered() < 0 || metric.total() < 1 || metric.covered() > metric.total()) {
                badRequest("Pokrycie metryki jest niepoprawne.");
            }
            ScannerStore.GuidanceSpanSource source = sources.get(sourceKey(observation.sources().get(0)));
            Double expected = expectedMetric(observation.kind(), source);
            boolean validatedKind = isValidatedMetric(observation.kind());
            if (observation.provenance() == Provenance.MISSING) {
                if (metric.value() != null || metric.covered() != 0) badRequest("Brakująca metryka nie może zawierać wartości.");
                if (validatedKind && expected != null) conflict("Metryka oznaczona jako brakująca występuje w źródłowej telemetrii.");
            } else if (validatedKind && (expected == null || metric.value() == null || Math.abs(metric.value() - expected) > 0.000_001)) {
                conflict("Wartość metryki nie zgadza się ze źródłową telemetrią.");
            }
        }
    }

    private void validateRoundCostSummary(Request request, Observation observation, ScannerStore.GuidanceSpanSource source) {
        if (observation.metric() != null || observation.excerpt() == null
                || observation.sources().size() != 1 || observation.provenance() != Provenance.DERIVED
                || !EVIDENCE_VERSION.equals(observation.ruleVersion())
                || observation.excerpt().truncated() || observation.excerpt().redacted()) {
            badRequest("Zwarte podsumowanie rundy ma niepoprawny kontrakt.");
        }
        JsonNode summary;
        try { summary = mapper.readTree(observation.excerpt().text()); }
        catch (JsonProcessingException failure) {
            badRequest("Zwarte podsumowanie rundy nie jest poprawnym JSON-em.");
            return;
        }
        SourceRef ref = observation.sources().get(0);
        if (!summary.isObject() || ref.roundRef() == null || !ref.roundRef().equals(summary.path("roundRef").asText())
                || !summary.path("metrics").isObject() || !summary.has("classification")) {
            badRequest("Zwarte podsumowanie nie wskazuje dokładnie swojej rundy.");
        }
        Map<String, String> metrics = Map.of(
                "inputTokens", "INPUT_TOKENS",
                "freshInputTokens", "FRESH_INPUT_TOKENS",
                "cacheReadTokens", "CACHE_READ_TOKENS",
                "outputTokens", "OUTPUT_TOKENS",
                "cacheWriteTokens", "CACHE_WRITE_TOKENS",
                "credits", "CREDITS",
                "contextOccupancy", "CONTEXT_OCCUPANCY"
        );
        JsonNode values = summary.path("metrics");
        if (values.size() != metrics.size()) badRequest("Zwarte podsumowanie rundy ma niepełny zestaw metryk.");
        for (Map.Entry<String, String> entry : metrics.entrySet()) {
            JsonNode item = values.path(entry.getKey());
            if (!item.isObject() || !item.has("value") || !item.path("provenance").isTextual()
                    || !item.has("formulaId")) {
                badRequest("Zwarte podsumowanie rundy ma niepoprawne pole metryki.");
            }
            Double expected = expectedMetric(entry.getValue(), source);
            JsonNode actual = item.path("value");
            String expectedProvenance = expected == null ? "MISSING"
                    : Set.of("FRESH_INPUT_TOKENS", "CREDITS", "CONTEXT_OCCUPANCY").contains(entry.getValue())
                    ? "DERIVED" : "EMITTED";
            if (!expectedProvenance.equals(item.path("provenance").asText())) {
                conflict("Pochodzenie metryki w zwartym podsumowaniu nie zgadza się z telemetrią.");
            }
            if (!expectedRoundMetricAvailability(entry.getValue(), source).equals(item.path("availability").asText())) {
                conflict("Dostępność metryki w zwartym podsumowaniu nie zgadza się z telemetrią.");
            }
            if (expected == null) {
                if (!actual.isNull()) conflict("Brakująca metryka w zwartym podsumowaniu zawiera wartość.");
            } else if (!actual.isNumber() || Math.abs(actual.doubleValue() - expected) > 0.000_001) {
                conflict("Metryka w zwartym podsumowaniu nie zgadza się ze źródłową telemetrią.");
            }
            if ("DERIVED".equals(expectedProvenance) && item.path("formulaId").isNull()) {
                badRequest("Wyliczona metryka w zwartym podsumowaniu nie wskazuje formuły.");
            }
        }
        validateRoundClassification(request, summary.path("classification"));
    }

    private String expectedRoundMetricAvailability(String kind, ScannerStore.GuidanceSpanSource source) {
        if (expectedMetric(kind, source) == null) return "missing";
        if (Set.of("CACHE_READ_TOKENS", "FRESH_INPUT_TOKENS").contains(kind)) {
            JsonNode attributes = parse(source.attributesJson());
            Double input = emitted(attributes, "gen_ai.usage.input_tokens");
            Double cache = emitted(attributes, "gen_ai.usage.cache_read.input_tokens");
            if (input != null && cache != null && cache > input) return "invalid";
        }
        return Set.of("FRESH_INPUT_TOKENS", "CREDITS", "CONTEXT_OCCUPANCY").contains(kind)
                ? "derived" : "emitted";
    }

    private void validateRoundClassification(Request request, JsonNode classification) {
        String fingerprint = request.manifest().classificationFingerprint();
        if (fingerprint == null) {
            if (!classification.isNull()) badRequest("Podsumowanie rundy zawiera kategorię bez źródłowej klasyfikacji AI.");
            return;
        }
        if (!classification.isObject() || !"AI_CLASSIFICATION".equals(classification.path("provenance").asText())
                || !classification.path("roundId").isTextual() || !classification.path("actions").isArray()) {
            badRequest("Kategoria w zwartym podsumowaniu ma niepoprawny kontrakt.");
        }
        Set<String> actual = new LinkedHashSet<>();
        for (JsonNode action : classification.path("actions")) {
            if (!action.isTextual() || !ACTIONS.contains(action.asText()) || !actual.add(action.asText())) {
                badRequest("Kategoria rundy jest nieznana albo powtórzona.");
            }
        }
        JsonNode stored = classificationForFingerprint(request.scope().rootSessionId(), fingerprint);
        JsonNode storedRound = null;
        for (JsonNode candidate : stored.path("rounds")) {
            if (classification.path("roundId").asText().equals(candidate.path("roundId").asText())) {
                storedRound = candidate;
                break;
            }
        }
        if (storedRound == null || !storedRound.path("actions").isArray()) {
            conflict("Nie znaleziono rundy wskazanej przez zwartą klasyfikację.");
        }
        Set<String> expected = new LinkedHashSet<>();
        for (JsonNode action : storedRound.path("actions")) expected.add(action.asText());
        if (!actual.equals(expected)) conflict("Kategorie rundy nie zgadzają się z zapisaną klasyfikacją AI.");
    }

    private boolean isContentFragment(Observation observation) {
        return observation.excerpt() != null
                && !Set.of("ROUND_COST_SUMMARY", "ROUND_ACTIONS").contains(observation.kind());
    }

    private boolean isValidatedMetric(String kind) {
        return Set.of("INPUT_TOKENS", "COMPACTION_INPUT_TOKENS", "CONTEXT_BEFORE_COMPACTION",
                "CONTEXT_AFTER_COMPACTION", "CACHE_READ_TOKENS", "COMPACTION_CACHE_READ_TOKENS",
                "CACHE_WRITE_TOKENS", "COMPACTION_CACHE_WRITE_TOKENS", "OUTPUT_TOKENS",
                "COMPACTION_OUTPUT_TOKENS", "COMPACTION_REASONING_TOKENS", "FRESH_INPUT_TOKENS",
                "COMPACTION_FRESH_INPUT_TOKENS", "CREDITS", "COMPACTION_CREDITS",
                "CONTEXT_OCCUPANCY", "COMPACTION_DURATION").contains(kind);
    }

    private Double expectedMetric(String kind, ScannerStore.GuidanceSpanSource source) {
        JsonNode attributes = parse(source.attributesJson());
        return switch (kind) {
            case "INPUT_TOKENS", "COMPACTION_INPUT_TOKENS", "CONTEXT_BEFORE_COMPACTION", "CONTEXT_AFTER_COMPACTION" ->
                    emitted(attributes, "gen_ai.usage.input_tokens");
            case "CACHE_READ_TOKENS", "COMPACTION_CACHE_READ_TOKENS" -> emitted(attributes, "gen_ai.usage.cache_read.input_tokens");
            case "CACHE_WRITE_TOKENS", "COMPACTION_CACHE_WRITE_TOKENS" -> emittedFallback(attributes,
                    "gen_ai.usage.cache_creation.input_tokens", "gen_ai.usage.cache_write.input_tokens");
            case "OUTPUT_TOKENS", "COMPACTION_OUTPUT_TOKENS" -> emitted(attributes, "gen_ai.usage.output_tokens");
            case "COMPACTION_REASONING_TOKENS" -> maximum(
                    emitted(attributes, "gen_ai.usage.reasoning.output_tokens"),
                    emitted(attributes, "gen_ai.usage.reasoning_tokens"));
            case "FRESH_INPUT_TOKENS", "COMPACTION_FRESH_INPUT_TOKENS" -> difference(
                    emitted(attributes, "gen_ai.usage.input_tokens"),
                    emitted(attributes, "gen_ai.usage.cache_read.input_tokens"));
            case "CREDITS", "COMPACTION_CREDITS" -> divide(emittedFallback(attributes,
                    "copilot_chat.copilot_usage_nano_aiu", "github.copilot.nano_aiu"), 1_000_000_000d);
            case "CONTEXT_OCCUPANCY" -> divide(emitted(attributes, "gen_ai.usage.input_tokens"),
                    add(emitted(attributes, "copilot_chat.request.max_prompt_tokens"), emitted(attributes, "gen_ai.request.max_tokens")));
            case "COMPACTION_DURATION" -> source.durationMs();
            default -> null;
        };
    }

    private void validatePrivacy(Request request) {
        if (request.userContext().goal() != null && SECRET.matcher(request.userContext().goal()).find()) {
            badRequest("Cel użytkownika zawiera nieredagowany sekret.");
        }
        if (request.userContext().constraints().stream().anyMatch(value -> SECRET.matcher(value).find())) {
            badRequest("Ograniczenia użytkownika zawierają nieredagowany sekret.");
        }
        for (Observation observation : request.observations()) {
            if (observation.excerpt() == null) continue;
            String text = observation.excerpt().text();
            if (observation.excerpt().originalCharacters() < text.length()) {
                badRequest("Długość źródłowa fragmentu jest mniejsza od treści podglądu.");
            }
            if (SECRET.matcher(text).find()) badRequest("Pakiet zawiera nieredagowany sekret.");
            try {
                if (containsForbiddenContent(mapper.readTree(text))) {
                    badRequest("Pakiet zawiera treść systemową, developerską albo jawny reasoning.");
                }
            } catch (JsonProcessingException ignored) {
                // A plain-text excerpt is allowed; recognized secrets were checked above.
            }
        }
    }

    private void validateClassificationFingerprint(long sessionId, String fingerprint) {
        if (fingerprint == null) return;
        classificationForFingerprint(sessionId, fingerprint);
    }

    private JsonNode classificationForFingerprint(long sessionId, String fingerprint) {
        return store.toolClassifications(sessionId).stream()
                .map(this::parse)
                .filter(node -> fingerprint.equals(sha256(canonical(node))))
                .findFirst()
                .orElseThrow(() -> new AdvicePreparationException(HttpStatus.CONFLICT,
                        "Nie znaleziono klasyfikacji AI wskazanej przez manifest. Odśwież analizę kategorii."));
    }

    private boolean containsForbiddenContent(JsonNode node) {
        if (node == null) return false;
        if (node.isObject()) {
            String role = node.path("role").asText("").toLowerCase(Locale.ROOT);
            if (role.equals("system") || role.equals("developer")) return true;
            var fields = node.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                if (Set.of("reasoning", "reasoning_content", "thinking").contains(field.getKey().toLowerCase(Locale.ROOT))) return true;
                if (containsForbiddenContent(field.getValue())) return true;
            }
        } else if (node.isArray()) {
            for (JsonNode child : node) if (containsForbiddenContent(child)) return true;
        }
        return false;
    }

    JsonNode sourceSnapshot(ScannerStore.GuidanceSpanSource source) {
        ObjectNode snapshot = mapper.createObjectNode();
        snapshot.set("attributes", parse(source.attributesJson()));
        snapshot.set("events", parse(source.eventsJson()));
        ArrayNode messages = snapshot.putArray("messages");
        for (ScannerStore.GuidanceMessageSource message : store.guidanceMessages(source.id())) {
            ObjectNode item = messages.addObject();
            item.put("id", message.id());
            item.put("direction", message.direction());
            item.put("sequenceNo", message.sequenceNo());
            if (message.roleName() == null) item.putNull("roleName"); else item.put("roleName", message.roleName());
            item.put("content", message.content());
            item.put("sourceKind", message.sourceKind());
        }
        return snapshot;
    }

    String sourceContentHash(ScannerStore.GuidanceSpanSource source) {
        return sha256(canonical(sourceSnapshot(source)));
    }

    String dataFingerprint(Request request) {
        return dataFingerprint(mapper.valueToTree(request));
    }

    String dataFingerprint(JsonNode request) {
        ObjectNode material = mapper.createObjectNode();
        JsonNode manifest = request.path("manifest");
        material.set("catalogVersion", request.path("catalogVersion"));
        material.set("scope", request.path("scope"));
        material.set("selectedRefs", manifest.path("selectedRefs"));
        material.set("supportingRefs", manifest.path("supportingRefs"));
        material.set("omitted", manifest.path("omitted"));
        material.set("observations", request.path("observations"));
        material.set("candidateTechniqueIds", request.path("candidateTechniqueIds"));
        material.set("userContext", request.path("userContext"));
        material.set("evidenceVersion", manifest.path("evidenceVersion"));
        material.set("redactionVersion", manifest.path("redactionVersion"));
        return sha256(canonical(material));
    }

    private boolean rawContainsSpan(String rawJson, String traceId, String spanId) {
        JsonNode raw = parse(rawJson);
        if (raw.isTextual()) return false;
        return rawContainsSpan(raw, traceId, spanId);
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
            return java.util.HexFormat.of().formatHex(Base64.getDecoder().decode(rawValue)).equalsIgnoreCase(normalizedHex);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private JsonNode parse(String value) {
        try { return mapper.readTree(value); }
        catch (JsonProcessingException failure) { return mapper.getNodeFactory().textNode(value); }
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

    private String jsonString(String value) {
        try { return mapper.writeValueAsString(value); }
        catch (JsonProcessingException failure) { throw new IllegalStateException("Nie udało się skanonizować tekstu.", failure); }
    }

    private String javascriptNumber(double value) {
        if (!Double.isFinite(value)) throw new AdvicePreparationException(HttpStatus.BAD_REQUEST, "Pakiet zawiera niepoprawną liczbę.");
        if (value == 0) return "0";
        double absolute = Math.abs(value);
        BigDecimal decimal = BigDecimal.valueOf(value).stripTrailingZeros();
        if (absolute >= 0.000_001 && absolute < 1e21) return decimal.toPlainString();
        return decimal.toString().replace('E', 'e');
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException failure) {
            throw new IllegalStateException("Brak SHA-256 w środowisku uruchomieniowym.", failure);
        }
    }

    private Object column(Map<String, Object> row, String name) {
        return row.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .map(Map.Entry::getValue).findFirst().orElse(null);
    }

    private String textColumn(Map<String, Object> row, String name) {
        Object value = column(row, name);
        return value == null ? null : storedText(value);
    }

    private String storedText(Object value) {
        if (value instanceof Clob clob) {
            try { return clob.getSubString(1, Math.toIntExact(clob.length())); }
            catch (SQLException failure) { throw new IllegalStateException("Nie udało się odczytać źródła.", failure); }
        }
        return value == null ? "" : value.toString();
    }

    private String sourceKey(SourceRef ref) { return ref.sessionId() + ":" + ref.spanId(); }
    private Set<String> unique(List<String> values) { return new HashSet<>(values); }
    private Double emitted(JsonNode attributes, String key) {
        JsonNode node = attributes.get(key);
        if (node == null || node.isNull()) return null;
        if (node.isNumber()) return node.doubleValue();
        if (node.isTextual()) {
            try { double value = Double.parseDouble(node.textValue()); return Double.isFinite(value) ? value : null; }
            catch (NumberFormatException ignored) { return null; }
        }
        return null;
    }
    private Double emittedFallback(JsonNode attributes, String primary, String fallback) {
        return attributes.has(primary) ? emitted(attributes, primary) : emitted(attributes, fallback);
    }
    private Double difference(Double left, Double right) { return left == null || right == null ? null : Math.max(0, left - right); }
    private Double add(Double left, Double right) { return left == null || right == null ? null : left + right; }
    private Double maximum(Double left, Double right) { return left == null ? right : right == null ? left : Math.max(left, right); }
    private Double divide(Double left, Double right) { return left == null || right == null || right == 0 ? null : left / right; }

    private void badRequest(String message) { throw new AdvicePreparationException(HttpStatus.BAD_REQUEST, message); }
    private void notFound(String message) { throw new AdvicePreparationException(HttpStatus.NOT_FOUND, message); }
    private void conflict(String message) { throw new AdvicePreparationException(HttpStatus.CONFLICT, message); }
}
