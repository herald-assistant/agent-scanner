package dev.agentscanner.optimization;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Component
public final class TechniqueCatalog {

    private static final Set<String> KNOWN_TOPICS = Set.of(
            "GENERAL",
            "ACQUIRE_DATA",
            "MODIFY",
            "WRITE_INTERMEDIATE",
            "WRITE_FINAL",
            "VALIDATE",
            "DELEGATE",
            "MANAGE_CONTEXT",
            "RESPOND",
            "OTHER",
            "UNKNOWN",
            "CONTEXT_COMPACTION",
            "UNMAPPED",
            "UNATTRIBUTED"
    );
    private static final Set<String> KNOWN_APPLICATION_POINTS = Set.of(
            "PROMPT",
            "PROJECT_INSTRUCTIONS",
            "SKILL",
            "AGENT_ROLE",
            "TOOL_CODE",
            "PROJECT_MAP",
            "ARTIFACT_PIPELINE",
            "SESSION_STRATEGY",
            "MODEL_OR_RUNTIME_CONFIG"
    );
    private static final Set<String> KNOWN_SETUP_LEVELS = Set.of("NONE", "SMALL", "MEDIUM", "LARGE");

    private final Document document;

    public TechniqueCatalog(ObjectMapper objectMapper) {
        var resource = new ClassPathResource("optimization/techniques-v1.json");
        try (InputStream input = resource.getInputStream()) {
            document = objectMapper.readValue(input, Document.class);
        } catch (IOException exception) {
            throw new IllegalStateException("Nie udało się wczytać katalogu technik optymalizacji.", exception);
        }
        validate(document);
    }

    public Document document() {
        return document;
    }

    static void validate(Document document) {
        if (document == null) {
            throw new IllegalStateException("Katalog technik nie może być pusty.");
        }
        requireText(document.version(), "version");
        requireNonEmpty(document.techniques(), "techniques");

        Set<String> ids = new HashSet<>();
        for (Technique technique : document.techniques()) {
            if (technique == null) {
                throw new IllegalStateException("Katalog technik zawiera pusty wpis.");
            }
            requireText(technique.id(), "technique.id");
            if (!ids.add(technique.id())) {
                throw new IllegalStateException("Identyfikator techniki nie jest unikalny: " + technique.id());
            }
            if (technique.revision() < 1) {
                throw new IllegalStateException("Rewizja techniki musi być dodatnia: " + technique.id());
            }
            requireText(technique.title(), technique.id() + ".title");
            requireText(technique.explanation(), technique.id() + ".explanation");
            requireText(technique.mechanism(), technique.id() + ".mechanism");
            requireText(technique.firstExperimentGoal(), technique.id() + ".firstExperimentGoal");
            requireText(technique.simplerAlternative(), technique.id() + ".simplerAlternative");
            requireTextList(technique.topics(), technique.id() + ".topics");
            requireKnownValues(technique.topics(), KNOWN_TOPICS, technique.id() + ".topics");
            requireTextList(technique.whenUseful(), technique.id() + ".whenUseful");
            requireTextList(technique.whenNotUseful(), technique.id() + ".whenNotUseful");
            requireTextList(technique.prerequisites(), technique.id() + ".prerequisites");
            requireTextList(technique.applyAt(), technique.id() + ".applyAt");
            requireKnownValues(technique.applyAt(), KNOWN_APPLICATION_POINTS, technique.id() + ".applyAt");
            requireTextList(technique.firstExperiment(), technique.id() + ".firstExperiment");
            if (technique.firstExperiment().size() > 3) {
                throw new IllegalStateException("Pierwszy eksperyment może mieć najwyżej trzy kroki: " + technique.id());
            }
            if (technique.example() == null) {
                throw new IllegalStateException("Brak przykładu dla techniki: " + technique.id());
            }
            requireText(technique.example().before(), technique.id() + ".example.before");
            requireText(technique.example().after(), technique.id() + ".example.after");
            if (technique.setup() == null || !KNOWN_SETUP_LEVELS.contains(technique.setup().level())) {
                throw new IllegalStateException("Nieznany poziom wdrożenia techniki: " + technique.id());
            }
            requireTextList(technique.setup().tasks(), technique.id() + ".setup.tasks");
            if (technique.maintenance() == null) {
                throw new IllegalStateException("Brak opisu utrzymania techniki: " + technique.id());
            }
            requireTextList(technique.maintenance().tasks(), technique.id() + ".maintenance.tasks");
            requireTextList(technique.maintenance().triggers(), technique.id() + ".maintenance.triggers");
            requireTextList(technique.qualityChecks(), technique.id() + ".qualityChecks");
            requireTextList(technique.compare(), technique.id() + ".compare");
            if (technique.relatedTechniqueIds() == null) {
                throw new IllegalStateException("Brak listy powiązanych technik: " + technique.id());
            }
        }

        for (Technique technique : document.techniques()) {
            for (String relatedId : technique.relatedTechniqueIds()) {
                if (!ids.contains(relatedId)) {
                    throw new IllegalStateException(
                            "Technika " + technique.id() + " wskazuje nieistniejącą technikę: " + relatedId
                    );
                }
                if (technique.id().equals(relatedId)) {
                    throw new IllegalStateException("Technika nie może wskazywać samej siebie: " + technique.id());
                }
            }
        }
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Wymagane pole katalogu jest puste: " + field);
        }
    }

    private static void requireNonEmpty(List<?> values, String field) {
        if (values == null || values.isEmpty()) {
            throw new IllegalStateException("Wymagana lista katalogu jest pusta: " + field);
        }
    }

    private static void requireTextList(List<String> values, String field) {
        requireNonEmpty(values, field);
        for (int index = 0; index < values.size(); index++) {
            requireText(values.get(index), field + "[" + index + "]");
        }
    }

    private static void requireKnownValues(List<String> values, Set<String> knownValues, String field) {
        for (String value : values) {
            if (!knownValues.contains(value)) {
                throw new IllegalStateException("Nieznana wartość w " + field + ": " + value);
            }
        }
    }

    public record Document(String version, List<Technique> techniques) {
    }

    public record Technique(
            String id,
            int revision,
            String title,
            String explanation,
            String mechanism,
            String firstExperimentGoal,
            String simplerAlternative,
            List<String> topics,
            List<String> whenUseful,
            List<String> whenNotUseful,
            List<String> prerequisites,
            List<String> applyAt,
            List<String> firstExperiment,
            Example example,
            Setup setup,
            Maintenance maintenance,
            List<String> qualityChecks,
            List<String> compare,
            List<String> relatedTechniqueIds
    ) {
    }

    public record Example(String before, String after) {
    }

    public record Setup(String level, List<String> tasks) {
    }

    public record Maintenance(List<String> tasks, List<String> triggers) {
    }
}
