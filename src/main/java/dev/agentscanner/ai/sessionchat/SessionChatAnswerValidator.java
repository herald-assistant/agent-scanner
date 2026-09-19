package dev.agentscanner.ai.sessionchat;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Component
final class SessionChatAnswerValidator {
    private static final int MAX_ANSWER_CHARACTERS = 24_000;
    private final ObjectMapper mapper;

    SessionChatAnswerValidator(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    SessionChat.Answer validate(String text, Set<String> allowedEvidence) {
        if (text == null || text.isBlank() || text.length() > MAX_ANSWER_CHARACTERS) invalid();
        SessionChat.Answer answer;
        try {
            answer = mapper.readerFor(SessionChat.Answer.class)
                .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                .readValue(text);
        } catch (IOException failure) {
            throw new IllegalStateException("Model nie zwrócił poprawnego kontraktu rozmowy.");
        }
        if (answer == null || !"session-analysis-answer".equals(answer.contract()) || answer.status() == null
            || !validText(answer.answerMarkdown(), 16_000) || answer.evidence() == null
            || !validTextList(answer.hypotheses(), 8, 1_000) || !validTextList(answer.limitations(), 8, 1_000)
            || !validTextList(answer.suggestedFollowUps(), 6, 500) || answer.evidence().size() > 32) invalid();
        Set<String> unique = new HashSet<>();
        List<SessionChat.Evidence> verifiedEvidence = new ArrayList<>();
        for (SessionChat.Evidence evidence : answer.evidence()) {
            if (evidence == null || !validText(evidence.ref(), 512) || !validText(evidence.label(), 240)
                || !unique.add(evidence.ref())) invalid();
            // A model can return a useful answer and still add a semantic shortcut such as
            // "I1" or "session-overview" beside exact Scanner references. Never expose such
            // a shortcut as evidence, but do not discard the verified answer and its valid refs.
            if (allowedEvidence.contains(evidence.ref())) verifiedEvidence.add(evidence);
        }
        if (answer.status() == SessionChat.AnswerStatus.ANSWER && verifiedEvidence.isEmpty() && answer.hypotheses().isEmpty()) invalid();
        return new SessionChat.Answer(answer.contract(), answer.status(), answer.answerMarkdown(),
            List.copyOf(verifiedEvidence), answer.hypotheses(), answer.limitations(), answer.suggestedFollowUps());
    }

    private boolean validTextList(List<String> values, int maxItems, int maxLength) {
        if (values == null || values.size() > maxItems) return false;
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
