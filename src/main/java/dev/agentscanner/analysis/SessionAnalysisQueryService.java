package dev.agentscanner.analysis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Bounded, audit-oriented queries over one frozen reconstructed session.
 * REST controllers and Copilot custom tools deliberately share this service.
 */
@Service
public class SessionAnalysisQueryService {
    public static final String BOOTSTRAP_CONTRACT = "session-chat-bootstrap";
    public static final String TOOLSET_CONTRACT = "session-analysis-tools";
    public static final String REDACTION_CONTRACT = "guidance-redaction";

    private static final int DEFAULT_PAGE = 25;
    private static final int MAX_PAGE = 50;
    private static final int MAX_TEXT = 12_000;
    private static final Pattern SECRET = Pattern.compile(
        "(?i)(?:\\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}\\b|\\bBearer\\s+[A-Za-z0-9._~+/=-]{12,}\\b|(?:api[_-]?key|token|password|secret|authorization)\\s*[:=]\\s*[^\\s,;\"']{6,})");
    private static final Pattern ATTACHMENT_PATH = Pattern.compile("(?i)<attachment\\b[^>]*\\bfilePath=\"([^\"]+)\"");
    private static final Pattern TAG_BLOCK = Pattern.compile("(?is)<(instruction|skill|agent)(?:\\s[^>]*)?>(.*?)</\\1>");
    private static final Pattern TAG_VALUE = Pattern.compile("(?is)<([a-zA-Z]+)>(.*?)</\\1>");

    private final SessionReconstructionService reconstruction;
    private final ObjectMapper mapper;

    public SessionAnalysisQueryService(SessionReconstructionService reconstruction, ObjectMapper mapper) {
        this.reconstruction = reconstruction;
        this.mapper = mapper;
    }

    public record Scope(long rootSessionId, long cutoffSignalId, String reconstructionVersion,
                        String redactionVersion, String ownerRef) {
    }

    public Scope createScope(long sessionId) {
        Map<String, Object> material = reconstruction.reconstruct(sessionId)
            .orElseThrow(() -> notFound("Nie znaleziono sesji do analizy."));
        return new Scope(sessionId, number(material.get("cutoffSignalId")),
            text(material, "reconstructionVersion"), REDACTION_CONTRACT, "local-user");
    }

    public Map<String, Object> bootstrap(Scope scope) {
        Material material = material(scope);
        Map<String, Object> overview = overview(scope);
        Map<String, Object> configuration = configuration(scope);
        @SuppressWarnings("unchecked") List<Map<String, Object>> interactions =
            (List<Map<String, Object>>) listInteractions(scope, 0, DEFAULT_PAGE).get("items");

        Map<String, Object> session = new LinkedHashMap<>();
        session.put("sessionRef", scope.rootSessionId());
        session.put("cutoffSignalId", scope.cutoffSignalId());
        session.put("reconstructionVersion", scope.reconstructionVersion());
        putIfPresent(session, "source", material.sourceSession().get("sourceKind"));
        putIfPresent(session, "repository", material.sourceSession().get("repository"));
        putIfPresent(session, "startedAt", material.sourceSession().get("startedAt"));
        putIfPresent(session, "lastSignalAt", material.sourceSession().get("lastSeenAt"));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("contract", BOOTSTRAP_CONTRACT);
        result.put("session", session);
        result.put("summary", overview.get("summary"));
        result.put("configuration", configuration.get("summary"));
        result.put("interactions", interactions);
        result.put("navigation", Map.of(
            "interactions", "scanner_list_interactions",
            "rounds", "scanner_list_rounds",
            "roundEvidence", "scanner_get_round_evidence",
            "configuration", "scanner_get_configuration",
            "costs", "scanner_get_cost_summary",
            "subagents", "scanner_get_subagent_tree",
            "search", "scanner_search_session"));
        result.put("coverage", overview.get("coverage"));
        result.put("limitations", overview.get("limitations"));
        result.put("capturedAt", Instant.now().toString());
        result.put("contextHash", sha256(canonical(result)));
        return result;
    }

