<!-- PROTECTED FILE -->
<!-- NOTE: The heartbeat EXECUTION ORDER is hardcoded in orchestrator.js for security. -->
<!-- This file configures THRESHOLDS and SCHEDULES only. -->

# Sneebly Heartbeat Configuration

## Budget
- Max API spend per heartbeat: $1.50 (stop processing if exceeded)
- Budget warning threshold: $1.00 (log a warning)

## Schedules
- Error triage: every heartbeat
- Performance check: every heartbeat
- Approved queue: every heartbeat
- Codebase analysis: weekly, Mondays
- Self-improvement: weekly, Fridays

## Thresholds
- Performance degradation alert: >20% increase in p95 response time
- Error escalation: 3+ occurrences of same error
- Health check timeout: 10 seconds

## Notes
The execution order (security check → health → errors → performance → queue → weekly tasks) is hardcoded in the orchestrator for safety. This file controls the configurable parameters that the orchestrator reads — not the order of execution.
