package com.meridian.sentinel.detection;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/detection")
@Tag(name = "Detection", description = "Operational controls for the detection engine")
@PreAuthorize("hasRole('ADMIN')")
public class DetectionController {

    private final BulkDetectionRunner runner;

    public DetectionController(BulkDetectionRunner runner) {
        this.runner = runner;
    }

    @PostMapping("/run-pending")
    @Operation(summary = "Evaluate every transaction not yet evaluated (loaded with detect=false, or after a failure)")
    public BulkDetectionRunner.Summary runPending() {
        return runner.runPending();
    }
}
