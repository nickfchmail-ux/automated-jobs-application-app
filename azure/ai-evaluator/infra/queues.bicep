// ============================================================
//  AI Evaluator — Storage Queues (NO Service Bus — FREE path)
//
//  Migration (2026-08-28, mandated): Service Bus (~$10/mo) →
//  Azure Storage Queues ($0). The evaluator's queues
//  (`evaluation-requests`, `resume-requests`,
//  `cover-letter-requests`) now live in the Function App's host
//  storage account (`AzureWebJobsStorage`) and are AUTO-CREATED
//  by the Functions runtime on first use — NO provisioning needed.
//
//  This file is intentionally a no-op placeholder so existing
//  deployment scripts that reference it keep working. There is
//  nothing to deploy for Storage Queues.
// ============================================================

// Intentionally empty — Storage Queues are auto-created by the Functions
// runtime inside the existing `AzureWebJobsStorage` account. No Service Bus
// namespace, no queues resource, no RBAC needed.
