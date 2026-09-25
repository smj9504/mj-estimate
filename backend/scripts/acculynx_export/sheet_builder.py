"""
Phase 4: turn the raw JSON (API + web capture) into spreadsheet tabs that
follow AccuLynx's own layout - one tab per section of an AccuLynx job file,
with column names taken from AccuLynx's field names.

Every job-level row starts with Job ID / Job # / Job Name so any tab can be
filtered back to a job, and the Jobs tab links each job to its Drive folder.
"""

import html
import json
import re
from collections import OrderedDict
from typing import Any, Dict, Iterable, List, Optional

from .config import ExportConfig

MAX_CELL = 49_000  # Google Sheets hard limit is 50,000 characters per cell

JOB_KEY_COLUMNS = ["Job ID", "Job #", "Job Name"]


def g(data: Any, path: str, default: Any = "") -> Any:
    """Safe nested get: g(job, 'locationAddress.state.abbreviation')."""
    cur = data
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return default
        if cur is None:
            return default
    return cur


def yes_no(value: Any) -> str:
    if value is True:
        return "Yes"
    if value is False:
        return "No"
    return ""


def fmt_address(addr: Optional[Dict]) -> str:
    if not addr:
        return ""
    parts = [addr.get("street1"), addr.get("street2"), addr.get("city"),
             " ".join(filter(None, [g(addr, "state.abbreviation") or g(addr, "state.name"), addr.get("zipCode")]))]
    return ", ".join(p for p in parts if p)


def strip_html(text: Any) -> str:
    if not isinstance(text, str):
        return "" if text is None else str(text)
    text = re.sub(r"<(br|/p|/div|/li)\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return yes_no(value)
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, default=str)
    if isinstance(value, str) and len(value) > MAX_CELL:
        return value[:MAX_CELL] + " …[truncated - see raw JSON]"
    return value


class Tab:
    def __init__(self, name: str, columns: List[str]):
        self.name = name
        self.columns = columns
        self.rows: List[List[Any]] = []

    def add(self, **values: Any) -> None:
        unknown = set(values) - set(self.columns)
        if unknown:
            raise KeyError(f"{self.name}: unknown columns {unknown}")
        self.rows.append([cell(values.get(c)) for c in self.columns])

    def as_values(self) -> List[List[Any]]:
        return [self.columns] + self.rows


def _kw(columns: Iterable[str]) -> Dict[str, str]:
    """Map 'Job #' style headers to python-friendly keyword names."""
    return {c: re.sub(r"\W+", "_", c).strip("_").lower() for c in columns}


