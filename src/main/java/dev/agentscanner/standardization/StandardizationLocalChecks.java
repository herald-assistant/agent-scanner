package dev.agentscanner.standardization;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static dev.agentscanner.standardization.Standardization.*;

@Component
public final class StandardizationLocalChecks {
    private final ObjectMapper mapper;
    public StandardizationLocalChecks(ObjectMapper mapper) { this.mapper = mapper; }

    public List<LocalCheck> inspect(FileEvidence file, Profile profile) {
        List<LocalCheck> checks = new ArrayList<>();
        if (file.category() == Category.CONTEXT) return List.of();
        if (file.content().isBlank()) {
            checks.add(new LocalCheck(file.id(), "WARNING", "Plik jest pusty; brak treści do oceny."));
        }
        if (file.redacted()) checks.add(new LocalCheck(file.id(), "INFO", "Rozpoznane wartości poufne zamaskowano przed analizą."));
        if (file.category() == Category.PROMPTS && profile == Profile.AUTO) {
            checks.add(new LocalCheck(file.id(), "INFO", "Plik promptu jest szablonem uruchamianym przez użytkownika; sama obecność w repozytorium nie dołącza go do każdej rozmowy."));
        }
        if (file.category() == Category.PROMPTS && (profile == Profile.VSCODE_AGENT_HOST
                || profile == Profile.COPILOT_CLI || profile == Profile.GITHUB_CLOUD || profile == Profile.GITHUB_REVIEW)) {
            checks.add(new LocalCheck(file.id(), "INFO", "Pliki promptów nie są obsługiwane przez wybrany profil. Można ocenić ich treść, ale nie aktywację."));
        }
        if (file.category() == Category.MCP) {
            json(file, checks);
        } else {
            markdown(file, profile, checks);
        }
        return List.copyOf(checks);
    }

    private void json(FileEvidence file, List<LocalCheck> checks) {
        try {
            var reader = mapper.copy().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
            if (file.path().equals(".vscode/mcp.json")) {
                reader.enable(JsonParser.Feature.ALLOW_COMMENTS, JsonParser.Feature.ALLOW_TRAILING_COMMA);
            }
            var root = reader.readTree(file.content());
            if (root == null || !root.isObject()) {
                checks.add(new LocalCheck(file.id(), "ERROR", "Konfiguracja MCP powinna być obiektem JSON."));
                return;
            }
            String key = file.path().equals(".vscode/mcp.json") ? "servers" : "mcpServers";
            var servers = root.has(key) ? root.path(key) : root;
            if (!servers.isObject() || file.path().equals(".vscode/mcp.json") && !root.has(key)) {
                checks.add(new LocalCheck(file.id(), "ERROR", "Brak mapy serwerów właściwej dla lokalizacji konfiguracji."));
                return;
            }
            var iterator = servers.elements();
            while (iterator.hasNext()) {
                var server = iterator.next();
                if (!server.isObject() || server.has("args") && !server.path("args").isArray()
                        || server.has("command") && !server.path("command").isTextual()
                        || server.has("url") && !server.path("url").isTextual()) {
                    checks.add(new LocalCheck(file.id(), "ERROR", "Niepoprawny typ deklaracji serwera, command, url lub args."));
                    return;
                }
            }
            checks.add(new LocalCheck(file.id(), "PASS", "Składnia i podstawowa struktura MCP są poprawne. Nie sprawdzano połączenia ani uprawnień."));
        } catch (Exception failure) {
            checks.add(new LocalCheck(file.id(), "ERROR", "Nie można odczytać JSON: sprawdź składnię i powtórzone klucze. Treść błędu parsera została pominięta."));
        }
    }

