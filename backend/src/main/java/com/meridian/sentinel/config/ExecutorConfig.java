package com.meridian.sentinel.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

@Configuration
public class ExecutorConfig {

    /** Bounded pool used by bulk detection; work is partitioned by customer so each customer is handled by one task. */
    @Bean(destroyMethod = "shutdown")
    ExecutorService detectionExecutor(SentinelProperties props) {
        AtomicInteger n = new AtomicInteger();
        ThreadFactory tf = r -> {
            Thread t = new Thread(r, "detection-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        };
        return Executors.newFixedThreadPool(Math.max(1, props.detection().threads()), tf);
    }
}