    public Map<String, Object> overview(Scope scope) {
        Material material = material(scope);
        List<Map<String, Object>> allSpans = material.details().stream().flatMap(detail -> detail.spans().stream()).toList();
        List<Map<String, Object>> chats = allSpans.stream().filter(span -> "chat".equals(text(span, "operationName"))).toList();
        List<Map<String, Object>> tools = allSpans.stream().filter(span -> "execute_tool".equals(text(span, "operationName"))).toList();
        List<Map<String, Object>> interactions = list(material.view().get("interactions"));
        List<Map<String, Object>> groups = list(material.view().get("costGroups"));
        long errors = allSpans.stream().filter(this::confirmedError).count();
        Set<String> models = chats.stream().map(span -> firstText(span, "model"))
            .filter(value -> value != null && !value.isBlank()).collect(Collectors.toCollection(LinkedHashSet::new));

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("models", List.copyOf(models));
        summary.put("interactions", interactions.size());
        summary.put("rounds", chats.size());
        summary.put("subagents", Math.max(0, groups.size() - 1));
        summary.put("compactions", allSpans.stream().filter(span -> "summarizeconversationhistory-full".equalsIgnoreCase(attribute(span, "gen_ai.agent.name"))).count());
        summary.put("toolExecutions", tools.size());
        summary.put("confirmedErrors", errors);

        Map<String, Object> coverage = new LinkedHashMap<>();
        coverage.put("contentCaptured", Boolean.TRUE.equals(material.sourceSession().get("contentCaptured")));
        coverage.put("roundsWithInputTokens", chats.stream().filter(span -> hasAttribute(span, "gen_ai.usage.input_tokens")).count());
        coverage.put("roundsWithOutputTokens", chats.stream().filter(span -> hasAttribute(span, "gen_ai.usage.output_tokens")).count());
        coverage.put("roundsWithCredits", chats.stream().filter(span -> hasAttribute(span, "copilot_chat.copilot_usage_nano_aiu")).count());
        coverage.put("roundCount", chats.size());

        Map<String, Object> result = envelope(scope, "session-overview");
        result.put("summary", summary);
        result.put("coverage", coverage);
        result.put("limitations", Boolean.TRUE.equals(material.sourceSession().get("contentCaptured"))
            ? List.of() : List.of("SESSION_CONTENT_NOT_CAPTURED"));
        result.put("evidenceRefs", chats.stream().limit(20).map(this::spanRef).toList());
        return result;
    }

