package com.meridian.sentinel.common;

/** Masks personally identifiable information for list views and unprivileged roles (Business Rule 8). */
public final class PiiMasker {

    private PiiMasker() {
    }

    /** "Aarav Mehta" -> "A**** M****". */
    public static String maskName(String name) {
        if (name == null || name.isBlank()) {
            return name;
        }
        StringBuilder sb = new StringBuilder();
        for (String part : name.trim().split("\\s+")) {
            if (!sb.isEmpty()) {
                sb.append(' ');
            }
            sb.append(part.charAt(0)).append("*".repeat(Math.max(3, part.length() - 1)));
        }
        return sb.toString();
    }

    /** Keeps only the last four characters: "ABCPM1234K" -> "******234K". */
    public static String maskId(String id) {
        if (id == null || id.isBlank()) {
            return id;
        }
        int keep = Math.min(4, id.length() / 2);
        return "*".repeat(id.length() - keep) + id.substring(id.length() - keep);
    }
}
