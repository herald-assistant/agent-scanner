package dev.agentscanner.config;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaRoutingController {

    @GetMapping("/sessions/{sessionId}")
    String sessionRoute() {
        return "forward:/index.html";
    }

    @GetMapping({"/standardization", "/sessions/{sessionId}/standardization", "/repositories/new", "/repositories/{repositoryId}",
            "/repositories/{repositoryId}/new", "/repositories/{repositoryId}/analyses/{analysisId}",
            "/sessions/{sessionId}/{tab:overview|cost|workflow|ai-hub|technical}"})
    String featureRoute() {
        return "forward:/index.html";
    }
}
