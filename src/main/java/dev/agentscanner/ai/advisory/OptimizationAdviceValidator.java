package dev.agentscanner.ai.advisory;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Component
final class OptimizationAdviceValidator {
    private static final int MAX_ANSWER_CHARACTERS = 12_000;
    private final ObjectMapper mapper;

    OptimizationAdviceValidator(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    OptimizationAdvice.Answer validate(String text, OptimizationAdvice.Request request) {
        if (text == null || text.isBlank() || text.length() > MAX_ANSWER_CHARACTERS) invalid();
        OptimizationAdvice.Answer answer;
        try {
            answer = mapper.readerFor(OptimizationAdvice.Answer.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .readValue(text);
        } catch (IOException failure) {
            throw new IllegalStateException("Model nie zwrócił poprawnego kontraktu rekomendacji.");
        }
        if (answer == null || answer.status() == null || answer.proposals() == null
                || answer.missingInformation() == null || !validTextList(answer.missingInformation(), 8, 500, true)) invalid();
        if (answer.status() == OptimizationAdvice.AdviceStatus.SUGGESTIONS) {
            if (answer.proposals().isEmpty() || answer.proposals().size() > 3) invalid();
        } else if (!answer.proposals().isEmpty()) invalid();

        Set<String> techniqueIds = Set.copyOf(request.candidateTechniqueIds());
        Set<String> observationIds = request.observations().stream().map(OptimizationAdvice.Observation::id)
                .collect(java.util.stream.Collectors.toSet());
        Set<String> usedTechniques = new HashSet<>();
        for (OptimizationAdvice.Proposal proposal : answer.proposals()) {
            if (proposal == null || !techniqueIds.contains(proposal.techniqueId())
                    || !usedTechniques.add(proposal.techniqueId()) || !validText(proposal.rationale(), 1_000)
                    || !validTextList(proposal.observationIds(), 32, 240, false)
                    || !observationIds.containsAll(proposal.observationIds())
                    || !validTextList(proposal.conditionsToCheck(), 8, 500, false)
                    || !validTextList(proposal.experimentSteps(), 8, 500, false)
                    || !validTextList(proposal.setupWork(), 8, 500, false)
                    || !validTextList(proposal.maintenanceWork(), 8, 500, false)
                    || !validTextList(proposal.qualityChecks(), 8, 500, false)
                    || !validTextList(proposal.comparisonPlan(), 8, 500, false)
                    || !validTextList(proposal.limitations(), 8, 500, false)
                    || proposal.alternativeTechniqueId() != null
                    && (!techniqueIds.contains(proposal.alternativeTechniqueId())
                    || proposal.techniqueId().equals(proposal.alternativeTechniqueId()))) invalid();
        }
        return answer;
    }

    private boolean validTextList(List<String> values, int maxItems, int maxLength, boolean allowEmpty) {
        if (values == null || values.size() > maxItems || !allowEmpty && values.isEmpty()) return false;
        Set<String> unique = new HashSet<>();
        return values.stream().allMatch(value -> validText(value, maxLength) && unique.add(value));
    }

    private boolean validText(String value, int maxLength) {
        return value != null && !value.isBlank() && value.length() <= maxLength;
    }

    private void invalid() {
        throw new IllegalStateException("Model nie zwrócił poprawnego kontraktu rekomendacji.");
    }
}
