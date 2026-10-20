"""drop the address and PA from auto-created follow-up task titles

The claim page already shows the property address and the PA, so the
auto-created tasks no longer repeat them:

  WM Follow up - Docs sent to adjuster (<address>) | PA: <name>
      -> WM Follow up - Docs sent to adjuster
  Prepare Supplement Estimate - <address>  -> Prepare Supplement Estimate
  Supplement - <address>                   -> Supplement Follow-up
  Rebuild Payment - <address>              -> Rebuild Payment
  WM Payment - <address>                   -> WM Payment

The two payment titles were dropped from the code earlier but older rows
still carry them, often as a bare "Rebuild Payment - " when the address was
empty.

The WM task's description also loses its " | PA: <name>" suffix.

Only titles that still have the auto-created shape for their task type are
rewritten, so a title someone edited by hand is left alone. The addresses are
not kept anywhere else on the task, so downgrade does not restore them.

Revision ID: ft20261021ttl01
Revises: pw20261020chg01
Create Date: 2026-10-21
"""
import re

from alembic import op
import sqlalchemy as sa

revision = 'ft20261021ttl01'
down_revision = 'pw20261020chg01'
branch_labels = None
depends_on = None


# task_type -> (prefix of the old auto-created title, new title)
TITLE_RULES = {
    'wm_docs_sent': ('WM Follow up - Docs sent to adjuster (', 'WM Follow up - Docs sent to adjuster'),
    'supplement_estimate_prep': ('Prepare Supplement Estimate - ', 'Prepare Supplement Estimate'),
    'supplement_sent': ('Supplement - ', 'Supplement Follow-up'),
    'payment_check': ('Rebuild Payment -', 'Rebuild Payment'),
    'wm_payment_check': ('WM Payment -', 'WM Payment'),
}

WM_DESCRIPTION_PREFIX = 'Water mitigation documents'
PA_SUFFIX = re.compile(r' \| PA: [^\n]*')


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, task_type, title, description FROM followup_tasks "
            "WHERE task_type IN :types"
        ).bindparams(sa.bindparam('types', expanding=True)),
        {'types': list(TITLE_RULES)},
    ).fetchall()

    for row in rows:
        old_prefix, new_title = TITLE_RULES[row.task_type]
        title = row.title or ''
        description = row.description

        if title.startswith(old_prefix):
            title = new_title
        if (
            row.task_type == 'wm_docs_sent'
            and description
            and description.startswith(WM_DESCRIPTION_PREFIX)
        ):
            description = PA_SUFFIX.sub('', description, count=1)

        if title != (row.title or '') or description != row.description:
            conn.execute(
                sa.text(
                    "UPDATE followup_tasks SET title = :title, description = :description "
                    "WHERE id = :id"
                ),
                {'title': title, 'description': description, 'id': row.id},
            )


def downgrade() -> None:
    pass
