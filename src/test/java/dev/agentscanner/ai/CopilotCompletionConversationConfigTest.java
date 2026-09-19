package dev.agentscanner.ai;

import com.github.copilot.SystemMessageMode;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class CopilotCompletionConversationConfigTest {
    @Test
    void createsPersistentTextOnlyConversationWithoutDiscovery() {
        var config = CopilotCompletion.conversationSessionConfig("test-model", Path.of("."), "rules");

        assertEquals("test-model", config.getModel());
        assertEquals(SystemMessageMode.REPLACE, config.getSystemMessage().getMode());
        assertEquals("rules", config.getSystemMessage().getContent());
        assertTrue(config.getEnableSessionStore().orElse(false));
        assertFalse(config.getEnableSkills().orElse(true));
        assertFalse(config.getEnableConfigDiscovery().orElse(true));
        assertFalse(config.getMemory().getEnabled());
        assertTrue(config.getTools().isEmpty());
        assertTrue(config.getAvailableTools().isEmpty());
        assertTrue(config.getMcpServers().isEmpty());
    }

    @Test
    void resumesWithTheSameTextOnlyRestrictionsAndSystemRules() {
        var config = CopilotCompletion.conversationResumeConfig("test-model", Path.of("."), "rules");

        assertEquals("test-model", config.getModel());
        assertEquals(SystemMessageMode.REPLACE, config.getSystemMessage().getMode());
        assertEquals("rules", config.getSystemMessage().getContent());
        assertTrue(config.getEnableSessionStore().orElse(false));
        assertFalse(config.getEnableSkills().orElse(true));
        assertFalse(config.getEnableConfigDiscovery().orElse(true));
        assertFalse(config.getMemory().getEnabled());
        assertTrue(config.getTools().isEmpty());
        assertTrue(config.getAvailableTools().isEmpty());
        assertTrue(config.getMcpServers().isEmpty());
    }

    @Test
    void exposesOnlyExplicitScannerToolsInPersistedChat() {
        var tool = com.github.copilot.rpc.ToolDefinition.createSkipPermission("scanner_get_session_overview",
                "overview", Map.of("type", "object"), invocation -> CompletableFuture.completedFuture("{}"));
        var config = CopilotCompletion.toolSessionConfig("scanner-chat-1", "test-model", Path.of("."),
                "rules", List.of(tool));

        assertEquals("scanner-chat-1", config.getSessionId());
        assertEquals(List.of(tool), config.getTools());
        assertEquals(List.of("scanner_get_session_overview"), config.getAvailableTools());
        assertTrue(config.getMcpServers().isEmpty());
        assertTrue(config.getCustomAgents().isEmpty());
        assertTrue(config.getSkillDirectories().isEmpty());
        assertFalse(config.getEnableSkills().orElse(true));
        assertFalse(config.getEnableConfigDiscovery().orElse(true));
        assertFalse(config.getEnableHostGitOperations().orElse(true));
    }
}
