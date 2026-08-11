"""
AccuLynx integration module (Simple Work -> AccuLynx, outbound only).

Sends claim files (photos/documents) to the matching AccuLynx job/lead.
Designed to be fully removable. To rip this feature out entirely:

1. Delete this folder: backend/app/domains/integrations/acculynx/
2. Remove the router registration block in backend/app/main.py
   (search for "acculynx_router")
3. Remove the ENABLE_ACCULYNX / ACCULYNX_* settings in
   backend/app/core/config.py (and the matching lines in
   backend/.env.development, .env.example, .env.production.example)
4. Add an Alembic migration that drops the `acculynx_job_links`,
   `acculynx_uploads`, and `acculynx_contact_links` tables (no other
   tables are touched by this module)
5. Delete frontend/src/services/acculynxService.ts and
   frontend/src/components/common/AccuLynxSyncButton.tsx
6. Remove the single import line + single JSX line marked with
   `{/* AccuLynx: ... */}` in each page that renders <AccuLynxSyncButton />
   (ClientDetail.tsx, WaterMitigationDetail.tsx)

No other domain's models/API files are modified by this module - it only
reads (never writes) app.domains.file and app.domains.water_mitigation
models.
"""
