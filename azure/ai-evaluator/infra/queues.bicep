// ============================================================
//  AI Evaluator — Service Bus queues (queues.bicep)
//
//  The evaluator shares the scraper's Service Bus namespace
//  (`jobsautomation-sbns`) and adds TWO independent queues, one
//  per document concern (each scales + retries on its own):
//
//    - `resume-requests`        → resumeWorker    (tailored resume)
//    - `cover-letter-requests`  → coverLetterWorker (cover letter)
//
//  (`evaluation-requests` already exists on the namespace and is
//  not recreated here — Bicep is additive/idempotent.)
//
//  Deploy (from azure/ai-evaluator):
//    az deployment group create \
//      --resource-group jobsautomation-rg \
//      --template-file infra/queues.bicep \
//      --parameters serviceBusNamespaceName=jobsautomation-sbns
// ============================================================

param serviceBusNamespaceName string = 'jobsautomation-sbns'

// ── Reference the EXISTING Service Bus namespace (don't recreate) ──
resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' existing = {
  name: serviceBusNamespaceName
}

// ── Tailored resume generation (independent of evaluation) ───
resource resumeQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  name: 'resume-requests'
  parent: serviceBusNamespace
  properties: {
    maxSizeInMegabytes: 1024
    defaultMessageTimeToLive: 'P2D'
    maxDeliveryCount: 5
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    deadLetteringOnMessageExpiration: true
    enablePartitioning: true
    lockDuration: 'PT5M' // resume HTML generation can be slow
  }
}

// ── Cover letter generation (independent of evaluation) ──────
resource coverLetterQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  name: 'cover-letter-requests'
  parent: serviceBusNamespace
  properties: {
    maxSizeInMegabytes: 1024
    defaultMessageTimeToLive: 'P2D'
    maxDeliveryCount: 5
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    deadLetteringOnMessageExpiration: true
    enablePartitioning: true
    lockDuration: 'PT5M'
  }
}

// ── Outputs ──────────────────────────────────────────────────
output serviceBusNamespaceName_out string = serviceBusNamespaceName
