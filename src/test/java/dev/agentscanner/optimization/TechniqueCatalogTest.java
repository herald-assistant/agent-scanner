package dev.agentscanner.optimization;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.api.OptimizationTechniqueController;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TechniqueCatalogTest {

    @Test
    void loadsTheVersionedPilotCatalogWithCompleteTechniques() {
        TechniqueCatalog catalog = new TechniqueCatalog(new ObjectMapper());

        assertThat(catalog.document().version()).isEqualTo("techniques-v1");
        assertThat(catalog.document().techniques())
                .extracting(TechniqueCatalog.Technique::id)
                .containsExactlyInAnyOrder("T01", "T03", "T04", "T11", "T14", "T15");
        TechniqueCatalog.Technique firstExperiment = catalog.document().techniques().stream()
                .filter(technique -> technique.id().equals("T03"))
                .findFirst()
                .orElseThrow();
        assertThat(firstExperiment.firstExperiment()).isNotEmpty();
        assertThat(firstExperiment.maintenance().triggers()).isNotEmpty();
    }

    @Test
    void rejectsDuplicateTechniqueIdentifiers() {
        TechniqueCatalog catalog = new TechniqueCatalog(new ObjectMapper());
        TechniqueCatalog.Technique technique = catalog.document().techniques().get(0);
        TechniqueCatalog.Document invalid = new TechniqueCatalog.Document(
                "techniques-v1",
                List.of(technique, technique)
        );

        assertThatThrownBy(() -> TechniqueCatalog.validate(invalid))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("nie jest unikalny")
                .hasMessageContaining(technique.id());
    }

    @Test
    void rejectsReferencesToMissingTechniques() {
        TechniqueCatalog catalog = new TechniqueCatalog(new ObjectMapper());
        TechniqueCatalog.Technique source = catalog.document().techniques().get(0);
        TechniqueCatalog.Technique invalid = new TechniqueCatalog.Technique(
                source.id(),
                source.revision(),
                source.title(),
                source.explanation(),
                source.mechanism(),
                source.firstExperimentGoal(),
                source.simplerAlternative(),
                source.topics(),
                source.whenUseful(),
                source.whenNotUseful(),
                source.prerequisites(),
                source.applyAt(),
                source.firstExperiment(),
                source.example(),
                source.setup(),
                source.maintenance(),
                source.qualityChecks(),
                source.compare(),
                List.of("T404")
        );

        assertThatThrownBy(() -> TechniqueCatalog.validate(new TechniqueCatalog.Document("techniques-v1", List.of(invalid))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("nieistniejącą technikę")
                .hasMessageContaining("T404");
    }

    @Test
    void servesTheCatalogFromTheLocalApi() throws Exception {
        TechniqueCatalog catalog = new TechniqueCatalog(new ObjectMapper());
        MockMvc mvc = MockMvcBuilders
                .standaloneSetup(new OptimizationTechniqueController(catalog))
                .build();

        mvc.perform(get("/api/optimization/techniques"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value("techniques-v1"))
                .andExpect(jsonPath("$.techniques.length()").value(6))
                .andExpect(jsonPath("$.techniques[?(@.id == 'T03')].title").isNotEmpty());
    }
}
