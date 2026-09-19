package com.meridian.sentinel.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.meridian.sentinel.common.GlobalExceptionHandler;
import com.meridian.sentinel.common.Roles;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

import java.io.IOException;
import java.util.List;

/**
 * HTTP Basic, stateless. Role checks are enforced here (coarse, per URL) and again with {@code @PreAuthorize}
 * on each controller method, so the UI is never the only line of defence.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private static final String[] PUBLIC = {"/actuator/health", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html"};

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, ObjectMapper mapper) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(PUBLIC).permitAll()
                        .requestMatchers("/api/v1/ingest/**", "/api/v1/detection/**").hasRole(Roles.ADMIN)
                        .requestMatchers(HttpMethod.POST, "/api/v1/transactions").hasRole(Roles.ADMIN)
                        .requestMatchers(HttpMethod.GET, "/api/v1/rules/**", "/api/v1/watchlist/**", "/api/v1/fx-rates/**")
                        .hasRole(Roles.ANALYST)
                        .requestMatchers("/api/v1/rules/**", "/api/v1/watchlist/**", "/api/v1/fx-rates/**").hasRole(Roles.ADMIN)
                        .requestMatchers("/api/v1/**").hasRole(Roles.ANALYST)
                        .anyRequest().denyAll())
                .httpBasic(basic -> basic.authenticationEntryPoint((req, res, ex) ->
                        writeError(res, mapper, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Authentication required", req.getRequestURI())))
                .exceptionHandling(eh -> eh
                        .authenticationEntryPoint((req, res, ex) ->
                                writeError(res, mapper, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Authentication required", req.getRequestURI()))
                        .accessDeniedHandler((req, res, ex) ->
                                writeError(res, mapper, HttpStatus.FORBIDDEN, "FORBIDDEN", "You do not have permission to perform this action", req.getRequestURI())));
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /** Users come from environment variables; startup fails fast if a password is missing. */
    @Bean
    UserDetailsService userDetailsService(SentinelProperties props, PasswordEncoder encoder) {
        List<UserDetails> users = props.users().stream().map(u -> {
            if (u.password() == null || u.password().isBlank()) {
                throw new IllegalStateException("Password for user '" + u.username()
                        + "' is not configured; set the corresponding SENTINEL_*_PASSWORD environment variable");
            }
            return User.withUsername(u.username())
                    .password(encoder.encode(u.password()))
                    .roles(u.roles().toArray(String[]::new))
                    .build();
        }).toList();
        return new InMemoryUserDetailsManager(users);
    }

    private static void writeError(HttpServletResponse res, ObjectMapper mapper, HttpStatus status, String code,
                                   String message, String path) throws IOException {
        res.setStatus(status.value());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(res.getOutputStream(), GlobalExceptionHandler.body(status, code, message, path));
    }
}
