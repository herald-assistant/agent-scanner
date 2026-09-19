package dev.agentscanner.store;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Repository
public class ScannerStore {
    private static final String SESSION_VIEW_SQL = """
        SELECT a.id, a.conversation_id, a.agent_name, a.agent_type, a.requested_model, a.response_model,
          a.repository, a.branch_name, a.commit_sha, a.started_at, a.ended_at, a.last_seen_at,
          a.input_tokens, a.output_tokens, a.cache_read_tokens, a.cache_creation_tokens, a.reasoning_tokens,
          COALESCE(c.turn_count, a.turn_count) AS turn_count,
          COALESCE(c.tool_count, a.tool_count) AS tool_count,
          a.error_count, a.content_captured
        FROM agent_session a LEFT JOIN (
          SELECT session_id,
            SUM(CASE WHEN operation_name='chat' THEN 1 ELSE 0 END) AS turn_count,
            SUM(CASE WHEN operation_name='execute_tool' THEN 1 ELSE 0 END) AS tool_count
          FROM span_record GROUP BY session_id
        ) c ON c.session_id=a.id
        """;
    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    private final ObjectMapper mapper;

    public ScannerStore(JdbcTemplate jdbc, NamedParameterJdbcTemplate named, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.named = named;
        this.mapper = mapper;
    }

    public long insertSignal(String type, Instant receivedAt, String contentType, String encoding,
                             JsonNode resourceAttributes, String rawJson, byte[] rawPayload, int itemCount) {
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("""
            INSERT INTO telemetry_signal(signal_type, received_at, content_type, content_encoding,
              resource_attributes, raw_json, raw_payload, item_count)
            VALUES (:type, :received, :contentType, :encoding, :resources, :json, :payload, :count)
            """, new MapSqlParameterSource()
                .addValue("type", type)
                .addValue("received", Timestamp.from(receivedAt))
                .addValue("contentType", contentType)
                .addValue("encoding", encoding)
                .addValue("resources", resourceAttributes.toString())
                .addValue("json", rawJson)
                .addValue("payload", rawPayload)
                .addValue("count", itemCount), keys, new String[]{"id"});
        return Objects.requireNonNull(keys.getKey()).longValue();
    }

