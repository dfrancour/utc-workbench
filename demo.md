# --- Deploy Pipeline ---
# Label: deploy
# URL: https://github.com/acme/payment-svc/actions/runs/11842903455

2026-04-06T14:32:01Z deploy/pipeline: Release v2.41.0 rolled out to payment-svc (3/3 pods healthy)
2026-04-06T14:32:01Z deploy/pipeline: Image: ghcr.io/acme/payment-svc:v2.41.0 sha256:a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890
2026-04-06T14:32:03Z deploy/pipeline: Canary check passed — error rate 0.02%, latency p99 180ms

# --- Kernel / syslog ---
# Label: kernel

Apr  6 14:35:17 payment-svc-7b9d kernel: [483921.332] TCP: request_sock_TCP: Possible SYN flooding on port 443. Sending cookies.
Apr  6 14:35:17 payment-svc-7b9d kernel: [483921.335] nf_conntrack: table full, dropping packet
Apr  6 14:36:02 payment-svc-7b9d kernel: [483966.118] Out of memory: Killed process 4421 (java) total-vm:8145920kB, anon-rss:7926784kB

# --- Application logs ---
# Label: payment-svc
# URL: https://grafana.internal/explore?orgId=1&left=%7B%22datasource%22:%22loki-prod%22%7D

2026-04-06T14:34:48.221Z payment-svc app[web]: warn - Connection pool exhaustion imminent: 14/15 active, 23 pending
2026-04-06T14:35:55.003Z payment-svc app[web]: error - Failed to acquire DB connection after 5000ms: pool timeout [txn_id=a8f3e691]
2026-04-06T14:36:11.447Z payment-svc app[web]: error - Unhandled rejection in ChargeProcessor.execute: ECONNREFUSED 10.0.7.12:5432 [trace_id=0af7651916cd43dd8448eb211c80319c]
2026-04-06T14:37:30.882Z payment-svc app[web]: fatal - Circuit breaker OPEN for downstream payments-db after 50 consecutive failures

# --- Nginx access logs ---
# Label: nginx

2026-04-06T14:36:22.104Z nginx: 10.0.3.44 - - [06/Apr/2026:14:36:22 +0000] "POST /v1/charges HTTP/1.1" 504 0 "-" "AcmeCheckout/3.1.0" rt=30.001 upstream_response_time=-
2026-04-06T14:37:45.991Z nginx: 10.0.3.44 - - [06/Apr/2026:14:37:45 +0000] "POST /v1/charges HTTP/1.1" 503 142 "-" "AcmeCheckout/3.1.0" rt=0.001 upstream_response_time=-
2026-04-06T14:39:55.882Z nginx: 10.0.3.22 - - [06/Apr/2026:14:39:55 +0000] "GET /healthz HTTP/1.1" 503 24 "-" "kube-probe/1.28" rt=0.000

# --- Alertmanager ---
# Label: alertmanager
# URL: https://alertmanager.internal/#/alerts?filter=payment

1775831743 alertmanager: FIRING - PaymentLatencyP99 > 2000ms for payment-svc (cluster=prod-us-east, severity=critical, runbook=https://wiki.internal/runbooks/payment-latency)
1775831880 alertmanager: FIRING - PaymentErrorRate > 5% for payment-svc (cluster=prod-us-east, severity=critical, current=34.7%)
1775832195 alertmanager: RESOLVED - PaymentErrorRate for payment-svc (cluster=prod-us-east, duration=5m15s)

# --- PagerDuty ---
# Label: pagerduty
# URL: https://acme.pagerduty.com/incidents/P8842XYZ

Mon, 06 Apr 2026 14:38:02 +0000 pagerduty: Incident #8842 triggered — "Payment API 5xx spike" assigned to oncall@acme.example via escalation policy "payments-critical"
Mon, 06 Apr 2026 14:38:45 +0000 pagerduty: Incident #8842 acknowledged by alice@acme.example
Mon, 06 Apr 2026 14:45:08 +0000 pagerduty: Incident #8842 resolved by alice@acme.example (TTR: 7m06s)

# --- Slack ---
# Label: slack
# URL: https://acme.slack.com/archives/C04INCIDENTS/p1775832083

04/06/2026 10:41:23 AM EDT #support — @alice: "Customers reporting checkout failures — payments not going through, getting generic error page"
04/06/2026 10:42:55 AM EDT #incidents — @bob: "Confirmed. payment-svc circuit breaker is open. Rolling back v2.41.0 now."
04/06/2026 10:46:30 AM EDT #incidents — @alice: "Rollback complete. Error rates nominal. Monitoring for 15 min before closing."

# --- Deploy Pipeline (rollback) ---
# Label: deploy
# URL: https://github.com/acme/payment-svc/actions/runs/11842951002

2026-04-06T14:42:10Z deploy/pipeline: Rollback initiated for payment-svc v2.41.0 → v2.40.9 by alice
2026-04-06T14:43:25Z deploy/pipeline: Image: ghcr.io/acme/payment-svc:v2.40.9 sha256:e5f6a7b8c9d01234567890abcdef1234567890abcdef1234567890abcdef1234
2026-04-06T14:43:28Z deploy/pipeline: All 3/3 pods healthy. Canary check passed — error rate 0.1%, latency p99 95ms

# --- Datadog ---
# Label: datadog
# URL: https://app.datadoghq.com/apm/traces?query=service:payment-svc

1775832195123 datadog: payment-svc error rate dropped below 1% threshold (current: 0.8%)
1775832310456 datadog: payment-svc p99 latency recovered to baseline (current: 92ms, baseline: 88ms)
