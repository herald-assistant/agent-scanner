package dev.agentscanner.analysis;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Public read-only API used by both the UI and external Scanner analysis clients. */
@RestController
@RequestMapping("/api/sessions/{sessionId}/analysis-data")
public final class SessionAnalysisController {
    private final SessionAnalysisQueryService queries;

    SessionAnalysisController(SessionAnalysisQueryService queries) {
        this.queries = queries;
    }

    @GetMapping("/overview")
    public Map<String, Object> overview(@org.springframework.web.bind.annotation.PathVariable long sessionId) {
        return queries.overview(queries.createScope(sessionId));
    }

    @GetMapping("/configuration")
    public Map<String, Object> configuration(@org.springframework.web.bind.annotation.PathVariable long sessionId) {
        return queries.configuration(queries.createScope(sessionId));
    }

    @GetMapping("/interactions")
    public Map<String, Object> interactions(@org.springframework.web.bind.annotation.PathVariable long sessionId,
                                            @RequestParam(defaultValue = "0") int cursor,
                                            @RequestParam(defaultValue = "25") int limit) {
        return queries.listInteractions(queries.createScope(sessionId), cursor, limit);
    }

    @GetMapping("/rounds")
    public Map<String, Object> rounds(@org.springframework.web.bind.annotation.PathVariable long sessionId,
                                     @RequestParam(required = false) String interactionRef,
                                     @RequestParam(required = false) String actorRef,
                                     @RequestParam(required = false) List<String> roundRefs,
                                     @RequestParam(defaultValue = "0") int cursor,
                                     @RequestParam(defaultValue = "25") int limit) {
        return queries.listRounds(queries.createScope(sessionId), interactionRef, actorRef, roundRefs, cursor, limit);
    }

    @GetMapping("/round-evidence")
    public Map<String, Object> roundEvidence(@org.springframework.web.bind.annotation.PathVariable long sessionId,
                                             @RequestParam String roundRef,
                                             @RequestParam(required = false) List<String> sections) {
        return queries.roundEvidence(queries.createScope(sessionId), roundRef, sections);
    }

    @GetMapping("/subagents")
    public Map<String, Object> subagents(@org.springframework.web.bind.annotation.PathVariable long sessionId) {
        return queries.subagentTree(queries.createScope(sessionId));
    }

    @GetMapping("/cost")
    public Map<String, Object> cost(@org.springframework.web.bind.annotation.PathVariable long sessionId,
                                   @RequestParam(required = false) List<String> roundRefs) {
        return queries.costSummary(queries.createScope(sessionId), roundRefs);
    }

    @GetMapping("/search")
    public Map<String, Object> search(@org.springframework.web.bind.annotation.PathVariable long sessionId,
                                     @RequestParam String query,
                                     @RequestParam(defaultValue = "0") int cursor,
                                     @RequestParam(defaultValue = "20") int limit) {
        return queries.search(queries.createScope(sessionId), query, cursor, limit);
    }
}
