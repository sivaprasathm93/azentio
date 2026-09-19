package com.meridian.sentinel.ingestion;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.ingestion.RowReader.Row;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RowReaderTest {

    private final RowReader reader = new RowReader(new ObjectMapper().registerModule(new JavaTimeModule()),
            Validation.buildDefaultValidatorFactory().getValidator());

    private List<Row<TransactionRecord>> csv(String content) {
        return reader.fromCsv(new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8)), TransactionRecord.class);
    }

    @Test
    void parsesValidRowsAndRejectsMalformedOnesIndividually() {
        List<Row<TransactionRecord>> rows = csv("""
                txn_ref,account_number,direction,amount,currency,counterparty_name,counterparty_account,counterparty_country,channel,jurisdiction,occurred_at
                T1,ACC1,CREDIT,9500.00,USD,Alpha,,AE,SWIFT,AE,2026-06-01T10:00:00Z
                T2,ACC1,SIDEWAYS,100,INR,,,,UPI,,2026-06-01T10:00:00Z
                T3,ACC1,DEBIT,abc,INR,,,,UPI,,2026-06-01T10:00:00Z
                T4,ACC1,DEBIT,-5,INR,,,,UPI,,2026-06-01T10:00:00Z
                T5,ACC1,DEBIT,5,INR,,,,UPI,,not-a-date
                T6,ACC1,DEBIT
                """);

        assertThat(rows).hasSize(6);
        assertThat(rows.get(0).ok()).isTrue();
        assertThat(rows.get(0).value().amount()).isEqualByComparingTo("9500");
        assertThat(rows.get(0).value().counterpartyAccount()).isNull();
        assertThat(rows.get(1).error()).contains("direction");
        assertThat(rows.get(2).error()).contains("amount");
        assertThat(rows.get(3).error()).contains("amount");
        assertThat(rows.get(4).error()).contains("occurredAt");
        assertThat(rows.get(5).error()).contains("columns");
        assertThat(rows).extracting(Row::line).containsExactly(2, 3, 4, 5, 6, 7);
    }

    @Test
    void jsonRowsGetTheSameValidation() {
        List<Row<CustomerRecord>> rows = reader.fromJson(List.of(
                Map.of("externalRef", "C1", "fullName", "Test One", "nationalId", "X1", "customerType", "RETAIL",
                        "country", "IN", "kycRiskRating", "LOW"),
                Map.of("externalRef", "C2", "fullName", "Test Two", "nationalId", "X2", "customerType", "ALIEN",
                        "country", "India", "kycRiskRating", "LOW")), CustomerRecord.class);

        assertThat(rows.get(0).ok()).isTrue();
        assertThat(rows.get(1).error()).contains("customerType", "country");
    }

    @Test
    void unparseableFileIsABadRequest() {
        assertThatThrownBy(() -> csv("a,b\n\"unterminated,1\n")).isInstanceOf(ApiException.class);
    }

    @Test
    void headersMayBeSnakeCase() {
        assertThat(RowReader.camel("counterparty_country")).isEqualTo("counterpartyCountry");
        assertThat(RowReader.camel("txnRef")).isEqualTo("txnRef");
    }
}
