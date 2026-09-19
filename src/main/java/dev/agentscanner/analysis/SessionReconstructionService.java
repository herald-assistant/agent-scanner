package dev.agentscanner.analysis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.api.ApiView;
import dev.agentscanner.api.SessionSourceView;
import dev.agentscanner.store.ScannerStore;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Canonical, deterministic reconstruction shared by HTTP clients and future AI tool adapters.
 * Presentation strings and UI state deliberately stay outside this service.
 */
@Service
public class SessionReconstructionService {
    public static final String VERSION = "session-reconstruction-v1";
    public static final String EPISODE_VERSION = "copilot-episode-v1";

    private static final Set<String> AUXILIARY_AGENTS = Set.of(
        "title", "copilot-chat", "backgroundtodoagent", "copilotlanguagemodelwrapper",
        "healapplypatch", "executionsubagenttool", "summarizeconversationhistory-full"
    );
    private static final Map<String, String> AUXILIARY_TITLES = Map.of(
        "title", "Generowanie tytułu",
        "copilot-chat", "Techniczny wrapper Copilota",
        "backgroundtodoagent", "Aktualizacja planu w tle",
        "copilotlanguagemodelwrapper", "Pomocnicze przetwarzanie treści",
        "healapplypatch", "Naprawa formatu zmiany",
        "executionsubagenttool", "Subagent wykonawczy",
        "summarizeconversationhistory-full", "Kompaktowanie kontekstu"
    );
    private static final Set<String> MUTATING_TOOLS = Set.of(
        "apply_patch", "create_file", "create_directory", "edit_notebook_file", "vscode_renameSymbol"
    );

    private final ScannerStore store;
    private final ObjectMapper mapper;
    private final Map<CacheKey, Map<String, Object>> cache = new ConcurrentHashMap<>();
    private final Map<CacheKey, Map<String, Object>> workflowCache = new ConcurrentHashMap<>();

    public SessionReconstructionService(ScannerStore store, ObjectMapper mapper) {
        this.store = store;
        this.mapper = mapper;
    }

    public Optional<Map<String, Object>> reconstruct(long sessionId) {
        return reconstructAt(sessionId, store.maxSignalId());
    }

    /** Reconstructs the session only from signals visible at the supplied audit cutoff. */
    public Optional<Map<String, Object>> reconstructAt(long sessionId, long cutoffSignalId) {
        if (cutoffSignalId <= 0) return Optional.empty();
        Map<String, Object> sourceRow = store.session(sessionId).orElse(null);
        if (sourceRow == null) return Optional.empty();
        CacheKey cacheKey = new CacheKey(sessionId, cutoffSignalId, VERSION);
        Map<String, Object> cached = cache.get(cacheKey);
        if (cached != null) return Optional.of(cached);

        Map<Long, List<String>> resources = store.sessionResourceAttributesUpTo(cutoffSignalId);
        Detail source = detail(sourceRow, resources, cutoffSignalId);
        List<Detail> related = selectRelated(source, store.sessions(), resources, cutoffSignalId);
        Map<String, Object> view = buildView(source, related);
        long observedSignalId = maxSignalId(concat(List.of(source), related));
        long actualCutoffSignalId = observedSignalId == 0 ? cutoffSignalId : observedSignalId;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemaVersion", VERSION);
        result.put("reconstructionVersion", EPISODE_VERSION);
        result.put("cutoffSignalId", actualCutoffSignalId);
        result.put("detail", source.json());
        result.put("relatedDetails", related.stream().map(Detail::evidenceJson).toList());
        result.put("view", view);
        cache.keySet().removeIf(key -> key.sessionId() == sessionId && !key.equals(cacheKey));
        cache.put(cacheKey, result);
        return Optional.of(result);
    }

