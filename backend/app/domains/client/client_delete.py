"""
Deleting a client takes everything linked to it: its claims and cash jobs, and
every job, contract, invoice, estimate, report and stored file that hangs off them.

Documents are found through their links only. A document that merely carries the
client's name as text may be someone else's, so it stays.

The rows go in one transaction and the stored files after it, so a delete that
fails never leaves rows pointing at files that are gone.
"""

from dataclasses import dataclass
import logging
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple
import uuid

from sqlalchemy import or_

from app.domains.acculynx_archive.models import AccuLynxArchivedJob
from app.domains.bathroom_estimate.models import BathroomEstimate
from app.domains.cabinet_estimate.models import CabinetEstimate
from app.domains.claim_followup.models import FollowUpTask, SentEmail
from app.domains.client.models import Claim, ClaimExpense, ClaimPayment, ClaimNegotiation, ClaimTodo, Client
from app.domains.contract.models import ContractInstance, ContractTemplate
from app.domains.credit.models import AppliedDiscount, CreditTransaction, CustomerCredit
from app.domains.crew_upload.models import UploadLink
from app.domains.document_transfer.models import DocumentTransfer
from app.domains.document_types.models import WorkOrderDocumentType, WorkOrderTrade
from app.domains.electrician_report.models import ElectricianReport
from app.domains.email_ingestion.models import EmailIngestionLog, ReceivedEmail
from app.domains.estimate.models import Estimate
from app.domains.file.models import File
from app.domains.integrations.models import CompanyCamPhoto
from app.domains.invoice.models import Invoice
from app.domains.material_order.models import MaterialOrder
from app.domains.pack_calculation.models import PackCalculation, PackingPhoto
from app.domains.payment.models import BillingSchedule, Payment, PaymentRefund
from app.domains.plumber_report.models import PlumberReport
from app.domains.plumber_report.templates.models import PlumberReportTemplateUsage
from app.domains.rebuild.models import RebuildCompletionDoc, RebuildProject
from app.domains.roofing_estimate.models import RoofingEstimate
from app.domains.siding_estimate.models import SidingEstimate
from app.domains.sketch.models import Sketch
from app.domains.storage.factory import StorageFactory
from app.domains.supplement.models import BidItemEstimate, SupplementFollowUp, SupplementRequest
from app.domains.water_mitigation.models import WaterMitigationJob, WMDocument, WMDocumentSlotOverride, WMPhoto
from app.domains.water_mitigation.sketch_models import WMFloorSketch
from app.domains.work_order.models import WorkOrder, WorkOrderStaffAssignment

logger = logging.getLogger(__name__)

_STORAGE_SCHEME = re.compile(r'^(?:b2|gs)://[^/]+/')


@dataclass(frozen=True)
class StoredFile:
    provider: str
    key: str


@dataclass
class _Linked:
    """The ids of everything a client delete takes"""
    claims: List[Any]
    wm_jobs: List[Any]
    contracts: List[Any]
    invoices: List[Any]
    estimates: List[Any]
    work_orders: List[Any]
    pack_calculations: List[Any]
    cabinet_estimates: List[Any]
    bathroom_estimates: List[Any]
    roofing_estimates: List[Any]
    siding_estimates: List[Any]
    material_orders: List[Any]
    plumber_reports: List[Any]
    electrician_reports: List[Any]
    followup_tasks: List[Any]
    supplements: List[Any]
    bid_items: List[Any]
    rebuild_projects: List[Any]


def _ids(db: Any, column: Any, *conditions: Any) -> List[Any]:
    return [row[0] for row in db.query(column).filter(or_(*conditions)).all()]


def _estimate_groups(db: Any, model: Any, claim_ids: List[Any]) -> List[Any]:
    """Estimates on these claims, with the rest of each one's restoration-and-options group"""
    rows = db.query(model.id, model.group_id).filter(model.claim_id.in_(claim_ids)).all()
    groups = [row.group_id or row.id for row in rows]
    return _ids(db, model.id, model.id.in_(groups), model.group_id.in_(groups))


