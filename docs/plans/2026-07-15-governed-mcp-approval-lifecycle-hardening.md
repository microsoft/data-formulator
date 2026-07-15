# Governed MCP Approval Lifecycle Hardening Implementation Plan

**Goal:** Complete the locally testable approval lifecycle by adding owner-bound
denial and proving terminal, replay-safe behavior under confirmation/denial
races and upstream failure.

**Architecture:** Keep approval state inside the gateway process and address it
only by the authenticated caller subject plus caller-owned operation ID. Extend
the existing coordinator with an atomic denial transition, expose a bodyless
gateway-only denial route, and retain consume-before-execute semantics so an
upstream failure cannot replay an approved action. Do not add live identity,
startup composition, browser-supplied approval IDs, or an arbitrary expiry
duration.

**Tech Stack:** Python, FastMCP, Starlette, HTTPX ASGI transport, pytest.

**Status:** Complete locally. Pending-approval expiry remains an open product
and topology decision.

---

## Current Context

- `McpApprovalGate` already supports pending, approved, denied, and consumed
  states under a lock.
- `McpGatewayApprovalCoordinator` stores immutable requests by
  `(caller_subject, operation_id)` and consumes/deletes a request before the
  upstream call.
- `POST /approvals/{operation_id}/confirm` accepts no request body and maps
  missing, mismatched, or consumed approvals to the same sanitized response.
- The product client surfaces approval but never confirms or retries it.
- Tenant consent, token acquisition, production startup, and live upstream
  validation remain blocked and are outside this increment.

## Scope Decisions

- Add an explicit denial operation owned by the same authenticated subject.
- Return the same generic authorization failure for unknown, already-decided,
  or other-subject operation IDs to avoid state enumeration.
- Keep approval decisions terminal. A failed upstream call after confirmation
  requires a new product operation and new approval.
- Do not implement time-based expiry until the product defines the pending
  approval TTL and expired-state UX. This is a specific open decision, not an
  implementation omission.

## Task 1: Add Atomic Coordinator Denial

**Objective:** Let the owner deny one pending operation without invoking the
upstream client and without exposing the internal approval ID.

**Files:**

- Modify: `tests/backend/mcp/test_gateway_service.py`
- Modify: `py-src/data_formulator/mcp_gateway/service.py`

**Step 1: Write failing coordinator tests**

Add tests proving:

- the requesting subject can deny a pending operation;
- denial removes the pending operation without constructing an upstream client;
- confirmation and repeated denial after denial both raise
  `McpApprovalRequiredError`;
- a different subject cannot deny the operation and does not affect the
  owner's pending request.

The intended public method is:

```python
def deny(
    self,
    *,
    caller_subject: str,
    operation_id: str,
) -> None:
    ...
```

**Step 2: Verify RED**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest `
  tests\backend\mcp\test_gateway_service.py `
  -k "deny" -q
```

Expected: FAIL because `McpGatewayApprovalCoordinator.deny` does not exist.

**Step 3: Implement the minimal denial transition**

Under the coordinator lock:

1. Resolve only `(caller_subject, operation_id)`.
2. Call `McpApprovalGate.deny()` with the internal approval ID.
3. Raise the existing sanitized `McpApprovalRequiredError` when either lookup
   or transition fails.
4. Delete the pending record only after the gate transition succeeds.
5. Never construct or call an upstream client.

**Step 4: Verify GREEN**

Re-run the focused command. Expected: all selected denial tests pass.

## Task 2: Expose a Bodyless Owner-Bound Denial Route

**Objective:** Add a gateway-only route that denies exactly one operation owned
by the authenticated caller.

**Files:**

- Modify: `tests/backend/mcp/test_gateway_app.py`
- Modify: `py-src/data_formulator/mcp_gateway/app.py`

**Step 1: Write failing ASGI tests**

Add tests for:

- `POST /approvals/{operation_id}/deny` returning:

  ```json
  {
    "status": "success",
    "data": {
      "operation_id": "operation-1",
      "state": "denied"
    }
  }
  ```

- forwarding only the authenticated subject and path operation ID to the
  coordinator;
- rejecting any request body with the existing generic `403 ACCESS_DENIED`
  envelope;
- returning the same generic envelope for unknown, already-decided, and
  other-subject operation IDs;
- returning `401 AUTH_REQUIRED` when caller authentication fails.

**Step 2: Verify RED**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest `
  tests\backend\mcp\test_gateway_app.py `
  -k "denial_route" -q
```

Expected: FAIL because the denial route and protocol method do not exist.

**Step 3: Implement the minimal route**

