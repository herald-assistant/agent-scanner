package dev.agentscanner.standardization;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.agentscanner.ai.CopilotCompletion;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

import static dev.agentscanner.standardization.Standardization.*;

@Service
public final class StandardizationService {
    private static final Set<String> OMIT_REASONS = Set.of("EXCLUDED", "UNREADABLE", "TOO_LARGE", "LIMIT", "UNSUPPORTED_ENCODING");
    private final StandardizationCatalog catalog;
    private final StandardizationLocalChecks checks;
    private final StandardizationValidator validator;
    private final CopilotCompletion completion;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final Map<String, Entry> previews = new LinkedHashMap<>();

    @Autowired
    public StandardizationService(StandardizationCatalog catalog, StandardizationLocalChecks checks,
                                  StandardizationValidator validator, CopilotCompletion completion, ObjectMapper mapper) {
        this(catalog, checks, validator, completion, mapper, Clock.systemUTC());
    }
    StandardizationService(StandardizationCatalog catalog, StandardizationLocalChecks checks,
                           StandardizationValidator validator, CopilotCompletion completion, ObjectMapper mapper, Clock clock) {
        this.catalog = catalog; this.checks = checks; this.validator = validator;
        this.completion = completion; this.mapper = mapper; this.clock = clock;
    }

