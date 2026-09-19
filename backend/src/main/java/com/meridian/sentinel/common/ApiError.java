package com.meridian.sentinel.common;

import java.time.Instant;
import java.util.List;

/** Uniform error body returned by every endpoint. */
public record ApiError(Instant timestamp, int status, String error, String code, String message, String path,
                       List<FieldError> fieldErrors) {

    public record FieldError(String field, String message) {
    }
}