def _reports_only_this_client_uses(db: Any, report_column: Any, client_id: str) -> List[Any]:
    ours = {
        row[0] for row in db.query(report_column).filter(
            Claim.client_id == client_id, report_column.isnot(None)
        ).all()
    }
    theirs = {
        row[0] for row in db.query(report_column).filter(
            Claim.client_id != client_id, report_column.in_(list(ours))
        ).all()
    }
    # The report tables hold their ids as UUID objects, unlike claims
    return [uuid.UUID(str(report)) for report in ours - theirs]


def _find_linked(db: Any, client_id: str) -> _Linked:
    claims = _ids(db, Claim.id, Claim.client_id == client_id)
    supplements = _ids(db, SupplementRequest.id, SupplementRequest.claim_id.in_(claims))
    return _Linked(
        claims=claims,
        wm_jobs=_ids(db, WaterMitigationJob.id, WaterMitigationJob.claim_id.in_(claims)),
        contracts=_ids(
            db, ContractInstance.id,
            ContractInstance.client_id == client_id, ContractInstance.claim_id.in_(claims),
        ),
        invoices=_ids(db, Invoice.id, Invoice.client_id == client_id, Invoice.claim_id.in_(claims)),
        estimates=_ids(db, Estimate.id, Estimate.client_id == client_id, Estimate.claim_id.in_(claims)),
        work_orders=_ids(db, WorkOrder.id, WorkOrder.client_id == client_id, WorkOrder.claim_id.in_(claims)),
        pack_calculations=_ids(
            db, PackCalculation.id,
            PackCalculation.client_id == client_id, PackCalculation.claim_id.in_(claims),
        ),
        cabinet_estimates=_estimate_groups(db, CabinetEstimate, claims),
        bathroom_estimates=_estimate_groups(db, BathroomEstimate, claims),
        roofing_estimates=_ids(db, RoofingEstimate.id, RoofingEstimate.claim_id.in_(claims)),
        siding_estimates=_ids(db, SidingEstimate.id, SidingEstimate.claim_id.in_(claims)),
        material_orders=_ids(db, MaterialOrder.id, MaterialOrder.claim_id.in_(claims)),
        plumber_reports=_reports_only_this_client_uses(db, Claim.plumber_report_id, client_id),
        electrician_reports=_reports_only_this_client_uses(db, Claim.electrician_report_id, client_id),
        followup_tasks=_ids(db, FollowUpTask.id, FollowUpTask.claim_id.in_(claims)),
        supplements=supplements,
        bid_items=_ids(db, BidItemEstimate.id, BidItemEstimate.supplement_id.in_(supplements)),
        rebuild_projects=_ids(db, RebuildProject.id, RebuildProject.claim_id.in_(claims)),
    )


def _email_log_condition(client_id: str, linked: _Linked) -> Any:
    return or_(
        EmailIngestionLog.matched_client_id == client_id,
        EmailIngestionLog.matched_claim_id.in_(linked.claims),
    )


