package com.meridian.sentinel.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI sentinelOpenApi() {
        return new OpenAPI()
                .info(new Info().title("Sentinel AML API").version("v1")
                        .description("Transaction monitoring: ingestion, rule-based detection, alerts and case management. "
                                + "Roles: ANALYST (queue & disposition), SUPERVISOR (+ full PII, case closure, reopen), "
                                + "ADMIN (+ ingestion, rule/watchlist/FX configuration)."))
                .components(new Components().addSecuritySchemes("basic",
                        new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("basic")))
                .addSecurityItem(new SecurityRequirement().addList("basic"));
    }
}
