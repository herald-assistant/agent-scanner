package dev.agentscanner.ai.discussion;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Component
final class RoundDiscussionAnswerValidator {
    private static final int MAX_ANSWER_CHARACTERS = 16_000;
    private final ObjectMapper mapper;

    RoundDiscussionAnswerValidator(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    RoundDiscussion.Answer validate(String text, RoundDiscussion.EvidenceSnapshot snapshot) {
        if (text == null || text.isBlank() || text.length() > MAX_ANSWER_CHARACTERS) invalid();
        RoundDiscussion.Answer answer;
        try {
            answer = mapper.readerFor(RoundDiscussion.Answer.class)
                    .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .readValue(text);
        } catch (IOException failure) {
            throw new IllegalStateException("Model nie zwrócił poprawnego kontraktu rozmowy.");
        }
        if (answer == null || answer.status() == null || answer.blocks() == null
                || answer.questionsToUser() == null || answer.limitations() == null
                || answer.blocks().size() > 8
                || !validTextList(answer.questionsToUser(), 6, 500, true)
                || !validTextList(answer.limitations(), 8, 500, true)) invalid();
        if (answer.status() == RoundDiscussion.AnswerStatus.ANSWER && answer.blocks().isEmpty()) invalid();

        Set<String> roundRefs = Set.copyOf(snapshot.selection().roundRefs());
        Set<String> boundaryIds = snapshot.boundaries().stream().map(RoundDiscussion.Boundary::id)
                .collect(java.util.stream.Collectors.toSet());
        for (RoundDiscussion.AnswerBlock block : answer.blocks()) {
            if (block == null || block.kind() == null || !validText(block.text(), 4_000)
                    || !validTextList(block.roundRefs(), 32, 160, true)
                    || !validTextList(block.boundaryIds(), 64, 240, true)
                    || !roundRefs.containsAll(block.roundRefs()) || !boundaryIds.containsAll(block.boundaryIds())) invalid();
            if (block.kind() != RoundDiscussion.BlockKind.GENERAL_GUIDANCE
                    && block.roundRefs().isEmpty() && block.boundaryIds().isEmpty()) invalid();
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
        throw new IllegalStateException("Model nie zwrócił poprawnego kontraktu rozmowy.");
    }
}
