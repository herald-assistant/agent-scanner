package dev.agentscanner.analysis;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SessionAnalysisQueryServiceTest {
    private final SessionReconstructionService reconstruction = mock(SessionReconstructionService.class);
    private final SessionAnalysisQueryService service = new SessionAnalysisQueryService(reconstruction, new ObjectMapper());

    @Test
    void everyQueryUsesTheCutoffFrozenWhenTheScopeWasCreated() {
        Map<String, Object> material = material();
        when(reconstruction.reconstruct(7)).thenReturn(Optional.of(material));
        when(reconstruction.reconstructAt(7, 19)).thenReturn(Optional.of(material));

        var scope = service.createScope(7);
        var overview = service.overview(scope);

        assertEquals(19L, scope.cutoffSignalId());
        assertEquals(19L, overview.get("cutoffSignalId"));
        verify(reconstruction).reconstructAt(7, 19);
    }

    @Test
    void bootstrapCoversTheWholeSessionWithoutAFocusContract() {
        Map<String, Object> material = material();
        when(reconstruction.reconstructAt(7, 19)).thenReturn(Optional.of(material));
        var scope = new SessionAnalysisQueryService.Scope(7, 19, SessionReconstructionService.EPISODE_VERSION,
                SessionAnalysisQueryService.REDACTION_CONTRACT, "local-user");

        Map<String, Object> bootstrap = service.bootstrap(scope);

        assertEquals(SessionAnalysisQueryService.BOOTSTRAP_CONTRACT, bootstrap.get("contract"));
        assertFalse(bootstrap.containsKey("focus"));
        assertFalse(bootstrap.containsKey("focusDigest"));
        assertTrue(bootstrap.containsKey("interactions"));
        assertTrue(bootstrap.containsKey("navigation"));
    }

    private Map<String, Object> material() {
        return Map.of(
                "cutoffSignalId", 19L,
                "reconstructionVersion", SessionReconstructionService.EPISODE_VERSION,
                "detail", Map.of("session", Map.of("id", 7L, "contentCaptured", true),
                        "spans", List.of(), "messages", List.of(), "signals", List.of()),
                "relatedDetails", List.of(),
                "view", Map.of("interactions", List.of(), "costGroups", List.of(), "modelTurns", List.of())
        );
    }
}
