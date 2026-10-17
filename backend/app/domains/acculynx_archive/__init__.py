"""
Read-only archive of jobs brought over from AccuLynx before the account was
cancelled: job/insurance/payment info, documents, and Communication threads.

Kept apart from `claims` on purpose - these jobs are finished and paid, and
mixing them into claims would put them in dashboards, payment status and
follow-ups. Each archived job hangs off a `clients` row so it shows up on the
client page and in client search.

Separate from app.domains.integrations.acculynx (the outbound "send files to
AccuLynx" feature), which goes away with the account. This module needs no
AccuLynx API key - the importer reads a local backup made by
backend/scripts/acculynx_archive/.
"""