    public Map<String, Object> configuration(Scope scope) {
        Material material = material(scope);
        List<Map<String, Object>> spans = material.details().stream().flatMap(detail -> detail.spans().stream()).toList();
        List<Map<String, Object>> chats = spans.stream().filter(span -> "chat".equals(text(span, "operationName"))).toList();
        List<Map<String, Object>> roots = spans.stream().filter(span -> "invoke_agent".equals(text(span, "operationName"))).toList();
        List<Map<String, Object>> executions = spans.stream().filter(span -> "execute_tool".equals(text(span, "operationName"))).toList();
        List<String> systemTexts = chats.stream().flatMap(span -> attributeTexts(span, "gen_ai.system_instructions").stream()).toList();

        LinkedHashSet<String> instructionPaths = new LinkedHashSet<>();
        LinkedHashMap<String, Map<String, Object>> skills = new LinkedHashMap<>();
        LinkedHashMap<String, Map<String, Object>> agents = new LinkedHashMap<>();
        for (String value : systemTexts) {
            Matcher attachment = ATTACHMENT_PATH.matcher(value);
            while (attachment.find()) {
                String path = normalizePath(unescape(attachment.group(1)));
                if (instructionKind(path) != null) instructionPaths.add(path);
            }
            Matcher blocks = TAG_BLOCK.matcher(value);
            while (blocks.find()) {
                String kind = blocks.group(1).toLowerCase(Locale.ROOT);
                Map<String, String> tags = tagValues(blocks.group(2));
                if ("instruction".equals(kind)) {
                    String path = normalizePath(tags.getOrDefault("file", ""));
                    if (!path.isBlank()) instructionPaths.add(path);
                } else {
                    String name = tags.get("name");
                    if (name != null && !name.isBlank()) {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("name", name.trim());
                        putIfPresent(item, "description", tags.get("description"));
                        putIfPresent(item, "path", tags.get("file"));
                        ("skill".equals(kind) ? skills : agents).putIfAbsent(name.trim(), item);
                    }
                }
            }
        }

        Map<String, Long> usedTools = executions.stream().map(span -> attribute(span, "gen_ai.tool.name"))
            .filter(Objects::nonNull).collect(Collectors.groupingBy(value -> value, LinkedHashMap::new, Collectors.counting()));
        Map<String, Long> usedSkills = executions.stream().map(span -> attribute(span, "github.copilot.tool.parameters.skill_name"))
            .filter(Objects::nonNull).collect(Collectors.groupingBy(value -> value, LinkedHashMap::new, Collectors.counting()));
        for (Map.Entry<String, Long> entry : usedSkills.entrySet()) {
            skills.computeIfAbsent(entry.getKey(), name -> new LinkedHashMap<>(Map.of("name", name))).put("useCount", entry.getValue());
        }
        for (Map<String, Object> skill : skills.values()) skill.putIfAbsent("useCount", usedSkills.getOrDefault(skill.get("name"), 0L));

        Map<String, Long> usedAgents = new LinkedHashMap<>();
        for (Map<String, Object> root : roots) if ("custom".equals(attribute(root, "github.copilot.agent.type"))) {
            String name = Optional.ofNullable(attribute(root, "github.copilot.custom_agent.name")).orElse("Custom agent główny");
            usedAgents.merge(name, 1L, Long::sum);
        }
        for (Map<String, Object> execution : executions) {
            String tool = attribute(execution, "gen_ai.tool.name");
            if (!Set.of("runSubagent", "execution_subagent").contains(tool)) continue;
            JsonNode args = parsedAttribute(execution, "gen_ai.tool.call.arguments");
            for (String key : List.of("agentName", "agent", "name")) if (args.path(key).isTextual() && !args.path(key).asText().isBlank()) {
                usedAgents.merge(args.path(key).asText(), 1L, Long::sum); break;
            }
        }
        for (Map.Entry<String, Long> entry : usedAgents.entrySet()) {
            agents.computeIfAbsent(entry.getKey(), name -> new LinkedHashMap<>(Map.of("name", name))).put("useCount", entry.getValue());
        }
        for (Map<String, Object> agent : agents.values()) agent.putIfAbsent("useCount", usedAgents.getOrDefault(agent.get("name"), 0L));

        LinkedHashSet<String> availableTools = new LinkedHashSet<>();
        LinkedHashSet<String> exposedTools = new LinkedHashSet<>();
        for (Map<String, Object> root : roots) definitionNames(root).forEach(availableTools::add);
        for (Map<String, Object> chat : chats) {
            List<String> names = definitionNames(chat);
            availableTools.addAll(names); exposedTools.addAll(names);
        }
        LinkedHashSet<String> mcpTools = availableTools.stream().filter(name -> name.startsWith("mcp_")).collect(Collectors.toCollection(LinkedHashSet::new));
        LinkedHashSet<String> mcpServers = executions.stream().map(span -> firstNonBlank(
            attribute(span, "github.copilot.tool.parameters.mcp_server_name"),
            attribute(span, "github.copilot.tool.parameters.mcp_server_name_hash")))
            .filter(Objects::nonNull).collect(Collectors.toCollection(LinkedHashSet::new));
        long mcpExecutions = executions.stream().filter(span -> isMcp(span)).count();

        List<Map<String, Object>> instructionRows = instructionPaths.stream().map(path -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("path", path); item.put("kind", instructionKind(path)); item.put("provenance", "EMITTED"); return item;
        }).toList();
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("systemInstructionsObserved", !systemTexts.isEmpty());
        summary.put("instructions", instructionRows.size());
        summary.put("repositorySkillsAvailable", skills.values().stream().filter(item -> workspacePath(String.valueOf(item.getOrDefault("path", "")))).count());
        summary.put("repositorySkillsUsed", skills.values().stream().filter(item -> workspacePath(String.valueOf(item.getOrDefault("path", ""))))
            .filter(item -> number(item.get("useCount")) > 0).count());
        summary.put("customAgentsAvailable", agents.size());
        summary.put("customAgentsUsed", agents.values().stream().filter(item -> number(item.get("useCount")) > 0).count());
        summary.put("mcpToolsAvailable", mcpTools.size());
        summary.put("mcpExecutions", mcpExecutions);
        summary.put("toolKindsAvailable", availableTools.size());
        summary.put("toolKindsExposed", exposedTools.size());
        summary.put("toolKindsUsed", usedTools.size());
        summary.put("toolExecutions", executions.size());

