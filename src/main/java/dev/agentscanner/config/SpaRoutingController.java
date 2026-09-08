package dev.agentscanner.config;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaRoutingController {

    @GetMapping("/sessions/{sessionId}")
    String sessionRoute() {
        return "forward:/index.html";
    }
}
