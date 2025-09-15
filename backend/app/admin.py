"""
SQLAdmin configuration for database management UI
"""

from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request
from starlette.responses import RedirectResponse
from sqlalchemy.orm import Session
import secrets

from app.domains.company.models import Company
from app.domains.invoice.models import Invoice, InvoiceItem
from app.domains.estimate.models import Estimate, EstimateItem
from app.domains.plumber_report.models import PlumberReport
from app.domains.document.models import Document
from app.document_types.models import DocumentType, Trade

# Simple authentication for admin panel (you can enhance this later)
class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        username = form.get("username")
        password = form.get("password")
        
        # Simple authentication - you should replace this with proper authentication
        # For now, using hardcoded credentials for development
        if username == "admin" and password == "admin123":
            request.session.update({"token": secrets.token_hex(16)})
            return True
        return False

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        token = request.session.get("token")
        return token is not None


# Custom Model Views with English labels and better display
class CompanyAdmin(ModelView, model=Company):
    name = "Company"
    name_plural = "Companies"
    icon = "fa-solid fa-building"
    
    column_list = [
        Company.id,
        Company.name,
        Company.company_code,
        Company.phone,
        Company.email,
        Company.city,
        Company.created_at
    ]
    
    column_labels = {
        "id": "ID",
        "name": "Company Name",
        "address": "Address",
        "phone": "Phone",
        "email": "Email",
        "website": "Website",
        "city": "City",
        "state": "State",
        "zipcode": "ZIP Code",
        "company_code": "Company Code",
        "license_number": "License Number",
        "insurance_info": "Insurance Info",
        "created_at": "Created At",
        "updated_at": "Updated At"
    }
    
    column_searchable_list = [Company.name, Company.company_code, Company.email]
    column_sortable_list = [Company.name, Company.created_at]
    column_default_sort = [(Company.created_at, True)]  # Sort by created_at desc
    page_size = 50


class InvoiceAdmin(ModelView, model=Invoice):
    name = "Invoice"
    name_plural = "Invoices"
    icon = "fa-solid fa-file-invoice"
    
    column_list = [
        Invoice.id,
        Invoice.invoice_number,
        Invoice.client_name,
        Invoice.total_amount,
        Invoice.status,
        Invoice.invoice_date,
        Invoice.due_date
    ]
    
    column_labels = {
        "id": "ID",
        "invoice_number": "송장 번호",
        "company_id": "Company ID",
        "client_name": "Client Name",
        "client_address": "고객 주소",
        "client_phone": "고객 전화번호",
        "client_email": "고객 이메일",
        "invoice_date": "송장 날짜",
        "due_date": "만기일",
        "status": "상태",
        "subtotal": "소계",
        "tax_rate": "세율",
        "tax_amount": "세금",
        "discount_amount": "할인",
        "total_amount": "총액",
        "notes": "메모",
        "terms": "조건",
        "payment_terms": "지불 조건",
        "created_at": "Created At",
        "updated_at": "Updated At"
    }
    
    column_searchable_list = [Invoice.invoice_number, Invoice.client_name]
    column_sortable_list = [Invoice.invoice_date, Invoice.total_amount, Invoice.status]
    column_default_sort = [(Invoice.invoice_date, True)]
    column_formatters = {
        Invoice.total_amount: lambda m, a: f"${m.total_amount:,.2f}" if m.total_amount else "$0.00",
        Invoice.status: lambda m, a: {
            "pending": "Pending",
            "paid": "Paid",
            "overdue": "Overdue",
            "cancelled": "Cancelled"
        }.get(m.status, m.status)
    }
    page_size = 50


class InvoiceItemAdmin(ModelView, model=InvoiceItem):
    name = "Invoice Item"
    name_plural = "Invoice Items"
    icon = "fa-solid fa-list"
    
    column_list = [
        InvoiceItem.id,
        InvoiceItem.invoice_id,
        InvoiceItem.description,
        InvoiceItem.quantity,
        InvoiceItem.rate,
        InvoiceItem.amount
    ]
    
    column_labels = {
        "id": "ID",
        "invoice_id": "송장 ID",
        "description": "Description",
        "quantity": "Quantity",
        "unit": "Unit",
        "rate": "Rate",
        "amount": "Amount",
        "tax_rate": "세율",
        "tax_amount": "세금",
        "order_index": "순서",
        "created_at": "Created At",
        "updated_at": "Updated At"
    }
    
    column_searchable_list = [InvoiceItem.description]
    column_sortable_list = [InvoiceItem.amount, InvoiceItem.order_index]
    column_formatters = {
        InvoiceItem.amount: lambda m, a: f"${m.amount:,.2f}" if m.amount else "$0.00",
        InvoiceItem.rate: lambda m, a: f"${m.rate:,.2f}" if m.rate else "$0.00"
    }
    page_size = 100