    private void markdown(FileEvidence file, Profile profile, List<LocalCheck> checks) {
        String text = file.content().replace("\r\n", "\n").replaceFirst("^\uFEFF", "");
        String[] lines = text.split("\n", -1);
        boolean frontmatter = lines[0].stripTrailing().equals("---");
        boolean githubAgent = file.category() == Category.AGENTS && file.path().startsWith(".github/agents/");
        boolean required = file.category() == Category.SKILLS
                || githubAgent && (profile == Profile.COPILOT_CLI || profile == Profile.GITHUB_CLOUD)
                || pathInstructions(file) && pathHeaderRequired(profile);
        if (!frontmatter) {
            checks.add(new LocalCheck(file.id(), required ? "ERROR" : "PASS", required
                    ? "Ten mechanizm w wybranym profilu wymaga nagłówka YAML na początku pliku."
                    : profile == Profile.AUTO && githubAgent
                    ? "Brak nagłówka YAML jest dopuszczalny w części klientów; automatyczny dobór agenta wymaga osobnej oceny."
                    : "Markdown bez nagłówka YAML jest dopuszczalny. Treść wymaga osobnej oceny."));
            if (pathInstructions(file) && !required) missingApplyTo(file, profile, checks);
            if (profile == Profile.AUTO && githubAgent) add(file, checks, "INFO",
                    "Bez opisu roli nie potwierdzono możliwości jej automatycznego doboru przez klientów, którzy go wymagają.");
            return;
        }
        int end = 1;
        while (end < lines.length && !lines[end].stripTrailing().equals("---")) end++;
        if (end == lines.length) {
            checks.add(new LocalCheck(file.id(), "ERROR", "Nagłówek YAML nie ma poprawnego zamknięcia."));
            return;
        }
        String header = String.join("\n", java.util.Arrays.copyOfRange(lines, 1, end));
        try {
            LoaderOptions options = new LoaderOptions();
            options.setAllowDuplicateKeys(false);
            options.setMaxAliasesForCollections(20);
            options.setNestingDepthLimit(30);
            options.setCodePointLimit(MAX_FILE_BYTES);
            Object parsed = header.lines().allMatch(line -> line.isBlank() || line.stripLeading().startsWith("#"))
                    ? Map.of() : new Yaml(new SafeConstructor(options)).load(header);
            if (!(parsed instanceof Map<?, ?> fields) || fields.keySet().stream().anyMatch(key -> !(key instanceof String))) {
                checks.add(new LocalCheck(file.id(), "ERROR", "Nagłówek YAML powinien zawierać mapę pól z tekstowymi kluczami."));
                return;
            }
            switch (file.category()) {
                case SKILLS -> skill(file, profile, fields, checks);
                case INSTRUCTIONS -> instructions(file, profile, fields, checks);
                case AGENTS -> agent(file, profile, fields, checks);
                case PROMPTS -> prompt(file, profile, fields, checks);
                default -> { }
            }
            if (String.join("\n", java.util.Arrays.copyOfRange(lines, end + 1, lines.length)).isBlank()) {
                add(file, checks, "WARNING", "Pod nagłówkiem nie ma treści Markdown opisującej instrukcje, rolę lub zadanie.");
            }
            if (checks.stream().noneMatch(check -> check.state().equals("ERROR"))) {
                add(file, checks, "PASS", "Składnia nagłówka i sprawdzone pola są poprawne. To nie potwierdza aktywacji, znaczenia treści ani obsługi wszystkich rozszerzeń.");
            }
        } catch (Exception failure) {
            checks.add(new LocalCheck(file.id(), "ERROR", "Nie można odczytać YAML: sprawdź składnię, powtórzone klucze i niedozwolone tagi."));
        }
    }

    private void instructions(FileEvidence file, Profile profile, Map<?, ?> fields, List<LocalCheck> checks) {
        if (!pathInstructions(file)) return;
        textField(file, fields, "name", false, checks);
        textField(file, fields, "description", false, checks);
        String applyTo = textField(file, fields, "applyTo", pathHeaderRequired(profile), checks);
        if (applyTo != null && applyTo.isBlank()) add(file, checks, "ERROR", "applyTo nie może być pustym wzorcem.");
        if (!fields.containsKey("applyTo") && !pathHeaderRequired(profile)) missingApplyTo(file, profile, checks);
        if (profile == Profile.GITHUB_CLOUD || profile == Profile.GITHUB_REVIEW) {
            String exclude = textField(file, fields, "excludeAgent", false, checks);
            if (exclude != null && !Set.of("code-review", "cloud-agent").contains(exclude)) {
                add(file, checks, "ERROR", "excludeAgent w profilu GitHub przyjmuje code-review albo cloud-agent.");
            }
        }
        unknownFields(file, fields, Set.of("name", "description", "applyTo", "excludeAgent"), checks);
    }

