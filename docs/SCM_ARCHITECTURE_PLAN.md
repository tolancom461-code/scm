# Procure Nexus SCM — execution architecture

## Current Architecture
React 19/Vite/TypeScript, Express/tRPC, MySQL/TiDB/Drizzle. Local scrypt credentials and database-backed sessions. Home.tsx combines navigation, authentication and operational screens; routers.ts combines all API modules; db.ts combines persistence and business logic. The deployed schema has 22 prototype tables. Code, rather than old status documents, is the baseline.

## Problems Found
POs, quotations and deliveries carry header amounts rather than linked lines. Arbitrary IDs lack relational enforcement. Request creation, permission replacement and amendments are not atomic. Timestamp numbering can collide. Draft amendments immediately affect contract totals. Receipt balance checking and insertion are separate operations. Master data, GRN, stock ledger and invoices are absent. Table search is cosmetic. Server lists load all records. Document download proxy bypasses confidentiality authorization. Bootstrap can race. Rate limiting lives in process memory. Fixed administrator credentials must be removed.

## Reusable Components
React component library, language resources and RTL styles; tRPC client/server and Zod; scrypt and session hashing; export formatting and filter tests; storage provider adapter; supplier/auth data as a transition foundation.

## Components to Refactor
Extract domain routers first, then page components and repositories. Operational old APIs remain explicitly prototype paths until their replacement is tested; do not present these as SCM-ready. No microservices or stack replacement.

## Database Problems
Introduce normalized master data and explicit foreign keys, version columns, indexed lookups and check constraints. Monetary DECIMAL values cross API boundaries as strings. Use fixed-point integer arithmetic with explicit rounding. Schema and migration baseline backed up under docs/baseline-scm before edits. No destructive reset is required for incremental implementation.

## Security Problems
Server-side permissions must gate every mutation and file download. Add domain errors with safe public messages. Record actor, entity, before/after and reason within the same transaction. Maintain separation of duties even for administrators. Prototype security is not a completed audit.

## Workflow Problems
Model definitions, ordered steps, instances and decisions. Pin the definition version to an instance. Validate transitions and actor eligibility on the server. Approval/application of a contract amendment is one locked transaction, not a side effect of creating a draft. Amount ranges and delegation must have deterministic boundaries.

## UI/UX Problems
Extract feature pages with real server pagination/search/filtering, translated forms, dependency pickers, detail screens and loading/error states. Keep language changes on the current route. Avoid navigation entries for unimplemented capabilities.

## Proposed Architecture
Modular monolith: router → domain service → transactional repository. Shared core owns errors, fixed-point arithmetic, permissions and transaction context. Audit, numbering and outbox accept the caller's transaction. Master-data owns categories, units/conversions, branches, sites, cost centers, warehouses/locations and items. Other modules own the document lifecycle rather than one universal document table.

## Proposed Database Model
- Foundation: document_sequences, operation_keys, scm_audit_events, scm_outbox, workflow_definitions, workflow_steps, workflow_instances, workflow_decisions.
- Master data: scm_categories, scm_units, scm_uom_conversions, scm_branches, scm_sites, scm_cost_centers, scm_warehouses, scm_warehouse_locations, scm_items.
- Projects: projects, wbs_nodes, budgets, budget_ledger. Each WBS belongs to exactly one project; distribution references must agree.
- Procurement: requisitions/lines, rfqs/lines/invited_suppliers, quotations/lines/evaluations, awards/lines, orders/lines/schedules/distributions. Explicit source line IDs persist throughout the cycle. Splits cannot exceed source quantity.
- Receiving: shipments/lines, goods_receipts/lines, inspections/lines, supplier_returns/lines. Receipt and inspection are separate facts; only accepted inventory-tracked quantities become usable stock.
- Inventory: immutable movement ledger plus locked balance projection; reservations, transfer pairs, counts and reversal references. No direct balance editor.
- Financial control: invoices/lines, matches/exceptions, milestones, payment_allocations, credit_notes. Invoiced quantity cannot exceed eligible accepted quantities net of returns and previously invoiced amounts.
- Contracts: lines, deliverables, amendments, variations, guarantees, retentions, certificates, claims and closeout.
- Supplier extensions: contacts, bank approvals, qualification, expiring documents and calculated performance.

## Proposed Modules
auth, users, permissions, master-data, suppliers, procurement, sourcing, contracts, purchasing, receiving, inventory, finance-control, projects, workflows, documents, notifications, integrations, reporting, audit.

## Implementation Order
A foundation → B master data → C procurement/sourcing → D receiving/inventory → E financial control → F contracts → G projects (project references introduced before C) → H supplier management → I basic logistics → J rule-based planning → K analytics. Implement and verify each increment; generation of a schema alone does not complete a module.

## Accounting definitions and acceptance scenarios
Requested is a planning amount, committed is approved uncancelled PO value, received is net accepted receipt value, actual is approved invoice value, paid is posted allocations. These are separate measures and must never be summed as costs. Available budget = approved budget minus net commitments (actualizing a commitment does not consume budget twice).

Olive scenario: 20 ordered at SAR 10,000; 20 received, 18 accepted, 2 rejected and returned; usable inventory 18; invoice eligibility initially 18, not 20. Contract payment schedule 30/40/20/10 is SAR 60k/80k/40k/20k against SAR 200k, with explicit conditions. An advance must be recovered/allocated rather than counted twice as an invoice payment. A full 200k invoice remains blocked until replacement acceptance or an authorized contractual settlement. Riyadh WBS includes Civil, MEP, Fit-out, Furniture, IT, Landscaping, Pre-opening.

## Verification
Unit tests for arithmetic, validators, authorization and transitions; MySQL integration tests for rollback, concurrency, idempotency and foreign keys; runtime tests for multilingual forms and complete lifecycle. TypeScript, unit tests and production build must pass. Report unrun database/browser checks explicitly.
