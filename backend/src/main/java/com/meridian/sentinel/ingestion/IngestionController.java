package com.meridian.sentinel.ingestion;

import com.meridian.sentinel.common.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "Ingestion", description = "Bulk (JSON/CSV) and streaming ingestion of KYC, account and transaction data")
@PreAuthorize("hasRole('ADMIN')")
public class IngestionController {

    private final IngestionService service;
    private final RowReader reader;

    public IngestionController(IngestionService service, RowReader reader) {
        this.service = service;
        this.reader = reader;
    }

    @PostMapping(value = "/ingest/customers", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Bulk upsert customers (KYC) from a JSON array; invalid rows are rejected individually")
    public IngestionResult customers(@RequestBody @ArraySchema(schema = @Schema(implementation = CustomerRecord.class))
                                     List<Map<String, Object>> body) {
        return service.ingestCustomers(reader.fromJson(body, CustomerRecord.class), "json");
    }

    @PostMapping(value = "/ingest/customers/csv", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Bulk upsert customers from CSV (header row; camelCase or snake_case columns)")
    public IngestionResult customersCsv(@RequestPart("file") MultipartFile file) {
        return service.ingestCustomers(reader.fromCsv(open(file), CustomerRecord.class), "csv:" + file.getOriginalFilename());
    }

    @PostMapping(value = "/ingest/accounts", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Bulk upsert accounts from a JSON array; customerRef must already exist")
    public IngestionResult accounts(@RequestBody @ArraySchema(schema = @Schema(implementation = AccountRecord.class))
                                    List<Map<String, Object>> body) {
        return service.ingestAccounts(reader.fromJson(body, AccountRecord.class), "json");
    }

    @PostMapping(value = "/ingest/accounts/csv", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Bulk upsert accounts from CSV")
    public IngestionResult accountsCsv(@RequestPart("file") MultipartFile file) {
        return service.ingestAccounts(reader.fromCsv(open(file), AccountRecord.class), "csv:" + file.getOriginalFilename());
    }

    @PostMapping(value = "/ingest/transactions", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Bulk load transactions from a JSON array, then run detection in parallel (detect=false to skip)")
    public IngestionResult transactions(@RequestBody @ArraySchema(schema = @Schema(implementation = TransactionRecord.class))
                                        List<Map<String, Object>> body,
                                        @RequestParam(defaultValue = "true") boolean detect) {
        return service.ingestTransactions(reader.fromJson(body, TransactionRecord.class), "json", detect);
    }

    @PostMapping(value = "/ingest/transactions/csv", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Bulk load transactions from CSV, then run detection in parallel (detect=false to skip)")
    public IngestionResult transactionsCsv(@RequestPart("file") MultipartFile file,
                                           @RequestParam(defaultValue = "true") boolean detect) {
        return service.ingestTransactions(reader.fromCsv(open(file), TransactionRecord.class),
                "csv:" + file.getOriginalFilename(), detect);
    }

    @PostMapping(value = "/transactions", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Streaming ingestion of a single transaction; evaluated synchronously and returns any alert raised",
            description = "400 invalid payload, 409 duplicate txnRef, 422 unknown account / unsupported currency")
    public IngestionService.StreamResult stream(@Valid @RequestBody TransactionRecord record) {
        return service.ingestOne(record);
    }

    @GetMapping("/ingest/batches")
    @Operation(summary = "Recent ingestion batches (from the audit log)")
    public List<Map<String, Object>> batches() {
        return service.recentBatches();
    }

    @GetMapping("/ingest/batches/{batchId}/errors")
    @Operation(summary = "Rejected rows of a batch with the reason for each")
    public List<Map<String, Object>> errors(@PathVariable UUID batchId) {
        return service.errors(batchId);
    }

    private static InputStream open(MultipartFile file) {
        if (file.isEmpty()) {
            throw ApiException.badRequest("EMPTY_FILE", "Uploaded file is empty");
        }
        try {
            return file.getInputStream();
        } catch (IOException e) {
            throw ApiException.badRequest("UNREADABLE_FILE", "Uploaded file could not be read");
        }
    }
}
