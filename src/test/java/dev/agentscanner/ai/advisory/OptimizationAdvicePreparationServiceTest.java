package dev.agentscanner.ai.advisory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.optimization.TechniqueCatalog;
import dev.agentscanner.store.ScannerStore;
import dev.agentscanner.ai.AiExecutionCoordinator;
import dev.agentscanner.ai.CopilotProperties;
import jakarta.validation.Validation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import static dev.agentscanner.ai.advisory.OptimizationAdvice.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class OptimizationAdvicePreparationServiceTest {
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final ScannerStore store = mock(ScannerStore.class);
    private final TechniqueCatalog catalog = new TechniqueCatalog(mapper);
    private final OptimizationAdvicePreparationService service = new OptimizationAdvicePreparationService(
            mapper, Validation.buildDefaultValidatorFactory().getValidator(), store, catalog
    );
    private ScannerStore.GuidanceSpanSource source;

    @BeforeEach
    void prepareSource() {
        source = new ScannerStore.GuidanceSpanSource(
                10, 1, 7, "trace-1", "span-1", "chat", "agent", "root", 250d,
                100, 20, 40, 0, 0,
                "{\"copilot_chat.copilot_usage_nano_aiu\":100000000,\"gen_ai.usage.input_tokens\":100}",
                "[]", "{\"resourceSpans\":[{\"scopeSpans\":[{\"spans\":[{\"traceId\":\"trace-1\",\"spanId\":\"span-1\"}]}]}]}"
        );
        when(store.session(1)).thenReturn(Optional.of(Map.of("conversation_id", "root")));
        when(store.guidanceSpanSource(1, 10)).thenReturn(Optional.of(source));
        when(store.guidanceMessages(10)).thenReturn(List.of());
        when(store.spans(1)).thenReturn(List.of(Map.of("attributes_json", source.attributesJson())));
        when(store.messages(1)).thenReturn(List.of());
    }

    @Test
    void validatesRawAndNormalizedSourcesAndPersistsFrozenPreviewWithoutAi() {
        assertThat(service.sourceContentHash(source))
                .isEqualTo("9f7e6901f0d4cbe1be8412abf1ca0206e46ba7be0dfba7579cb11de45c1e0fc9");
        Request request = request(source, "T03", null);

        PreparedPreview result = service.prepare(1, mapper.valueToTree(request));

        assertThat(result.preparation().sourceValidation()).isEqualTo("RAW_AND_NORMALIZED");
        assertThat(result.preparation().previewId()).isNotBlank();
        assertThat(result.summary().sendBlocked()).isFalse();
        assertThat(result.warnings()).anyMatch(item -> item.contains("Model AI nie został uruchomiony"));
        verify(store).saveOptimizationAdvicePreview(anyString(), eq(1L), matches("[0-9a-f]{64}"),
                eq(request.manifest().dataFingerprint()), any(), any(), contains("RAW_AND_NORMALIZED"));
    }

    @Test
    void validatesCompactRoundMetricsAndDoesNotCountThemAsRawContentFragments() {
        PreparedPreview result = service.prepare(1, mapper.valueToTree(roundSummaryRequest(source, 100d)));

        assertThat(result.summary().observations()).isEqualTo(1);
        assertThat(result.summary().contentFragments()).isZero();
        assertThat(result.request().observations().get(0).kind()).isEqualTo("ROUND_COST_SUMMARY");
    }

    @Test
    void doesNotRejectAValidPackageBecauseOfLocalCountOrCharacterThresholds() throws Exception {
        Request request = repeatedObservationsRequest(source, 160);
        assertThat(mapper.writeValueAsString(request).length()).isGreaterThan(56_000);

        PreparedPreview result = service.prepare(1, mapper.valueToTree(request));

        assertThat(result.summary().observations()).isEqualTo(160);
        assertThat(result.summary().payloadCharacters()).isGreaterThan(56_000);
        assertThat(result.summary().sendBlocked()).isFalse();
    }

    @Test
    void rejectsATamperedValueInsideCompactRoundMetrics() {
        Request request = roundSummaryRequest(source, 101d);

        assertThatThrownBy(() -> service.prepare(1, mapper.valueToTree(request)))
                .isInstanceOfSatisfying(AdvicePreparationException.class,
                        failure -> assertThat(failure.status()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void validatesNestedRoundActionsAgainstTheFrozenClassification() {
        String stored = "{\"analyzedAt\":\"2026-09-08T10:00:00Z\",\"assessments\":[],\"model\":\"gpt-test\"," +
                "\"rounds\":[{\"actions\":[\"ACQUIRE_DATA\"],\"evidenceInvocationIds\":[],\"reason\":\"Dowód.\",\"roundId\":\"round-1\"}]," +
                "\"tools\":[],\"version\":\"model-actions-v5\"}";
        String fingerprint = sha256(stored);
        when(store.toolClassifications(1)).thenReturn(List.of(stored));

        PreparedPreview result = service.prepare(1, mapper.valueToTree(
                roundSummaryRequest(source, 100d, fingerprint, "ACQUIRE_DATA")));

        assertThat(result.summary().sendBlocked()).isFalse();
    }

    @Test
    void rejectsNestedRoundActionsThatDifferFromTheFrozenClassification() {
        String stored = "{\"analyzedAt\":\"2026-09-08T10:00:00Z\",\"assessments\":[],\"model\":\"gpt-test\"," +
                "\"rounds\":[{\"actions\":[\"ACQUIRE_DATA\"],\"evidenceInvocationIds\":[],\"reason\":\"Dowód.\",\"roundId\":\"round-1\"}]," +
                "\"tools\":[],\"version\":\"model-actions-v5\"}";
        String fingerprint = sha256(stored);
        when(store.toolClassifications(1)).thenReturn(List.of(stored));

        assertThatThrownBy(() -> service.prepare(1, mapper.valueToTree(
                roundSummaryRequest(source, 100d, fingerprint, "MODIFY"))))
                .isInstanceOfSatisfying(AdvicePreparationException.class,
                        failure -> assertThat(failure.status()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void reloadsAPreviewAfterDatabaseTimestampRoundTrip() throws Exception {
        PreparedPreview prepared = service.prepare(1, mapper.valueToTree(request(source, "T03", null)));
        var metadata = prepared.preparation();
        var preparedAt = java.time.Instant.parse(metadata.preparedAt());
        var expiresAt = java.time.Instant.parse(metadata.expiresAt());
        assertThat(preparedAt.getNano() % 1_000_000).isZero();
        assertThat(expiresAt.getNano() % 1_000_000).isZero();
        when(store.optimizationAdvicePreview(1, metadata.previewId())).thenReturn(Optional.of(
                new ScannerStore.OptimizationAdvicePreviewSource(
                        metadata.previewId(), 1, metadata.requestHash(), prepared.request().manifest().dataFingerprint(),
                        preparedAt, expiresAt, mapper.writeValueAsString(prepared))));

        assertThat(service.loadAndRevalidate(1, metadata.previewId())).isEqualTo(prepared);
    }

    @Test
    void canonicalizesIntegralFloatingPointValuesLikeBrowserJson() {
        ScannerStore.GuidanceSpanSource floating = new ScannerStore.GuidanceSpanSource(
                source.id(), source.sessionId(), source.signalId(), source.traceId(), source.spanId(), source.operationName(),
                source.agentName(), source.conversationId(), source.durationMs(), source.inputTokens(), source.outputTokens(),
                source.cacheReadTokens(), source.cacheCreationTokens(), source.reasoningTokens(),
                "{\"value\":100.0}", source.eventsJson(), source.rawJson());

        assertThat(service.sourceContentHash(floating))
                .isEqualTo("82bbe6b8b5aaf1c4e6e8ae726290a7be173c20c20e10fe4945b08a9542fddb7b");
    }

    @Test
    void rejectsAChangedNormalizedSourceAsAConflict() {
        Request request = request(source, "T03", null);
        ScannerStore.GuidanceSpanSource changed = new ScannerStore.GuidanceSpanSource(
                source.id(), source.sessionId(), source.signalId(), source.traceId(), source.spanId(), source.operationName(),
                source.agentName(), source.conversationId(), source.durationMs(), source.inputTokens(), source.outputTokens(),
                source.cacheReadTokens(), source.cacheCreationTokens(), source.reasoningTokens(),
                "{\"gen_ai.usage.input_tokens\":101}", source.eventsJson(), source.rawJson());
        when(store.guidanceSpanSource(1, 10)).thenReturn(Optional.of(changed));

        assertThatThrownBy(() -> service.prepare(1, mapper.valueToTree(request)))
                .isInstanceOfSatisfying(AdvicePreparationException.class,
                        failure -> assertThat(failure.status()).isEqualTo(HttpStatus.CONFLICT));
        verify(store, never()).saveOptimizationAdvicePreview(anyString(), anyLong(), anyString(), anyString(), any(), any(), anyString());
    }

    @Test
    void rejectsAnUnknownTechniqueBeforePersisting() {
        Request request = request(source, "T404", null);

        assertThatThrownBy(() -> service.prepare(1, mapper.valueToTree(request)))
                .isInstanceOfSatisfying(AdvicePreparationException.class,
                        failure -> assertThat(failure.status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void rejectsAValidLookingSpanThatIsAbsentFromTheRawSignal() {
        Request request = request(source, "T03", null);
        ScannerStore.GuidanceSpanSource withoutRaw = new ScannerStore.GuidanceSpanSource(
                source.id(), source.sessionId(), source.signalId(), source.traceId(), source.spanId(), source.operationName(),
                source.agentName(), source.conversationId(), source.durationMs(), source.inputTokens(), source.outputTokens(),
                source.cacheReadTokens(), source.cacheCreationTokens(), source.reasoningTokens(),
                source.attributesJson(), source.eventsJson(), "{\"resourceSpans\":[]}");
        when(store.guidanceSpanSource(1, 10)).thenReturn(Optional.of(withoutRaw));

        assertThatThrownBy(() -> service.prepare(1, mapper.valueToTree(request)))
                .isInstanceOfSatisfying(AdvicePreparationException.class,
                        failure -> assertThat(failure.status()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void rejectsAValidSourceFromAnUnrelatedSession() {
        ScannerStore.GuidanceSpanSource foreign = foreignSource("foreign-agent");
        when(store.session(2)).thenReturn(Optional.of(Map.of("conversation_id", "foreign-agent")));
        when(store.guidanceSpanSource(2, 20)).thenReturn(Optional.of(foreign));
        when(store.guidanceMessages(20)).thenReturn(List.of());

        assertThatThrownBy(() -> service.prepare(1, mapper.valueToTree(request(foreign, "T03", null))))
                .isInstanceOfSatisfying(AdvicePreparationException.class,
                        failure -> assertThat(failure.status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void acceptsAChildSessionOnlyWhenTheParentContainsItsExactLaunchCallId() {
        ScannerStore.GuidanceSpanSource child = foreignSource("child-call");
        when(store.session(2)).thenReturn(Optional.of(Map.of("conversation_id", "child-call")));
        when(store.guidanceSpanSource(2, 20)).thenReturn(Optional.of(child));
        when(store.guidanceMessages(20)).thenReturn(List.of());
        when(store.spans(1)).thenReturn(List.of(Map.of("attributes_json", "{\"gen_ai.tool.call.id\":\"child-call\"}")));

        PreparedPreview result = service.prepare(1, mapper.valueToTree(request(child, "T03", null)));

        assertThat(result.preparation().sourceValidation()).isEqualTo("RAW_AND_NORMALIZED");
    }

    @Test
    void acceptsAnExplicitCompactorSourceThatReferencesTheRootConversation() {
        ScannerStore.GuidanceSpanSource compactor = foreignSource("trace:compactor");
        compactor = new ScannerStore.GuidanceSpanSource(
                compactor.id(), compactor.sessionId(), compactor.signalId(), compactor.traceId(), compactor.spanId(),
                compactor.operationName(), "summarizeConversationHistory-full", compactor.conversationId(),
                compactor.durationMs(), compactor.inputTokens(), compactor.outputTokens(), compactor.cacheReadTokens(),
                compactor.cacheCreationTokens(), compactor.reasoningTokens(),
                "{\"gen_ai.agent.name\":\"summarizeConversationHistory-full\",\"gen_ai.usage.input_tokens\":100}",
                compactor.eventsJson(), compactor.rawJson());
        when(store.session(2)).thenReturn(Optional.of(Map.of("conversation_id", "trace:compactor")));
        when(store.guidanceSpanSource(2, 20)).thenReturn(Optional.of(compactor));
        when(store.guidanceMessages(20)).thenReturn(List.of(new ScannerStore.GuidanceMessageSource(
                30, 20, "input", 0, "user", "{\"path\":\"transcripts/root.jsonl\"}", "attribute")));

        PreparedPreview result = service.prepare(1, mapper.valueToTree(compactionRequest(compactor)));

        assertThat(result.request().scope().kind()).isEqualTo("compaction");
        verify(store).saveOptimizationAdvicePreview(anyString(), eq(1L), anyString(), anyString(), any(), any(), anyString());
    }

    @Test
    void mapsContractFailuresToPolishHttpErrorsAndRejectsUnknownFields() throws Exception {
        var coordinator = new AiExecutionCoordinator();
        try {
            var controller = new OptimizationAdviceController(service, mock(OptimizationAdviceService.class),
                    new CopilotProperties("", "", null, null, 30), coordinator);
            var mvc = MockMvcBuilders.standaloneSetup(controller).build();
            JsonNode body = mapper.valueToTree(request(source, "T03", null));
            ((com.fasterxml.jackson.databind.node.ObjectNode) body).put("unexpected", true);

            mvc.perform(post("/api/ai/optimization-advice/prepare").param("sessionId", "1")
                            .contentType("application/json").content(mapper.writeValueAsBytes(body)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("Pakiet doradczy ma niepoprawną strukturę albo zawiera nieznane pola."));
        } finally {
            coordinator.close();
        }
    }

    private Request request(ScannerStore.GuidanceSpanSource source, String techniqueId, String fingerprint) {
        String roundRef = source.traceId() + "/" + source.spanId();
        SourceRef ref = new SourceRef(source.sessionId(), source.id(), source.signalId(), source.traceId(), source.spanId(),
                "normalized:span:" + source.id() + "#gen_ai.usage.input_tokens", service.sourceContentHash(source),
                roundRef, null, null, "gen_ai.usage.input_tokens");
        Observation observation = new Observation(roundRef + ":metric:1", "INPUT_TOKENS", Provenance.EMITTED,
                List.of(ref), null, new Metric(100d, "token", roundRef, 1, 1, null),
                null, List.of());
        Manifest manifest = new Manifest("2026-09-08T10:00:00Z", fingerprint == null ? "0".repeat(64) : fingerprint,
                List.of(roundRef), List.of(), List.of(), null,
                EVIDENCE_VERSION, REDACTION_VERSION, "UNVERIFIED");
        Request draft = new Request(VERSION, catalog.document().version(),
                new Scope("phase", 1, source.traceId(), List.of(roundRef), List.of("ACQUIRE_DATA"), null),
                manifest, List.of(observation), List.of(techniqueId),
                new UserContext("Znajdź źródło kosztu.", "UNKNOWN", "UNKNOWN", List.of()));
        Manifest complete = new Manifest(manifest.capturedAt(), service.dataFingerprint(draft), manifest.selectedRefs(),
                manifest.supportingRefs(), manifest.omitted(), manifest.classificationFingerprint(),
                manifest.evidenceVersion(), manifest.redactionVersion(), manifest.upstreamCompleteness());
        return new Request(draft.version(), draft.catalogVersion(), draft.scope(), complete,
                draft.observations(), draft.candidateTechniqueIds(), draft.userContext());
    }

    private Request repeatedObservationsRequest(ScannerStore.GuidanceSpanSource source, int count) {
        Request base = request(source, "T03", null);
        Observation template = base.observations().get(0);
        List<Observation> observations = java.util.stream.IntStream.range(0, count)
                .mapToObj(index -> new Observation("repeated-" + index, template.kind(), template.provenance(),
                        template.sources(), template.ruleVersion(), template.metric(), template.excerpt(),
                        template.limitationCodes()))
                .toList();
        Manifest draftManifest = new Manifest(base.manifest().capturedAt(), "0".repeat(64),
                base.manifest().selectedRefs(), base.manifest().supportingRefs(), base.manifest().omitted(),
                base.manifest().classificationFingerprint(), base.manifest().evidenceVersion(),
                base.manifest().redactionVersion(), base.manifest().upstreamCompleteness());
        Request draft = new Request(base.version(), base.catalogVersion(), base.scope(), draftManifest,
                observations, base.candidateTechniqueIds(), base.userContext());
        Manifest complete = new Manifest(draftManifest.capturedAt(), service.dataFingerprint(draft),
                draftManifest.selectedRefs(), draftManifest.supportingRefs(), draftManifest.omitted(),
                draftManifest.classificationFingerprint(), draftManifest.evidenceVersion(),
                draftManifest.redactionVersion(), draftManifest.upstreamCompleteness());
        return new Request(draft.version(), draft.catalogVersion(), draft.scope(), complete,
                draft.observations(), draft.candidateTechniqueIds(), draft.userContext());
    }

    private Request roundSummaryRequest(ScannerStore.GuidanceSpanSource source, double inputTokens) {
        return roundSummaryRequest(source, inputTokens, null, null);
    }

    private Request roundSummaryRequest(ScannerStore.GuidanceSpanSource source, double inputTokens,
                                        String classificationFingerprint, String action) {
        String roundRef = source.traceId() + "/" + source.spanId();
        SourceRef ref = new SourceRef(source.sessionId(), source.id(), source.signalId(), source.traceId(), source.spanId(),
                "normalized:span:" + source.id() + "#guidance.round.cost-summary-v2", service.sourceContentHash(source),
                roundRef, null, null, "guidance.round.cost-summary-v2");
        String classification = action == null ? "null" : "{\"actions\":[\"" + action
                + "\"],\"provenance\":\"AI_CLASSIFICATION\",\"roundId\":\"round-1\"}";
        String excerpt = "{\"classification\":" + classification + ",\"metrics\":{" +
                "\"cacheReadTokens\":{\"availability\":\"missing\",\"formulaId\":null,\"provenance\":\"MISSING\",\"value\":null}," +
                "\"cacheWriteTokens\":{\"availability\":\"missing\",\"formulaId\":null,\"provenance\":\"MISSING\",\"value\":null}," +
                "\"contextOccupancy\":{\"availability\":\"missing\",\"formulaId\":null,\"provenance\":\"MISSING\",\"value\":null}," +
                "\"credits\":{\"availability\":\"derived\",\"formulaId\":\"nano AIU / 1 000 000 000\",\"provenance\":\"DERIVED\",\"value\":0.1}," +
                "\"freshInputTokens\":{\"availability\":\"missing\",\"formulaId\":\"I − K\",\"provenance\":\"MISSING\",\"value\":null}," +
                "\"inputTokens\":{\"availability\":\"emitted\",\"formulaId\":null,\"provenance\":\"EMITTED\",\"value\":" + inputTokens + "}," +
                "\"outputTokens\":{\"availability\":\"missing\",\"formulaId\":null,\"provenance\":\"MISSING\",\"value\":null}}," +
                "\"roundRef\":\"" + roundRef + "\"}";
        Observation observation = new Observation(roundRef + ":cost-summary", "ROUND_COST_SUMMARY", Provenance.DERIVED,
                List.of(ref), EVIDENCE_VERSION, null, new Excerpt(excerpt, excerpt.length(), false, false),
                List.of("COMPACT_ROUND_SUMMARY", "FIELD_LEVEL_PROVENANCE"));
        Manifest manifest = new Manifest("2026-09-08T10:00:00Z", "0".repeat(64), List.of(roundRef),
                List.of(), List.of(), classificationFingerprint, EVIDENCE_VERSION, REDACTION_VERSION, "UNVERIFIED");
        Request draft = new Request(VERSION, catalog.document().version(),
                new Scope("phase", 1, source.traceId(), List.of(roundRef), List.of("ACQUIRE_DATA"), null),
                manifest, List.of(observation), List.of("T03"),
                new UserContext("Znajdź źródło kosztu.", "UNKNOWN", "UNKNOWN", List.of()));
        Manifest complete = new Manifest(manifest.capturedAt(), service.dataFingerprint(draft), manifest.selectedRefs(),
                manifest.supportingRefs(), manifest.omitted(), classificationFingerprint, EVIDENCE_VERSION, REDACTION_VERSION, "UNVERIFIED");
        return new Request(draft.version(), draft.catalogVersion(), draft.scope(), complete, draft.observations(),
                draft.candidateTechniqueIds(), draft.userContext());
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private Request compactionRequest(ScannerStore.GuidanceSpanSource source) {
        String compactionRef = source.sessionId() + "/" + source.id();
        SourceRef ref = new SourceRef(source.sessionId(), source.id(), source.signalId(), source.traceId(), source.spanId(),
                "normalized:span:" + source.id() + "#gen_ai.usage.input_tokens", service.sourceContentHash(source),
                null, null, null, "gen_ai.usage.input_tokens");
        Observation observation = new Observation(compactionRef + ":metric:1", "COMPACTION_INPUT_TOKENS", Provenance.EMITTED,
                List.of(ref), null, new Metric(100d, "token", compactionRef, 1, 1, null), null, List.of());
        Manifest manifest = new Manifest("2026-09-08T10:00:00Z", "0".repeat(64), List.of(compactionRef),
                List.of(), List.of(), null, EVIDENCE_VERSION, REDACTION_VERSION, "UNVERIFIED");
        Request draft = new Request(VERSION, catalog.document().version(),
                new Scope("compaction", 1, null, null, null, compactionRef), manifest, List.of(observation),
                List.of("T15"), new UserContext(null, "UNKNOWN", "UNKNOWN", List.of()));
        Manifest complete = new Manifest(manifest.capturedAt(), service.dataFingerprint(draft), manifest.selectedRefs(),
                manifest.supportingRefs(), manifest.omitted(), null, EVIDENCE_VERSION, REDACTION_VERSION, "UNVERIFIED");
        return new Request(draft.version(), draft.catalogVersion(), draft.scope(), complete, draft.observations(),
                draft.candidateTechniqueIds(), draft.userContext());
    }

    private ScannerStore.GuidanceSpanSource foreignSource(String conversationId) {
        return new ScannerStore.GuidanceSpanSource(
                20, 2, 8, "trace-2", "span-2", "chat", "agent", conversationId, 300d,
                100, 10, 0, 0, 0, "{\"gen_ai.usage.input_tokens\":100}", "[]",
                "{\"resourceSpans\":[{\"scopeSpans\":[{\"spans\":[{\"traceId\":\"trace-2\",\"spanId\":\"span-2\"}]}]}]}"
        );
    }
}
