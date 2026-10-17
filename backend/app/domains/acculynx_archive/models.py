"""
AccuLynx archive models - see __init__.py.
"""

from sqlalchemy import (
    DECIMAL,
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.core.base_models import BaseModel
from app.core.database_factory import Base
from app.core.database_types import UUIDType


class AccuLynxArchivedJob(Base, BaseModel):
    """One AccuLynx job, frozen as it was when the account was closed."""
    __tablename__ = "acculynx_archived_jobs"
    __table_args__ = (
        Index('ix_acculynx_archived_jobs_client_id', 'client_id'),
        {'extend_existing': True}
    )

    client_id = Column(UUIDType(), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)

    acculynx_job_id = Column(String(100), nullable=False, unique=True)
    acculynx_contact_id = Column(String(100))
    job_number = Column(String(50))
    job_name = Column(String(500))
    milestone = Column(String(50))  # Lead | Prospect | Approved | Completed | Invoiced | Closed
    trade_types = Column(String(255))  # "Roofing, Interior"
    work_type = Column(String(100))  # Insurance | Retail ...

    address = Column(Text)
    city = Column(String(100))
    state = Column(String(50))
    zipcode = Column(String(20))

    job_created_at = Column(DateTime(timezone=True))
    milestone_date = Column(DateTime(timezone=True))

    insurance_company = Column(String(255))
    claim_number = Column(String(100))
    date_of_loss = Column(DateTime(timezone=True))
    damage_location = Column(Text)
    adjuster_name = Column(String(255))
    adjuster_phone = Column(String(50))
    adjuster_email = Column(String(255))

    approved_job_value = Column(DECIMAL(15, 2))
    total_received = Column(DECIMAL(15, 2))
    balance_due = Column(DECIMAL(15, 2))

    # Documents live in Google Drive, one folder per job (see
    # backend/scripts/acculynx_archive/stage_for_drive.py). The id is filled
    # in after upload; until then the app links to a Drive search by name.
    drive_folder_name = Column(String(255))
    drive_folder_id = Column(String(100))

    document_count = Column(Integer, default=0)
    message_count = Column(Integer, default=0)

    # Everything the API returned for the job (job, insurance, adjuster,
    # payments, invoices, history...), for anything not lifted into columns
    raw = Column(JSON)

    # importing -> complete; a re-run resumes an `importing` job
    import_status = Column(String(20), nullable=False, default="importing")

    documents = relationship(
        "AccuLynxArchivedDocument", back_populates="job",
        cascade="all, delete-orphan", lazy="select",
    )
    messages = relationship(
        "AccuLynxArchivedMessage", back_populates="job",
        cascade="all, delete-orphan", lazy="select",
        order_by="AccuLynxArchivedMessage.sent_at",
    )


class AccuLynxArchivedDocument(Base, BaseModel):
    """
    A job document's listing. The file itself is in the job's Google Drive
    folder at `drive_path`; nothing is kept in app storage.
    """
    __tablename__ = "acculynx_archived_documents"
    __table_args__ = (
        Index('ix_acculynx_archived_documents_job_id', 'archived_job_id'),
        {'extend_existing': True}
    )

    archived_job_id = Column(
        UUIDType(), ForeignKey("acculynx_archived_jobs.id", ondelete="CASCADE"), nullable=False
    )
    # AccuLynx file id, or "att:<message attachment id>" for email
    # attachments that were never filed into a document folder
    acculynx_file_id = Column(String(100), nullable=False, unique=True)

    folder_name = Column(String(255))  # AccuLynx document folder
    name = Column(String(500), nullable=False)
    drive_path = Column(Text)  # inside the job's Drive folder, e.g. "Invoice/INV-12.pdf"
    content_type = Column(String(100))
    size = Column(Integer)
    uploaded_by = Column(String(255))
    uploaded_at = Column(DateTime(timezone=True))

    job = relationship("AccuLynxArchivedJob", back_populates="documents")


class AccuLynxArchivedMessage(Base, BaseModel):
    """One message from a job's Communication tab (email, text, job message)."""
    __tablename__ = "acculynx_archived_messages"
    __table_args__ = (
        Index('ix_acculynx_archived_messages_job_id', 'archived_job_id'),
        {'extend_existing': True}
    )

    archived_job_id = Column(
        UUIDType(), ForeignKey("acculynx_archived_jobs.id", ondelete="CASCADE"), nullable=False
    )
    acculynx_message_id = Column(String(100), nullable=False, unique=True)
    thread_id = Column(String(100), nullable=False)
    message_type = Column(String(30))  # Email | Text | JobMessage ...

    subject = Column(Text)
    sender_name = Column(String(255))
    sender_email = Column(String(255))
    recipients = Column(JSON)  # [{name, email, type: to|cc}]
    sent_at = Column(DateTime(timezone=True))

    # AccuLynx stores emails as full HTML templates (~19KB each); only the
    # readable text is kept here - the raw HTML stays in the local backup
    body_text = Column(Text)
    # [{name, document_id}] - document_id points at AccuLynxArchivedDocument
    attachments = Column(JSON)

    job = relationship("AccuLynxArchivedJob", back_populates="messages")
