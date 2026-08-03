# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small-to-mid-size insurance restoration company owner-operators who work both in the field and at the office. They assess damage on-site with a tablet, then return to the desk to write estimates, manage claims, and coordinate jobs. In smaller shops, one person wears every hat — estimator, project manager, bookkeeper. Larger teams have technicians uploading field photos and office staff handling claims paperwork, but the owner touches every part of the system.

Secondary users: field technicians (photo capture, work order execution), office staff (claims tracking, scheduling), and external contractors/public adjusters (viewing estimates, signing contracts via shared links).

## Product Purpose

An all-in-one platform for insurance restoration contractors to manage the entire claim lifecycle — from initial damage assessment through estimation, work orders, invoicing, and payment — without juggling multiple expensive tools. Success means a restoration company can run its entire back-office from a single application: fewer missed follow-ups, faster estimate turnaround, and less time on paperwork.

## Positioning

Competitors like Xactimate, JobNimbus, and RestorationManager each solve pieces of the workflow but require stitching together multiple subscriptions. This product consolidates estimates, invoices, work orders, water mitigation management, claims tracking, contracts, and specialty trade reports into one integrated system — at a fraction of the cost. AI-powered photo classification and insurance document extraction reduce manual data entry that competitors still require.

## Operating Context

- Restoration work is insurance-driven: estimates reference Xactimate line codes, claims have adjusters and supplements, and documents follow insurance industry conventions (ACV, RCV, depreciation, O&P).
- Field work happens on construction sites — dusty, wet, time-pressured. The tool must work on tablets and phones with intermittent connectivity.
- Office work involves juggling dozens of active claims, each with follow-up deadlines, document trails, and payment milestones.
- Water mitigation is a high-frequency workflow: emergency response, daily moisture readings, photo documentation, equipment tracking, and scope-of-work reports.
- Integrations with CompanyCam (field photos), Google Sheets (data sync), and Slack (notifications) bridge the field-office gap.

## Capabilities and Constraints

**Core capabilities:**
- Estimate and invoice creation with insurance-specific calculations (ACV/RCV, depreciation, O&P)
- Water mitigation job management with AI photo classification, floor sketching, and scope-of-work generation
- Claims lifecycle dashboard with follow-up task management and email ingestion
- Work order assignment and tracking with trade-based costing
- Digital contracts with e-signature (field tablet and remote signing)
- Specialty reports for plumbers and electricians
- Reconstruction sub-estimates: cabinets, bathrooms, roofing, siding, pack-out
- Insurance PDF extraction and Xactimate code reference tools
- AI-powered material detection from photos

**Technical constraints:**
- React 18 + TypeScript frontend, FastAPI + Python backend
- Ant Design 5.x component library
- Must support tablet and mobile use for field workers
- Production target: ~$7/month infrastructure (Vercel + Render + NeonDB)

**Undecided:**
- Product name (currently "SimpleWorks" in HTML title, "MJ Estimate" internally — neither is final)
- No locked visual identity — brand direction is fully open

## Evidence on Hand

No external brand assets, logos, testimonials, certifications, or case studies exist yet. The product is functional but early-stage. All content in the UI (company names, sample data) is placeholder. The Korean-language UI copy is developer convenience; the product language is English.

## Product Principles

1. **One tool, not five.** Every workflow a restoration company needs should live in a single application — never force users to context-switch between platforms.
2. **Field-ready by default.** If it can't be used on a wet construction site with one hand on a tablet, it's not done.
3. **Automate the tedious.** AI and integrations should eliminate repetitive data entry (photo sorting, insurance parsing, line-code lookup) so owners spend time on billable work.
4. **Insurance-native.** The system speaks the language of insurance claims — Xactimate codes, ACV/RCV, depreciation schedules, supplements — without requiring users to translate between tools.
5. **Affordable at any scale.** A one-person shop and a 50-person company should both find the pricing and complexity appropriate.