    private void skill(FileEvidence file, Profile profile, Map<?, ?> fields, List<LocalCheck> checks) {
        String name = textField(file, fields, "name", true, checks);
        String description = textField(file, fields, "description", true, checks);
        if (name != null && !name.isBlank()) {
            if (characters(name) > 64 || !name.matches("[\\p{Ll}\\p{Lo}\\p{Nd}]+(?:-[\\p{Ll}\\p{Lo}\\p{Nd}]+)*")) {
                add(file, checks, "WARNING", "SPEC Agent Skills: name ma mieć 1–64 znaki, małe litery/cyfry i pojedyncze łączniki wewnątrz nazwy. Liczymy punkty kodowe Unicode.");
            }
            String[] path = file.path().split("/");
            if (path.length > 1 && !name.equals(path[path.length - 2])) {
                add(file, checks, "WARNING", "SPEC / VS Code: name powinno odpowiadać nazwie katalogu skilla. GitHub opisuje tę zgodność jako typową; nie dowodzi to błędu każdego klienta.");
            }
        }
        if (description != null && characters(description) > 1024) {
            add(file, checks, "WARNING", "SPEC Agent Skills: description przekracza 1024 znaki (punkty kodowe Unicode).");
        }
        for (String key : List.of("license", "compatibility")) {
            if (fields.containsKey(key) && !(fields.get(key) instanceof String)) {
                add(file, checks, "WARNING", "SPEC Agent Skills: pole " + key + " powinno być tekstem.");
            }
        }
        if (fields.get("compatibility") instanceof String compatibility
                && (compatibility.isBlank() || characters(compatibility) > 500)) {
            add(file, checks, "WARNING", "SPEC Agent Skills: podane compatibility powinno mieć 1–500 znaków (punkty kodowe Unicode).");
        }
        if (fields.containsKey("metadata") && !stringMap(fields.get("metadata"))) {
            add(file, checks, "WARNING", "SPEC Agent Skills: metadata powinno być mapą tekstowych kluczy i wartości.");
        }
        if (fields.containsKey("allowed-tools") && !(fields.get("allowed-tools") instanceof String)) {
            if (!stringList(fields.get("allowed-tools"))) {
                add(file, checks, "ERROR", "allowed-tools powinno zawierać nazwy narzędzi jako tekst lub listę tekstów zależnie od klienta.");
            } else if (profile != Profile.COPILOT_CLI) {
                add(file, checks, "INFO", "Lista allowed-tools jest udokumentowana dla CLI; specyfikacja Agent Skills opisuje tekst. Obsługa listy wymaga sprawdzenia wybranego klienta.");
            }
        }
        if (isVsCode(profile) || profile == Profile.COPILOT_CLI || profile == Profile.AUTO) {
            booleanFields(file, fields, List.of("user-invocable", "disable-model-invocation"), checks);
            textField(file, fields, "argument-hint", false, checks);
        }
        if (profile == Profile.AUTO && Boolean.TRUE.equals(fields.get("disable-model-invocation"))) {
            add(file, checks, "WARNING", "Automatyczny dobór skilla przez model jest wyłączony przez disable-model-invocation: true.");
        }
        unknownFields(file, fields, Set.of("name", "description", "license", "compatibility", "metadata",
                "allowed-tools", "argument-hint", "user-invocable", "disable-model-invocation"), checks);
    }

