from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text
from sqlalchemy.orm import relationship
from app.core.database_factory import Base


class PlumberReportTemplate(Base):
    __tablename__ = "plumber_report_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)  # warranty, terms, notes
    content = Column(Text, nullable=False)
    description = Column(Text)
    is_active = Column(Boolean, default=True)
    usage_count = Column(Integer, default=0)
    created_by = Column(UUID(as_uuid=True), ForeignKey("staff.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    company = relationship("Company")
    created_by_staff = relationship("Staff", foreign_keys=[created_by])


class PlumberReportTemplateUsage(Base):
    __tablename__ = "plumber_report_template_usage"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    template_id = Column(UUID(as_uuid=True), ForeignKey("plumber_report_templates.id"), nullable=False)
    used_by = Column(UUID(as_uuid=True), ForeignKey("staff.id"))
    report_id = Column(UUID(as_uuid=True), ForeignKey("plumber_reports.id"))
    used_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    template = relationship("PlumberReportTemplate")
    user = relationship("Staff", foreign_keys=[used_by])
    report = relationship("PlumberReport", foreign_keys=[report_id])