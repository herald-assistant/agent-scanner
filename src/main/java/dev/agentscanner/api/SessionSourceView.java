package dev.agentscanner.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

final class SessionSourceView {
    private SessionSourceView() {}

    static void addTo(Map<String, Object> session, List<String> resourceDocuments, ObjectMapper mapper) {
        Source source = detect(resourceDocuments, mapper);
        session.put("sourceKind", source.kind());
        session.put("sourceName", source.name());
        if (source.service() != null) session.put("sourceService", source.service());
        if (source.version() != null) session.put("sourceVersion", source.version());
    }

    private static Source detect(List<String> documents, ObjectMapper mapper) {
        Source fallback = new Source("unknown", "Źródło nierozpoznane", null, null);
        for (String document : documents) {
            JsonNode resources;
            try { resources = mapper.readTree(document); }
            catch (Exception ignored) { continue; }
            if (!resources.isArray()) continue;
            for (JsonNode resource : resources) {
                String service = text(resource, "service.name");
                String version = text(resource, "service.version");
                if ("copilot-chat".equals(service)) {
                    // This service is emitted by the Copilot Chat extension bundled with VS Code.
                    return new Source("vscode", "Visual Studio Code", service, version);
                }
                if ("github-copilot".equals(service)) {
                    fallback = new Source("copilot-sdk", "GitHub Copilot SDK", service, version);
                } else if (fallback.service() == null && service != null) {
                    fallback = new Source("unknown", "Źródło nierozpoznane", service, version);
                }
            }
        }
        return fallback;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || !value.isTextual() || value.asText().isBlank() ? null : value.asText();
    }

    private record Source(String kind, String name, String service, String version) {}
}