    public long upsertSession(SessionValues v) {
        jdbc.update("""
            MERGE INTO agent_session s USING (VALUES (?)) incoming(conversation_id)
            ON s.conversation_id = incoming.conversation_id
            WHEN MATCHED THEN UPDATE SET
              agent_name=COALESCE(?, s.agent_name), agent_type=COALESCE(?, s.agent_type),
              requested_model=COALESCE(?, s.requested_model), response_model=COALESCE(?, s.response_model),
              repository=COALESCE(?, s.repository), branch_name=COALESCE(?, s.branch_name),
              commit_sha=COALESCE(?, s.commit_sha),
              started_at=CASE WHEN s.started_at IS NULL OR ? < s.started_at THEN ? ELSE s.started_at END,
              ended_at=CASE WHEN s.ended_at IS NULL OR ? > s.ended_at THEN ? ELSE s.ended_at END,
              last_seen_at=?, input_tokens=GREATEST(s.input_tokens, ?), output_tokens=GREATEST(s.output_tokens, ?),
              cache_read_tokens=GREATEST(s.cache_read_tokens, ?), cache_creation_tokens=GREATEST(s.cache_creation_tokens, ?),
              reasoning_tokens=GREATEST(s.reasoning_tokens, ?), turn_count=GREATEST(s.turn_count, ?),
              tool_count=GREATEST(s.tool_count, ?), error_count=GREATEST(s.error_count, ?),
              content_captured=s.content_captured OR ?
            WHEN NOT MATCHED THEN INSERT
              (conversation_id, agent_name, agent_type, requested_model, response_model, repository, branch_name,
               commit_sha, started_at, ended_at, last_seen_at, input_tokens, output_tokens, cache_read_tokens,
               cache_creation_tokens, reasoning_tokens, turn_count, tool_count, error_count, content_captured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            v.conversationId(), v.agentName(), v.agentType(), v.requestedModel(), v.responseModel(),
            v.repository(), v.branch(), v.commitSha(), ts(v.startedAt()), ts(v.startedAt()), ts(v.endedAt()), ts(v.endedAt()),
            ts(v.lastSeenAt()), v.inputTokens(), v.outputTokens(), v.cacheReadTokens(), v.cacheCreationTokens(),
            v.reasoningTokens(), v.turnCount(), v.toolCount(), v.errorCount(), v.contentCaptured(),
            v.conversationId(), v.agentName(), v.agentType(), v.requestedModel(), v.responseModel(),
            v.repository(), v.branch(), v.commitSha(), ts(v.startedAt()), ts(v.endedAt()), ts(v.lastSeenAt()),
            v.inputTokens(), v.outputTokens(), v.cacheReadTokens(), v.cacheCreationTokens(), v.reasoningTokens(),
            v.turnCount(), v.toolCount(), v.errorCount(), v.contentCaptured());
        return jdbc.queryForObject("SELECT id FROM agent_session WHERE conversation_id=?", Long.class, v.conversationId());
    }

    public long insertSpan(SpanValues v) {
        KeyHolder keys = new GeneratedKeyHolder();
        named.update("""
            MERGE INTO span_record (signal_id, session_id, trace_id, span_id, parent_span_id, span_name,
              operation_name, span_kind, started_at, ended_at, duration_ms, status_code, status_message,
              model, agent_name, conversation_id, input_tokens, output_tokens, cache_read_tokens,
              cache_creation_tokens, reasoning_tokens, ttft_ms, attributes_json, events_json)
            KEY(trace_id, span_id)
            VALUES (:signalId, :sessionId, :traceId, :spanId, :parentSpanId, :spanName, :operation,
              :kind, :started, :ended, :duration, :statusCode, :statusMessage, :model, :agent,
              :conversation, :input, :output, :cacheRead, :cacheCreation, :reasoning, :ttft,
              :attributes, :events)
            """, new MapSqlParameterSource()
                .addValue("signalId", v.signalId()).addValue("sessionId", v.sessionId())
                .addValue("traceId", v.traceId()).addValue("spanId", v.spanId())
                .addValue("parentSpanId", v.parentSpanId()).addValue("spanName", v.spanName())
                .addValue("operation", v.operation()).addValue("kind", v.kind())
                .addValue("started", ts(v.startedAt())).addValue("ended", ts(v.endedAt()))
                .addValue("duration", v.durationMs()).addValue("statusCode", v.statusCode())
                .addValue("statusMessage", v.statusMessage()).addValue("model", v.model())
                .addValue("agent", v.agentName()).addValue("conversation", v.conversationId())
                .addValue("input", v.inputTokens()).addValue("output", v.outputTokens())
                .addValue("cacheRead", v.cacheReadTokens()).addValue("cacheCreation", v.cacheCreationTokens())
                .addValue("reasoning", v.reasoningTokens()).addValue("ttft", v.ttftMs())
                .addValue("attributes", v.attributesJson()).addValue("events", v.eventsJson()), keys,
                new String[]{"id"});
        Number key = keys.getKey();
        if (key != null) return key.longValue();
        return jdbc.queryForObject("SELECT id FROM span_record WHERE trace_id=? AND span_id=?", Long.class,
            v.traceId(), v.spanId());
    }

    public void insertMessage(long spanId, String direction, int sequence, String role, String content, String sourceKind) {
        jdbc.update("INSERT INTO message_record(span_id,direction,sequence_no,role_name,content,source_kind) VALUES (?,?,?,?,?,?)",
            spanId, direction, sequence, role, content, sourceKind);
    }

    public void insertMetricOrEvent(long signalId, String type, String name, Instant occurredAt,
                                    String bodyJson, String attributesJson) {
        jdbc.update("INSERT INTO metric_or_event(signal_id,signal_type,name,occurred_at,body_json,attributes_json) VALUES (?,?,?,?,?,?)",
            signalId, type, name, ts(occurredAt), bodyJson, attributesJson);
    }

    public List<Map<String, Object>> sessions() {
        return jdbc.queryForList(SESSION_VIEW_SQL + " ORDER BY a.last_seen_at DESC");
    }

    public long maxSignalId() {
        Long value = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM telemetry_signal", Long.class);
        return value == null ? 0 : value;
    }

    public List<Long> sessionIdsByTraceIds(Collection<String> traceIds) {
        if (traceIds.isEmpty()) return List.of();
        String placeholders = String.join(",", Collections.nCopies(traceIds.size(), "?"));
        return jdbc.queryForList("SELECT DISTINCT session_id FROM span_record WHERE trace_id IN (" + placeholders + ")",
            Long.class, traceIds.toArray());
    }

    public Map<Long, List<String>> sessionResourceAttributes() {
        return sessionResourceAttributesUpTo(Long.MAX_VALUE);
    }

    public Map<Long, List<String>> sessionResourceAttributesUpTo(long cutoffSignalId) {
        Map<Long, List<String>> result = new LinkedHashMap<>();
        List<SessionResourceAttributes> rows = jdbc.query("""
            SELECT DISTINCT s.session_id, t.id, t.resource_attributes
            FROM span_record s JOIN telemetry_signal t ON t.id=s.signal_id
            WHERE t.id <= ? ORDER BY s.session_id, t.id
            """, (rs, row) -> new SessionResourceAttributes(
                rs.getLong("session_id"), rs.getString("resource_attributes")), cutoffSignalId);
        rows.forEach(source -> result.computeIfAbsent(source.sessionId(), ignored -> new ArrayList<>())
            .add(source.resourceAttributes()));
        return result;
    }

    public List<String> sessionResourceAttributes(long sessionId) {
        return jdbc.query("""
            SELECT DISTINCT t.id, t.resource_attributes
            FROM telemetry_signal t JOIN span_record s ON s.signal_id=t.id
            WHERE s.session_id=? ORDER BY t.id
            """, (rs, row) -> rs.getString("resource_attributes"), sessionId);
    }

    public Optional<Map<String, Object>> session(long id) {
        List<Map<String, Object>> result = jdbc.queryForList(SESSION_VIEW_SQL + " WHERE a.id=?", id);
        return result.stream().findFirst();
    }

    public Optional<Long> sessionIdByConversationId(String conversationId) {
        return jdbc.queryForList("SELECT id FROM agent_session WHERE conversation_id=?", Long.class, conversationId)
            .stream().findFirst();
    }

    public Optional<String> toolClassification(long sessionId, String requestHash) {
        return jdbc.queryForList("SELECT result_json FROM tool_classification_result WHERE session_id=? AND request_hash=?",
            String.class, sessionId, requestHash).stream().findFirst();
    }

    public List<String> toolClassifications(long sessionId) {
        return jdbc.queryForList("SELECT result_json FROM tool_classification_result WHERE session_id=?",
                String.class, sessionId);
    }

    public void saveToolClassification(long sessionId, String requestHash, String version, String model,
                                       Instant analyzedAt, String resultJson) {
        jdbc.update("""
            MERGE INTO tool_classification_result
              (session_id, request_hash, version, model, analyzed_at, result_json)
            KEY(session_id, request_hash) VALUES (?,?,?,?,?,?)
            """, sessionId, requestHash, version, model, ts(analyzedAt), resultJson);
    }

    public Optional<GuidanceSpanSource> guidanceSpanSource(long sessionId, long spanRecordId) {
        List<GuidanceSpanSource> rows = jdbc.query("""
            SELECT s.id, s.session_id, s.signal_id, s.trace_id, s.span_id, s.operation_name,
              s.agent_name, s.conversation_id, s.duration_ms, s.input_tokens, s.output_tokens,
              s.cache_read_tokens, s.cache_creation_tokens, s.reasoning_tokens,
              s.attributes_json, s.events_json, t.raw_json
            FROM span_record s JOIN telemetry_signal t ON t.id=s.signal_id
            WHERE s.session_id=? AND s.id=?
            """, (rs, row) -> new GuidanceSpanSource(
                rs.getLong("id"), rs.getLong("session_id"), rs.getLong("signal_id"),
                rs.getString("trace_id"), rs.getString("span_id"), rs.getString("operation_name"),
                rs.getString("agent_name"), rs.getString("conversation_id"),
                nullableDouble(rs.getObject("duration_ms")), rs.getLong("input_tokens"),
                rs.getLong("output_tokens"), rs.getLong("cache_read_tokens"),
                rs.getLong("cache_creation_tokens"), rs.getLong("reasoning_tokens"),
                rs.getString("attributes_json"), rs.getString("events_json"), rs.getString("raw_json")
            ), sessionId, spanRecordId);
        return rows.stream().findFirst();
    }

    public List<GuidanceMessageSource> guidanceMessages(long spanRecordId) {
        return jdbc.query("""
            SELECT id, span_id, direction, sequence_no, role_name, content, source_kind
            FROM message_record WHERE span_id=? ORDER BY direction, sequence_no, id
            """, (rs, row) -> new GuidanceMessageSource(
                rs.getLong("id"), rs.getLong("span_id"), rs.getString("direction"),
                rs.getInt("sequence_no"), rs.getString("role_name"), rs.getString("content"),
                rs.getString("source_kind")
            ), spanRecordId);
    }

    public void saveOptimizationAdvicePreview(String id, long sessionId, String requestHash,
                                              String dataFingerprint, Instant preparedAt,
                                              Instant expiresAt, String previewJson) {
        jdbc.update("DELETE FROM optimization_advice_preview WHERE expires_at < ?", ts(preparedAt));
        jdbc.update("""
            INSERT INTO optimization_advice_preview
              (id, session_id, request_hash, data_fingerprint, prepared_at, expires_at, preview_json)
            VALUES (?,?,?,?,?,?,?)
            """, id, sessionId, requestHash, dataFingerprint, ts(preparedAt), ts(expiresAt), previewJson);
    }

    public Optional<String> optimizationAdvicePreview(String id) {
        return jdbc.queryForList("SELECT preview_json FROM optimization_advice_preview WHERE id=?",
            String.class, id).stream().findFirst();
    }

    public Optional<OptimizationAdvicePreviewSource> optimizationAdvicePreview(long sessionId, String id) {
        return jdbc.query("""
            SELECT id, session_id, request_hash, data_fingerprint, prepared_at, expires_at, preview_json
            FROM optimization_advice_preview WHERE session_id=? AND id=?
            """, (rs, row) -> new OptimizationAdvicePreviewSource(
                rs.getString("id"), rs.getLong("session_id"), rs.getString("request_hash"),
                rs.getString("data_fingerprint"), rs.getTimestamp("prepared_at").toInstant(),
                rs.getTimestamp("expires_at").toInstant(), rs.getString("preview_json")
            ), sessionId, id).stream().findFirst();
    }

    public Optional<String> optimizationAdviceResult(long sessionId, String adviceHash) {
        return jdbc.queryForList("SELECT result_json FROM optimization_advice_result WHERE session_id=? AND advice_hash=?",
                String.class, sessionId, adviceHash).stream().findFirst();
    }

    public void saveOptimizationAdviceResult(long sessionId, String adviceHash, String requestHash,
                                             String dataFingerprint, String version, String catalogVersion,
                                             String promptVersion, String model, Instant analyzedAt, String resultJson) {
        jdbc.update("""
            MERGE INTO optimization_advice_result
              (session_id, advice_hash, request_hash, data_fingerprint, version, catalog_version,
               prompt_version, model, analyzed_at, result_json)
            KEY(session_id, advice_hash) VALUES (?,?,?,?,?,?,?,?,?,?)
            """, sessionId, adviceHash, requestHash, dataFingerprint, version, catalogVersion,
                promptVersion, model, ts(analyzedAt), resultJson);
    }

    public void saveSessionChat(String id, long sessionId, String model, long cutoffSignalId,
                                String reconstructionVersion, String promptVersion, String toolsetVersion,
                                String redactionVersion, String focusJson, String bootstrapJson,
                                String contextHash, Instant createdAt) {
        jdbc.update("""
            INSERT INTO session_chat
              (id, session_id, model, cutoff_signal_id, reconstruction_version, prompt_version,
               toolset_version, redaction_version, focus_json, bootstrap_json, context_hash, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, id, sessionId, model, cutoffSignalId, reconstructionVersion, promptVersion,
            toolsetVersion, redactionVersion, focusJson, bootstrapJson, contextHash, ts(createdAt), ts(createdAt));
    }

    public Optional<SessionChatSource> sessionChat(String id) {
        return jdbc.query("""
            SELECT id, session_id, model, cutoff_signal_id, reconstruction_version, prompt_version,
              toolset_version, redaction_version, focus_json, bootstrap_json, context_hash,
              copilot_session_id, revision, created_at, updated_at
            FROM session_chat WHERE id=?
            """, sessionChatMapper(), id).stream().findFirst();
    }

    public List<SessionChatSource> sessionChats(long sessionId) {
        return jdbc.query("""
            SELECT id, session_id, model, cutoff_signal_id, reconstruction_version, prompt_version,
              toolset_version, redaction_version, focus_json, bootstrap_json, context_hash,
              copilot_session_id, revision, created_at, updated_at
            FROM session_chat WHERE session_id=? ORDER BY updated_at DESC, id DESC
            """, sessionChatMapper(), sessionId);
    }

    public List<SessionChatSource> allSessionChats() {
        return jdbc.query("""
            SELECT id, session_id, model, cutoff_signal_id, reconstruction_version, prompt_version,
              toolset_version, redaction_version, focus_json, bootstrap_json, context_hash,
              copilot_session_id, revision, created_at, updated_at
            FROM session_chat ORDER BY updated_at DESC, id DESC
            """, sessionChatMapper());
    }

    private org.springframework.jdbc.core.RowMapper<SessionChatSource> sessionChatMapper() {
        return (rs, row) -> new SessionChatSource(
            rs.getString("id"), rs.getLong("session_id"), rs.getString("model"),
            rs.getLong("cutoff_signal_id"), rs.getString("reconstruction_version"), rs.getString("prompt_version"),
            rs.getString("toolset_version"), rs.getString("redaction_version"), rs.getString("focus_json"),
            rs.getString("bootstrap_json"), rs.getString("context_hash"), rs.getString("copilot_session_id"),
            rs.getInt("revision"), rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    public Optional<SessionChatTurnSource> sessionChatTurn(String chatId, String clientRequestId) {
        return jdbc.query("""
            SELECT id, chat_id, client_request_id, question, question_hash, status, answer_json,
              error_message, created_at, completed_at
            FROM session_chat_turn WHERE chat_id=? AND client_request_id=?
            """, sessionChatTurnMapper(), chatId, clientRequestId).stream().findFirst();
    }

    public List<SessionChatTurnSource> sessionChatTurns(String chatId) {
        return jdbc.query("""
            SELECT id, chat_id, client_request_id, question, question_hash, status, answer_json,
              error_message, created_at, completed_at
            FROM session_chat_turn WHERE chat_id=? ORDER BY created_at, id
            """, sessionChatTurnMapper(), chatId);
    }

    public void saveSessionChatTurn(String id, String chatId, String clientRequestId, String question,
                                    String questionHash, Instant createdAt) {
        jdbc.update("""
            INSERT INTO session_chat_turn
              (id, chat_id, client_request_id, question, question_hash, status, created_at)
            VALUES (?,?,?,?,?,'RUNNING',?)
            """, id, chatId, clientRequestId, question, questionHash, ts(createdAt));
    }

    @Transactional
    public void completeSessionChatTurn(String chatId, String turnId, String copilotSessionId,
                                        String answerJson, Instant completedAt) {
        jdbc.update("""
            UPDATE session_chat_turn SET status='COMPLETED', answer_json=?, error_message=NULL,
              completed_at=? WHERE id=? AND chat_id=?
            """, answerJson, ts(completedAt), turnId, chatId);
        jdbc.update("""
            UPDATE session_chat SET copilot_session_id=?, revision=revision+1, updated_at=? WHERE id=?
            """, copilotSessionId, ts(completedAt), chatId);
    }

    public void failSessionChatTurn(String chatId, String turnId, String message, Instant completedAt) {
        jdbc.update("""
            UPDATE session_chat_turn SET status='FAILED', answer_json=NULL, error_message=?,
              completed_at=? WHERE id=? AND chat_id=?
            """, message, ts(completedAt), turnId, chatId);
        jdbc.update("UPDATE session_chat SET updated_at=? WHERE id=?", ts(completedAt), chatId);
    }

    public void saveSessionChatCopilotSession(String chatId, String copilotSessionId, Instant updatedAt) {
        jdbc.update("UPDATE session_chat SET copilot_session_id=?, updated_at=? WHERE id=?",
            copilotSessionId, ts(updatedAt), chatId);
    }

    private org.springframework.jdbc.core.RowMapper<SessionChatTurnSource> sessionChatTurnMapper() {
        return (rs, row) -> new SessionChatTurnSource(
            rs.getString("id"), rs.getString("chat_id"), rs.getString("client_request_id"),
            rs.getString("question"), rs.getString("question_hash"), rs.getString("status"),
            rs.getString("answer_json"), rs.getString("error_message"), rs.getTimestamp("created_at").toInstant(),
            rs.getTimestamp("completed_at") == null ? null : rs.getTimestamp("completed_at").toInstant());
    }

    public void startSessionChatToolCall(String id, String chatId, String turnId, String sdkToolCallId,
                                         int sequenceNo, String toolName, String argumentsJson,
                                         String argumentsHash, Instant startedAt) {
        jdbc.update("""
            INSERT INTO session_chat_tool_call
              (id, chat_id, turn_id, sdk_tool_call_id, sequence_no, tool_name, arguments_json,
               arguments_hash, status, started_at)
            VALUES (?,?,?,?,?,?,?,?,'RUNNING',?)
            """, id, chatId, turnId, sdkToolCallId, sequenceNo, toolName, argumentsJson, argumentsHash, ts(startedAt));
    }

    public void completeSessionChatToolCall(String id, String resultJson, String resultHash,
                                            int resultCharacters, boolean truncated, Instant completedAt) {
        jdbc.update("""
            UPDATE session_chat_tool_call SET status='COMPLETED', result_json=?, result_hash=?,
              result_characters=?, truncated=?, error_message=NULL, completed_at=? WHERE id=?
            """, resultJson, resultHash, resultCharacters, truncated, ts(completedAt), id);
    }

    public void failSessionChatToolCall(String id, String message, Instant completedAt) {
        jdbc.update("""
            UPDATE session_chat_tool_call SET status='FAILED', error_message=?, completed_at=? WHERE id=?
            """, message, ts(completedAt), id);
    }

    public List<SessionChatToolCallSource> sessionChatToolCalls(String turnId) {
        return jdbc.query("""
            SELECT id, chat_id, turn_id, sdk_tool_call_id, sequence_no, tool_name, arguments_json,
              status, result_json, result_characters, truncated, error_message, started_at, completed_at
            FROM session_chat_tool_call WHERE turn_id=? ORDER BY sequence_no, started_at, id
            """, (rs, row) -> new SessionChatToolCallSource(
                rs.getString("id"), rs.getString("chat_id"), rs.getString("turn_id"),
                rs.getString("sdk_tool_call_id"), rs.getInt("sequence_no"), rs.getString("tool_name"),
                rs.getString("arguments_json"), rs.getString("status"), rs.getString("result_json"),
                nullableInteger(rs.getObject("result_characters")), rs.getBoolean("truncated"),
                rs.getString("error_message"), rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("completed_at") == null ? null : rs.getTimestamp("completed_at").toInstant()), turnId);
    }

    public void saveSessionChatEvidence(String chatId, String evidenceRef, String sourceKind, String firstTurnId) {
        jdbc.update("""
            MERGE INTO session_chat_evidence(chat_id, evidence_ref, source_kind, first_turn_id)
            KEY(chat_id, evidence_ref) VALUES (?,?,?,?)
            """, chatId, evidenceRef, sourceKind, firstTurnId);
    }

    public Set<String> sessionChatEvidenceRefs(String chatId) {
        return new LinkedHashSet<>(jdbc.queryForList(
            "SELECT evidence_ref FROM session_chat_evidence WHERE chat_id=? ORDER BY evidence_ref", String.class, chatId));
    }

    public void deleteSessionChat(String chatId) {
        jdbc.update("DELETE FROM session_chat WHERE id=?", chatId);
    }

    public List<Map<String, Object>> spans(long sessionId) {
        return jdbc.queryForList("""
            SELECT id, signal_id, trace_id, span_id, parent_span_id, span_name, operation_name, span_kind,
              started_at, ended_at, duration_ms, status_code, status_message, model, agent_name,
              conversation_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              reasoning_tokens, ttft_ms, attributes_json, events_json
            FROM span_record WHERE session_id=? ORDER BY started_at, id
            """, sessionId);
    }

    public List<Map<String, Object>> messages(long sessionId) {
        return jdbc.queryForList("""
            SELECT m.id, m.span_id, m.direction, m.sequence_no, m.role_name, m.content, m.source_kind
            FROM message_record m JOIN span_record s ON s.id=m.span_id
            WHERE s.session_id=? ORDER BY s.started_at, m.direction, m.sequence_no
            """, sessionId);
    }

    public List<Map<String, Object>> signals(long sessionId) {
        return jdbc.queryForList("""
            SELECT DISTINCT t.id, t.signal_type, t.received_at, t.content_type, t.content_encoding,
              t.resource_attributes, t.raw_json, t.item_count
            FROM telemetry_signal t JOIN span_record s ON s.signal_id=t.id
            WHERE s.session_id=? ORDER BY t.received_at
            """, sessionId);
    }

    public Map<String, Object> status(boolean paused) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("paused", paused);
        result.put("lastSignalAt", jdbc.queryForObject("SELECT MAX(received_at) FROM telemetry_signal", Timestamp.class));
        for (String type : List.of("traces", "metrics", "logs")) {
            Long count = jdbc.queryForObject("SELECT COUNT(*) FROM telemetry_signal WHERE signal_type=?", Long.class, type);
            result.put(type, count == null ? 0 : count);
        }
        Boolean captured = jdbc.queryForObject("SELECT COALESCE(MAX(CASE WHEN content_captured THEN 1 ELSE 0 END),0) FROM agent_session", Integer.class) > 0;
        result.put("contentCaptured", captured);
        return result;
    }

    @Transactional
    public void deleteSession(long id) {
        List<Long> signalIds = jdbc.queryForList("SELECT DISTINCT signal_id FROM span_record WHERE session_id=?", Long.class, id);
        jdbc.update("DELETE FROM agent_session WHERE id=?", id);
        for (Long signalId : signalIds) jdbc.update("DELETE FROM telemetry_signal WHERE id=?", signalId);
        jdbc.update("DELETE FROM agent_session s WHERE NOT EXISTS (SELECT 1 FROM span_record p WHERE p.session_id=s.id)");
    }

    @Transactional
    public void deleteAll() {
        jdbc.update("DELETE FROM telemetry_signal");
        jdbc.update("DELETE FROM agent_session");
    }

    @Transactional
    public int deleteBefore(Instant cutoff) {
        int count = jdbc.update("DELETE FROM telemetry_signal WHERE received_at < ?", ts(cutoff));
        jdbc.update("DELETE FROM agent_session s WHERE NOT EXISTS (SELECT 1 FROM span_record p WHERE p.session_id=s.id)");
        return count;
    }

    public void checkpoint() {
        jdbc.execute("CHECKPOINT");
    }

    public JsonNode parseJson(String value) {
        try { return mapper.readTree(value); }
        catch (JsonProcessingException exception) { return mapper.getNodeFactory().textNode(value); }
    }

    private static Timestamp ts(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static Double nullableDouble(Object value) {
        return value instanceof Number number ? number.doubleValue() : null;
    }

    private static Integer nullableInteger(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }

    public record GuidanceSpanSource(
            long id, long sessionId, long signalId, String traceId, String spanId,
            String operationName, String agentName, String conversationId, Double durationMs,
            long inputTokens, long outputTokens, long cacheReadTokens, long cacheCreationTokens,
            long reasoningTokens, String attributesJson, String eventsJson, String rawJson
    ) {
    }

    public record GuidanceMessageSource(
            long id, long spanId, String direction, int sequenceNo, String roleName,
            String content, String sourceKind
    ) {
    }

    public record OptimizationAdvicePreviewSource(
            String id, long sessionId, String requestHash, String dataFingerprint,
            Instant preparedAt, Instant expiresAt, String previewJson
    ) {
    }

    public record SessionChatSource(
        String id, long sessionId, String model, long cutoffSignalId,
            String reconstructionVersion, String promptVersion, String toolsetVersion,
            String redactionVersion, String focusJson, String bootstrapJson, String contextHash,
            String copilotSessionId, int revision, Instant createdAt, Instant updatedAt
    ) {
    }

    public record SessionChatTurnSource(
            String id, String chatId, String clientRequestId, String question, String questionHash,
            String status, String answerJson, String errorMessage, Instant createdAt, Instant completedAt
    ) {
    }

    public record SessionChatToolCallSource(
            String id, String chatId, String turnId, String sdkToolCallId, int sequenceNo,
            String toolName, String argumentsJson, String status, String resultJson,
            Integer resultCharacters, boolean truncated, String errorMessage,
            Instant startedAt, Instant completedAt
    ) {
    }

    private record SessionResourceAttributes(long sessionId, String resourceAttributes) {}

    public record SessionValues(String conversationId, String agentName, String agentType,
        String requestedModel, String responseModel, String repository, String branch, String commitSha,
        Instant startedAt, Instant endedAt, Instant lastSeenAt, long inputTokens, long outputTokens,
        long cacheReadTokens, long cacheCreationTokens, long reasoningTokens, int turnCount,
        int toolCount, int errorCount, boolean contentCaptured) {}

    public record SpanValues(long signalId, long sessionId, String traceId, String spanId,
        String parentSpanId, String spanName, String operation, String kind, Instant startedAt,
        Instant endedAt, Double durationMs, String statusCode, String statusMessage, String model,
        String agentName, String conversationId, long inputTokens, long outputTokens,
        long cacheReadTokens, long cacheCreationTokens, long reasoningTokens, Double ttftMs,
        String attributesJson, String eventsJson) {}
}