class EstimateAdmin(ModelView, model=Estimate):
    name = "Estimate"
    name_plural = "Estimates"
    icon = "fa-solid fa-calculator"
    
    column_list = [
        Estimate.id,
        Estimate.estimate_number,
        Estimate.client_name,
        Estimate.total_amount,
        Estimate.status,
        Estimate.estimate_date
    ]
    
    column_labels = {
        "id": "ID",
        "estimate_number": "견적 번호",
        "company_id": "Company ID",
        "client_name": "Client Name",
        "client_address": "고객 주소",
        "client_phone": "고객 전화번호",
        "client_email": "고객 이메일",
        "estimate_date": "견적 날짜",
        "valid_until": "유효 기한",
        "status": "상태",
        "subtotal": "소계",
        "tax_rate": "세율",
        "tax_amount": "세금",
        "discount_amount": "할인",
        "total_amount": "총액",
        "notes": "메모",
        "terms": "조건",
        "claim_number": "클레임 번호",
        "policy_number": "보험 번호",
        "deductible": "공제액",
        "depreciation_amount": "감가상각",
        "acv_amount": "실제 현금 가치",
        "rcv_amount": "교체 비용 가치",
        "room_data": "룸 데이터",
        "created_at": "Created At",
        "updated_at": "Updated At"
    }
    
    column_searchable_list = [Estimate.estimate_number, Estimate.client_name, Estimate.claim_number]
    column_sortable_list = [Estimate.estimate_date, Estimate.total_amount, Estimate.status]
    column_default_sort = [(Estimate.estimate_date, True)]
    column_formatters = {
        Estimate.total_amount: lambda m, a: f"${m.total_amount:,.2f}" if m.total_amount else "$0.00",
        Estimate.status: lambda m, a: {
            "draft": "Draft",
            "sent": "Sent",
            "accepted": "Accepted",
            "rejected": "Rejected",
            "expired": "Expired"
        }.get(m.status, m.status)
    }
    page_size = 50


class EstimateItemAdmin(ModelView, model=EstimateItem):
    name = "Estimate Item"
    name_plural = "Estimate Items"
    icon = "fa-solid fa-list-ol"
    
    column_list = [
        EstimateItem.id,
        EstimateItem.estimate_id,
        EstimateItem.room,
        EstimateItem.description,
        EstimateItem.quantity,
        EstimateItem.rate,
        EstimateItem.amount
    ]
    
    column_labels = {
        "id": "ID",
        "estimate_id": "견적 ID",
        "room": "룸",
        "description": "Description",
        "quantity": "Quantity",
        "unit": "Unit",
        "rate": "Rate",
        "amount": "Amount",
        "tax_rate": "세율",
        "tax_amount": "세금",
        "depreciation_rate": "감가상각률",
        "depreciation_amount": "감가상각액",
        "acv_amount": "ACV",
        "rcv_amount": "RCV",
        "order_index": "순서",
        "category": "카테고리",
        "created_at": "Created At",
        "updated_at": "Updated At"
    }
    
    column_searchable_list = [EstimateItem.description, EstimateItem.room, EstimateItem.category]
    column_sortable_list = [EstimateItem.amount, EstimateItem.order_index, EstimateItem.room]
    column_formatters = {
        EstimateItem.amount: lambda m, a: f"${m.amount:,.2f}" if m.amount else "$0.00",
        EstimateItem.rate: lambda m, a: f"${m.rate:,.2f}" if m.rate else "$0.00"
    }
    page_size = 100


class PlumberReportAdmin(ModelView, model=PlumberReport):
    name = "Plumber Report"
    name_plural = "Plumber Reports"
    icon = "fa-solid fa-wrench"
    
    column_list = [
        PlumberReport.id,
        PlumberReport.report_number,
        PlumberReport.client_name,
        PlumberReport.inspection_date,
        PlumberReport.status,
        PlumberReport.water_source
    ]
    
    column_labels = {
        "id": "ID",
        "report_number": "보고서 번호",
        "company_id": "Company ID",
        "client_name": "Client Name",
        "client_address": "고객 주소",
        "client_phone": "고객 전화번호",
        "client_email": "고객 이메일",
        "report_date": "보고서 날짜",
        "inspection_date": "검사 날짜",
        "status": "상태",
        "water_source": "수원",
        "water_pressure": "수압",
        "main_line_size": "주관 크기",
        "main_line_material": "주관 재질",
        "findings": "발견사항",
        "recommendations": "권고사항",
        "inspection_areas": "검사 구역",
        "attachments": "첨부파일",
        "created_at": "Created At",
        "updated_at": "Updated At"
    }
    
    column_searchable_list = [PlumberReport.report_number, PlumberReport.client_name]
    column_sortable_list = [PlumberReport.inspection_date, PlumberReport.status]
    column_default_sort = [(PlumberReport.report_date, True)]
    column_formatters = {
        PlumberReport.status: lambda m, a: {
            "draft": "Draft",
            "completed": "Completed",
            "sent": "발송됨"
        }.get(m.status, m.status)
    }
    page_size = 50


