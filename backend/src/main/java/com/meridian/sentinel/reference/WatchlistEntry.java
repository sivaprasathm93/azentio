package com.meridian.sentinel.reference;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "watchlist_entry")
@Getter
@Setter
public class WatchlistEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "entry_type")
    private String entryType;

    private String value;

    @Column(name = "list_name")
    private String listName;

    private String reason;

    private boolean active;

    @Column(name = "updated_at")
    private Instant updatedAt;
}
