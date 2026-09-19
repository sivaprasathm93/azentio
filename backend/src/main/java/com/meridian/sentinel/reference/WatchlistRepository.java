package com.meridian.sentinel.reference;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WatchlistRepository extends JpaRepository<WatchlistEntry, Long> {

    List<WatchlistEntry> findAllByOrderByEntryTypeAscValueAsc();

    Optional<WatchlistEntry> findByEntryTypeAndValue(String entryType, String value);
}