    public Optional<Map<String, Object>> workflowSources(long sessionId) {
        Map<String, Object> sourceRow = store.session(sessionId).orElse(null);
        if (sourceRow == null) return Optional.empty();
        long observedCutoff = store.maxSignalId();
        CacheKey cacheKey = new CacheKey(sessionId, observedCutoff, VERSION + ":workflow");
        Map<String, Object> cached = workflowCache.get(cacheKey);
        if (cached != null) return Optional.of(cached);

        Map<Long, List<String>> resources = store.sessionResourceAttributes();
        Detail source = detail(sourceRow, resources);
        List<Map<String, Object>> rows = store.sessions();
        Map<String, Long> sessionByConversation = rows.stream().map(ApiView::row)
            .filter(row -> row.get("conversationId") != null)
            .collect(Collectors.toMap(row -> text(row, "conversationId"), row -> number(row.get("id")), (left, right) -> left));
        Map<Long, Map<String, Object>> rowById = rows.stream().collect(Collectors.toMap(row -> number(row.get("ID")), Function.identity()));
        LinkedHashMap<Long, Detail> selected = new LinkedHashMap<>();
        selected.put(source.id(), source);
        ArrayDeque<Detail> pending = new ArrayDeque<>();
        pending.add(source);
        while (!pending.isEmpty()) {
            Detail current = pending.removeFirst();
            Set<Long> candidateIds = current.spans().stream()
                .filter(span -> "execute_tool".equals(text(span, "operationName")))
                .map(span -> attribute(span, "gen_ai.tool.call.id"))
                .filter(Objects::nonNull).map(sessionByConversation::get).filter(Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
            Set<String> traceIds = current.spans().stream().map(span -> text(span, "traceId"))
                .filter(value -> !value.isBlank()).collect(Collectors.toSet());
            candidateIds.addAll(store.sessionIdsByTraceIds(traceIds));
            for (Long candidateId : candidateIds) {
                if (selected.containsKey(candidateId) || !rowById.containsKey(candidateId)) continue;
                Detail candidate = detail(rowById.get(candidateId), resources);
                selected.put(candidateId, candidate);
                pending.add(candidate);
            }
        }
        List<Detail> related = selected.values().stream().filter(detail -> detail.id() != sessionId).toList();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemaVersion", VERSION);
        result.put("reconstructionVersion", EPISODE_VERSION);
        result.put("cutoffSignalId", maxSignalId(selected.values().stream().toList()));
        result.put("sources", related.stream().map(Detail::json).toList());
        workflowCache.keySet().removeIf(key -> key.sessionId() == sessionId && !key.equals(cacheKey));
        workflowCache.put(cacheKey, result);
        return Optional.of(result);
    }

    private Detail detail(long id, Map<Long, List<String>> resources) {
        return detail(store.session(id).orElseThrow(), resources, Long.MAX_VALUE);
    }

    private Detail detail(Map<String, Object> sessionRow, Map<Long, List<String>> resources) {
        return detail(sessionRow, resources, Long.MAX_VALUE);
    }

    private Detail detail(long id, Map<Long, List<String>> resources, long cutoffSignalId) {
        return detail(store.session(id).orElseThrow(), resources, cutoffSignalId);
    }

    private Detail detail(Map<String, Object> sessionRow, Map<Long, List<String>> resources, long cutoffSignalId) {
        long id = number(sessionRow.get("ID"));
        Map<String, Object> session = ApiView.row(sessionRow);
        SessionSourceView.addTo(session, resources.getOrDefault(id, List.of()), mapper);
        List<Map<String, Object>> spans = withDepth(ApiView.rows(store.spans(id)).stream()
            .filter(span -> number(span.get("signalId")) <= cutoffSignalId).toList());
        Set<Long> spanIds = spans.stream().map(span -> number(span.get("id"))).collect(Collectors.toSet());
        List<Map<String, Object>> messages = ApiView.rows(store.messages(id)).stream()
            .filter(message -> spanIds.contains(number(message.get("spanId")))).toList();
        List<Map<String, Object>> signals = ApiView.rows(store.signals(id)).stream()
            .filter(signal -> number(signal.get("id")) <= cutoffSignalId).toList();
        return new Detail(session, spans, messages, signals);
    }

    private List<Detail> selectRelated(Detail source, List<Map<String, Object>> sessionRows,
                                       Map<Long, List<String>> resources) {
        return selectRelated(source, sessionRows, resources, Long.MAX_VALUE);
    }

    private List<Detail> selectRelated(Detail source, List<Map<String, Object>> sessionRows,
                                       Map<Long, List<String>> resources, long cutoffSignalId) {
        if (isAuxiliary(source)) return List.of();
        Set<String> linkedConversationIds = source.spans().stream()
            .filter(span -> "execute_tool".equals(text(span, "operationName")))
            .map(span -> attribute(span, "gen_ai.tool.call.id")).filter(Objects::nonNull)
            .collect(Collectors.toSet());
        long start = time(source.session().get("startedAt")) - 2_000;
        long end = time(first(source.session(), "endedAt", "lastSeenAt")) + 2_500;
        return sessionRows.stream().map(ApiView::row).filter(session -> number(session.get("id")) != source.id()).filter(session -> {
            String conversationId = text(session, "conversationId");
            String agentName = session.get("agentName") == null ? null : text(session, "agentName");
            if (linkedConversationIds.contains(conversationId)) return true;
            if (isContextCompaction(agentName)) return true;
            if (!(conversationId.startsWith("trace:") || conversationId.startsWith("call_") || isAuxiliaryAgent(agentName))) return false;
            long at = time(first(session, "startedAt", "lastSeenAt"));
            return at >= start && at <= end;
        }).map(session -> detail(number(session.get("id")), resources, cutoffSignalId))
            .filter(detail -> !detail.spans().isEmpty()).toList();
    }

    private Map<String, Object> buildView(Detail originalSource, List<Detail> originalRelated) {
        List<Prepared> prepared = prepareSources(originalSource, originalRelated);
        List<Episode> episodes = episodes(prepared.get(0).primary(), prepared.subList(1, prepared.size()).stream().map(Prepared::primary).toList());
        Detail own = episodes.get(0).source();
        List<Map<String, Object>> tools = own.spans().stream()
            .filter(span -> Set.of("execute_tool", "execute_hook").contains(text(span, "operationName")))
            .sorted(spanOrder()).toList();
        List<Map<String, Object>> primaryModels = own.spans().stream().filter(span -> "chat".equals(text(span, "operationName")))
            .sorted(spanOrder()).toList();
        List<Map<String, Object>> executedTools = tools.stream().filter(span -> "execute_tool".equals(text(span, "operationName"))).toList();
        Set<String> primaryTraceIds = primaryModels.stream().map(span -> text(span, "traceId")).collect(Collectors.toSet());
        List<Map<String, Object>> roots = own.spans().stream()
            .filter(span -> "invoke_agent".equals(text(span, "operationName")) && primaryTraceIds.contains(text(span, "traceId")))
            .sorted(spanOrder()).toList();
        Map<String, Map<String, Object>> rootByTrace = roots.stream().collect(Collectors.toMap(
            span -> text(span, "traceId"), Function.identity(), (left, right) -> left, LinkedHashMap::new));
        List<String> interactionTraceIds = primaryModels.stream().map(span -> text(span, "traceId")).distinct()
            .sorted(Comparator.comparingLong(trace -> {
                Map<String, Object> root = rootByTrace.get(trace);
                if (root != null) return time(root.get("startedAt"));
                return primaryModels.stream().filter(span -> trace.equals(text(span, "traceId"))).findFirst()
                    .map(span -> time(span.get("startedAt"))).orElse(0L);
            })).toList();

        List<Map<String, Object>> interactions = new ArrayList<>();
        List<Map<String, Object>> modelTurns = new ArrayList<>();
        int globalTurn = 0;
        for (int interactionPosition = 0; interactionPosition < interactionTraceIds.size(); interactionPosition++) {
            String traceId = interactionTraceIds.get(interactionPosition);
            Map<String, Object> root = rootByTrace.get(traceId);
            List<Map<String, Object>> calls = primaryModels.stream().filter(span -> traceId.equals(text(span, "traceId"))).toList();
            List<Map<String, Object>> traceTools = executedTools.stream().filter(span -> traceId.equals(text(span, "traceId"))).toList();
            List<Map<String, Object>> diagnostics = tools.stream().filter(span -> traceId.equals(text(span, "traceId"))).toList();
            String prompt = prompt(own, root, interactionPosition);
            int interactionIndex = interactionPosition + 1;
            List<Map<String, Object>> turns = new ArrayList<>();
            for (int turnPosition = 0; turnPosition < calls.size(); turnPosition++) {
                Map<String, Object> model = calls.get(turnPosition);
                long from = time(first(model, "endedAt", "startedAt"));
                long to = turnPosition + 1 < calls.size() ? time(calls.get(turnPosition + 1).get("startedAt")) : Long.MAX_VALUE;
                Map<String, Object> turn = new LinkedHashMap<>();
                turn.put("index", ++globalTurn);
                turn.put("interactionIndex", interactionIndex);
                turn.put("interactionTurnIndex", turnPosition + 1);
                turn.put("interactionPrompt", prompt);
                putIfNotNull(turn, "interactionStartedAt", root == null ? calls.get(0).get("startedAt") : root.get("startedAt"));
                turn.put("model", model);
                turn.put("tools", between(traceTools, from, to));
                turn.put("diagnostics", between(diagnostics, from, to));
                turns.add(turn);
                modelTurns.add(turn);
            }
            Map<String, Object> interaction = new LinkedHashMap<>();
            interaction.put("index", interactionIndex);
            interaction.put("traceId", traceId);
            interaction.put("prompt", prompt);
            putIfNotNull(interaction, "startedAt", root == null ? calls.get(0).get("startedAt") : root.get("startedAt"));
            interaction.put("turns", turns);
            interactions.add(interaction);
        }

        LinkedHashMap<Long, Map<String, Object>> relatedCalls = new LinkedHashMap<>();
        for (Prepared item : prepared) for (Map<String, Object> call : item.auxiliary()) {
            @SuppressWarnings("unchecked") Map<String, Object> span = (Map<String, Object>) call.get("span");
            if (!isContextCompaction(attribute(span, "gen_ai.agent.name")))
                relatedCalls.put(number(span.get("id")), call);
        }
        for (Episode episode : episodes.subList(1, episodes.size())) {
            for (Map<String, Object> span : episode.source().spans()) if ("chat".equals(text(span, "operationName"))) {
                Map<String, Object> call = new LinkedHashMap<>();
                call.put("span", span);
                call.put("label", auxiliaryTitle(episode.source().agentName()));
                relatedCalls.put(number(span.get("id")), call);
            }
        }

        LinkSelection selection = linkedSelection(episodes);
        Map<String, Map<String, Object>> launchByEpisode = selection.launches().entrySet().stream().collect(Collectors.toMap(
            entry -> entry.getValue().id(), Map.Entry::getKey, (left, right) -> left));
        List<Map<String, Object>> costGroups = new ArrayList<>();
        List<Map<String, Object>> billingModels = new ArrayList<>();
        for (int index = 0; index < episodes.size(); index++) {
            Episode episode = episodes.get(index);
            if (!selection.included().contains(episode.id())) continue;
            List<Map<String, Object>> spans = episode.source().spans().stream().filter(span -> "chat".equals(text(span, "operationName")))
                .sorted(spanOrder()).toList();
            billingModels.addAll(spans);
            if (spans.isEmpty()) continue;
            Map<String, Object> launch = launchByEpisode.get(episode.id());
            Map<String, Object> group = new LinkedHashMap<>();
            group.put("id", episode.id());
            group.put("kind", index == 0 ? "main" : "subagent");
            putIfNotNull(group, "agentName", episode.source().session().get("agentName"));
            putIfNotNull(group, "startedAt", launch == null ? spans.get(0).get("startedAt") : launch.get("startedAt"));
            group.put("spans", spans);
            costGroups.add(group);
        }
        costGroups.sort(Comparator.<Map<String, Object>>comparingInt(group -> "main".equals(group.get("kind")) ? 0 : 1)
            .thenComparingLong(group -> time(group.get("startedAt"))));

        Map<String, Object> view = new LinkedHashMap<>();
        view.put("tools", tools);
        view.put("primaryModelSpans", primaryModels);
        view.put("billingModelSpans", billingModels);
        view.put("costGroups", costGroups);
        view.put("modelTurns", modelTurns);
        view.put("interactions", interactions);
        // Context compaction is deliberately completed by the compatibility adapter until its
        // evidence matcher has an independent backend parity suite.
        view.put("relatedModelCalls", relatedCalls.values().stream()
            .sorted(Comparator.comparingLong(call -> time(((Map<?, ?>) call.get("span")).get("startedAt")))).toList());
        view.put("assistantAnswer", assistantAnswer(own, roots));
        view.put("toolDefinitionNames", toolDefinitionNames(own));
        view.put("contextualMessageCount", own.messages().stream().filter(message -> "input".equals(text(message, "direction")))
            .filter(message -> text(message, "content").contains("<environment_info>") || text(message, "content").contains("<context>"))
            .count());
        view.put("madeFileChanges", tools.stream().map(span -> attribute(span, "gen_ai.tool.name"))
            .filter(Objects::nonNull).anyMatch(MUTATING_TOOLS::contains));
        return view;
    }

    private List<Prepared> prepareSources(Detail source, List<Detail> related) {
        List<Episode> rawEpisodes = episodes(source, related);
        LinkSelection selection = linkedSelection(rawEpisodes);
        Map<String, Map<String, Object>> launchByEpisode = selection.launches().entrySet().stream().collect(Collectors.toMap(
            entry -> entry.getValue().id(), Map.Entry::getKey, (left, right) -> left));
        Set<Long> preserved = rawEpisodes.stream().skip(1).filter(episode -> selection.included().contains(episode.id()))
            .flatMap(episode -> {
                Map<String, Object> launch = launchByEpisode.get(episode.id());
                if (launch == null || !"execution_subagent".equals(attribute(launch, "gen_ai.tool.name"))) return java.util.stream.Stream.empty();
                return episode.source().spans().stream().filter(span -> "chat".equals(text(span, "operationName")))
                    .filter(span -> "executionsubagenttool".equals(lower(attribute(span, "gen_ai.agent.name"))))
                    .map(span -> number(span.get("id")));
            }).collect(Collectors.toSet());
        return concat(List.of(source), related).stream().map(detail -> separateAuxiliary(detail, preserved)).toList();
    }

    private Prepared separateAuxiliary(Detail source, Set<Long> preserved) {
        List<Map<String, Object>> chats = source.spans().stream().filter(span -> "chat".equals(text(span, "operationName"))).toList();
        List<Map<String, Object>> auxiliary = chats.stream().filter(span -> !preserved.contains(number(span.get("id"))))
            .filter(span -> isAuxiliaryAgent(attribute(span, "gen_ai.agent.name"))).toList();
        if (auxiliary.isEmpty()) return new Prepared(source, List.of());
        Set<Long> auxiliaryIds = auxiliary.stream().map(span -> number(span.get("id"))).collect(Collectors.toSet());
        List<Map<String, Object>> primaryChats = chats.stream().filter(span -> !auxiliaryIds.contains(number(span.get("id")))).toList();
        List<ModelResponse> auxiliaryResponses = auxiliary.stream().map(span -> modelResponse(source, span)).toList();
        List<ModelResponse> primaryResponses = primaryChats.stream().map(span -> modelResponse(source, span)).toList();
        Set<String> auxiliaryCallIds = auxiliaryResponses.stream().flatMap(response -> response.ids().stream()).collect(Collectors.toSet());
        Set<String> primaryCallIds = primaryResponses.stream().flatMap(response -> response.ids().stream()).collect(Collectors.toSet());
        Set<String> auxiliaryNames = auxiliaryResponses.stream().flatMap(response -> response.names().stream()).collect(Collectors.toSet());
        Set<String> primaryNames = primaryResponses.stream().flatMap(response -> response.names().stream()).collect(Collectors.toSet());
        boolean primaryOutputCovered = primaryResponses.stream().allMatch(ModelResponse::observed);
        Set<Long> auxiliaryToolIds = source.spans().stream().filter(span -> "execute_tool".equals(text(span, "operationName")))
            .filter(span -> {
                String callId = attribute(span, "gen_ai.tool.call.id");
                if (callId != null) return auxiliaryCallIds.contains(callId) && !primaryCallIds.contains(callId);
                String name = attribute(span, "gen_ai.tool.name");
                return primaryOutputCovered && name != null && auxiliaryNames.contains(name) && !primaryNames.contains(name);
            }).map(span -> number(span.get("id"))).collect(Collectors.toSet());
        Set<Long> excluded = new HashSet<>(auxiliaryIds);
        excluded.addAll(auxiliaryToolIds);
        Detail primary = new Detail(source.session(), source.spans().stream().filter(span -> !excluded.contains(number(span.get("id")))).toList(),
            source.messages().stream().filter(message -> !auxiliaryIds.contains(number(message.get("spanId")))).toList(), source.signals());
        List<Map<String, Object>> calls = auxiliary.stream().map(span -> {
            Map<String, Object> call = new LinkedHashMap<>();
            call.put("span", span);
            call.put("label", auxiliaryTitle(attribute(span, "gen_ai.agent.name")));
            return call;
        }).toList();
        return new Prepared(primary, calls);
    }

    private List<Episode> episodes(Detail source, List<Detail> related) {
        List<Detail> sources = concat(List.of(source), related.stream().filter(item -> item.id() != source.id()).toList());
        record Entry(Detail detail, Map<String, Object> span) {}
        List<Entry> entries = sources.stream().flatMap(detail -> detail.spans().stream().map(span -> new Entry(detail, span)))
            .sorted(Comparator.<Entry>comparingLong(entry -> number(entry.span().get("signalId"))).reversed()
                .thenComparingLong(entry -> entry.detail().id()).thenComparing(entry -> entry.span(), spanOrder())).toList();
        LinkedHashMap<String, Entry> unique = new LinkedHashMap<>();
        entries.forEach(entry -> unique.putIfAbsent(spanRef(entry.span()), entry));
        List<Map<String, Object>> spans = unique.values().stream().map(Entry::span).sorted(spanOrder()).toList();
        Map<String, Map<String, Object>> byRef = spans.stream().collect(Collectors.toMap(this::spanRef, Function.identity(), (a, b) -> a));
        Function<Map<String, Object>, Map<String, Object>> parent = span -> byRef.get(text(span, "traceId") + "/" + text(span, "parentSpanId"));
        Set<String> callIds = spans.stream().filter(span -> "execute_tool".equals(text(span, "operationName")))
            .map(span -> attribute(span, "gen_ai.tool.call.id")).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<String, Map<String, Object>> roots = new HashMap<>();
        for (Map<String, Object> span : spans) {
            Map<String, Object> current = span;
            Set<String> visited = new HashSet<>();
            while (current != null && !"invoke_agent".equals(text(current, "operationName")) && visited.add(spanRef(current))) current = parent.apply(current);
            roots.put(spanRef(span), current != null && "invoke_agent".equals(text(current, "operationName")) ? current : null);
        }
        String primaryId = "conversation:" + source.conversationId();
        record Identity(String id, String value) {}
        Map<String, Identity> rootIdentities = new HashMap<>();
        for (Map<String, Object> root : spans.stream().filter(span -> "invoke_agent".equals(text(span, "operationName"))).toList()) {
            Map<String, Object> launch = parent.apply(root);
            String raw = attribute(root, "gen_ai.conversation.id");
            String callId = launch != null && "execute_tool".equals(text(launch, "operationName")) ? attribute(launch, "gen_ai.tool.call.id") : null;
            String chatId = attribute(root, "copilot_chat.chat_session_id");
            String parentChatId = attribute(root, "copilot_chat.parent_chat_session_id");
            String mixed = callId != null && callId.equals(chatId) && parentChatId != null && launch != null &&
                (parentChatId.equals(attribute(launch, "copilot_chat.chat_session_id")) || parentChatId.equals(attribute(launch, "gen_ai.conversation.id"))) ? callId : null;
            List<String> childIds = spans.stream().filter(span -> "chat".equals(text(span, "operationName")) && roots.get(spanRef(span)) == root)
                .map(span -> attribute(span, "gen_ai.conversation.id")).filter(Objects::nonNull).distinct().toList();
            String detached = launch == null && childIds.size() == 1 && callIds.contains(childIds.get(0)) ? childIds.get(0) : null;
            Entry origin = unique.get(spanRef(root));
            String identity = firstNonNull(mixed, detached, raw, origin != null && origin.detail() == source ? source.conversationId() : null);
            boolean main = Objects.equals(identity, source.conversationId()) && launch == null && detached == null;
            String storedIdentity = launch != null && Objects.equals(identity, attribute(launch, "gen_ai.conversation.id")) && !Objects.equals(callId, identity) ? null : identity;
            rootIdentities.put(spanRef(root), new Identity(main ? primaryId : "agent:" + spanRef(root), storedIdentity));
        }
        record Bucket(String identity, List<Map<String, Object>> spans) {}
        LinkedHashMap<String, Bucket> grouped = new LinkedHashMap<>();
        grouped.put(primaryId, new Bucket(source.conversationId(), new ArrayList<>()));
        for (Map<String, Object> span : spans) {
            String raw = attribute(span, "gen_ai.conversation.id");
            Map<String, Object> root = roots.get(spanRef(span));
            Identity group = root == null ? null : rootIdentities.get(spanRef(root));
            if (group == null || ("chat".equals(text(span, "operationName")) && raw != null && !raw.equals(group.value()) && !raw.equals(root == null ? null : attribute(root, "gen_ai.conversation.id")))) {
                Entry entry = unique.get(spanRef(span));
                Detail origin = entry.detail();
                String identity = raw != null ? raw : origin == source ? source.conversationId() : null;
                group = new Identity(Objects.equals(identity, source.conversationId()) ? primaryId :
                    "trace:" + text(span, "traceId") + ":conversation:" + (identity == null ? origin.id() : identity), identity);
            }
            Identity selectedGroup = group;
            Bucket bucket = grouped.computeIfAbsent(selectedGroup.id(), ignored -> new Bucket(selectedGroup.value(), new ArrayList<>()));
            bucket.spans().add(span);
        }
        for (Map.Entry<String, Bucket> entry : new ArrayList<>(grouped.entrySet())) {
            if (!entry.getKey().startsWith("trace:") || entry.getValue().identity() == null) continue;
            List<Map.Entry<String, Bucket>> matches = grouped.entrySet().stream().filter(other -> other.getKey().startsWith("agent:") &&
                Objects.equals(other.getValue().identity(), entry.getValue().identity()) && other.getValue().spans().stream()
                    .anyMatch(span -> Objects.equals(text(span, "traceId"), text(entry.getValue().spans().get(0), "traceId")))).toList();
            if (matches.size() == 1) {
                matches.get(0).getValue().spans().addAll(entry.getValue().spans());
                grouped.remove(entry.getKey());
            }
        }
        return grouped.entrySet().stream().sorted(Comparator.<Map.Entry<String, Bucket>>comparingInt(entry -> entry.getKey().equals(primaryId) ? 0 : 1)
            .thenComparing(Map.Entry::getKey)).map(entry -> {
                String id = entry.getKey(); Bucket bucket = entry.getValue();
                List<Map<String, Object>> members = bucket.spans().stream().sorted(spanOrder()).toList();
                Set<Long> databaseIds = members.stream().map(span -> number(span.get("id"))).collect(Collectors.toSet());
                Detail origin = id.equals(primaryId) ? source : sources.stream().filter(detail -> Objects.equals(detail.conversationId(), bucket.identity())).findFirst()
                    .orElseGet(() -> Optional.ofNullable(unique.get(members.isEmpty() ? null : spanRef(members.get(0)))).map(Entry::detail).orElse(source));
                Map<String, Object> representative = members.stream().filter(span -> "invoke_agent".equals(text(span, "operationName"))).findFirst()
                    .orElseGet(() -> members.stream().filter(span -> "chat".equals(text(span, "operationName"))).findFirst().orElse(null));
                Map<String, Object> session = new LinkedHashMap<>(origin.session());
                session.put("conversationId", bucket.identity() == null ? origin.conversationId() : bucket.identity());
                if (representative != null && attribute(representative, "gen_ai.agent.name") != null)
                    session.put("agentName", attribute(representative, "gen_ai.agent.name"));
                Set<Long> signalIds = members.stream().map(span -> number(span.get("signalId"))).collect(Collectors.toSet());
                List<Map<String, Object>> messages = distinctById(sources.stream().flatMap(detail -> detail.messages().stream())
                    .filter(message -> databaseIds.contains(number(message.get("spanId")))).toList());
                List<Map<String, Object>> signals = distinctById(sources.stream().flatMap(detail -> detail.signals().stream())
                    .filter(signal -> signalIds.contains(number(signal.get("id")))).toList());
                return new Episode(id, bucket.identity(), new Detail(session, members, messages, signals));
            }).toList();
    }

    private LinkSelection linkedSelection(List<Episode> episodes) {
        Map<Map<String, Object>, Episode> launches = episodeLaunches(episodes);
        Set<String> included = new LinkedHashSet<>(); included.add(episodes.get(0).id());
        ArrayDeque<Episode> pending = new ArrayDeque<>(); pending.add(episodes.get(0));
        while (!pending.isEmpty()) {
            Episode episode = pending.removeFirst();
            for (Map<String, Object> span : episode.source().spans()) if ("execute_tool".equals(text(span, "operationName"))) {
                Episode child = launches.get(span);
                if (child != null && included.add(child.id())) pending.add(child);
            }
        }
        return new LinkSelection(included, launches);
    }

    private Map<Map<String, Object>, Episode> episodeLaunches(List<Episode> episodes) {
        List<Episode> candidates = episodes.stream().filter(episode -> episode.identity() != null && episode.source().spans().stream().anyMatch(span ->
            Objects.equals(attribute(span, "gen_ai.conversation.id"), episode.identity()) || Objects.equals(attribute(span, "copilot_chat.chat_session_id"), episode.identity()))).toList();
        record Edge(Map<String, Object> tool, Episode child) {}
        List<Edge> edges = new ArrayList<>();
        for (Episode episode : episodes) for (Map<String, Object> tool : episode.source().spans()) {
            if (!"execute_tool".equals(text(tool, "operationName"))) continue;
            String callId = attribute(tool, "gen_ai.tool.call.id");
            List<Episode> children = candidates.stream().filter(child -> Objects.equals(child.identity(), callId)).toList();
            long start = time(tool.get("startedAt"));
            Map<String, Object> previous = episode.source().spans().stream().filter(span -> "chat".equals(text(span, "operationName")) &&
                Objects.equals(text(span, "traceId"), text(tool, "traceId")) && time(span.get("startedAt")) <= start).max(spanOrder()).orElse(null);
            if (children.size() == 1 && previous != null && time(first(previous, "endedAt", "startedAt")) <= start) edges.add(new Edge(tool, children.get(0)));
        }
        return edges.stream().filter(edge -> edges.stream().filter(other -> other.child().id().equals(edge.child().id())).count() == 1)
            .collect(Collectors.toMap(Edge::tool, Edge::child, (a, b) -> a, LinkedHashMap::new));
    }

    private ModelResponse modelResponse(Detail source, Map<String, Object> span) {
        List<Map<String, Object>> messages = source.messages().stream().filter(message -> number(message.get("spanId")) == number(span.get("id")) &&
            "output".equals(text(message, "direction"))).sorted(Comparator.comparingLong(message -> number(message.get("sequenceNo")))).toList();
        List<JsonNode> roots = new ArrayList<>();
        for (Map<String, Object> message : messages) readJson(text(message, "content")).ifPresent(roots::add);
        if (messages.isEmpty()) {
            JsonNode attrs = attributes(span);
            if (attrs.has("gen_ai.output.messages")) roots.add(parseEmbedded(attrs.get("gen_ai.output.messages")));
        }
        Set<String> ids = new HashSet<>(), names = new HashSet<>();
        roots.forEach(root -> collectCalls(root, ids, names, 0));
        return new ModelResponse(!roots.isEmpty(), ids, names);
    }

    private void collectCalls(JsonNode node, Set<String> ids, Set<String> names, int depth) {
        if (node == null || depth > 30) return;
        if (node.isArray()) { node.forEach(child -> collectCalls(child, ids, names, depth + 1)); return; }
        if (!node.isObject()) return;
        String type = node.path("type").asText("");
        if (Set.of("tool_call_response", "function_call_output", "tool_result", "tool_response", "reasoning", "reasoning_text", "thinking").contains(type) ||
            "tool".equals(node.path("role").asText())) return;
        JsonNode function = node.path("function");
        boolean call = Set.of("tool_call", "function_call", "tool_use").contains(type) || function.path("name").isTextual();
        if (call) {
            for (String key : List.of("call_id", "callId", "tool_call_id", "toolCallId", "tool_use_id", "id"))
                if (node.path(key).isTextual() && !node.path(key).asText().isBlank()) { ids.add(node.path(key).asText()); break; }
            for (JsonNode candidate : List.of(function.path("name"), node.path("name"), node.path("tool_name"), node.path("toolName")))
                if (candidate.isTextual() && !candidate.asText().isBlank()) { names.add(candidate.asText()); break; }
            return;
        }
        for (String key : List.of("parts", "output", "content", "messages", "tool_calls")) if (node.has(key)) collectCalls(node.get(key), ids, names, depth + 1);
    }

    private String prompt(Detail own, Map<String, Object> root, int position) {
        if (root != null) {
            String emitted = attribute(root, "copilot_chat.user_request");
            if (emitted != null && !emitted.isBlank()) return emitted.trim();
            for (Map<String, Object> message : own.messages()) if (number(message.get("spanId")) == number(root.get("id")) &&
                "input".equals(text(message, "direction")) && "user".equals(text(message, "roleName"))) {
                String value = messageText(text(message, "content"));
                if (!value.isBlank() && !value.startsWith("<environment_info>") && !value.startsWith("<context>")) return value;
            }
        }
        return position == 0 ? "Treść promptu nie została wyemitowana." : "Treść kolejnego promptu nie została wyemitowana.";
    }

    private String assistantAnswer(Detail own, List<Map<String, Object>> roots) {
        List<Map<String, Object>> candidates = new ArrayList<>();
        if (!roots.isEmpty()) {
            long latest = number(roots.get(roots.size() - 1).get("id"));
            candidates.addAll(own.messages().stream().filter(message -> number(message.get("spanId")) == latest).toList());
            long first = number(roots.get(0).get("id"));
            candidates.addAll(own.messages().stream().filter(message -> number(message.get("spanId")) == first).toList());
        }
        candidates.addAll(own.messages());
        return candidates.stream().filter(message -> "output".equals(text(message, "direction")) && "assistant".equals(text(message, "roleName")))
            .findFirst().map(message -> messageText(text(message, "content"))).orElse("Odpowiedź nie została wyemitowana.");
    }

    private List<String> toolDefinitionNames(Detail own) {
        Set<String> names = new LinkedHashSet<>();
        for (Map<String, Object> message : own.messages()) if ("definition".equals(text(message, "direction"))) {
            readJson(text(message, "content")).map(node -> node.path("name")).filter(JsonNode::isTextual).map(JsonNode::asText)
                .filter(value -> !value.isBlank()).ifPresent(names::add);
        }
        return names.stream().sorted().toList();
    }

    private String messageText(String content) {
        Optional<JsonNode> parsed = readJson(content);
        if (parsed.isEmpty()) return content;
        JsonNode node = parsed.get();
        if (node.path("parts").isArray()) {
            List<String> parts = new ArrayList<>();
            for (JsonNode part : node.path("parts")) {
                JsonNode value = part.has("content") ? part.get("content") : part.get("text");
                if (value != null && value.isTextual() && !value.asText().isBlank()) parts.add(value.asText());
            }
            return String.join("\n", parts);
        }
        return node.path("content").isTextual() ? node.path("content").asText() : content;
    }

    private List<Map<String, Object>> withDepth(List<Map<String, Object>> spans) {
        Map<String, Map<String, Object>> byId = spans.stream().collect(Collectors.toMap(span -> text(span, "spanId"), Function.identity(), (a, b) -> a));
        return spans.stream().map(span -> {
            int depth = 0; Map<String, Object> parent = byId.get(text(span, "parentSpanId")); Set<Long> visited = new HashSet<>();
            while (parent != null && depth < 8 && visited.add(number(parent.get("id")))) {
                depth++; parent = byId.get(text(parent, "parentSpanId"));
            }
            Map<String, Object> copy = new LinkedHashMap<>(span); copy.put("depth", depth); return copy;
        }).toList();
    }

    private JsonNode attributes(Map<String, Object> span) {
        return readJson(text(span, "attributesJson")).orElseGet(mapper::createObjectNode);
    }

    private String attribute(Map<String, Object> span, String key) {
        JsonNode value = attributes(span).get(key);
        if (value == null || value.isNull()) return null;
        String text = value.isTextual() ? value.asText() : value.toString();
        return text.isBlank() ? null : text;
    }

    private Optional<JsonNode> readJson(String value) {
        if (value == null || value.isBlank()) return Optional.empty();
        try { return Optional.of(mapper.readTree(value)); }
        catch (Exception ignored) { return Optional.empty(); }
    }

    private JsonNode parseEmbedded(JsonNode value) {
        if (!value.isTextual()) return value;
        return readJson(value.asText()).orElse(value);
    }

    private Comparator<Map<String, Object>> spanOrder() {
        return Comparator.comparingLong((Map<String, Object> span) -> time(span.get("startedAt")))
            .thenComparingLong(span -> number(span.get("id")));
    }

    private List<Map<String, Object>> between(List<Map<String, Object>> spans, long from, long to) {
        return spans.stream().filter(span -> time(span.get("startedAt")) >= from && time(span.get("startedAt")) < to).toList();
    }

    private String spanRef(Map<String, Object> span) { return text(span, "traceId") + "/" + text(span, "spanId"); }
    private boolean isContextCompaction(String name) { return "summarizeconversationhistory-full".equals(lower(name)); }
    private boolean isAuxiliaryAgent(String name) { return name != null && AUXILIARY_AGENTS.contains(lower(name)); }
    private boolean isAuxiliary(Detail detail) { return detail.conversationId().startsWith("trace:") || detail.conversationId().startsWith("call_") || isAuxiliaryAgent(detail.agentName()); }
    private String auxiliaryTitle(String name) { return AUXILIARY_TITLES.getOrDefault(lower(name), name == null ? "Sesja agenta" : name); }
    private String lower(String value) { return value == null ? "" : value.toLowerCase(Locale.ROOT); }
    private String text(Map<?, ?> source, String key) { Object value = source.get(key); return value == null ? "" : String.valueOf(value); }
    private long number(Object value) { return value instanceof Number number ? number.longValue() : value == null || String.valueOf(value).isBlank() ? 0 : Long.parseLong(String.valueOf(value)); }
    private Object first(Map<String, Object> source, String... keys) { for (String key : keys) if (source.get(key) != null) return source.get(key); return null; }
    private String firstNonNull(String... values) { for (String value : values) if (value != null) return value; return null; }
    private void putIfNotNull(Map<String, Object> target, String key, Object value) { if (value != null) target.put(key, value); }
    private long time(Object value) {
        if (value == null) return 0;
        if (value instanceof Timestamp timestamp) return timestamp.getTime();
        if (value instanceof java.util.Date date) return date.getTime();
        try { return Instant.parse(String.valueOf(value)).toEpochMilli(); }
        catch (Exception ignored) {
            try { return OffsetDateTime.parse(String.valueOf(value)).toInstant().toEpochMilli(); }
            catch (Exception ignoredAgain) { return 0; }
        }
    }
    private long maxSignalId(List<Detail> details) { return details.stream().flatMap(detail -> detail.spans().stream()).mapToLong(span -> number(span.get("signalId"))).max().orElse(0); }
    private <T> List<T> concat(List<T> first, List<T> second) { List<T> result = new ArrayList<>(first); result.addAll(second); return result; }
    private List<Map<String, Object>> distinctById(Collection<Map<String, Object>> rows) {
        LinkedHashMap<Long, Map<String, Object>> result = new LinkedHashMap<>(); rows.forEach(row -> result.putIfAbsent(number(row.get("id")), row)); return List.copyOf(result.values());
    }

    private record Detail(Map<String, Object> session, List<Map<String, Object>> spans,
                          List<Map<String, Object>> messages, List<Map<String, Object>> signals) {
        long id() { return ((Number) session.get("id")).longValue(); }
        String conversationId() { return String.valueOf(session.get("conversationId")); }
        String agentName() { return session.get("agentName") == null ? null : String.valueOf(session.get("agentName")); }
        Map<String, Object> json() {
            Map<String, Object> result = new LinkedHashMap<>(); result.put("session", session); result.put("spans", spans); result.put("messages", messages); result.put("signals", signals); return result;
        }
        Map<String, Object> evidenceJson() {
            List<Map<String, Object>> compactSignals = signals.stream().map(signal -> {
                Map<String, Object> compact = new LinkedHashMap<>(signal);
                compact.remove("rawJson");
                return compact;
            }).toList();
            Map<String, Object> result = new LinkedHashMap<>(); result.put("session", session); result.put("spans", spans);
            result.put("messages", messages); result.put("signals", compactSignals); return result;
        }
    }
    private record Prepared(Detail primary, List<Map<String, Object>> auxiliary) {}
    private record Episode(String id, String identity, Detail source) {}
    private record LinkSelection(Set<String> included, Map<Map<String, Object>, Episode> launches) {}
    private record ModelResponse(boolean observed, Set<String> ids, Set<String> names) {}
    private record CacheKey(long sessionId, long cutoffSignalId, String version) {}
}