def _file_row_condition(db: Any, client_id: str, linked: _Linked) -> Any:
    """The rows of the generic files table that belong to what is being deleted"""
    def strs(ids: Iterable[Any]) -> List[str]:
        return [str(i) for i in ids]

    by_context = {
        'negotiation': linked.claims,
        'claim-negotiation': linked.claims,
        'claim': linked.claims,
        'water-mitigation': linked.wm_jobs,
        'insurance_estimate': linked.followup_tasks,
        'wm_estimate': linked.followup_tasks,
        'supplement': linked.supplements,
        'supplement_bid_item': linked.supplements + linked.bid_items,
        'electrician-report': linked.electrician_reports,
        'estimate': linked.estimates,
        'invoice': linked.invoices,
        'work-order': linked.work_orders,
    }
    file_ids = set()
    for column, condition in (
        (Claim.insurance_estimate_file_id, Claim.id.in_(linked.claims)),
        (Claim.wm_estimate_file_id, Claim.id.in_(linked.claims)),
        (ClaimNegotiation.document_url, ClaimNegotiation.claim_id.in_(linked.claims)),
        (ClaimExpense.receipt_file_id, ClaimExpense.claim_id.in_(linked.claims)),
        (ClaimPayment.check_photo_file_id, ClaimPayment.claim_id.in_(linked.claims)),
        (SupplementRequest.document_file_id, SupplementRequest.id.in_(linked.supplements)),
        (BidItemEstimate.custom_document_file_id, BidItemEstimate.id.in_(linked.bid_items)),
        (PackingPhoto.photo_id, PackingPhoto.claim_id.in_(linked.claims)),
        (EmailIngestionLog.file_id, _email_log_condition(client_id, linked)),
    ):
        file_ids.update(strs(_ids(db, column, condition)))
    for (attachment_ids,) in db.query(SupplementFollowUp.reply_attachment_ids).filter(
        SupplementFollowUp.supplement_id.in_(linked.supplements)
    ).all():
        file_ids.update(strs(attachment_ids or []))

    return or_(
        File.id.in_(list(file_ids)),
        *[
            (File.context == context) & File.context_id.in_(strs(ids))
            for context, ids in by_context.items()
        ],
    )


def _stored_files(db: Any, linked: _Linked, file_rows: Any) -> List[StoredFile]:
    jobs = linked.wm_jobs
    contracts = ContractInstance.id.in_(linked.contracts)
    found = []
    for provider, key, condition in (
        (WMPhoto.storage_provider, WMPhoto.storage_file_id, WMPhoto.job_id.in_(jobs)),
        (WMDocument.storage_provider, WMDocument.storage_file_id, WMDocument.job_id.in_(jobs)),
        (WMFloorSketch.storage_provider, WMFloorSketch.storage_file_id, WMFloorSketch.job_id.in_(jobs)),
        (ContractInstance.signed_pdf_provider, ContractInstance.signed_pdf_url, contracts),
        (ContractInstance.filled_pdf_provider, ContractInstance.filled_pdf_url, contracts),
        (File.storage_provider, File.url, file_rows),
    ):
        found.extend(db.query(provider, key).filter(condition).all())

    # Rebuild documents only keep the prefixed path
    for (url,) in db.query(RebuildCompletionDoc.file_url).filter(
        RebuildCompletionDoc.project_id.in_(linked.rebuild_projects)
    ).all():
        if url and url.startswith('b2://'):
            found.append(('b2', url))
        elif url and url.startswith('gs://'):
            found.append(('gcs', url))

    # A sketch background kept in the database (provider 'db') has no stored file
    return list(dict.fromkeys(
        StoredFile(provider, key) for provider, key in found if provider and provider != 'db' and key
    ))


def _blob_path(key: str) -> str:
    return _STORAGE_SCHEME.sub('', key).replace('\\', '/')


def _not_used_elsewhere(db: Any, files: List[StoredFile]) -> List[StoredFile]:
    """Drop files another record still uses: the same photo can sit on several jobs,
    and a contract can point at its template's PDF. Call once the rows are gone."""
    in_use = set()
    for column in (
        WMPhoto.storage_file_id,
        WMDocument.storage_file_id,
        WMDocument.source_storage_file_id,
        WMFloorSketch.storage_file_id,
        File.url,
        ContractInstance.signed_pdf_url,
        ContractInstance.filled_pdf_url,
        ContractTemplate.file_url,
        RebuildCompletionDoc.file_url,
    ):
        in_use.update(_blob_path(value) for (value,) in db.query(column).filter(column.isnot(None)).all())
    return [stored for stored in files if _blob_path(stored.key) not in in_use]


def _remove_rows(db: Any, model: Any, *conditions: Any) -> None:
    """Delete rows directly, for tables with nothing below them the session must cascade to"""
    db.query(model).filter(or_(*conditions)).delete(synchronize_session=False)


def _delete_objects(db: Any, model: Any, ids: List[Any]) -> None:
    """Delete through the session, so the model's own cascades run"""
    for entity in db.query(model).filter(model.id.in_(ids)).all():
        db.delete(entity)
    db.flush()


