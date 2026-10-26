"""A carrier estimate's totals are read from its own summary, one section per
coverage, for each summary layout seen in real carrier PDFs."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.insurance_extraction.parsers.estimate_summary import parse_estimate_summary  # noqa: E402

# Travelers' "how to read your estimate" page, as pdfplumber reads it
TRAVELERS_GUIDE = """\
Totals: Living Room 122.48 2,251.24 325.31 1,925.93 Totals: Main Level 122.48
Line Item Totals: GUIDE_EXAMPLE 145.10 2,630.11 325.31 2,304.80
Total Recoverable Depreciation 93.10
"""

LINE_ITEMS = """\
Line Item Totals: INSURED_NAME 73.20 6,844.89 1,554.13 5,290.76
"""


def amounts(pages):
    result = parse_estimate_summary(pages)
    return result['totals'], [(s['section_name'], s['rcv'], s['net_acv']) for s in result['sections']]


def test_travelers_guide_example_and_line_item_totals_are_not_the_claim():
    summary = """\
Summary for
Dwelling
Summary for All Items
Line Item Total 6,771.69
Replacement Cost Value $6,844.89
Less Depreciation (1,554.13)
Actual Cash Value $5,290.76
Less Deductible (1,000.00)
Net Claim Remaining $370.39
Total Depreciation 1,554.13
Net Claim Remaining if Depreciation is Recovered $1,924.52
"""
    totals, sections = amounts([TRAVELERS_GUIDE, LINE_ITEMS, summary])

    assert sections == [('Dwelling', 6844.89, 5290.76)]
    assert totals['rcv_amount'] == 6844.89
    assert totals['depreciation_amount'] == 1554.13
    assert totals['acv_amount'] == 5290.76
    assert totals['deductible'] == 1000.0


def test_coverages_add_up_and_code_upgrade_counts_its_paid_when_incurred_rcv():
    dwelling = """\
Summary for Dwelling
Line Item Total 6,883.65
Replacement Cost Value $7,010.26
Less Depreciation (569.52)
Actual Cash Value $6,440.74
Less Deductible (1,000.00)
Net Claim Remaining $4,797.59
"""
    code_upgrade = """\
Summary for Ordinance Or Law - Code Upgrade
Line Item Total 0.00
Replacement Cost Value $0.00
Net Claim $0.00
Line Item Total 372.97
Replacement Cost Value $377.81
Total Paid When Incurred $377.81
Net Claim $0.00
Net Claim if Additional Amounts are Recovered $377.81
Ordinance Or Law - Additional Coverage Limit Recap
"""
    recap = """\
Recap by Category
Subtotal 7,256.62
Overhead 725.66
"""
    totals, sections = amounts([dwelling, code_upgrade, recap])

    assert sections == [
        ('Dwelling', 7010.26, 6440.74),
        ('Ordinance Or Law - Code Upgrade', 377.81, 0.0),
    ]
    assert totals['rcv_amount'] == 7388.07
    assert totals['acv_amount'] == 6440.74
    # The recap's O&P is not the code upgrade's
    assert parse_estimate_summary([dwelling, code_upgrade, recap])['sections'][1]['overhead_amount'] == 0


def test_no_depreciation_reads_acv_from_net_claim():
    summary = """\
Summary for Dwelling
Line Item Total 29,614.91
Replacement Cost Value $30,062.86
Less Deductible (1,000.00)
Net Claim $29,062.86
"""
    totals, sections = amounts([summary])

    assert sections == [('Dwelling', 30062.86, 30062.86)]
    assert totals['depreciation_amount'] == 0


def test_liberty_mutual_claim_totals():
    page = """\
