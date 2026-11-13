"""
Prices taken from an Xactimate line item.

The owner's rule (2026-11-12): never Xactimate's own figure, 10-15% over
it; 10% chosen 2026-11-13. Every catalog that prices a line this way
writes it as xact(<Xactimate price>) with the line's code beside it, so
the bathroom and flooring estimates move together when this changes.
Look a line up in the local price list scrape (C:\\Users\\minje\\
xactimate_price_list\\out\\catalog\\<CAT>.tsv; what each line includes is
in parsed.jsonl).
"""

XACTIMATE_MARKUP = 1.10


def xact(price: float) -> float:
    """An Xactimate line item's price, marked up"""
    return round(price * XACTIMATE_MARKUP, 2)
