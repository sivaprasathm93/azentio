package com.meridian.sentinel.ingestion;

import com.meridian.sentinel.detection.BulkDetectionRunner;

import java.util.List;
import java.util.UUID;

/** Batch outcome: nothing is silently dropped — every received record is accepted, a duplicate, or rejected. */
public record IngestionResult(UUID batchId, String recordType, int received, int accepted, int duplicates, int rejected,
                              List<RowError> errors, boolean errorsTruncated, long ingestMs,
                              BulkDetectionRunner.Summary detection) {

    public record RowError(Integer line, String key, String error) {
    }
}
