package com.meridian.sentinel.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PiiMaskerTest {

    @Test
    void masksEveryNamePartKeepingInitials() {
        assertThat(PiiMasker.maskName("Aarav Mehta")).isEqualTo("A**** M****");
        assertThat(PiiMasker.maskName("Li")).isEqualTo("L***");
        assertThat(PiiMasker.maskName(null)).isNull();
    }

    @Test
    void keepsOnlyTheLastCharactersOfIdentifiers() {
        assertThat(PiiMasker.maskId("ABCPM1234K")).isEqualTo("******234K");
        assertThat(PiiMasker.maskId("123")).isEqualTo("**3");
    }
}
