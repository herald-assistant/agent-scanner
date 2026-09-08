package dev.agentscanner.ai.discussion;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RoundDiscussionAnswerValidatorTest {
    private final RoundDiscussionAnswerValidator validator = new RoundDiscussionAnswerValidator(new ObjectMapper());

    @Test
    void acceptsEvidenceBackedExplanationAndGeneralGuidance() {
        String json = """
                {"status":"ANSWER","blocks":[
                  {"kind":"EXPLANATION","text":"W drugiej rundzie odebrano wynik.","boundaryIds":["b2"],"roundRefs":["t/s2"]},
                  {"kind":"GENERAL_GUIDANCE","text":"Warto porównać wariant kontrolny.","boundaryIds":[],"roundRefs":[]}
                ],"questionsToUser":[],"limitations":[]}
                """;

        RoundDiscussion.Answer answer = validator.validate(json, snapshot());

        assertThat(answer.status()).isEqualTo(RoundDiscussion.AnswerStatus.ANSWER);
        assertThat(answer.blocks()).hasSize(2);
    }

    @Test
    void rejectsAnExplanationWithoutAValidEvidenceReference() {
        String json = """
                {"status":"ANSWER","blocks":[
                  {"kind":"EXPLANATION","text":"Na pewno tak było.","boundaryIds":[],"roundRefs":[]}
                ],"questionsToUser":[],"limitations":[]}
                """;

        assertThatThrownBy(() -> validator.validate(json, snapshot()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("kontraktu rozmowy");
    }

    private RoundDiscussion.EvidenceSnapshot snapshot() {
        return new RoundDiscussion.EvidenceSnapshot(
                RoundDiscussion.EVIDENCE_VERSION, "2026-09-08T10:00:00Z", "a".repeat(64),
                new RoundDiscussion.Selection(1, "root", "Główny agent", "t", "t/s1", "t/s2",
                        List.of("t/s1", "t/s2"), "Zbadaj przebieg"),
                List.of(),
                List.of(new RoundDiscussion.Boundary("b2", "t/s2", "MODEL_RESPONSE", null,
                        new ObjectMapper().createObjectNode(), List.of())),
                RoundDiscussion.REDACTION_VERSION, "UNVERIFIED");
    }
}