Liberty Mutual Insurance
Deductible: $1,000.00
CLAIM TOTALS
Total taxes: $577.59
Replacement cost value: $25,788.39
Less costs payable when incurred: $(4,032.10)
Less Recoverable depreciation (including taxes): $(11,886.68)
Actual cash value: $9,869.61
Applied deductible: $(1,000.00)
Net actual cash value: $8,869.61
Amount payable if depreciation is recovered and costs are incurred: $24,788.39
"""
    totals, sections = amounts([page])

    assert sections == [('All Items', 25788.39, 9869.61)]
    assert totals['depreciation_amount'] == 11886.68
    assert totals['deductible'] == 1000.0
    assert totals['net_claim'] == 8869.61


def test_older_liberty_mutual_summary_adds_acv_per_coverage():
    page = """\
Subtotal: $11,547.09
Replacement Cost Value: $11,829.25
Replacement Cost on Coverage Building ($614,100.00 limit): $11,125.74
Less Recoverable Depreciation: $(4,497.70)
Net Actual Cash Value on Coverage Building: $6,628.04
Net Coverage Building if Depreciation Is Recovered: $11,125.74
Replacement Cost on Coverage Code: $703.51
Net Actual Cash Value on Coverage Code: $0.00
Deductible ($4,700.00): $(4,700.00)
Net Estimate if Depreciation Is Recovered: $6,629.25
"""
    totals, sections = amounts(['Deductible: $4,700.00', page])

    assert sections == [('All Items', 11829.25, 6628.04)]
    assert totals['depreciation_amount'] == 4497.70
    assert totals['deductible'] == 4700.0


def test_allstate_payment_worksheet_with_several_amounts_per_line():
    page = """\
Payment Worksheet
Actual Cash Value Benefits: Replacement Cost (RC) Benefits: Claim Summary Payments:
Estimate Total....... $24,407.34 Estimated Total RC Benefits..... $7,549.78 Loss of Use....... $0.00
Overhead & Profit..... $4,675.92 Less Deferred Payments Made..... -$0.00 Coverage...... $17,488.00
Replacement Cost...................................... $29,455.40
Less Recoverable Depreciation................. -$7,549.78
Actual Cash Value (ACV) Subtotal.......... $21,905.62
Less Deductible......................................... -$1,000.00 Summary of Payments:
Less Advance Payments............................ -$470.48 Outstanding ACV Settlement.......... $3,417.62
"""
    totals, sections = amounts([page])

    assert sections == [('All Items', 29455.40, 21905.62)]
    assert totals['depreciation_amount'] == 7549.78
    assert totals['deductible'] == 1000.0


def test_state_farm_example_page_and_mitigation_credit_are_left_out():
    # How OCR reads State Farm's explainer page: cleaner than its text layer
    example = """\
3. Replacement Cost Value (RCV) – Estimated cost to repair or replace
Summary for Dwelling Estimated cost to repair or replace
Line Item Total 5,953.10
Replacement Cost Value (Including General Contractor Overhead and Profit) 7,326.12
Less Depreciation (Including Taxes) (832.50)
"""
    summary = """\
Deductible: $1,000.00
Summary for Coverage A - Dwelling - 37 Water Damage and
Line Item Total 9,644.76
Replacement Cost Value (Including General Contractor Overhead and Profit) 12,200.68
Less Depreciation (Including Taxes) (2,014.52)
Less Deductible (1,000.00)
Net Actual Cash Value Payment $2,840.85
"""
    credit = """\
Deductible: $0.00
Summary for Coverage A - Dwelling - 37 Water Damage and
Replacement Cost Value -6,642.28
Less Deductible (0.00)
"""
    totals, sections = amounts([example, summary, credit])

    assert sections == [('Coverage A - Dwelling - 37 Water Damage and', 12200.68, 10186.16)]
    assert totals['rcv_amount'] == 12200.68
    assert totals['deductible'] == 1000.0


def test_no_summary_means_no_sections():
    policy = """\
Coverage Deductible Limit
Building: Comprehensive perils, 100% coinsurance, Replacement cost
Property deductible*: $25,000
"""
    totals, sections = amounts([policy, LINE_ITEMS, ''])

    assert sections == []
    assert totals['rcv_amount'] == 0