1. Add `deny(...) -> None` to the local approval coordinator protocol.
2. Register `POST /approvals/{operation_id}/deny` only when approval
   coordination and caller-subject resolution are both injected.
3. Reuse the confirmation route's bodyless request, authentication, and
   sanitized failure policy.
4. Do not accept an approval ID, profile, source, tool, endpoint, or arguments.

**Step 4: Verify GREEN**

Re-run the focused command. Expected: all selected denial-route tests pass.

## Task 3: Prove Terminal Race And Failure Semantics

**Objective:** Establish that one terminal approval decision wins and that an
upstream failure after consumption cannot replay the request.

**Files:**

- Modify: `tests/backend/mcp/test_gateway_service.py`
- Modify only if a test exposes a defect:
  `py-src/data_formulator/mcp_gateway/service.py`

**Step 1: Add race and terminal-state tests**

Add tests proving:

- concurrent owner confirmations produce exactly one upstream call and one
  sanitized approval-unavailable failure;
- concurrent owner confirm/deny attempts produce one terminal winner;
- an upstream `McpUpstreamUnavailableError` after consumption is returned once,
  and a second confirmation attempt cannot call upstream again;
- unknown operation IDs and replayed IDs have indistinguishable domain errors.

Use an injected blocking/recording upstream client rather than sleeps. Keep all
tests offline.

**Step 2: Run the focused tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest `
  tests\backend\mcp\test_gateway_service.py -q
```

Expected:

- existing consume-before-execute tests may pass immediately as
  characterization evidence;
- any race that permits multiple terminal transitions or upstream calls must
  fail before production code changes.

**Step 3: Fix only demonstrated defects**

If RED exposes a race, keep pending lookup, gate transition, and pending-record
removal in one coordinator lock section. Do not hold that lock while awaiting
the upstream call.

**Step 4: Verify GREEN**

Re-run the focused file. Expected: all gateway service tests pass with one
upstream call per operation ID.

## Task 4: Validate And Update Evidence

**Objective:** Prove the lifecycle increment does not regress the governed MCP
or loader boundaries.

**Files:**

- Modify: `docs/plans/ISSUES.md`
- Modify: `docs/plans/2026-07-14-governed-mcp-adapter-tracker.md`

**Step 1: Run focused and regression suites**

```powershell
.\.venv\Scripts\python.exe -m pytest `
  tests\backend\mcp\test_gateway_approval.py `
  tests\backend\mcp\test_gateway_service.py `
  tests\backend\mcp\test_gateway_app.py -q

.\.venv\Scripts\python.exe -m pytest tests\backend\mcp -q

.\.venv\Scripts\python.exe -m pytest `
  tests\backend\data\test_mcp_governed_data_loader.py `
  tests\backend\data\test_data_connector_framework.py `
  tests\backend\data\test_all_loader_verification.py -q

git --no-pager diff --check
```

Measured result: focused lifecycle tests 32 passed, full MCP suite 144 passed,
governed loader/connector scope 85 passed, and `git diff --check` returned no
output.

**Step 2: Review the uncommitted diff**

Verify:

- denial and confirmation share the same subject-binding and bodyless contract;
- no internal approval ID or pending-state existence leaks;
- denial never constructs an upstream client;
- confirmation remains consume-before-execute and single-use;
- no tenant, token-acquisition, startup, or live-transport code was added.

**Step 3: Update measured evidence**

Mark the lifecycle-hardening tracker checkbox complete only after recording the
actual focused and full-suite counts. Leave token acquisition, startup
activation, time-based expiry, fixtures, and live validation unchecked.

## Risks And Open Decisions

- **Pending approval expiry:** The exact TTL and expired-state UX are not
  specified. Decide those together before adding a clock or cleanup policy.
- **Process-local state:** This remains valid only while confirmation/denial and
  retry execute in the same gateway process. Production multi-replica topology
  needs a separately approved shared-state or routing design.
- **At-most-once behavior:** Consume-before-execute prevents replay but means a
  transient upstream failure requires a new operation and approval. Revise only
  if product requirements explicitly prefer retryable approvals and define an
  idempotency contract.

## Completion Checklist

- [x] Owner-bound coordinator denial is RED then GREEN.
- [x] Bodyless denial route is RED then GREEN.
- [x] Confirmation/denial races permit one terminal winner.
- [x] Upstream failure after consumption cannot replay.
- [x] Unknown, denied, consumed, and other-subject IDs are indistinguishable.
- [x] Full MCP and loader regression suites are green.
- [x] Tracker evidence contains measured counts.
- [x] External approval and live-runtime blockers remain open.
