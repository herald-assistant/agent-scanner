package dev.agentscanner.analysis;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.store.ScannerStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SessionReconstructionServiceTest {
    @Mock ScannerStore store;

    @Test
    void checksTheCheapCutoffBeforeLoadingSessionEvidenceFromCache() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("ID", 7L);
        row.put("CONVERSATION_ID", "conversation-7");
        row.put("LAST_SEEN_AT", "2026-09-19T12:00:00Z");
        when(store.session(7)).thenReturn(Optional.of(row));
        when(store.maxSignalId()).thenReturn(19L);
        when(store.sessionResourceAttributesUpTo(19L)).thenReturn(Map.of());
        when(store.sessions()).thenReturn(List.of(row));
        when(store.spans(7)).thenReturn(List.of());
        when(store.messages(7)).thenReturn(List.of());
        when(store.signals(7)).thenReturn(List.of());
        SessionReconstructionService service = new SessionReconstructionService(store, new ObjectMapper());

        Map<String, Object> first = service.reconstruct(7).orElseThrow();
        Map<String, Object> second = service.reconstruct(7).orElseThrow();

        assertTrue(first == second);
        assertFalse(first.containsKey("workflowSources"));
        @SuppressWarnings("unchecked") Map<String, Object> view = (Map<String, Object>) first.get("view");
        assertFalse(view.containsKey("source"));
        verify(store, times(2)).maxSignalId();
        verify(store, times(1)).sessionResourceAttributesUpTo(19L);
        verify(store, times(1)).spans(7);
        verify(store, times(1)).messages(7);
        verify(store, times(1)).signals(7);
    }
}