class SheetBuilder:
    def __init__(self, cfg: ExportConfig, drive_state: Optional[Dict] = None):
        self.cfg = cfg
        self.drive = drive_state or {"jobs": {}}
        self.tabs: "OrderedDict[str, Tab]" = OrderedDict()
        self._define_tabs()
        self.users = {u["id"]: u for u in self._load_company("users") or [] if isinstance(u, dict)}
        self.contacts: Dict[str, Dict] = {}

    # ---------------- tab definitions (AccuLynx job-file order) ----------------

    def _define_tabs(self) -> None:
        J = JOB_KEY_COLUMNS
        defs = [
            ("Jobs", J + [
                "Current Milestone", "Milestone Status", "Milestone Date", "Priority", "Assignment",
                "Primary Contact", "Primary Contact ID", "Location Address", "Street 1", "Street 2",
                "City", "State", "Zip", "Country", "Latitude", "Longitude",
                "Job Category", "Work Type", "Trade Types", "Lead Source", "Lead Source (Child)",
                "Lead Dead Reason", "Company Representative", "Sales Owner", "A/R Owner",
                "Initial Appointment Start", "Initial Appointment End", "Initial Appointment Notes",
                "Insurance Company", "Claim #", "Date of Loss",
                "Approved Job Value", "Balance Due", "Created Date", "Modified Date",
                "Drive Folder", "Drive Path", "Photos & Videos", "Documents", "Communications",
                "Export Errors",
            ]),
            ("Contacts", [
                "Contact ID", "Contact Type", "Salutation", "First Name", "Last Name", "Company Name",
                "Cross Reference", "Primary Email", "All Emails", "Primary Phone", "All Phones",
                "SMS Opt-Out", "Mailing Address", "Billing Address", "Job IDs", "Job #s",
                "Custom Fields", "Created Date", "Modified Date",
            ]),
            ("Job Contacts", J + ["Contact ID", "Contact Name", "Is Primary", "Relation to Primary",
                                  "Email", "Phone"]),
            ("Insurance", J + [
                "Insurance Company", "Custom Insurance Company", "Damage Location", "Date of Loss",
                "Claim Filed", "Claim Filed Date", "Claim #", "Has Paperwork",
                "Adjuster Name", "Adjuster Phone", "Adjuster Phone Ext", "Adjuster Phone Type",
                "Adjuster Fax", "Adjuster Email", "Met With Adjuster", "Met With Adjuster Date",
                "Claim Approved", "Claim Approved Date",
            ]),
            ("Representatives", J + ["Type", "User", "User ID", "User Email"]),
            ("Custom Fields", ["Entity", "Entity ID"] + J[1:] + ["Label", "Field Type", "Value",
                                                                 "Modified By", "Modified Date"]),
            ("Communications", J + [
                "Date", "Channel", "Direction", "From", "To", "Subject", "Message",
                "Thread ID", "Message ID", "Tags", "Attachments", "Attachment Drive Links", "Raw",
            ]),
            ("Photos & Videos", J + ["File Name", "Tags / Album", "Description", "Taken / Uploaded",
                                     "Uploaded By", "Drive Link", "Drive Path", "Size (bytes)",
                                     "Content Type", "Source URL", "Download Error"]),
            ("Documents", J + ["Section", "AccuLynx Folder", "File Name", "Description", "Uploaded",
                               "Uploaded By", "Drive Link", "Drive Path", "Size (bytes)",
                               "Content Type", "Source URL", "Download Error"]),
            ("Estimates", J + [
                "Estimate ID", "Estimate #", "Title", "Description", "Is Primary",
                "Total Cost", "Total Price", "Tax Rate", "Tax Total", "Overhead Rate", "Overhead Total",
                "Profit Rate", "Profit Total", "Profit Margin Rate", "Profit Margin Total", "Notes",
                "Created By", "Created Date", "Modified By", "Modified Date",
            ]),
            ("Estimate Items", J + [
                "Estimate ID", "Estimate #", "Section", "Item ID", "Item Name", "Override Name",
                "Description", "Type", "Quantity", "Measurement Quantity", "Order Quantity",
                "Estimate Unit", "Order Unit", "Unit Conversion", "Material Cost", "Labor Cost",
                "Waste", "Price", "Fixed Price", "Total Price",
            ]),
            ("Financials", J + [
                "Financials ID", "Approved Job Value", "Balance Due", "Worksheet Total",
                "Change Order Total", "Insurance Claim Total", "Upgrade Total", "Discount Total",
                "Supplement Total", "Work Not Doing Total", "Sales Amount", "A/R Age (days)",
                "% Collected", "Accounting Integration Status",
            ]),
            ("Worksheet Items", J + ["Source", "Title", "State", "Section Type", "Item ID",
                                     "Item Name", "Price", "Total Price", "Parent Item ID",
                                     "Trade", "Created Date", "Modified Date"]),
            ("Invoices", J + ["Invoice ID", "Invoice #", "Invoice Name", "Invoice Date", "Due Date",
                              "State", "Total Price", "Balance Due", "Recording Status",
                              "Recording Classification", "Created Date"]),
            ("Invoice Items", J + ["Invoice ID", "Invoice #", "Section Type", "Item ID", "Item Name",
                                   "Price", "Total Price", "Line Item Assignment", "Reference Type",
                                   "Reference ID", "Parent Item ID"]),
            ("Payments", J + [
                "Group", "Payment ID", "Payment Type", "Payment Method", "Check / Ref #", "From / To",
                "Amount", "Payment Date", "Is Paid", "Notes", "Surcharge Fee", "Convenience Fee",
                "Convenience Fee Refund", "Parent ID", "Last Edited Date", "System",
            ]),
            ("Supplements", J + [
                "Supplement ID", "Name", "State", "Status ID", "Assigned Supplementer", "Assigned Date",
                "Total Original Claim", "Total Requested", "Total Approved", "Total Applied",
                "Created By", "Created Date", "Edited Date", "Closed Date", "Applied Date",
            ]),
            ("Supplement Items", J + ["Supplement ID", "Supplement", "Item ID", "Name", "Description",
                                      "Original Claim Amount", "Requested Amount", "Approved Amount",
                                      "Applied Amount"]),
            ("Supplement Notes", J + ["Supplement ID", "Supplement", "Date", "Created By", "Spoke With",
                                      "Notes", "Phone", "Extension", "Fax", "Email"]),
            ("Milestone History", J + ["Milestone", "Date"]),
            ("Job History", J + ["Date", "Source", "Type", "Action", "By", "Lead Dead Reason"]),
            ("Appointments", J + ["Appointment ID", "Calendar", "Event Type", "Title", "Start", "End",
                                  "All Day", "Location", "Attendees", "Shared With Customer Portal"]),
            ("Users", ["User ID", "Display Name", "First Name", "Last Name", "Initials", "Role",
                       "Status", "Email", "Phone", "Mobile Phone"]),
            ("Company Settings", ["Setting", "ID", "Name", "Details"]),
        ]
        for name, cols in defs:
            self.tabs[name] = Tab(name, cols)

    def add(self, tab: str, **values) -> None:
        t = self.tabs[tab]
        by_kw = {v: k for k, v in _kw(t.columns).items()}
        self.tabs[tab].add(**{by_kw.get(k, k): v for k, v in values.items()})

    # ---------------- helpers ----------------

    def _load_company(self, name: str) -> Any:
        path = self.cfg.raw_api_dir / "company" / f"{name}.json"
        return json.loads(path.read_text()) if path.exists() else None

    def user_name(self, ref: Any) -> str:
        if isinstance(ref, dict):
            uid = ref.get("id")
            if ref.get("displayName"):
                return ref["displayName"]
            if ref.get("user"):
                return self.user_name(ref["user"])
        else:
            uid = ref
        u = self.users.get(uid) if uid else None
        if u:
            return u.get("displayName") or f"{u.get('firstName', '')} {u.get('lastName', '')}".strip()
        return uid or ""

    @staticmethod
    def contact_name(contact: Optional[Dict]) -> str:
        if not contact:
            return ""
        name = " ".join(filter(None, [contact.get("firstName"), contact.get("lastName")]))
        return name or contact.get("companyName") or contact.get("id", "")

    # ---------------- build ----------------

    def build(self) -> "OrderedDict[str, Tab]":
        for path in sorted((self.cfg.raw_api_dir / "contacts").glob("*.json")):
            rec = json.loads(path.read_text())
            self.contacts[path.stem] = rec

        job_numbers: Dict[str, Dict] = {}
        for path in sorted((self.cfg.raw_api_dir / "jobs").glob("*.json")):
            rec = json.loads(path.read_text())
            job_id = path.stem
            job = rec.get("job") or rec.get("listing") or {}
            key = {"job_id": job_id, "job": job.get("jobNumber", ""), "job_name": job.get("jobName", "")}
            job_numbers[job_id] = key
            self._job_rows(job_id, rec, key)

        self._contact_rows(job_numbers)
        self._appointment_rows(job_numbers)
        self._user_rows()
        self._company_rows()
        return self.tabs

    def _job_rows(self, job_id: str, rec: Dict, key: Dict) -> None:
        job = rec.get("job") or rec.get("listing") or {}
        addr = job.get("locationAddress") or {}
        ins = rec.get("insurance") or {}
        adj = rec.get("adjuster") or {}
        fin = rec.get("financials") or {}
        appt = rec.get("initial_appointment") or job.get("initialAppointment") or {}
        drive = self.drive.get("jobs", {}).get(job_id, {})

        primary = next((c for c in rec.get("contacts") or [] if c.get("isPrimary")), None)
        primary_contact = (primary or {}).get("contact") or {}
        primary_id = primary_contact.get("id", "")
        if primary_id in self.contacts:
            primary_contact = self.contacts[primary_id].get("contact") or primary_contact

        web_counts = self._web_counts(job_id)
        lead_source = job.get("leadSource") or {}
        children = lead_source.get("children") or []
        self.add(
            "Jobs", **key,
            current_milestone=g(rec, "current_milestone.name") or job.get("currentMilestone"),
            milestone_status=g(rec, "current_milestone.status.name"),
            milestone_date=job.get("milestoneDate"), priority=job.get("priority"),
            assignment=(rec.get("listing") or {}).get("_assignment", ""),
            primary_contact=self.contact_name(primary_contact), primary_contact_id=primary_id,
            location_address=fmt_address(addr), street_1=addr.get("street1"), street_2=addr.get("street2"),
            city=addr.get("city"), state=g(addr, "state.abbreviation"), zip=addr.get("zipCode"),
            country=g(addr, "country.abbreviation"),
            latitude=g(job, "geoLocation.latitude"), longitude=g(job, "geoLocation.longitude"),
            job_category=g(job, "jobCategory.name"), work_type=g(job, "workType.name"),
            trade_types=", ".join(t.get("name", "") for t in job.get("tradeTypes") or []),
            lead_source=lead_source.get("name"),
            lead_source_child=", ".join(c.get("name", "") for c in children),
            lead_dead_reason=job.get("leadDeadReason"),
            company_representative=self.user_name(rec.get("company_representative")),
            sales_owner=self.user_name(rec.get("sales_owner")), a_r_owner=self.user_name(rec.get("ar_owner")),
            initial_appointment_start=appt.get("startDate"), initial_appointment_end=appt.get("endDate"),
            initial_appointment_notes=appt.get("notes"),
            insurance_company=g(ins, "insuranceCompany.name") or ins.get("customInsuranceCompanyName"),
            claim=ins.get("claimNumber"), date_of_loss=ins.get("dateOfLoss"),
            approved_job_value=fin.get("approvedJobValue"), balance_due=fin.get("balanceDue"),
            created_date=job.get("createdDate"), modified_date=job.get("modifiedDate"),
            drive_folder=drive.get("folder_link"), drive_path=drive.get("folder_path"),
            photos_videos=web_counts.get("photos_videos"), documents=web_counts.get("documents"),
            communications=web_counts.get("communications"),
            export_errors=rec.get("errors") or "",
        )

        for jc in rec.get("contacts") or []:
            c = jc.get("contact") or {}
            full = (self.contacts.get(c.get("id")) or {})
            emails = full.get("email_addresses") or c.get("emailAddresses") or []
            phones = full.get("phone_numbers") or c.get("phoneNumbers") or []
            self.add("Job Contacts", **key, contact_id=c.get("id"),
                     contact_name=self.contact_name(full.get("contact") or c),
                     is_primary=jc.get("isPrimary"), relation_to_primary=jc.get("relationToPrimary"),
                     email=", ".join(e.get("address", "") for e in emails if isinstance(e, dict)),
                     phone=", ".join(p.get("number", "") for p in phones if isinstance(p, dict)))

        if ins or adj:
            phone = adj.get("phone") or {}
            self.add("Insurance", **key,
                     insurance_company=g(ins, "insuranceCompany.name"),
                     custom_insurance_company=ins.get("customInsuranceCompanyName"),
                     damage_location=ins.get("damagelocation") or ins.get("damageLocation"),
                     date_of_loss=ins.get("dateOfLoss"), claim_filed=ins.get("claimFiled"),
                     claim_filed_date=ins.get("claimFiledDate"), claim=ins.get("claimNumber"),
                     has_paperwork=ins.get("hasPaperwork"), adjuster_name=adj.get("adjusterName"),
                     adjuster_phone=phone.get("number") if isinstance(phone, dict) else phone,
                     adjuster_phone_ext=phone.get("ext") if isinstance(phone, dict) else "",
                     adjuster_phone_type=phone.get("type") if isinstance(phone, dict) else "",
                     adjuster_fax=adj.get("fax"), adjuster_email=adj.get("email"),
                     met_with_adjuster=adj.get("metWithAdjuster"),
                     met_with_adjuster_date=adj.get("metWithAdjusterDate"),
                     claim_approved=adj.get("claimApproved"), claim_approved_date=adj.get("claimApprovedDate"))

        for rep in rec.get("representatives") or []:
            user = self.users.get(g(rep, "user.id")) or {}
            self.add("Representatives", **key, type=rep.get("type"), user=self.user_name(rep.get("user")),
                     user_id=g(rep, "user.id"), user_email=user.get("email"))

        for cf in rec.get("custom_fields") or []:
            self._custom_field_row("Job", job_id, key, cf)

        self._communication_rows(job_id, key)
        self._file_rows(job_id, key)

        for est in rec.get("estimates") or []:
            f = est.get("financials") or {}
            self.add("Estimates", **key, estimate_id=est.get("id"), estimate=est.get("estimateNumber"),
                     title=est.get("title"), description=est.get("description"), is_primary=est.get("isPrimary"),
                     total_cost=f.get("totalCost"), total_price=f.get("totalPrice"), tax_rate=f.get("taxRate"),
                     tax_total=f.get("taxTotal"), overhead_rate=f.get("overheadRate"),
                     overhead_total=f.get("overheadTotal"), profit_rate=f.get("profitRate"),
                     profit_total=f.get("profitTotal"), profit_margin_rate=est.get("profitMarginRate"),
                     profit_margin_total=est.get("profitMarginTotal"), notes=est.get("notes"),
                     created_by=self.user_name(est.get("createdBy")), created_date=est.get("createdDate"),
                     modified_by=self.user_name(est.get("modifiedBy")), modified_date=est.get("modifiedDate"))
            for section in est.get("sections") or []:
                for item in section.get("items") or []:
                    self.add("Estimate Items", **key, estimate_id=est.get("id"),
                             estimate=est.get("estimateNumber"),
                             section=section.get("name") or section.get("title") or section.get("id"),
                             item_id=item.get("id"), item_name=item.get("name"),
                             override_name=item.get("overrideName"), description=item.get("description"),
                             type=item.get("type"), quantity=item.get("quantity"),
                             measurement_quantity=item.get("measurementQuantity"),
                             order_quantity=item.get("orderQuantity"), estimate_unit=item.get("estimateUnit"),
                             order_unit=item.get("orderUnit"), unit_conversion=item.get("unitConversion"),
                             material_cost=item.get("materialCost"), labor_cost=item.get("laborCost"),
                             waste=item.get("waste"), price=item.get("price"),
                             fixed_price=item.get("fixedPrice"), total_price=item.get("totalPrice"))

        if fin:
            t = fin.get("worksheetSectionTotals") or {}
            ov = rec.get("payments_overview") or {}
            self.add("Financials", **key, financials_id=fin.get("id"),
                     approved_job_value=fin.get("approvedJobValue"), balance_due=fin.get("balanceDue"),
                     worksheet_total=t.get("worksheetTotal"), change_order_total=t.get("changeOrderTotal"),
                     insurance_claim_total=t.get("insuranceClaimTotal"), upgrade_total=t.get("upgradeTotal"),
                     discount_total=t.get("discountTotal"), supplement_total=t.get("supplementTotal"),
                     work_not_doing_total=t.get("workNotDoingTotal"), sales_amount=ov.get("salesAmount"),
                     a_r_age_days=ov.get("arAge"), collected=ov.get("percentageCollected"),
                     accounting_integration_status=rec.get("accounting_integration_status"))
            sheets = [("Worksheet", fin.get("worksheet_detail"))]
            sheets += [("Amendment", a) for a in fin.get("amendments_detail") or []]
            for source, ws in sheets:
                for section in (ws or {}).get("sections") or []:
                    for item in section.get("items") or []:
                        self.add("Worksheet Items", **key, source=source, title=ws.get("title"),
                                 state=ws.get("currentState"), section_type=section.get("sectionType"),
                                 item_id=item.get("id"), item_name=item.get("itemName"),
                                 price=item.get("price"), total_price=item.get("totalPrice"),
                                 parent_item_id=item.get("parentItemId"), trade=item.get("tradeId"),
                                 created_date=ws.get("createdDate"), modified_date=ws.get("modifiedDate"))

        for inv in rec.get("invoices") or []:
            self.add("Invoices", **key, invoice_id=inv.get("id"), invoice=inv.get("invoiceNumber"),
                     invoice_name=inv.get("invoiceName"), invoice_date=inv.get("invoiceDate"),
                     due_date=inv.get("dueDate"), state=inv.get("currentInvoiceState"),
                     total_price=inv.get("totalPrice"), balance_due=inv.get("balanceDue"),
                     recording_status=inv.get("recordingStatus"),
                     recording_classification=inv.get("recordingClassification"),
                     created_date=inv.get("createdDate"))
            for section in inv.get("sections") or []:
                for item in section.get("items") or []:
                    self.add("Invoice Items", **key, invoice_id=inv.get("id"), invoice=inv.get("invoiceNumber"),
                             section_type=section.get("invoiceWorksheetSectionType"), item_id=item.get("id"),
                             item_name=item.get("itemName"), price=item.get("price"),
                             total_price=item.get("totalPrice"), line_item_assignment=item.get("lineItemAssignment"),
                             reference_type=item.get("referenceType"), reference_id=item.get("referenceId"),
                             parent_item_id=item.get("parentItemId"))

        payments = rec.get("payments") or {}
        for group, outer, inner, party, ref in (
            ("Received", "receivedPayments", "receivedPayments", "from", "checkNumber"),
            ("Paid", "paidPayments", "paidPayments", "to", "refNumber"),
            ("Additional Expense", "additionalExpenses", "additionalExpenses", "to", "refNumber"),
        ):
            for p in g(payments, f"{outer}.{inner}", []) or []:
                self.add("Payments", **key, group=group, payment_id=p.get("id"),
                         payment_type=p.get("paymentType"), payment_method=p.get("paymentMethod"),
                         check_ref=p.get(ref), from_to=p.get(party), amount=p.get("amount"),
                         payment_date=p.get("paymentDate") or p.get("transactionDate"), is_paid=p.get("isPaid"),
                         notes=p.get("notes"), surcharge_fee=g(p, "surchargeFee.amount"),
                         convenience_fee=g(p, "convenienceFee.amount"),
                         convenience_fee_refund=g(p, "convenienceFeeRefund.amount"),
                         parent_id=p.get("parentId"), last_edited_date=p.get("lastEditedDate"),
                         system=p.get("system"))

        for s in rec.get("supplements") or []:
            items = g(s, "itemsToSupplement", {}) or {}
            self.add("Supplements", **key, supplement_id=s.get("id"), name=s.get("name"),
                     state=g(s, "state.supplementState"), status_id=g(s, "status.id"),
                     assigned_supplementer=self.user_name(g(s, "assignedSupplementer.supplementerAssigned", None)),
                     assigned_date=g(s, "assignedSupplementer.assignedDate"),
                     total_original_claim=items.get("totalOriginalClaimAmount"),
                     total_requested=items.get("totalRequestedAmount"),
                     total_approved=items.get("totalApprovedAmount"),
                     total_applied=items.get("totalAppliedAmount"),
                     created_by=self.user_name(s.get("createdBy")), created_date=s.get("createdDate"),
                     edited_date=s.get("editedDate"), closed_date=s.get("closedDate"),
                     applied_date=s.get("appliedDate"))
            for item in s.get("items_detail") or items.get("items") or []:
                self.add("Supplement Items", **key, supplement_id=s.get("id"), supplement=s.get("name"),
                         item_id=item.get("id"), name=item.get("name"), description=item.get("description"),
                         original_claim_amount=item.get("originalClaimAmount"),
                         requested_amount=item.get("requestedAmount"), approved_amount=item.get("approvedAmount"),
                         applied_amount=item.get("appliedAmount"))
            for n in s.get("notations_detail") or s.get("notations") or []:
                self.add("Supplement Notes", **key, supplement_id=s.get("id"), supplement=s.get("name"),
                         date=n.get("createdDate"), created_by=self.user_name(n.get("createdBy")),
                         spoke_with=n.get("spokeWith"), notes=n.get("notes"), phone=n.get("phone"),
                         extension=n.get("extension"), fax=n.get("fax"), email=n.get("email"))

        for m in rec.get("milestone_history") or []:
            self.add("Milestone History", **key, milestone=m.get("name"), date=m.get("date"))

        for source, entries in (("Job", rec.get("history")), ("Lead", rec.get("lead_history"))):
            for h in entries or []:
                self.add("Job History", **key, date=h.get("date"), source=source, type=h.get("type"),
                         action=h.get("action"), by=self.user_name(h.get("createdBy")),
                         lead_dead_reason=h.get("leadDeadReason"))

    def _custom_field_row(self, entity: str, entity_id: str, key: Dict, cf: Dict) -> None:
        values = ", ".join(str(v.get("value", "")) for v in cf.get("values") or [] if isinstance(v, dict))
        self.add("Custom Fields", entity=entity, entity_id=entity_id, job=key.get("job"),
                 job_name=key.get("job_name"), label=cf.get("label"), field_type=cf.get("fieldType"),
                 value=values, modified_by=self.user_name(cf.get("modifiedBy")),
                 modified_date=cf.get("modifiedDate"))

    # ---------------- web capture tabs ----------------

    def _web_manifest(self, job_id: str, section: str) -> Dict[str, Dict]:
        path = self.cfg.files_dir / job_id / section / "_manifest.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def _web_counts(self, job_id: str) -> Dict[str, int]:
        counts = {s: sum(1 for m in self._web_manifest(job_id, s).values() if "local_path" in m)
                  for s in ("photos_videos", "documents")}
        counts["communications"] = len(list(self._iter_messages(job_id)))
        return counts

    def _file_rows(self, job_id: str, key: Dict) -> None:
        job_files = self.cfg.files_dir / job_id
        if not job_files.exists():
            return
        for manifest_path in sorted(job_files.glob("*/_manifest.json")):
            section = manifest_path.parent.name
            for entry in json.loads(manifest_path.read_text()).values():
                meta = entry.get("meta") or {}
                drive = entry.get("drive") or {}
                common = dict(
                    file_name=entry.get("file_name") or first(meta, "fileName", "name", "title"),
                    description=first(meta, "description", "caption", "notes"),
                    uploaded_by=first(meta, "uploadedBy", "createdByName", "userName", "createdBy"),
                    drive_link=drive.get("link"), drive_path=drive.get("path"),
                    size_bytes=entry.get("size"), content_type=entry.get("content_type"),
                    source_url=entry.get("url", "").split("?")[0], download_error=entry.get("error"),
                )
                date_value = first(meta, "dateTaken", "takenDate", "createdDate", "uploadedDate", "date", "createdOn")
                if section == "photos_videos":
                    self.add("Photos & Videos", **key, tags_album=first(meta, "tags", "tagNames", "album", "albumName"),
                             taken_uploaded=date_value, **common)
                else:
                    self.add("Documents", **key, section=section,
                             acculynx_folder=first(meta, "folderName", "documentFolderName", "folder", "category"),
                             uploaded=date_value, **common)

    MESSAGE_BODY_KEYS = ("body", "message", "messageText", "text", "content", "note", "comment", "htmlBody")

    def _iter_messages(self, job_id: str) -> Iterable[Dict]:
        """
        Pull message-like objects out of the captured Communications JSON.
        Field names below are the common candidates; confirm them against the
        `web-discover` output and adjust if AccuLynx uses different ones.
        """
        comm_dir = self.cfg.raw_web_dir / job_id / "communications"
        if not comm_dir.exists():
            return
        seen = set()
        for path in sorted(comm_dir.glob("*.json")):
            body = json.loads(path.read_text()).get("body")
            for msg, thread in _walk_messages(body, None):
                mid = msg.get("id") or msg.get("messageId") or json.dumps(msg, sort_keys=True, default=str)[:200]
                if mid in seen:
                    continue
                seen.add(mid)
                yield {"msg": msg, "thread": thread}

    def _communication_rows(self, job_id: str, key: Dict) -> None:
        attachments = self._web_manifest(job_id, "communications")
        by_url = {e.get("url", "").split("?")[0]: e for e in attachments.values()}
        rows = []
        for item in self._iter_messages(job_id):
            msg, thread = item["msg"], item["thread"] or {}
            files = []
            for ref in _iter_urls(msg):
                entry = by_url.get(ref.split("?")[0])
                if entry:
                    files.append(entry)
            rows.append(dict(
                date=first(msg, "createdDate", "sentDate", "date", "timestamp", "createdOn", "sentOn", "dateCreated"),
                channel=first(msg, "channel", "messageType", "type", "source", "communicationType")
                or first(thread, "channel", "type", "messageType"),
                direction=first(msg, "direction", "inbound", "isInbound", "isIncoming"),
                from_=_person(first(msg, "from", "sender", "author", "createdBy", "fromName", "user")),
                to=_person(first(msg, "to", "recipients", "toName", "recipient")),
                subject=first(msg, "subject", "title") or first(thread, "subject", "title"),
                message=strip_html(first(msg, *self.MESSAGE_BODY_KEYS)),
                thread_id=first(thread, "id", "threadId") or first(msg, "threadId", "conversationId", "parentId"),
                message_id=first(msg, "id", "messageId"),
                tags=_person(first(msg, "tags", "tagNames")),
                attachments=", ".join(e.get("file_name", "") for e in files),
                attachment_drive_links="\n".join((e.get("drive") or {}).get("link", "") for e in files),
                raw=msg,
            ))
        rows.sort(key=lambda r: str(r["date"]))
        for r in rows:
            r["from"] = r.pop("from_")
            self.add("Communications", **key, **r)

    # ---------------- company-wide tabs ----------------

    def _contact_rows(self, job_numbers: Dict[str, Dict]) -> None:
        types = {t.get("id"): t.get("name") for t in self._load_company("contact_types") or [] if isinstance(t, dict)}
        for cid, rec in self.contacts.items():
            c = rec.get("contact") or rec.get("listing") or {}
            emails = rec.get("email_addresses") or c.get("emailAddresses") or []
            phones = rec.get("phone_numbers") or c.get("phoneNumbers") or []
            primary_email = next((e.get("address") for e in emails if e.get("primary")), "")
            primary_phone = next((p.get("number") for p in phones if p.get("primary")), "")
            job_ids = [j.get("id") for j in rec.get("jobs") or [] if j.get("id")]
            ctypes = c.get("contactTypes") or c.get("contactTypeIds") or []
            self.add("Contacts", contact_id=cid,
                     contact_type=", ".join(types.get(t.get("id") if isinstance(t, dict) else t, "")
                                            or (t.get("name", "") if isinstance(t, dict) else str(t)) for t in ctypes),
                     salutation=c.get("salutation"), first_name=c.get("firstName"), last_name=c.get("lastName"),
                     company_name=c.get("companyName"), cross_reference=c.get("crossReference"),
                     primary_email=primary_email,
                     all_emails=", ".join(e.get("address", "") for e in emails),
                     primary_phone=primary_phone,
                     all_phones=", ".join(f"{p.get('number', '')}{' x' + p['ext'] if p.get('ext') else ''}"
                                          f" ({p.get('type', '')})" for p in phones),
                     sms_opt_out=any(p.get("smsOptOut") for p in phones),
                     mailing_address=fmt_address(c.get("mailingAddress")),
                     billing_address=fmt_address(c.get("billingAddress")),
                     job_ids=", ".join(job_ids),
                     job_s=", ".join(filter(None, (job_numbers.get(j, {}).get("job") for j in job_ids))),
                     custom_fields="; ".join(
                         f"{cf.get('label')}: {', '.join(str(v.get('value', '')) for v in cf.get('values') or [])}"
                         for cf in rec.get("custom_fields") or []),
                     created_date=c.get("createdDate"), modified_date=c.get("modifiedDate"))
            for cf in rec.get("custom_fields") or []:
                self._custom_field_row("Contact", cid, {}, cf)

    def _appointment_rows(self, job_numbers: Dict[str, Dict]) -> None:
        path = self.cfg.raw_api_dir / "appointments.json"
        if not path.exists():
            return
        appts = json.loads(path.read_text())
        appts.sort(key=lambda a: str(a.get("start")))
        for a in appts:
            job_id = g(a, "job.id")
            key = job_numbers.get(job_id, {"job_id": job_id, "job": "", "job_name": a.get("jobName", "")})
            self.add("Appointments", **key, appointment_id=a.get("id"), calendar=g(a, "_calendar.name"),
                     event_type=a.get("eventType"), title=a.get("title"), start=a.get("start"), end=a.get("end"),
                     all_day=a.get("allDay"), location=a.get("location"),
                     attendees=", ".join(self.user_name(x) for x in a.get("attendees") or []),
                     shared_with_customer_portal=a.get("sharedWithCustomerPortal"))

    def _user_rows(self) -> None:
        for u in self.users.values():
            self.add("Users", user_id=u.get("id"), display_name=u.get("displayName"),
                     first_name=u.get("firstName"), last_name=u.get("lastName"), initials=u.get("initials"),
                     role=g(u, "role.name"), status=u.get("status"), email=u.get("email"),
                     phone=u.get("phone"), mobile_phone=u.get("mobilePhone"))

    def _company_rows(self) -> None:
        company_dir = self.cfg.raw_api_dir / "company"
        if not company_dir.exists():
            return
        for path in sorted(company_dir.glob("*.json")):
            if path.stem == "users":
                continue
            data = json.loads(path.read_text())
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                self.add("Company Settings", setting=path.stem, id=item.get("id"),
                         name=item.get("name") or item.get("title") or item.get("label"), details=item)


