package com.meridian.sentinel.customer;

import com.meridian.sentinel.audit.AuditService;
import com.meridian.sentinel.common.ApiException;
import com.meridian.sentinel.common.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/** Single place that decides whether PII is revealed, and records every reveal in the audit log. */
@Service
public class PiiAccessService {

    private final CustomerRepository customers;
    private final AuditService audit;

    public PiiAccessService(CustomerRepository customers, AuditService audit) {
        this.customers = customers;
        this.audit = audit;
    }

    @Transactional
    public CustomerView detailView(long customerId, String context) {
        Customer c = customers.findById(customerId).orElseThrow(() -> ApiException.notFound("Customer", customerId));
        boolean unmasked = CurrentUser.canSeePii();
        if (unmasked) {
            audit.record("CUSTOMER", c.getExternalRef(), "PII_VIEWED", null, null, Map.of("context", context));
        }
        return CustomerView.of(c, unmasked);
    }
}