def _delete_work_order_records(db: Any, work_orders: List[Any]) -> None:
    # These tables hold work order ids as UUID objects, unlike work_orders itself
    work_orders = [uuid.UUID(str(work_order)) for work_order in work_orders]
    credits = _ids(db, CustomerCredit.id, CustomerCredit.work_order_id.in_(work_orders))
    payments = _ids(db, Payment.id, Payment.work_order_id.in_(work_orders))
    _remove_rows(
        db, AppliedDiscount,
        AppliedDiscount.work_order_id.in_(work_orders), AppliedDiscount.customer_credit_id.in_(credits),
    )
    _remove_rows(
        db, CreditTransaction,
        CreditTransaction.work_order_id.in_(work_orders), CreditTransaction.customer_credit_id.in_(credits),
    )
    _remove_rows(db, CustomerCredit, CustomerCredit.id.in_(credits))
    _remove_rows(db, PaymentRefund, PaymentRefund.payment_id.in_(payments))
    _remove_rows(db, Payment, Payment.id.in_(payments))
    for model in (BillingSchedule, WorkOrderStaffAssignment, WorkOrderDocumentType, WorkOrderTrade):
        _remove_rows(db, model, model.work_order_id.in_(work_orders))


def _retire_email_logs(db: Any, client_id: str, linked: _Linked) -> None:
    """Keep the log rows but cut them loose. The poller reads them to know a message
    was already handled, so without them a re-scan would queue that mail for review again."""
    db.query(EmailIngestionLog).filter(_email_log_condition(client_id, linked)).update(
        {
            EmailIngestionLog.status: 'skipped',
            EmailIngestionLog.skip_reason: 'Client was deleted',
            EmailIngestionLog.file_id: None,
            EmailIngestionLog.negotiation_id: None,
            EmailIngestionLog.matched_client_id: None,
            EmailIngestionLog.matched_claim_id: None,
            EmailIngestionLog.match_method: None,
            EmailIngestionLog.match_confidence: None,
        },
        synchronize_session=False,
    )


def _count_rows(db: Any, column: Any, *conditions: Any) -> int:
    return db.query(column).filter(or_(*conditions)).count()


def linked_counts(db: Any, client_id: str) -> Optional[List[Dict[str, Any]]]:
    """What deleting a client would take, for the person about to confirm it (None = no such client)"""
    if not db.query(Client.id).filter(Client.id == client_id).first():
        return None
    linked = _find_linked(db, client_id)
    file_rows = _file_row_condition(db, client_id, linked)
    items: List[Tuple[str, int]] = [
        ('Claims and cash jobs', len(linked.claims)),
        ('Water mitigation jobs', len(linked.wm_jobs)),
        ('Contracts', len(linked.contracts)),
        ('Invoices', len(linked.invoices)),
        ('Estimates', sum(len(ids) for ids in (
            linked.estimates, linked.cabinet_estimates, linked.bathroom_estimates,
            linked.roofing_estimates, linked.siding_estimates,
        ))),
        ('Work orders', len(linked.work_orders)),
        ('Material orders', len(linked.material_orders)),
        ('Pack calculations', len(linked.pack_calculations)),
        ('Plumber and electrician reports', len(linked.plumber_reports) + len(linked.electrician_reports)),
        ('Supplements', len(linked.supplements)),
        ('Rebuild projects', len(linked.rebuild_projects)),
        ('Follow-up tasks', len(linked.followup_tasks)),
        ('Emails', (
            _count_rows(db, SentEmail.id, SentEmail.claim_id.in_(linked.claims))
            + _count_rows(db, ReceivedEmail.id, *_received_email_conditions(client_id, linked))
        )),
        ('AccuLynx archived jobs', _count_rows(
            db, AccuLynxArchivedJob.id, AccuLynxArchivedJob.client_id == client_id
        )),
        ('Photos and stored files', len(_stored_files(db, linked, file_rows))),
    ]
    return [{'label': label, 'count': count} for label, count in items if count]