# ---------------- module helpers ----------------


def first(data: Any, *keys: str) -> Any:
    if not isinstance(data, dict):
        return ""
    for k in keys:
        v = data.get(k)
        if v not in (None, "", [], {}):
            return v
    return ""


def _person(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(filter(None, (_person(v) for v in value)))
    if isinstance(value, dict):
        name = value.get("displayName") or value.get("name") or " ".join(
            filter(None, [value.get("firstName"), value.get("lastName")]))
        contact = value.get("email") or value.get("address") or value.get("phone") or value.get("number")
        return " ".join(filter(None, [name, f"<{contact}>" if contact else ""])) or value.get("id", "")
    return "" if value is None else str(value)


def _walk_messages(data: Any, thread: Optional[Dict]) -> Iterable:
    """Find dicts that carry a message body; the nearest enclosing dict is treated as the thread."""
    if isinstance(data, list):
        for item in data:
            yield from _walk_messages(item, thread)
    elif isinstance(data, dict):
        if any(isinstance(data.get(k), str) and data.get(k).strip() for k in SheetBuilder.MESSAGE_BODY_KEYS):
            yield data, thread
            for k in ("replies", "children", "comments"):
                if isinstance(data.get(k), list):
                    yield from _walk_messages(data[k], data)
            return
        scalar = {k: v for k, v in data.items() if not isinstance(v, (dict, list))}
        for v in data.values():
            if isinstance(v, (dict, list)):
                yield from _walk_messages(v, scalar or thread)


def _iter_urls(data: Any) -> Iterable[str]:
    if isinstance(data, dict):
        for v in data.values():
            yield from _iter_urls(v)
    elif isinstance(data, list):
        for v in data:
            yield from _iter_urls(v)
    elif isinstance(data, str) and data.startswith(("http://", "https://")):
        yield data
