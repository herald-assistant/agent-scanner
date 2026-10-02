package dev.agentscanner.standardization;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import static dev.agentscanner.standardization.Standardization.Category;

final class StandardizationText {
    private StandardizationText() {}
    private static final Set<String> EXCLUDED_DIRECTORIES = Set.of(".git", "node_modules", "target", "dist",
            "build", ".next", ".angular", ".venv", "venv", "vendor", "coverage");
    private static final Pattern TOKENS = Pattern.compile("\\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{20,})\\b");
    private static final Pattern BEARER = Pattern.compile("(?i)\\bBearer\\s+(?!\\[UKRYTO])([A-Za-z0-9._~+/=-]{12,})");
    private static final Pattern ASSIGNMENT = Pattern.compile("(?i)([\"']?(?:[\\w.-]*(?:token|password|secret|api[_-]?key|authorization))[\"']?\\s*[:=]\\s*[\"']?)([^\\s,\"';}]+)");
    private static final Pattern PRIVATE_KEY = Pattern.compile("-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\\s\\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----");
    private static final Pattern URL_CREDENTIALS = Pattern.compile("(?i)([a-z]+://)[^/\\s\"'@]+@");
    private static final Pattern XML_SECRET = Pattern.compile("(?i)(\\bname=[\"'][^\"']*(?:token|password|secret|api[_-]?key|authorization)[^\"']*[\"'][^>]*\\bvalue=[\"'])([^\"']+)([\"'])");
    private static final Pattern XML_SECRET_REVERSED = Pattern.compile("(?i)(\\bvalue=[\"'])([^\"']+)([\"'][^>]*\\bname=[\"'][^\"']*(?:token|password|secret|api[_-]?key|authorization)[^\"']*[\"'])");
    private static final Pattern AI_COMPONENT = Pattern.compile("(?i)<component\\b[^>]*\\bname=[\"'][^\"']*(?:aiassistant|github[-_.]?copilot|junie)[^\"']*[\"'][^>]*(?:/>|>[\\s\\S]*?</component>)");

    static String redact(String text) {
        String result = TOKENS.matcher(text).replaceAll("[UKRYTO]");
        result = URL_CREDENTIALS.matcher(result).replaceAll("$1[UKRYTO]@");
        result = XML_SECRET.matcher(result).replaceAll("$1[UKRYTO]$3");
        result = XML_SECRET_REVERSED.matcher(result).replaceAll("$1[UKRYTO]$3");
        result = BEARER.matcher(result).replaceAll("Bearer [UKRYTO]");
        result = PRIVATE_KEY.matcher(result).replaceAll(match ->
                String.join("\n", java.util.Collections.nCopies(match.group().split("\n", -1).length, "[UKRYTO]")));
        return ASSIGNMENT.matcher(result).replaceAll(match -> {
            String value = match.group(2);
            if (value.startsWith("$") || value.startsWith("[") || value.equals("null")
                    || value.equals("true") || value.equals("false") || value.length() < 6) return java.util.regex.Matcher.quoteReplacement(match.group());
            return java.util.regex.Matcher.quoteReplacement(match.group(1) + "[UKRYTO]");
        });
    }

    static String hash(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) { throw new IllegalStateException("Brak SHA-256.", failure); }
    }

    static boolean validPath(String path) {
        if (path == null || path.isBlank() || path.length() > 500 || path.startsWith("/")
                || path.contains("\\") || path.contains(":") || path.chars().anyMatch(c -> c < 32)) return false;
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.equalsIgnoreCase(".git")) return false;
        }
        return true;
    }

    static boolean analysisPath(String path) {
        if (!validPath(path)) return false;
        String lower = path.toLowerCase(Locale.ROOT);
        for (String part : lower.split("/")) {
            if (EXCLUDED_DIRECTORIES.contains(part) || part.equals(".env") || part.startsWith(".env.")) return false;
        }
        return category(path) != Category.CONTEXT || lower.matches(
                "\\.(?:github/(?:instructions|skills|agents|prompts)|claude/(?:skills|agents)|agents/skills)/.+\\.(?:md|txt)");
    }

    static boolean reportPath(String path) {
        if (!validPath(path)) return false;
        String lower = path.toLowerCase(Locale.ROOT);
        return lower.matches("\\.vscode/(?:settings|extensions)\\.json") || lower.matches("[^/]+\\.code-workspace")
                || lower.matches("\\.aiassistant/rules/.+\\.md") || Set.of(".aiignore", ".noai").contains(lower)
                || lower.matches("\\.idea/[^/]+\\.xml");
    }

    static String reportContent(String path, String content) {
        if (!path.toLowerCase(Locale.ROOT).startsWith(".idea/")) return content;
        return AI_COMPONENT.matcher(content).results().map(java.util.regex.MatchResult::group)
                .collect(java.util.stream.Collectors.joining("\n"));
    }

    static String safeRemote(String remote) {
        if (remote == null || remote.isBlank()) return null;
        if (remote.length() > 2000 || remote.chars().anyMatch(Character::isISOControl)) throw new IllegalArgumentException("Niepoprawne metadane Git.");
        try {
            var uri = java.net.URI.create(remote);
            if (uri.getScheme() != null && Set.of("http", "https", "ssh", "git").contains(uri.getScheme().toLowerCase(Locale.ROOT)) && uri.getHost() != null) {
                return redact(new java.net.URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), uri.getPath(), null, null).toString());
            }
        } catch (Exception ignored) { }
        var scp = Pattern.compile("(?i)^(?:[^@/\\s]+@)?([a-z\\d.-]+):([^?#\\s]+)$").matcher(remote);
        return scp.matches() ? redact(scp.group(1) + ":" + scp.group(2)) : null;
    }

    static Category category(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.matches("(?:.*/)?(?:agents|claude|gemini)\\.md")
                || lower.equals(".github/copilot-instructions.md") || lower.equals(".claude/claude.md")
                || lower.matches("\\.github/instructions/.+\\.instructions\\.md")) return Category.INSTRUCTIONS;
        if (lower.matches("\\.(github|claude|agents)/skills/[^/]+/skill\\.md")) return Category.SKILLS;
        if (lower.matches("\\.(github|claude)/agents/[^/]+\\.md")) return Category.AGENTS;
        if (lower.equals(".vscode/mcp.json") || lower.equals(".github/mcp.json") || lower.equals(".mcp.json")) return Category.MCP;
        if (lower.matches("\\.github/prompts/.+\\.prompt\\.md")) return Category.PROMPTS;
        return Category.CONTEXT;
    }
}