    private void agent(FileEvidence file, Profile profile, Map<?, ?> fields, List<LocalCheck> checks) {
        if (file.path().startsWith(".claude/agents/")) {
            add(file, checks, "INFO", "Format .claude/agents: sprawdzono składnię YAML. Nie przeniesiono wymagań pól profilu .github/agents na ten format.");
            return;
        }
        textField(file, fields, "name", false, checks);
        textField(file, fields, "description", profile == Profile.COPILOT_CLI || profile == Profile.GITHUB_CLOUD, checks);
        if (profile == Profile.AUTO && file.path().startsWith(".github/agents/") && !fields.containsKey("description")) {
            add(file, checks, "INFO", "Brak opisu roli ogranicza możliwość oceny automatycznego doboru; niektórzy klienci wymagają description.");
        }
        textField(file, fields, "argument-hint", false, checks);
        String target = textField(file, fields, "target", false, checks);
        if (target != null && !Set.of("vscode", "github-copilot").contains(target)) {
            add(file, checks, "ERROR", "target przyjmuje vscode albo github-copilot.");
        }
        if (fields.containsKey("tools") && !(fields.get("tools") instanceof String) && !stringList(fields.get("tools"))) {
            add(file, checks, "ERROR", "tools agenta powinno być listą tekstów lub tekstem z nazwami rozdzielonymi przecinkami.");
        }
        if (fields.containsKey("model") && !(fields.get("model") instanceof String)
                && !((isVsCode(profile) || profile == Profile.AUTO) && stringList(fields.get("model")))) {
            add(file, checks, "ERROR", "model powinno być tekstem; VS Code dopuszcza również listę tekstowych nazw modeli.");
        }
        booleanFields(file, fields, List.of("user-invocable", "disable-model-invocation", "infer"), checks);
        if (profile == Profile.AUTO && Boolean.TRUE.equals(fields.get("disable-model-invocation"))) {
            add(file, checks, "WARNING", "Automatyczny dobór agenta przez model jest wyłączony przez disable-model-invocation: true.");
        }
        if (fields.containsKey("infer")) add(file, checks, "INFO", profile == Profile.COPILOT_CLI
                ? "Referencja CLI nadal opisuje infer, a ogólna referencja agentów GitHub oznacza je jako wycofywane. Interpretacja wymaga uwzględnienia wersji klienta."
                : "infer jest wycofywane; dokumentacja zaleca user-invocable i disable-model-invocation.");
        if (isVsCode(profile)) {
            if (fields.containsKey("agents") && !"*".equals(fields.get("agents")) && !stringList(fields.get("agents"))) {
                add(file, checks, "ERROR", "agents w VS Code powinno być listą nazw agentów lub tekstem *.");
            }
            handoffs(file, fields, checks);
        } else if (fields.containsKey("handoffs")) {
            add(file, checks, "INFO", "handoffs jest rozszerzeniem VS Code; nie potwierdzono jego obsługi w wybranym profilu.");
        }
        if (profile == Profile.COPILOT_CLI || profile == Profile.GITHUB_CLOUD) {
            if (fields.containsKey("mcp-servers") && !(fields.get("mcp-servers") instanceof Map<?, ?>)) {
                add(file, checks, "ERROR", "mcp-servers agenta GitHub powinno być mapą konfiguracji serwerów.");
            }
            if (fields.containsKey("metadata") && !stringMap(fields.get("metadata"))) {
                add(file, checks, "ERROR", "metadata agenta GitHub powinno być mapą tekstowych kluczy i wartości.");
            }
        }
        unknownFields(file, fields, Set.of("name", "description", "argument-hint", "target", "tools", "model",
                "user-invocable", "disable-model-invocation", "infer", "agents", "handoffs", "mcp-servers", "metadata"), checks);
    }

