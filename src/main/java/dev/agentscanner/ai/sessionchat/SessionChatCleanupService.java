package dev.agentscanner.ai.sessionchat;

import dev.agentscanner.ai.CopilotCompletion;
import dev.agentscanner.store.ScannerStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;

/** Best-effort cleanup of Copilot SDK session-store entries before local cascade deletion. */
@Service
public final class SessionChatCleanupService {
    private static final Logger LOG = LoggerFactory.getLogger(SessionChatCleanupService.class);
    private final ScannerStore store;
    private final CopilotCompletion completion;

    public SessionChatCleanupService(ScannerStore store, CopilotCompletion completion) {
        this.store = store;
        this.completion = completion;
    }

    public void deleteChat(long sessionId, String chatId) {
        ScannerStore.SessionChatSource chat = store.sessionChat(chatId).orElseThrow(() ->
                new SessionChatException(org.springframework.http.HttpStatus.NOT_FOUND, "Nie znaleziono tej rozmowy."));
        if (chat.sessionId() != sessionId) throw new SessionChatException(
                org.springframework.http.HttpStatus.NOT_FOUND, "Nie znaleziono tej rozmowy w wybranej sesji.");
        cleanup(List.of(chat));
        store.deleteSessionChat(chatId);
    }

    public void cleanupSession(long sessionId) { cleanup(store.sessionChats(sessionId)); }
    public void cleanupAll() { cleanup(store.allSessionChats()); }

    private void cleanup(List<ScannerStore.SessionChatSource> chats) {
        for (ScannerStore.SessionChatSource chat : chats) {
            if (chat.copilotSessionId() == null || chat.copilotSessionId().isBlank()) continue;
            try { completion.deleteStoredConversation(chat.copilotSessionId()); }
            catch (Exception failure) {
                LOG.warn("Nie udało się usunąć lokalnego stanu SDK rozmowy {}. Rekord Scannera zostanie usunięty.",
                        chat.id());
            }
        }
    }
}
