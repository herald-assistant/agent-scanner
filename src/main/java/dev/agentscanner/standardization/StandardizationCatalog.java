package dev.agentscanner.standardization;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;

import static dev.agentscanner.standardization.Standardization.*;

/** The shipped Polish requirements are the single source of the substantive rubric. */
@Component
public final class StandardizationCatalog {
    private final Catalog catalog;

    public StandardizationCatalog() {
        List<Rule> rules = new ArrayList<>();
        List<Source> sources = new ArrayList<>();
        List<Standard> standards = new ArrayList<>();
        Map<Category, String> documents = new LinkedHashMap<>();
        documents.put(Category.INSTRUCTIONS, "instrukcje");
        documents.put(Category.SKILLS, "skills");
        documents.put(Category.AGENTS, "agenci");
        documents.put(Category.MCP, "mcp");
        documents.put(Category.PROMPTS, "prompty");
        for (var entry : documents.entrySet()) {
            String name = "standaryzacja-" + entry.getValue() + ".md";
            String content;
            try (var input = new ClassPathResource("standardization/" + name).getInputStream()) {
                content = new String(input.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
            } catch (Exception failure) {
                throw new IllegalStateException("Brak wymagań Standaryzacji w zasobach aplikacji.", failure);
            }
            standards.add(new Standard(entry.getKey(), name, content));
            var sourcePattern = Pattern.compile("^\\| ([ISAMP]\\d+) \\| \\[([^\\]]+)]\\((https://[^)]+)\\)", Pattern.MULTILINE);
            var sourceMatcher = sourcePattern.matcher(content);
            while (sourceMatcher.find()) sources.add(new Source(sourceMatcher.group(1), sourceMatcher.group(2), sourceMatcher.group(3)));
            int start = content.indexOf("## Kryteria merytoryczne dla AI");
            if (start < 0) throw new IllegalStateException("Brak kryteriów merytorycznych w " + name);
            String section = content.substring(start);
            int end = section.indexOf("\n## ");
            if (end >= 0) section = section.substring(0, end);
            var matcher = Pattern.compile("^\\| ([A-Z]{3}-\\d{3}) \\| (.*?) \\| (.*?) \\| (.*?) \\|$", Pattern.MULTILINE).matcher(section);
            while (matcher.find()) {
                String basis = matcher.group(2);
                List<String> ids = new ArrayList<>();
                var references = Pattern.compile("([ISAMP])(\\d+)(?:–([ISAMP])?(\\d+))?").matcher(basis);
                while (references.find()) {
                    int first = Integer.parseInt(references.group(2));
                    int last = references.group(4) == null ? first : Integer.parseInt(references.group(4));
                    for (int n = first; n <= last; n++) ids.add(references.group(1) + n);
                }
                rules.add(new Rule(matcher.group(1), entry.getKey(), basis, matcher.group(3), matcher.group(4), List.copyOf(ids)));
            }
        }
        Set<String> ids = new HashSet<>();
        Set<String> sourceIds = new HashSet<>();
        sources.forEach(source -> sourceIds.add(source.id()));
        if (rules.size() != 30 || rules.stream().anyMatch(rule -> !ids.add(rule.id()) || rule.sourceIds().isEmpty()
                || !sourceIds.containsAll(rule.sourceIds()))) throw new IllegalStateException("Niespójny katalog reguł Standaryzacji.");
        String fingerprint = StandardizationText.hash(standards.toString()).substring(0, 12);
        catalog = new Catalog("copilot-standardization-2026-09-22-" + fingerprint, "2026-09-22",
                List.copyOf(rules), List.copyOf(sources), List.copyOf(standards), List.of(Profile.AUTO),
                new Limits(MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES));
    }

    public Catalog get() { return catalog; }
}
