# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Office PM / owner**: checks job progress, payments, and follow-ups between site visits and meetings, often on a phone. Makes quick edits (notes, status, dates).
- **Claim / customer contact staff**: sends claim follow-up emails, answers adjusters, updates claim status.
- **Field crew / technicians**: upload site photos and documents, enter data on the job site from a phone.

All three groups use the app on mobile. Desktop remains the main surface for long-form estimate building.

## Product Purpose

MJ Estimate is an all-in-one back office for an insurance restoration contractor: estimates, invoices, work orders, water mitigation jobs, claim follow-up, payments, and documents. Success is staff knowing at a glance where each job and claim stands, and being able to act on it (note, status change, upload, email) from wherever they are.

## Operating Context

- Insurance restoration workflow: water mitigation jobs, reconstruction estimates, insurance carriers and adjusters, Xactimate line items.
- Integrations: CompanyCam photo sync, Google Sheets sync, Slack notifications, AI photo analysis.
- Mobile-heavy surfaces: Water Mitigation (list, detail, photos, documents, payment board), Claim Follow-up (dashboard, detail, email), Estimate creation (EstimateCreation, RepairEstimateWizard).
- Mobile jobs on those surfaces: scan status and payments in lists; edit notes and status in detail views; upload and view photos and documents; compose and send emails.

## Capabilities and Constraints

- React 18 + TypeScript + Ant Design 5 frontend; FastAPI backend. Redesign stays within Ant Design (theme tokens + component overrides), not a framework swap.
- UI copy is English; the team communicates in Korean.
- Existing behavior, data, and copy on redesigned pages must be preserved.

## Product Principles

1. Status at a glance: a list row should answer "where is this job/claim and is money in" without opening it.
2. Act from anywhere: the common edits (note, status, upload, email) must be comfortable with one thumb on a phone.
3. Quiet by default: color and badges are reserved for state that needs attention, not for labelling every field.
4. Same truth on every screen size: mobile shows the same data, restructured, never a cropped desktop table.
</content>
</invoke>
<invoke name="Bash">
<parameter name="command">cd /c/Users/minje/.claude/skills/impeccable/reference && cat new-work.md operate.md