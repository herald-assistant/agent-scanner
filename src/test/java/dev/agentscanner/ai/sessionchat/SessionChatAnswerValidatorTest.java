package dev.agentscanner.ai.sessionchat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SessionChatAnswerValidatorTest {
    private final SessionChatAnswerValidator validator = new SessionChatAnswerValidator(new ObjectMapper());

    @Test
    void acceptsOnlyEvidencePreviouslyExposedByScanner() {
        String json = """
            {"contract":"session-analysis-answer","status":"ANSWER","answerMarkdown":"W rundzie wykonano odczyt.",
             "evidence":[{"ref":"trace/span","label":"Runda M1"}],"hypotheses":[],"limitations":[],
             "suggestedFollowUps":["Czy sprawdzić wcześniejszy prompt?"]}
            """;

        var answer = validator.validate(json, Set.of("trace/span"));
        assertEquals(SessionChat.AnswerStatus.ANSWER, answer.status());
        assertEquals("trace/span", answer.evidence().get(0).ref());
    }

    @Test
    void rejectsInventedEvidenceAndUnknownFields() {
        String invented = """
            {"contract":"session-analysis-answer","status":"ANSWER","answerMarkdown":"Teza",
             "evidence":[{"ref":"other/span","label":"Nieznany"}],"hypotheses":[],"limitations":[],"suggestedFollowUps":[]}
            """;
        assertThrows(IllegalStateException.class, () -> validator.validate(invented, Set.of("trace/span")));

        String unknown = """
            {"contract":"session-analysis-answer","status":"INSUFFICIENT_EVIDENCE","answerMarkdown":"Brak danych",
             "evidence":[],"hypotheses":[],"limitations":["Brak treści"],"suggestedFollowUps":[],"extra":true}
            """;
        assertThrows(IllegalStateException.class, () -> validator.validate(unknown, Set.of()));
    }

    @Test
    void keepsTheAnswerAndDropsOnlySemanticShortcutsThatAreNotEvidenceRefs() {
        String json = """
            {"contract":"session-analysis-answer","status":"ANSWER","answerMarkdown":"Podsumowanie sesji.",
             "evidence":[
               {"ref":"I1","label":"Interakcja"},
               {"ref":"trace/span","label":"Runda M1"},
               {"ref":"session-overview","label":"Podsumowanie"}
             ],"hypotheses":[],"limitations":[],"suggestedFollowUps":[]}
            """;

        var answer = validator.validate(json, Set.of("trace/span"));

        assertEquals(1, answer.evidence().size());
        assertEquals("trace/span", answer.evidence().get(0).ref());
    }
}
