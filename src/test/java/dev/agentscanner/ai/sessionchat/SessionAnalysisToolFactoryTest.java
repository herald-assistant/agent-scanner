package dev.agentscanner.ai.sessionchat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.copilot.rpc.ToolInvocation;
import dev.agentscanner.analysis.SessionAnalysisQueryService;
import dev.agentscanner.store.ScannerStore;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.concurrent.CompletionException;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SessionAnalysisToolFactoryTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final SessionAnalysisQueryService queries = mock(SessionAnalysisQueryService.class);
    private final ScannerStore store = mock(ScannerStore.class);
    private final SessionAnalysisQueryService.Scope scope = new SessionAnalysisQueryService.Scope(
            7, 19, "copilot-episode-v1", "guidance-redaction", "local-user");

    @Test
    void rejectsAnInvocationWhoseRuntimeNameIsOutsideTheAllowlist() {
        var factory = new SessionAnalysisToolFactory(queries, store, mapper);
        var tool = factory.create(scope, "chat", "turn").get(0);
        var invocation = new ToolInvocation().setToolName("terminal").setToolCallId("call")
                .setArguments(mapper.createObjectNode());

        assertThrows(CompletionException.class, () -> tool.handler().invoke(invocation).join());
        verify(store, never()).startSessionChatToolCall(anyString(), anyString(), anyString(), anyString(),
                org.mockito.ArgumentMatchers.anyInt(), anyString(), anyString(), anyString(), any());
    }

    @Test
    void replacesAnOversizedResultWithABoundedManifest() {
        when(queries.overview(scope)).thenReturn(Map.of("payload", "x".repeat(120_000)));
        when(queries.hash(any())).thenReturn("hash");
        var factory = new SessionAnalysisToolFactory(queries, store, mapper);
        var tool = factory.create(scope, "chat", "turn").get(0);
        var invocation = new ToolInvocation().setToolName(tool.name()).setToolCallId("call")
                .setArguments(mapper.createObjectNode());

        Object result = tool.handler().invoke(invocation).join();

        assertTrue(String.valueOf(result).contains("scanner-tool-result-limit"));
        assertTrue(String.valueOf(result).length() < 2_000);
        verify(store).completeSessionChatToolCall(anyString(), anyString(), anyString(),
                org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.eq(true), any());
    }
}