class DocumentAdmin(ModelView, model=Document):
    name = "Document"
    name_plural = "Documents"
    icon = "fa-solid fa-file"
    
    column_list = [
        Document.id,
        Document.document_type,
        Document.document_number,
        Document.client_name,
        Document.total_amount,
        Document.status,
        Document.created_date
    ]
    
    column_labels = {
        "id": "ID",
        "document_type": "문서 유형",
        "document_id": "문서 ID",
        "document_number": "문서 번호",
        "client_name": "Client Name",
        "total_amount": "총액",
        "status": "상태",
        "created_date": "생성일자",
        "pdf_url": "PDF URL",
        "created_at": "Created At",
        "updated_at": "Updated At"
    }
    
    column_searchable_list = [Document.document_number, Document.client_name]
    column_sortable_list = [Document.created_date, Document.total_amount, Document.document_type]
    column_default_sort = [(Document.created_date, True)]
    column_formatters = {
        Document.total_amount: lambda m, a: f"${m.total_amount:,.2f}" if m.total_amount else "$0.00",
        Document.document_type: lambda m, a: {
            "invoice": "송장",
            "estimate": "견적서",
            "plumber_report": "배관 보고서"
        }.get(m.document_type, m.document_type)
    }
    page_size = 50


class DocumentTypeAdmin(ModelView, model=DocumentType):
    name = "Document Type"
    name_plural = "Document Types"
    icon = "fa-solid fa-file-contract"
    
    column_list = [
        DocumentType.id,
        DocumentType.name,
        DocumentType.code,
        DocumentType.category,
        DocumentType.base_price,
        DocumentType.is_active,
        DocumentType.display_order
    ]
    
    column_labels = {
        "id": "ID",
        "name": "문서 유형명",
        "code": "코드",
        "description": "Description",
        "category": "카테고리",
        "base_price": "기본 가격",
        "pricing_rules": "가격 규칙",
        "requires_measurement_report": "측정 보고서 필요",
        "measurement_report_providers": "측정 보고서 제공자",
        "template_name": "템플릿 이름",
        "is_active": "활성화",
        "is_available_online": "온라인 가능",
        "display_order": "표시 순서",
        "created_at": "Created At",
        "updated_at": "Updated At",
        "created_by": "생성자",
        "updated_by": "수정자"
    }
    
    column_searchable_list = [DocumentType.name, DocumentType.code]
    column_sortable_list = [DocumentType.name, DocumentType.base_price, DocumentType.display_order]
    column_default_sort = [(DocumentType.display_order, False)]
    column_formatters = {
        DocumentType.base_price: lambda m, a: f"${m.base_price:,.2f}" if m.base_price else "$0.00",
        DocumentType.is_active: lambda m, a: "활성" if m.is_active else "비활성"
    }
    page_size = 50
    
    form_excluded_columns = ['created_at', 'updated_at']
    

class TradeAdmin(ModelView, model=Trade):
    name = "Trade"
    name_plural = "Trades"
    icon = "fa-solid fa-tools"
    
    column_list = [
        Trade.id,
        Trade.name,
        Trade.code,
        Trade.category,
        Trade.is_active,
        Trade.requires_license,
        Trade.requires_insurance,
        Trade.display_order
    ]
    
    column_labels = {
        "id": "ID",
        "name": "업종명",
        "code": "코드",
        "description": "Description",
        "category": "카테고리",
        "is_active": "활성화",
        "requires_license": "면허 필요",
        "requires_insurance": "보험 필요",
        "license_type": "면허 유형",
        "display_order": "표시 순서",
        "created_at": "Created At",
        "updated_at": "Updated At",
        "created_by": "생성자",
        "updated_by": "수정자"
    }
    
    column_searchable_list = [Trade.name, Trade.code, Trade.category]
    column_sortable_list = [Trade.name, Trade.category, Trade.display_order]
    column_default_sort = [(Trade.display_order, False)]
    column_formatters = {
        Trade.is_active: lambda m, a: "활성" if m.is_active else "비활성",
        Trade.requires_license: lambda m, a: "필요" if m.requires_license else "불필요",
        Trade.requires_insurance: lambda m, a: "필요" if m.requires_insurance else "불필요"
    }
    page_size = 50
    
    form_excluded_columns = ['created_at', 'updated_at']


def setup_admin(app, engine):
    """
    Setup SQLAdmin with authentication and model views
    """
    # Use a consistent secret key from settings if available
    from app.core.config import settings
    secret_key = settings.SECRET_KEY if hasattr(settings, 'SECRET_KEY') else secrets.token_hex(32)
    
    authentication_backend = AdminAuth(secret_key=secret_key)
    
    admin = Admin(
        app=app,
        engine=engine,
        title="MJ Estimate Database Admin",
        authentication_backend=authentication_backend,
        base_url="/admin"
    )
    
    # Add all model views
    admin.add_view(CompanyAdmin)
    admin.add_view(InvoiceAdmin)
    admin.add_view(InvoiceItemAdmin)
    admin.add_view(EstimateAdmin)
    admin.add_view(EstimateItemAdmin)
    admin.add_view(PlumberReportAdmin)
    admin.add_view(DocumentAdmin)
    
    return admin