def _received_email_conditions(client_id: str, linked: _Linked) -> Tuple[Any, ...]:
    return (
        ReceivedEmail.matched_client_id == client_id,
        ReceivedEmail.matched_claim_id.in_(linked.claims),
        ReceivedEmail.matched_wm_job_id.in_(linked.wm_jobs),
    )


def delete_client_and_everything(db: Any, client_id: str) -> Optional[List[StoredFile]]:
    """Delete a client and all its linked records in the caller's transaction, and return
    the stored files to remove once that commits (None = no such client)."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if client is None:
        return None

    linked = _find_linked(db, client_id)
    file_rows = _file_row_condition(db, client_id, linked)
    files = _stored_files(db, linked, file_rows)
    _remove_rows(db, File, file_rows)

    _retire_email_logs(db, client_id, linked)
    _remove_rows(db, ReceivedEmail, *_received_email_conditions(client_id, linked))

    jobs = linked.wm_jobs
    _remove_rows(db, WMDocumentSlotOverride, WMDocumentSlotOverride.job_id.in_(jobs))
    _remove_rows(
        db, UploadLink,
        (UploadLink.context == 'water-mitigation') & UploadLink.context_id.in_(jobs),
    )
    _remove_rows(db, CompanyCamPhoto, CompanyCamPhoto.water_mitigation_job_id.in_(jobs))
    _delete_objects(db, WaterMitigationJob, jobs)

    _delete_objects(db, Sketch, _ids(
        db, Sketch.id,
        Sketch.estimate_id.in_(linked.estimates),
        Sketch.invoice_id.in_(linked.invoices),
        Sketch.work_order_id.in_(linked.work_orders),
    ))
    _remove_rows(
        db, DocumentTransfer,
        (DocumentTransfer.document_type == 'estimate') & DocumentTransfer.source_id.in_(linked.estimates),
        (DocumentTransfer.document_type == 'invoice') & DocumentTransfer.source_id.in_(linked.invoices),
    )
    _delete_work_order_records(db, linked.work_orders)

    for model, ids in (
        (ContractInstance, linked.contracts),
        (Invoice, linked.invoices),
        (Estimate, linked.estimates),
        (WorkOrder, linked.work_orders),
        (PackCalculation, linked.pack_calculations),
        (CabinetEstimate, linked.cabinet_estimates),
        (BathroomEstimate, linked.bathroom_estimates),
        (RoofingEstimate, linked.roofing_estimates),
        (SidingEstimate, linked.siding_estimates),
        (MaterialOrder, linked.material_orders),
    ):
        _delete_objects(db, model, ids)

    # Todos raised on the client itself, with no claim above them to take them
    _delete_objects(db, ClaimTodo, _ids(db, ClaimTodo.id, ClaimTodo.client_id == client_id))

    # Bulk deletes and database cascades above went around the session; read fresh
    # so the client's own cascade only sees what is left
    db.expire_all()
    db.delete(client)
    db.flush()

    # After the claims, whose columns point at these reports
    _remove_rows(
        db, PlumberReportTemplateUsage,
        PlumberReportTemplateUsage.report_id.in_(linked.plumber_reports),
    )
    _delete_objects(db, PlumberReport, linked.plumber_reports)
    _delete_objects(db, ElectricianReport, linked.electrician_reports)

    return _not_used_elsewhere(db, files)


def delete_stored_files(files: List[StoredFile]) -> None:
    """Remove files from storage. One that won't go is logged, not retried: its rows
    are already gone, so nothing in the app points at it any more."""
    providers: Dict[str, Any] = {}
    failed = 0
    for stored in files:
        try:
            if stored.provider not in providers:
                # Not get_instance: that swaps the app-wide provider when the type differs
                providers[stored.provider] = StorageFactory.create(stored.provider)
            if not providers[stored.provider].delete(stored.key):
                failed += 1
        except Exception as e:
            failed += 1
            logger.warning(f"Could not delete stored file {stored.provider}:{stored.key}: {e}")
    logger.info(f"Client delete removed {len(files) - failed} stored files, {failed} not removed")