    public Preview prepare(PrepareRequest request) {
        if (request == null || request.profile() == null || request.model() == null
                || !request.model().matches("[A-Za-z0-9_./:-]{1,160}") || request.clientVersion() == null
                || request.clientVersion().length() > 80 || request.files() == null || request.files().isEmpty()
                || request.files().size() > MAX_FILES || request.omissions() == null || request.omissions().size() > 400) {
            throw bad("Niepoprawny profil, model lub zakres plików. Wybierz od 1 do 80 plików.");
        }
        Set<String> paths = new HashSet<>();
        List<FileEvidence> files = new ArrayList<>();
        int total = 0;
        for (InputFile input : request.files()) {
            if (input == null || !StandardizationText.validPath(input.path()) || !paths.add(input.path())
                    || input.content() == null || input.content().contains("\u0000")) throw bad("Niepoprawna lub powtórzona ścieżka albo nietekstowy plik.");
            if (!StandardizationText.analysisPath(input.path())) throw bad(
                    "Analiza obejmuje konfiguracje Copilot i tekstowe materiały w ich katalogach. Manifesty, kod, workflow i dokumentacja projektu są poza zakresem.");
            int size = input.content().getBytes(StandardCharsets.UTF_8).length;
            total += size;
            if (size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw bad("Wybrany pakiet przekracza limit 128 KiB na plik lub 1 MiB łącznie. Zmniejsz zakres.");
            String text = input.content().replace("\r\n", "\n").replace("\r", "\n").replaceFirst("^\uFEFF", "");
            String redacted = StandardizationText.redact(text);
            files.add(new FileEvidence("f" + (files.size() + 1), input.path(), StandardizationText.category(input.path()),
                    redacted, StandardizationText.hash(redacted), redacted.split("\n", -1).length,
                    !redacted.equals(text) || redacted.contains("[UKRYTO]")));
        }
        for (Omission omission : request.omissions()) {
            if (omission == null || !StandardizationText.validPath(omission.path()) || !paths.add(omission.path())
                    || omission.reason() == null || !OMIT_REASONS.contains(omission.reason())) throw bad("Niepoprawna lista pominiętych plików.");
        }
        Set<Category> categories = new HashSet<>();
        files.forEach(file -> categories.add(file.category()));
        List<Rule> rules = catalog.get().rules().stream().filter(rule -> categories.contains(rule.category())).toList();
        if (rules.isEmpty()) throw bad("Wybierz co najmniej jeden plik konfiguracji Copilot. Same materiały pomocnicze nie podlegają tej analizie.");
        var targets = files.stream().flatMap(file -> rules.stream().filter(rule -> rule.category() == file.category())
                .map(rule -> new Target(file.id() + ":" + rule.id(), file.id(), rule.id()))).toList();
        Set<String> sourceIds = new HashSet<>();
        rules.forEach(rule -> sourceIds.addAll(rule.sourceIds()));
        Packet packet = new Packet(VERSION, catalog.get().version(), PROMPT_VERSION, request.profile(),
                request.clientVersion().isBlank() ? "nieznana" : StandardizationText.redact(request.clientVersion()),
                request.model(), request.inventoryComplete(), List.copyOf(files), List.copyOf(request.omissions()),
                files.stream().flatMap(file -> checks.inspect(file, request.profile()).stream()).toList(), rules,
                catalog.get().sources().stream().filter(source -> sourceIds.contains(source.id())).toList(),
                catalog.get().standards().stream().filter(standard -> categories.contains(standard.category())).toList(), targets);
        try {
            String prompt = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(packet);
            Instant expiry = clock.instant().plus(Duration.ofMinutes(15));
            Preview preview = new Preview(UUID.randomUUID().toString(), expiry.toString(),
                    StandardizationText.hash(StandardizationPrompt.SYSTEM + "\n" + prompt), packet, StandardizationPrompt.SYSTEM, prompt);
            synchronized (previews) {
                clean();
                if (previews.size() >= 8) throw bad("Osiągnięto limit podglądów. Usuń poprzedni podgląd lub poczekaj na jego wygaśnięcie.");
                previews.put(preview.id(), new Entry(preview, expiry));
            }
            return preview;
        } catch (IllegalArgumentException failure) { throw failure; }
        catch (Exception failure) { throw new IllegalStateException("Nie udało się przygotować podglądu."); }
    }

    public Result analyze(String id) throws Exception {
        Entry entry = entry(id);
        synchronized (entry) {
            if (entry.result != null) return entry.result;
            if (entry.used || entry.cancelled) throw bad("Ten podgląd został już wykorzystany lub anulowany. Przygotuj nowy.");
            entry.used = true;
            entry.thread = Thread.currentThread();
        }
        try {
            if (entry.cancelled) throw new InterruptedException();
            Preview preview = entry.preview;
            String raw = completion.complete(preview.packet().model(), preview.systemMessage(), preview.prompt());
            if (entry.cancelled) throw new InterruptedException();
            Result result = validator.validate(raw, preview);
            synchronized (entry) {
                if (entry.cancelled) throw new InterruptedException();
                entry.result = result;
            }
            return result;
        } finally { entry.thread = null; }
    }

    public Preview preview(String id) { return entry(id).preview; }

    public void cancel(String id) {
        Entry entry = entry(id);
        synchronized (entry) {
            entry.cancelled = true;
            if (entry.thread != null) entry.thread.interrupt();
        }
    }
    public void discard(String id) {
        synchronized (previews) {
            Entry entry = previews.get(id);
            if (entry != null && entry.thread != null) throw bad("Najpierw anuluj trwającą analizę.");
            previews.remove(id);
        }
    }
    private Entry entry(String id) {
        synchronized (previews) {
            clean();
            Entry entry = previews.get(id);
            if (entry == null) throw bad("Podgląd wygasł lub nie istnieje. Przygotuj go ponownie.");
            return entry;
        }
    }
    private void clean() {
        previews.values().removeIf(entry -> entry.thread == null && !entry.expiry.isAfter(clock.instant()));
    }
    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 60_000)
    public void expirePreviews() {
        synchronized (previews) { clean(); }
    }
    private IllegalArgumentException bad(String message) { return new IllegalArgumentException(message); }
    private static final class Entry {
        final Preview preview;
        final Instant expiry;
        boolean used;
        volatile boolean cancelled;
        volatile Thread thread;
        Result result;
        Entry(Preview preview, Instant expiry) { this.preview = preview; this.expiry = expiry; }
    }
}
