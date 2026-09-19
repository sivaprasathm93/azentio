package com.meridian.sentinel.casemgmt;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;

public interface CaseRepository extends JpaRepository<AmlCase, Long> {

    Page<AmlCase> findByStatusIn(Collection<CaseStatus> statuses, Pageable pageable);
}
