package dev.agentscanner.standardization;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

import static dev.agentscanner.standardization.Standardization.*;

@Component
public final class StandardizationValidator {
    private final ObjectMapper mapper;
    public StandardizationValidator(ObjectMapper mapper) {
        this.mapper = mapper.copy().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
                DeserializationFeature.FAIL_ON_TRAILING_TOKENS, DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
                .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    }

    public Result validate(String raw, Preview preview) {
        if (raw == null || raw.length() > 2_000_000) throw invalid();
        JsonNode root;
        try { root = mapper.readTree(raw); }
        catch (Exception failure) { throw invalid(); }
        if (root == null || !root.isObject() || root.size() != 2
                || !ANSWER_VERSION.equals(root.path("contract").asText())
                || !root.path("assessments").isArray()
                || root.path("assessments").size() > preview.packet().targets().size() + 20) throw invalid();
        var targets = preview.packet().targets().stream().collect(Collectors.toMap(Target::id, Function.identity()));
        var rules = preview.packet().rules().stream().collect(Collectors.toMap(Rule::id, Function.identity()));
        var files = preview.packet().files().stream().collect(Collectors.toMap(FileEvidence::id, Function.identity()));
        Map<String, Assessment> accepted = new LinkedHashMap<>();
        Set<String> encountered = new HashSet<>();
        int rejected = 0;
        for (JsonNode node : root.path("assessments")) {
            String id = node.path("assessmentId").asText("");
            if (!encountered.add(id)) {
                if (accepted.remove(id) != null) rejected++;
                rejected++;
                continue;
            }
            try {
                Assessment value = mapper.treeToValue(node, Assessment.class);
                Target target = targets.get(value.assessmentId());
                if (target == null || !valid(value, target, rules.get(target.ruleId()), files)) {
                    rejected++;
                    continue;
                }
                accepted.put(id, sanitized(value));
            } catch (Exception failure) { rejected++; }
        }
        if (accepted.isEmpty()) throw invalid();
        List<String> missing = preview.packet().targets().stream().map(Target::id).filter(id -> !accepted.containsKey(id)).toList();
        return new Result(ANSWER_VERSION, preview.id(), preview.hash(), preview.packet().model(), Instant.now().toString(),
                List.copyOf(accepted.values()), missing, rejected);
    }

    private boolean valid(Assessment value, Target target, Rule rule, Map<String, FileEvidence> files) {
        if (value.verdict() == null || !text(value.rationale(), 2000) || value.recommendation() == null
                || value.recommendation().length() > 2000 || value.evidence() == null || value.evidence().size() > 6
                || value.limitations() == null || value.limitations().size() > 6
                || value.limitations().stream().anyMatch(item -> !text(item, 500))
                || value.sourceIds() == null || value.sourceIds().isEmpty()
                || value.sourceIds().size() > rule.sourceIds().size()
                || !new HashSet<>(rule.sourceIds()).containsAll(value.sourceIds())
                || new HashSet<>(value.sourceIds()).size() != value.sourceIds().size()) return false;
        if (value.verdict() == Verdict.CONCERN && value.recommendation().isBlank()) return false;
        if (rule.basis().startsWith("AS-W") && value.verdict() == Verdict.NOT_APPLICABLE) return false;
        if (value.verdict() == Verdict.INSUFFICIENT_EVIDENCE && value.limitations().isEmpty()) return false;
        if ((value.verdict() == Verdict.SUPPORTED || value.verdict() == Verdict.CONCERN)
                && value.evidence().stream().noneMatch(item -> item != null && target.fileId().equals(item.fileId()))) return false;
        for (Evidence evidence : value.evidence()) {
            if (evidence == null || evidence.kind() == null || evidence.quote() == null) return false;
            FileEvidence file = files.get(evidence.fileId());
            if (file == null || evidence.startLine() < 1 || evidence.endLine() < evidence.startLine()
                    || evidence.endLine() > file.lines()) return false;
            if (evidence.kind() == EvidenceKind.ABSENCE) {
                if (evidence.startLine() != 1 || evidence.endLine() != file.lines() || !evidence.quote().isEmpty()) return false;
            } else {
                String[] lines = file.content().split("\n", -1);
                String segment = String.join("\n", Arrays.copyOfRange(lines, evidence.startLine() - 1, evidence.endLine()));
                if (!text(evidence.quote(), 1000) || !segment.contains(evidence.quote())) return false;
            }
        }
        return true;
    }

    private Assessment sanitized(Assessment value) {
        return new Assessment(value.assessmentId(), value.verdict(), StandardizationText.redact(value.rationale()),
                List.copyOf(value.evidence()), List.copyOf(value.sourceIds()),
                value.limitations().stream().map(StandardizationText::redact).toList(),
                StandardizationText.redact(value.recommendation()));
    }
    private boolean text(String value, int length) { return value != null && !value.isBlank() && value.length() <= length; }
    private IllegalStateException invalid() {
        return new IllegalStateException("Model nie zwrócił poprawnych ocen z dowodami. Wynik lokalny pozostaje dostępny. Przygotuj nowy podgląd, aby ponowić analizę.");
    }
}
