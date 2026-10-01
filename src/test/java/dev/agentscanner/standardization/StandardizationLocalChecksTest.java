package dev.agentscanner.standardization;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static dev.agentscanner.standardization.Standardization.*;
import static org.junit.jupiter.api.Assertions.*;

class StandardizationLocalChecksTest {
    private final StandardizationLocalChecks checks = new StandardizationLocalChecks(new ObjectMapper());

    private List<LocalCheck> inspect(String path, Category category, Profile profile, String content) {
        return checks.inspect(new FileEvidence("f1", path, category, content, "synthetic-hash",
                content.split("\n", -1).length, false), profile);
    }

    private List<LocalCheck> skill(String header) {
        return inspect(".github/skills/review/SKILL.md", Category.SKILLS, Profile.COPILOT_CLI,
                "---\n" + header + "\n---\nSprawdź rozdzielenie odpowiedzialności konfiguracji.");
    }

    private static boolean has(List<LocalCheck> result, String state, String message) {
        return result.stream().anyMatch(check -> check.state().equals(state) && check.message().contains(message));
    }

    private static void noErrors(List<LocalCheck> result) {
        assertFalse(has(result, "ERROR", ""), () -> result.toString());
    }

    @Test void acceptsOptionalVsCodeHeadersAndDoesNotRequireMarkdownHeadings() {
        for (String path : List.of(".github/agents/review.agent.md", ".github/prompts/review.prompt.md",
                ".github/instructions/review.instructions.md", ".github/copilot-instructions.md", "AGENTS.md")) {
            Category category = path.contains("/agents/") ? Category.AGENTS
                    : path.contains("/prompts/") ? Category.PROMPTS : Category.INSTRUCTIONS;
            noErrors(inspect(path, category, Profile.VSCODE_LOCAL, "Zasada zapisana jako pojedyncze zdanie."));
            noErrors(inspect(path, category, Profile.VSCODE_LOCAL, "---\n---\nZasada bez tytułu H1."));
        }
    }

    @Test void requiresGitHubAgentMetadataButNotVsCodeMetadata() {
        for (Profile profile : List.of(Profile.COPILOT_CLI, Profile.GITHUB_CLOUD)) {
            assertTrue(has(inspect(".github/agents/review.agent.md", Category.AGENTS, profile,
                    "Zasada."), "ERROR", "nagłówka YAML"));
            assertTrue(has(inspect(".github/agents/review.agent.md", Category.AGENTS, profile,
                    "---\nname: Review\n---\nZasada."), "ERROR", "description"));
        }
        noErrors(inspect(".github/agents/review.agent.md", Category.AGENTS, Profile.VSCODE_LOCAL,
                "---\nname: Review\n---\nZasada."));
    }

    @Test void appliesPathHeaderRequirementsOnlyToTheRelevantMechanismAndProfile() {
        String path = ".github/instructions/review.instructions.md";
        for (Profile profile : List.of(Profile.GITHUB_CLOUD, Profile.GITHUB_REVIEW, Profile.COPILOT_CLI)) {
            assertTrue(has(inspect(path, Category.INSTRUCTIONS, profile, "Zasada."), "ERROR", "nagłówka YAML"));
            assertTrue(has(inspect(path, Category.INSTRUCTIONS, profile, "---\nname: Review\n---\nZasada."), "ERROR", "applyTo"));
            noErrors(inspect("AGENTS.md", Category.INSTRUCTIONS, profile, "Zasada."));
        }
        List<LocalCheck> manual = inspect(path, Category.INSTRUCTIONS, Profile.VSCODE_LOCAL, "Zasada.");
        noErrors(manual);
        assertTrue(has(manual, "INFO", "Brak applyTo"));
        assertTrue(has(inspect(path, Category.INSTRUCTIONS, Profile.VSCODE_LOCAL,
                "---\napplyTo: ['**']\n---\nZasada."), "ERROR", "applyTo"));
        assertTrue(has(inspect(path, Category.INSTRUCTIONS, Profile.GITHUB_CLOUD,
                "---\napplyTo: '**'\nexcludeAgent: unknown\n---\nZasada."), "ERROR", "excludeAgent"));
        noErrors(inspect(path, Category.INSTRUCTIONS, Profile.GITHUB_REVIEW,
                "---\napplyTo: '**'\nexcludeAgent: cloud-agent\n---\nZasada."));
    }

    @Test void rejectsMissingOrNonTextualRequiredSkillFields() {
        for (String header : List.of("name: review", "description: Opis", "name: 42\ndescription: Opis",
                "name: review\ndescription: false", "name: review\ndescription: ''")) {
            assertTrue(has(skill(header), "ERROR", "Pole"));
        }
    }

    @Test void distinguishesSkillSpecificationConstraintsFromRuntimeErrors() {
        for (String name : List.of("Review", "-review", "review-", "review--config", "review/config", "x".repeat(65))) {
            assertTrue(has(skill("name: '" + name + "'\ndescription: Opis"), "WARNING", "SPEC Agent Skills: name"));
        }
        List<LocalCheck> differentDirectory = skill("name: other\ndescription: Opis");
        noErrors(differentDirectory);
        assertTrue(has(differentDirectory, "WARNING", "nazwie katalogu"));
        assertTrue(has(skill("name: review\ndescription: '" + "x".repeat(1025) + "'"), "WARNING", "1024"));
    }

