package dev.agentscanner.api;

import dev.agentscanner.optimization.TechniqueCatalog;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/optimization")
public final class OptimizationTechniqueController {

    private final TechniqueCatalog techniqueCatalog;

    public OptimizationTechniqueController(TechniqueCatalog techniqueCatalog) {
        this.techniqueCatalog = techniqueCatalog;
    }

    @GetMapping("/techniques")
    public TechniqueCatalog.Document techniques() {
        return techniqueCatalog.document();
    }
}
