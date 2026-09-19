package com.meridian.sentinel.casemgmt;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CaseNoteRepository extends JpaRepository<CaseNote, Long> {

    List<CaseNote> findByCaseIdOrderByCreatedAtAsc(Long caseId);
}
