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

    static String redact(String text) {
        String result = TOKENS.matcher(text).replaceAll("[UKRYTO]");
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