    @Test void countsUnicodeCodePointsInsteadOfUtf16UnitsForSkillLimits() {
        String name = "𐐨".repeat(64);
        List<LocalCheck> result = inspect(".github/skills/" + name + "/SKILL.md", Category.SKILLS, Profile.COPILOT_CLI,
                "---\nname: " + name + "\ndescription: '" + "😀".repeat(1024) + "'\n---\nProcedura.");
        noErrors(result);
        assertFalse(has(result, "WARNING", ""));
        assertFalse(has(skill("name: review\ndescription: '" + "x".repeat(1024) + "'"), "WARNING", "1024"));
    }

    @Test void acceptsCliAllowedToolsListsAndFlagsAmbiguousOtherClientSupportAsInformation() {
        noErrors(skill("name: review\ndescription: Opis\nallowed-tools: [read, search]\nuser-invocable: false"));
        List<LocalCheck> other = inspect(".github/skills/review/SKILL.md", Category.SKILLS, Profile.GITHUB_CLOUD,
                "---\nname: review\ndescription: Opis\nallowed-tools: [read]\n---\nProcedura.");
        noErrors(other);
        assertTrue(has(other, "INFO", "allowed-tools"));
        assertTrue(has(skill("name: review\ndescription: Opis\nallowed-tools: [read, 42]"), "ERROR", "allowed-tools"));
        assertTrue(has(skill("name: review\ndescription: Opis\nuser-invocable: 'false'"), "ERROR", "user-invocable"));
    }

    @Test void validatesAgentFieldTypesWithoutCheckingAvailabilityOfModelsOrTools() {
        String valid = "---\nname: Reviewer\nmodel: [private-model, another-model]\ntools: []\n"
                + "agents: '*'\nuser-invocable: false\nhandoffs:\n  - label: Continue\n    agent: personal-agent\n    send: false\n---\nRola.";
        noErrors(inspect(".github/agents/review.agent.md", Category.AGENTS, Profile.VSCODE_LOCAL, valid));
        assertTrue(has(inspect(".github/agents/review.agent.md", Category.AGENTS, Profile.GITHUB_CLOUD,
                "---\ndescription: Opis\nmodel: [private-model]\n---\nRola."), "ERROR", "model"));
        for (String field : List.of("description: [Opis]", "tools: [read, 42]", "user-invocable: 'false'",
                "target: arbitrary", "handoffs: wrong", "handoffs:\n  - send: 'true'")) {
            assertTrue(has(inspect(".github/agents/review.agent.md", Category.AGENTS, Profile.VSCODE_LOCAL,
                    "---\n" + field + "\n---\nRola."), "ERROR", ""), field);
        }
        noErrors(inspect(".github/agents/review.agent.md", Category.AGENTS, Profile.GITHUB_CLOUD,
                "---\ndescription: Opis\ntools: 'private-tool, read'\nhandoffs: ignored-by-cloud\n---\nRola."));
    }

    @Test void validatesPromptFieldsForVsCodeLocalOnly() {
        for (String field : List.of("agent: 42", "tools: read", "model: [example]", "description: false")) {
            String content = "---\n" + field + "\n---\nZadanie.";
            assertTrue(has(inspect(".github/prompts/review.prompt.md", Category.PROMPTS, Profile.VSCODE_LOCAL,
                    content), "ERROR", ""));
            noErrors(inspect(".github/prompts/review.prompt.md", Category.PROMPTS, Profile.JETBRAINS, content));
        }
        noErrors(inspect(".github/prompts/review.prompt.md", Category.PROMPTS, Profile.VSCODE_LOCAL,
                "---\nagent: personal-reviewer\ntools: []\n---\nZadanie."));
    }

    @Test void preservesUnknownFieldsAndDoesNotApplyGithubSchemaToClaudeAgents() {
        List<LocalCheck> extension = skill("name: review\ndescription: Opis\nfuture-field:\n  custom: value");
        noErrors(extension);
        assertTrue(has(extension, "INFO", "dodatkowe pola"));
        List<LocalCheck> claude = inspect(".claude/agents/review.md", Category.AGENTS, Profile.COPILOT_CLI,
                "---\nmodel: inherit\ncustom-field: 42\n---\nRola.");
        noErrors(claude);
        assertTrue(has(claude, "INFO", "Format .claude/agents"));
    }

    @Test void rejectsMalformedYamlDuplicateKeysAndUnsafeTagsWithoutLeakingInput() {
        for (String header : List.of("name: review\ndescription: [unclosed", "name: review\nname: again\ndescription: Opis",
                "name: !!java.net.URL [https://example.invalid]\ndescription: Opis",
                "- scalar-list\n- not-map", "name: review\n? [complex, key]\n: value")) {
            List<LocalCheck> result = skill(header);
            assertTrue(has(result, "ERROR", ""));
            assertFalse(result.toString().contains("example.invalid"));
            assertFalse(result.toString().contains("unclosed"));
        }
    }

    @Test void handlesHeaderDelimitersWindowsLineEndingsAndMissingBody() {
        noErrors(inspect(".github/skills/review/SKILL.md", Category.SKILLS, Profile.COPILOT_CLI,
                "\uFEFF---\r\nname: review\r\ndescription: Opis\r\n---\r\nProcedura."));
        assertTrue(has(inspect(".github/skills/review/SKILL.md", Category.SKILLS, Profile.COPILOT_CLI,
                "---\nname: review\ndescription: Opis\n---invalid"), "ERROR", "zamknięcia"));
        List<LocalCheck> emptyBody = inspect(".github/skills/review/SKILL.md", Category.SKILLS, Profile.COPILOT_CLI,
                "---\nname: review\ndescription: Opis\n---");
        noErrors(emptyBody);
        assertTrue(has(emptyBody, "WARNING", "nie ma treści Markdown"));
    }
}