    private void prompt(FileEvidence file, Profile profile, Map<?, ?> fields, List<LocalCheck> checks) {
        if (profile != Profile.VSCODE_LOCAL) {
            add(file, checks, "INFO", "Sprawdzono składnię YAML promptu. Typy pól charakterystycznych dla VS Code Local nie zostały narzucone innemu profilowi.");
            return;
        }
        for (String key : List.of("name", "description", "argument-hint", "agent", "model")) {
            textField(file, fields, key, false, checks);
        }
        if (fields.containsKey("tools") && !stringList(fields.get("tools"))) {
            add(file, checks, "ERROR", "tools promptu VS Code powinno być listą tekstowych nazw narzędzi.");
        }
        unknownFields(file, fields, Set.of("name", "description", "argument-hint", "agent", "model", "tools"), checks);
    }

    private void handoffs(FileEvidence file, Map<?, ?> fields, List<LocalCheck> checks) {
        if (!fields.containsKey("handoffs")) return;
        if (!(fields.get("handoffs") instanceof List<?> values) || values.stream().anyMatch(value -> !(value instanceof Map<?, ?>))) {
            add(file, checks, "ERROR", "handoffs w VS Code powinno być listą obiektów.");
            return;
        }
        for (Object value : values) {
            Map<?, ?> handoff = (Map<?, ?>) value;
            for (String key : List.of("label", "agent", "prompt", "model")) textField(file, handoff, key, false, checks);
            booleanFields(file, handoff, List.of("send"), checks);
        }
    }

    private String textField(FileEvidence file, Map<?, ?> fields, String key, boolean required, List<LocalCheck> checks) {
        if (!fields.containsKey(key) && !required) return null;
        if (!(fields.get(key) instanceof String value) || required && value.isBlank()) {
            add(file, checks, "ERROR", "Pole " + key + " powinno być " + (required ? "wymaganym niepustym tekstem." : "tekstem, jeśli zostało podane."));
            return null;
        }
        return value;
    }

    private void booleanFields(FileEvidence file, Map<?, ?> fields, List<String> keys, List<LocalCheck> checks) {
        for (String key : keys) {
            if (fields.containsKey(key) && !(fields.get(key) instanceof Boolean)) {
                add(file, checks, "ERROR", "Pole " + key + " powinno być wartością logiczną true/false, bez cudzysłowów.");
            }
        }
    }

    private void unknownFields(FileEvidence file, Map<?, ?> fields, Set<String> known, List<LocalCheck> checks) {
        if (fields.keySet().stream().anyMatch(key -> !known.contains(key))) {
            add(file, checks, "INFO", "Nagłówek zawiera dodatkowe pola. Zachowano je; ich znaczenie i obsługa przez klienta nie zostały zweryfikowane.");
        }
    }

    private static boolean pathInstructions(FileEvidence file) {
        return file.category() == Category.INSTRUCTIONS && file.path().endsWith(".instructions.md");
    }
    private static boolean pathHeaderRequired(Profile profile) {
        return profile == Profile.GITHUB_CLOUD || profile == Profile.GITHUB_REVIEW || profile == Profile.COPILOT_CLI;
    }
    private static boolean isVsCode(Profile profile) {
        return profile == Profile.VSCODE_LOCAL || profile == Profile.VSCODE_AGENT_HOST;
    }
    private static boolean stringList(Object value) {
        return value instanceof List<?> list && list.stream().allMatch(item -> item instanceof String);
    }
    private static boolean stringMap(Object value) {
        return value instanceof Map<?, ?> map && map.entrySet().stream().allMatch(entry -> entry.getKey() instanceof String && entry.getValue() instanceof String);
    }
    private static int characters(String value) { return value.codePointCount(0, value.length()); }
    private static void missingApplyTo(FileEvidence file, Profile profile, List<LocalCheck> checks) {
        add(file, checks, profile == Profile.AUTO ? "WARNING" : "INFO",
                "Brak applyTo: nie potwierdzono automatycznego doboru po ścieżkach. VS Code dopuszcza ręczne dołączenie; dopasowanie semantyczne zależy od klienta.");
    }
    private static void add(FileEvidence file, List<LocalCheck> checks, String state, String message) {
        checks.add(new LocalCheck(file.id(), state, message));
    }
}
