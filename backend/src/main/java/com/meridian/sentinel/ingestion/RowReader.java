package com.meridian.sentinel.ingestion;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.meridian.sentinel.common.ApiException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Turns raw JSON objects or CSV rows into typed, validated records. Malformed rows become {@link Row#error()}
 * instead of failing the batch, so one bad record never blocks the rest.
 */
@Component
public class RowReader {

    private final ObjectMapper mapper;
    private final Validator validator;

    public RowReader(ObjectMapper mapper, Validator validator) {
        this.mapper = mapper;
        this.validator = validator;
    }

    public record Row<T>(int line, String raw, T value, String error) {

        public boolean ok() {
            return error == null;
        }
    }

    public <T> List<Row<T>> fromJson(List<Map<String, Object>> items, Class<T> type) {
        List<Row<T>> rows = new ArrayList<>(items.size());
        for (int i = 0; i < items.size(); i++) {
            Map<String, Object> item = items.get(i);
            rows.add(convert(i + 1, item, item == null ? null : item.toString(), type));
        }
        return rows;
    }

    public <T> List<Row<T>> fromCsv(InputStream in, Class<T> type) {
        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setHeader().setSkipHeaderRecord(true).setTrim(true).setIgnoreEmptyLines(true).build();
        try (CSVParser parser = CSVParser.parse(new InputStreamReader(in, StandardCharsets.UTF_8), format)) {
            List<String> headers = parser.getHeaderNames();
            List<Row<T>> rows = new ArrayList<>();
            for (CSVRecord rec : parser) {
                int line = (int) rec.getRecordNumber() + 1; // +1 for the header line
                String raw = String.join(",", rec.toList());
                if (!rec.isConsistent()) {
                    rows.add(new Row<>(line, raw, null, "expected " + headers.size() + " columns but found " + rec.size()));
                    continue;
                }
                Map<String, Object> map = new LinkedHashMap<>();
                for (String h : headers) {
                    String v = rec.get(h);
                    map.put(camel(h), v == null || v.isBlank() ? null : v);
                }
                rows.add(convert(line, map, raw, type));
            }
            return rows;
        } catch (IOException | java.io.UncheckedIOException | IllegalArgumentException e) {
            throw ApiException.badRequest("MALFORMED_CSV", "CSV could not be parsed: " + e.getMessage());
        }
    }

    private <T> Row<T> convert(int line, Map<String, Object> item, String raw, Class<T> type) {
        if (item == null) {
            return new Row<>(line, raw, null, "record is null");
        }
        T value;
        try {
            value = mapper.convertValue(item, type);
        } catch (IllegalArgumentException e) {
            return new Row<>(line, raw, null, describe(e));
        }
        Set<ConstraintViolation<T>> violations = validator.validate(value);
        if (!violations.isEmpty()) {
            String msg = violations.stream().map(v -> v.getPropertyPath() + " " + v.getMessage())
                    .sorted().collect(Collectors.joining("; "));
            return new Row<>(line, raw, value, msg);
        }
        return new Row<>(line, raw, value, null);
    }

    private static String describe(IllegalArgumentException e) {
        if (e.getCause() instanceof InvalidFormatException ife && !ife.getPath().isEmpty()) {
            return ife.getPath().get(ife.getPath().size() - 1).getFieldName() + " has invalid value '" + ife.getValue() + "'";
        }
        if (e.getCause() instanceof MismatchedInputException mie && !mie.getPath().isEmpty()) {
            return mie.getPath().get(mie.getPath().size() - 1).getFieldName() + " has an invalid format";
        }
        String m = e.getMessage() == null ? "unreadable record" : e.getMessage();
        return m.length() > 300 ? m.substring(0, 300) : m;
    }

    /** Accepts both camelCase and snake_case CSV headers. */
    static String camel(String header) {
        String h = header.trim().replace("﻿", "");
        if (!h.contains("_")) {
            return h;
        }
        StringBuilder sb = new StringBuilder();
        boolean upper = false;
        for (char c : h.toLowerCase().toCharArray()) {
            if (c == '_') {
                upper = true;
            } else {
                sb.append(upper ? Character.toUpperCase(c) : c);
                upper = false;
            }
        }
        return sb.toString();
    }
}