        Map<String, Object> result = envelope(scope, "session-configuration");
        result.put("summary", summary);
        result.put("instructions", instructionRows);
        result.put("skills", List.copyOf(skills.values()));
        result.put("customAgents", List.copyOf(agents.values()));
        result.put("tools", Map.of("available", List.copyOf(availableTools), "exposed", List.copyOf(exposedTools), "used", usedTools));
        result.put("mcp", Map.of("tools", List.copyOf(mcpTools), "servers", List.copyOf(mcpServers), "executionCount", mcpExecutions));
        result.put("provenance", "DERIVED");
        return result;
    }

    public Map<String, Object> listInteractions(Scope scope, int cursor, int limit) {
        Material material = material(scope);
        List<Map<String, Object>> source = list(material.view().get("interactions"));
        List<Map<String, Object>> items = source.stream().map(interaction -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("interactionRef", "I" + number(interaction.get("index")));
            result.put("traceId", interaction.get("traceId"));
            result.put("prompt", truncate(redact(text(interaction, "prompt")), MAX_TEXT));
            result.put("startedAt", interaction.get("startedAt"));
            result.put("roundCount", list(interaction.get("turns")).size());
            result.put("provenance", "EMITTED");
            return result;
        }).toList();
        return page(scope, "session-interactions", items, cursor, limit);
    }

    public Map<String, Object> listRounds(Scope scope, String interactionRef, String actorRef,
                                          List<String> refs, int cursor, int limit) {
        Material material = material(scope);
        Set<String> selected = refs == null ? Set.of() : Set.copyOf(refs);
        List<Map<String, Object>> items = roundSummaries(material).stream()
            .filter(row -> interactionRef == null || interactionRef.isBlank() || interactionRef.equals(row.get("interactionRef")))
            .filter(row -> actorRef == null || actorRef.isBlank() || actorRef.equals(row.get("actorRef")))
            .filter(row -> selected.isEmpty() || selected.contains(String.valueOf(row.get("roundRef"))))
            .toList();
        return page(scope, "session-rounds", items, cursor, limit);
    }

    public Map<String, Object> roundEvidence(Scope scope, String roundRef, List<String> sections) {
        Material material = material(scope);
        LocatedSpan located = findChat(material, roundRef).orElseThrow(() -> notFound("Nie znaleziono wskazanej rundy w zakresie rozmowy."));
        Map<String, Object> span = located.span();
        List<Map<String, Object>> chats = located.detail().spans().stream()
            .filter(candidate -> "chat".equals(text(candidate, "operationName")) && text(candidate, "traceId").equals(text(span, "traceId")))
            .sorted(spanOrder()).toList();
        int position = chats.indexOf(span);
        long from = time(first(span, "endedAt", "startedAt"));
        long to = position >= 0 && position + 1 < chats.size() ? time(chats.get(position + 1).get("startedAt")) : Long.MAX_VALUE;
        List<Map<String, Object>> executions = located.detail().spans().stream()
            .filter(candidate -> "execute_tool".equals(text(candidate, "operationName")))
            .filter(candidate -> time(candidate.get("startedAt")) >= from && time(candidate.get("startedAt")) < to)
            .map(this::toolEvidence).toList();
        List<Map<String, Object>> messages = located.detail().messages().stream()
            .filter(message -> number(message.get("spanId")) == number(span.get("id")))
            .map(message -> {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("direction", message.get("direction")); result.put("role", message.get("roleName"));
                String content = redact(text(message, "content"));
                result.put("content", truncate(content, MAX_TEXT)); result.put("truncated", content.length() > MAX_TEXT);
                result.put("provenance", "EMITTED"); return result;
            }).toList();

        Map<String, Object> result = envelope(scope, "round-evidence");
        result.put("roundRef", roundRef);
        result.put("model", firstText(span, "model"));
        result.put("startedAt", span.get("startedAt"));
        result.put("endedAt", span.get("endedAt"));
        result.put("metrics", metrics(span));
        result.put("messages", messages);
        result.put("modelInput", boundedAttribute(span, "gen_ai.input.messages"));
        result.put("modelOutput", boundedAttribute(span, "gen_ai.output.messages"));
        result.put("toolDefinitions", boundedAttribute(span, "gen_ai.tool.definitions"));
        result.put("toolExecutions", executions);
        result.put("confirmedErrors", errorCodes(span));
        result.put("evidenceRefs", concat(List.of(roundRef), executions.stream().map(row -> String.valueOf(row.get("evidenceRef"))).toList()));
        result.put("provenance", "EMITTED");
        return result;
    }

    public Map<String, Object> subagentTree(Scope scope) {
        Material material = material(scope);
        List<Map<String, Object>> groups = list(material.view().get("costGroups"));
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> group : groups) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("actorRef", group.get("id")); item.put("kind", group.get("kind"));
            item.put("agentName", group.get("agentName")); item.put("startedAt", group.get("startedAt"));
            item.put("roundRefs", list(group.get("spans")).stream().map(this::spanRef).toList());
            item.put("provenance", "DERIVED"); items.add(item);
        }
        Map<String, Object> result = envelope(scope, "session-subagents");
        result.put("items", items); result.put("linkCoverage", "exact-call-id-or-structural"); return result;
    }

    public Map<String, Object> costSummary(Scope scope, List<String> refs) {
        Material material = material(scope);
        Set<String> selected = refs == null ? Set.of() : Set.copyOf(refs);
        List<Map<String, Object>> chats = material.details().stream().flatMap(detail -> detail.spans().stream())
            .filter(span -> "chat".equals(text(span, "operationName")))
            .filter(span -> selected.isEmpty() || selected.contains(spanRef(span))).toList();
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("inputTokens", sumAttribute(chats, "gen_ai.usage.input_tokens"));
        totals.put("outputTokens", sumAttribute(chats, "gen_ai.usage.output_tokens"));
        totals.put("cacheReadTokens", sumAttribute(chats, "gen_ai.usage.cache_read.input_tokens"));
        totals.put("cacheWriteTokens", sumAttribute(chats, "gen_ai.usage.cache_creation.input_tokens"));
        long creditsNano = chats.stream().mapToLong(span -> metricLong(span, "copilot_chat.copilot_usage_nano_aiu").orElse(0L)).sum();
        totals.put("credits", chats.stream().anyMatch(span -> hasAttribute(span, "copilot_chat.copilot_usage_nano_aiu")) ? creditsNano / 1_000_000_000d : null);
        totals.put("durationMs", chats.stream().mapToDouble(span -> span.get("durationMs") instanceof Number n ? n.doubleValue() : 0).sum());
        Map<String, Object> coverage = new LinkedHashMap<>();
        coverage.put("rounds", chats.size());
        coverage.put("credits", chats.stream().filter(span -> hasAttribute(span, "copilot_chat.copilot_usage_nano_aiu")).count());
        coverage.put("inputTokens", chats.stream().filter(span -> hasAttribute(span, "gen_ai.usage.input_tokens")).count());
        coverage.put("outputTokens", chats.stream().filter(span -> hasAttribute(span, "gen_ai.usage.output_tokens")).count());
        Map<String, Object> result = envelope(scope, "session-cost-summary");
        result.put("totals", totals); result.put("coverage", coverage); result.put("roundRefs", chats.stream().map(this::spanRef).toList());
        result.put("provenance", "DERIVED"); return result;
    }

    public Map<String, Object> search(Scope scope, String query, int cursor, int limit) {
        if (query == null || query.isBlank() || query.length() > 200) throw badRequest("Zapytanie wyszukiwania musi mieć od 1 do 200 znaków.");
        String needle = query.toLowerCase(Locale.ROOT);
        Material material = material(scope);
        List<Map<String, Object>> results = new ArrayList<>();
        for (Detail detail : material.details()) {
            Map<Long, Map<String, Object>> spans = detail.spans().stream().collect(Collectors.toMap(span -> number(span.get("id")), span -> span));
            for (Map<String, Object> message : detail.messages()) {
                String content = text(message, "content");
                if (!content.toLowerCase(Locale.ROOT).contains(needle)) continue;
                Map<String, Object> span = spans.get(number(message.get("spanId")));
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("kind", "MESSAGE"); row.put("roundRef", span == null ? null : spanRef(span));
                row.put("direction", message.get("direction")); row.put("excerpt", excerpt(redact(content), needle));
                row.put("evidenceRef", span == null ? "message:" + message.get("id") : spanRef(span)); row.put("provenance", "EMITTED");
                results.add(row);
            }
            for (Map<String, Object> span : detail.spans()) {
                String tool = attribute(span, "gen_ai.tool.name");
                String errors = String.join(" ", errorCodes(span));
                if ((tool == null || !tool.toLowerCase(Locale.ROOT).contains(needle)) && !errors.toLowerCase(Locale.ROOT).contains(needle)) continue;
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("kind", "SPAN"); row.put("roundRef", spanRef(span)); row.put("toolName", tool);
                row.put("errors", errorCodes(span)); row.put("evidenceRef", spanRef(span)); row.put("provenance", "EMITTED"); results.add(row);
            }
        }
        return page(scope, "session-search", results, cursor, limit);
    }

    public Set<String> evidenceRefs(Scope scope) {
        Material material = material(scope);
        return material.details().stream().flatMap(detail -> detail.spans().stream()).map(this::spanRef)
            .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    public String canonicalJson(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (Exception failure) { throw new IllegalStateException("Nie udało się zapisać danych analizy.", failure); }
    }

    public String hash(Object value) {
        return sha256(canonicalJson(value));
    }

    private Material material(Scope scope) {
        if (!SessionReconstructionService.EPISODE_VERSION.equals(scope.reconstructionVersion()) || !REDACTION_CONTRACT.equals(scope.redactionVersion()))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Wersja rekonstrukcji rozmowy nie jest już obsługiwana.");
        Map<String, Object> source = reconstruction.reconstructAt(scope.rootSessionId(), scope.cutoffSignalId())
            .orElseThrow(() -> notFound("Źródłowa sesja lub jej dane nie są już dostępne."));
        Map<String, Object> root = map(source.get("detail"));
        List<Detail> details = new ArrayList<>();
        details.add(detail(root));
        for (Map<String, Object> value : list(source.get("relatedDetails"))) details.add(detail(value));
        return new Material(source, map(source.get("view")), details, map(root.get("session")));
    }

    private List<Map<String, Object>> roundSummaries(Material material) {
        Map<String, Map<String, Object>> main = new LinkedHashMap<>();
        for (Map<String, Object> turn : list(material.view().get("modelTurns"))) {
            Map<String, Object> span = map(turn.get("model"));
            Map<String, Object> row = roundSummary(span, "main", "I" + number(turn.get("interactionIndex")),
                "M" + number(turn.get("interactionTurnIndex")), list(turn.get("tools")).size());
            main.put(spanRef(span), row);
        }
        List<Map<String, Object>> result = new ArrayList<>(main.values());
        for (Detail detail : material.details()) for (Map<String, Object> span : detail.spans()) {
            if (!"chat".equals(text(span, "operationName")) || main.containsKey(spanRef(span))) continue;
            String actor = "session:" + detail.session().get("id");
            result.add(roundSummary(span, actor, null, null, 0));
        }
        result.sort(Comparator.comparingLong(row -> time(row.get("startedAt"))));
        return result;
    }

    private Map<String, Object> roundSummary(Map<String, Object> span, String actor, String interaction, String label, int toolCount) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("roundRef", spanRef(span)); result.put("actorRef", actor); result.put("interactionRef", interaction);
        result.put("label", label == null ? spanRef(span) : label); result.put("model", firstText(span, "model"));
        result.put("startedAt", span.get("startedAt")); result.put("metrics", metrics(span)); result.put("toolExecutions", toolCount);
        result.put("confirmedErrors", errorCodes(span)); result.put("provenance", "DERIVED"); return result;
    }

    private Map<String, Object> metrics(Map<String, Object> span) {
        Map<String, Object> metrics = new LinkedHashMap<>();
        metricLong(span, "gen_ai.usage.input_tokens").ifPresent(value -> metrics.put("inputTokens", value));
        metricLong(span, "gen_ai.usage.output_tokens").ifPresent(value -> metrics.put("outputTokens", value));
        metricLong(span, "gen_ai.usage.cache_read.input_tokens").ifPresent(value -> metrics.put("cacheReadTokens", value));
        metricLong(span, "gen_ai.usage.cache_creation.input_tokens").ifPresent(value -> metrics.put("cacheWriteTokens", value));
        metricLong(span, "copilot_chat.copilot_usage_nano_aiu").ifPresent(value -> metrics.put("credits", value / 1_000_000_000d));
        putIfPresent(metrics, "durationMs", span.get("durationMs")); return metrics;
    }

    private Map<String, Object> toolEvidence(Map<String, Object> span) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("evidenceRef", spanRef(span)); result.put("name", attribute(span, "gen_ai.tool.name"));
        result.put("callId", attribute(span, "gen_ai.tool.call.id")); result.put("arguments", boundedAttribute(span, "gen_ai.tool.call.arguments"));
        result.put("result", boundedAttribute(span, "gen_ai.tool.call.result")); result.put("confirmedErrors", errorCodes(span));
        result.put("provenance", "EMITTED"); return result;
    }

    private Object boundedAttribute(Map<String, Object> span, String key) {
        JsonNode value = attributes(span).get(key);
        if (value == null || value.isNull()) return null;
        JsonNode parsed = parseEmbedded(value);
        String raw;
        try { raw = parsed.isTextual() ? parsed.asText() : mapper.writeValueAsString(parsed); }
        catch (Exception failure) { raw = parsed.toString(); }
        boolean redacted = SECRET.matcher(raw).find();
        raw = redact(raw);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("text", truncate(raw, MAX_TEXT)); result.put("originalCharacters", raw.length());
        result.put("truncated", raw.length() > MAX_TEXT); result.put("redacted", redacted);
        result.put("provenance", "EMITTED"); return result;
    }

    private Map<String, Object> envelope(Scope scope, String contract) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("contract", contract); result.put("sessionRef", scope.rootSessionId()); result.put("cutoffSignalId", scope.cutoffSignalId());
        result.put("reconstructionVersion", scope.reconstructionVersion()); return result;
    }

    private Map<String, Object> page(Scope scope, String contract, List<Map<String, Object>> source, int cursor, int requestedLimit) {
        int from = Math.max(0, cursor); int limit = requestedLimit <= 0 ? DEFAULT_PAGE : Math.min(MAX_PAGE, requestedLimit);
        int to = Math.min(source.size(), from + limit);
        Map<String, Object> result = envelope(scope, contract);
        result.put("items", from >= source.size() ? List.of() : source.subList(from, to));
        result.put("nextCursor", to < source.size() ? to : null); result.put("total", source.size()); result.put("truncated", to < source.size());
        return result;
    }

    private Detail detail(Map<String, Object> source) {
        return new Detail(map(source.get("session")), list(source.get("spans")), list(source.get("messages")));
    }

    private Optional<LocatedSpan> findChat(Material material, String ref) {
        for (Detail detail : material.details()) for (Map<String, Object> span : detail.spans())
            if ("chat".equals(text(span, "operationName")) && spanRef(span).equals(ref)) return Optional.of(new LocatedSpan(detail, span));
        return Optional.empty();
    }

    private List<String> definitionNames(Map<String, Object> span) {
        JsonNode node = parsedAttribute(span, "gen_ai.tool.definitions");
        if (!node.isArray()) return List.of();
        List<String> names = new ArrayList<>();
        for (JsonNode item : node) if (item.path("name").isTextual() && !item.path("name").asText().isBlank()) names.add(item.path("name").asText());
        return names;
    }

    private List<String> attributeTexts(Map<String, Object> span, String key) {
        JsonNode node = parsedAttribute(span, key); List<String> result = new ArrayList<>(); collectText(node, result, 0); return result;
    }

    private void collectText(JsonNode node, List<String> result, int depth) {
        if (node == null || node.isNull() || depth > 20) return;
        if (node.isTextual()) {
            try { JsonNode nested = mapper.readTree(node.asText()); if (!nested.isTextual()) { collectText(nested, result, depth + 1); return; } }
            catch (Exception ignored) { }
            if (!node.asText().isBlank()) result.add(node.asText()); return;
        }
        if (node.isArray()) { node.forEach(item -> collectText(item, result, depth + 1)); return; }
        if (!node.isObject()) return;
        for (String key : List.of("content", "text", "parts")) if (node.has(key)) collectText(node.get(key), result, depth + 1);
    }

    private JsonNode parsedAttribute(Map<String, Object> span, String key) {
        JsonNode value = attributes(span).get(key); return value == null ? mapper.nullNode() : parseEmbedded(value);
    }

    private JsonNode parseEmbedded(JsonNode value) {
        if (!value.isTextual()) return value;
        try { return mapper.readTree(value.asText()); } catch (Exception ignored) { return value; }
    }

    private JsonNode attributes(Map<String, Object> span) {
        try { return mapper.readTree(text(span, "attributesJson")); }
        catch (Exception ignored) { return mapper.createObjectNode(); }
    }

    private String attribute(Map<String, Object> span, String key) {
        JsonNode value = attributes(span).get(key); if (value == null || value.isNull()) return null;
        String result = value.isTextual() ? value.asText() : value.toString(); return result.isBlank() ? null : result;
    }

    private boolean hasAttribute(Map<String, Object> span, String key) { return attributes(span).has(key); }
    private Optional<Long> metricLong(Map<String, Object> span, String key) {
        JsonNode value = attributes(span).get(key); if (value == null || value.isNull()) return Optional.empty();
        try { return Optional.of(value.isNumber() ? value.longValue() : Long.parseLong(value.asText())); }
        catch (Exception ignored) { return Optional.empty(); }
    }
    private Long sumAttribute(List<Map<String, Object>> spans, String key) {
        if (spans.stream().noneMatch(span -> hasAttribute(span, key))) return null;
        return spans.stream().map(span -> metricLong(span, key)).filter(Optional::isPresent).mapToLong(value -> value.orElse(0L)).sum();
    }

    private boolean confirmedError(Map<String, Object> span) { return !errorCodes(span).isEmpty(); }
    private List<String> errorCodes(Map<String, Object> span) {
        List<String> result = new ArrayList<>();
        if ("STATUS_CODE_ERROR".equals(span.get("statusCode"))) result.add("STATUS_CODE_ERROR");
        if (attribute(span, "error.type") != null) result.add("error.type");
        try {
            JsonNode events = mapper.readTree(text(span, "eventsJson"));
            if (events.isArray()) for (JsonNode event : events) {
                String name = event.path("name").asText("").toLowerCase(Locale.ROOT);
                if (Set.of("exception", "error", "github.copilot.session.abort").contains(name) || name.endsWith(".error")) result.add(name);
            }
        } catch (Exception ignored) { }
        if ("execute_tool".equals(text(span, "operationName"))) {
            JsonNode toolResult = parsedAttribute(span, "gen_ai.tool.call.result");
            if (toolResult.isObject()) {
                if (toolResult.path("isError").asBoolean(false)) result.add("isError=true");
                if (toolResult.has("success") && !toolResult.path("success").asBoolean(true)) result.add("success=false");
                if (toolResult.has("ok") && !toolResult.path("ok").asBoolean(true)) result.add("ok=false");
                if (Set.of("error", "failed", "failure").contains(toolResult.path("status").asText("").toLowerCase(Locale.ROOT))) result.add("status=" + toolResult.path("status").asText());
                JsonNode exit = toolResult.has("exitCode") ? toolResult.get("exitCode") : toolResult.get("exit_code");
                if (exit != null && exit.canConvertToInt() && exit.asInt() != 0) result.add("exitCode=" + exit.asInt());
            }
        }
        return result.stream().distinct().toList();
    }

    private boolean isMcp(Map<String, Object> span) {
        return attribute(span, "github.copilot.tool.parameters.mcp_tool_name") != null
            || attribute(span, "github.copilot.tool.parameters.mcp_server_name") != null
            || Optional.ofNullable(attribute(span, "gen_ai.tool.name")).orElse("").startsWith("mcp_");
    }

    private String instructionKind(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith("/.github/copilot-instructions.md")) return "copilot-instructions";
        if (lower.endsWith("/agents.md") || lower.equals("agents.md")) return "agents-md";
        if (lower.endsWith(".instructions.md")) return "scoped-instructions";
        return null;
    }

    private boolean workspacePath(String path) { return path.replace('\\', '/').contains("/.github/") || path.toLowerCase(Locale.ROOT).endsWith("/agents.md"); }
    private Map<String, String> tagValues(String body) {
        Map<String, String> values = new LinkedHashMap<>(); Matcher matcher = TAG_VALUE.matcher(body);
        while (matcher.find()) values.putIfAbsent(matcher.group(1), unescape(matcher.group(2)).trim()); return values;
    }
    private String normalizePath(String path) { return path == null ? "" : path.replace('\\', '/').replaceAll("/{2,}", "/").trim(); }
    private String unescape(String value) { return value.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&"); }
    private String redact(String value) { return SECRET.matcher(value == null ? "" : value).replaceAll("[REDACTED]"); }
    private String truncate(String value, int max) { return value.length() <= max ? value : value.substring(0, max) + "…"; }
    private String excerpt(String value, String needle) { int at = value.toLowerCase(Locale.ROOT).indexOf(needle); int from = Math.max(0, at - 180); return truncate(value.substring(from), 600); }

    private String spanRef(Map<String, Object> span) { return text(span, "traceId") + "/" + text(span, "spanId"); }
    private Comparator<Map<String, Object>> spanOrder() { return Comparator.comparingLong(span -> time(span.get("startedAt"))); }
    private String firstText(Map<String, Object> span, String key) { Object direct = span.get(key); return direct == null ? firstNonBlank(attribute(span, "gen_ai.response.model"), attribute(span, "gen_ai.request.model")) : String.valueOf(direct); }
    private String firstNonBlank(String... values) { for (String value : values) if (value != null && !value.isBlank()) return value; return null; }
    private Object first(Map<String, Object> source, String... keys) { for (String key : keys) if (source.get(key) != null) return source.get(key); return null; }
    private long time(Object value) { if (value == null) return 0; try { return Instant.parse(String.valueOf(value)).toEpochMilli(); } catch (Exception ignored) { return 0; } }
    private long number(Object value) { if (value instanceof Number number) return number.longValue(); try { return value == null ? 0 : Long.parseLong(String.valueOf(value)); } catch (Exception ignored) { return 0; } }
    private String text(Map<?, ?> source, String key) { Object value = source.get(key); return value == null ? "" : String.valueOf(value); }
    private void putIfPresent(Map<String, Object> target, String key, Object value) { if (value != null && !String.valueOf(value).isBlank()) target.put(key, value); }
    private List<String> concat(List<String> left, List<String> right) { List<String> result = new ArrayList<>(left); result.addAll(right); return result; }

    @SuppressWarnings("unchecked") private Map<String, Object> map(Object value) { return value instanceof Map<?, ?> source ? (Map<String, Object>) source : Map.of(); }
    @SuppressWarnings("unchecked") private List<Map<String, Object>> list(Object value) { return value instanceof List<?> source ? (List<Map<String, Object>>) source : List.of(); }
    private String canonical(Object value) { return canonicalJson(value); }
    private String sha256(String value) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception failure) { throw new IllegalStateException("Nie udało się obliczyć fingerprintu danych sesji.", failure); }
    }
    private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
    private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

    private record Detail(Map<String, Object> session, List<Map<String, Object>> spans, List<Map<String, Object>> messages) {}
    private record Material(Map<String, Object> raw, Map<String, Object> view, List<Detail> details, Map<String, Object> sourceSession) {}
    private record LocatedSpan(Detail detail, Map<String, Object> span) {}
}
