"""The product library: keeping retailer products, reading new ones off a
link or a screenshot, and never letting a pasted link point the server at
its own network. Pages, DNS, file storage and Claude are stood in for; the
database is a throwaway SQLite one."""

import asyncio
import ipaddress
from pathlib import Path
import socket
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: E402,F401  (registers every model, as the app does)
from app.core.database_factory import SQLAlchemySession  # noqa: E402
from app.domains.product_library import extract, fetch as fetch_module, service as service_module  # noqa: E402
from app.domains.product_library.catalog import retailer_of  # noqa: E402
from app.domains.product_library.fetch import FetchError, check_public_url, page_fields, parse_page  # noqa: E402
from app.domains.product_library.models import Product  # noqa: E402
from app.domains.product_library.schemas import ProductCreate, ProductUpdate  # noqa: E402
from app.domains.product_library.service import ProductService, snapshot  # noqa: E402

PAGE = """<!doctype html><html><head><title>Moen Arbor Pull-Down Faucet - The Home Depot</title>
<meta property="og:title" content="Arbor Single-Handle Pull-Down Sprayer Kitchen Faucet">
<meta property="og:image" content="https://images.example-cdn.com/og.jpg">
<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [
  {"@type": "BreadcrumbList", "name": "crumbs"},
  {"@type": "Product", "name": "Arbor Single-Handle Pull-Down Sprayer Kitchen Faucet",
   "brand": {"@type": "Brand", "name": "MOEN"}, "sku": "203154422", "mpn": "7594SRS", "color": "Spot Resist Stainless",
   "image": ["/images/main.jpg", {"url": "https://images.example-cdn.com/side.jpg"}],
   "offers": [{"@type": "Offer", "price": "229.00", "priceCurrency": "USD"}]}]}</script>
<style>.x { color: red }</style><script>var tracking = "do not read me";</script>
</head><body><h1>Arbor Pull-Down Faucet</h1><div>Spout height 9.5 in. Spout reach 8.75 in.</div></body></html>"""


@pytest.fixture
def public_dns(monkeypatch):
    """Every host resolves to one public address, unless a test says otherwise."""
    def resolve(host, port, *args, **kwargs):
        try:
            ip = str(ipaddress.ip_address(host))  # an address resolves to itself
        except ValueError:
            ip = {"localhost": "127.0.0.1", "intranet.local": "10.0.0.5", "metadata": "169.254.169.254"}.get(host, "93.184.216.34")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]
    monkeypatch.setattr(fetch_module.socket, "getaddrinfo", resolve)


@pytest.fixture
def session(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'products.db'}")
    Product.__table__.create(engine)
    s = SQLAlchemySession(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)())
    yield s
    s.close()


@pytest.fixture
def stored(monkeypatch):
    """File storage stood in for: records what was kept, hands back ids."""
    kept = []

    async def store(self, product_id, data, filename, content_type, category):
        kept.append({"product_id": str(product_id), "bytes": data, "name": filename, "type": content_type, "category": category})
        return f"file-{len(kept)}"

    monkeypatch.setattr(ProductService, "_store", store)
    return kept


def test_retailer_is_read_from_the_link_host():
    assert retailer_of("https://www.homedepot.com/p/Moen-Arbor/203154422") == "home_depot"
    assert retailer_of("https://www.lowes.com/pd/x/123") == "lowes"
    assert retailer_of("https://flooranddecor.com/tile/1") == "floor_decor"
    assert retailer_of("https://amzn.to/abc") == "amazon"
    assert retailer_of("https://notlowes.com/x") == "other"
    assert retailer_of(None) == "other"


@pytest.mark.parametrize("url", [
    "http://localhost/admin",
    "http://127.0.0.1:8000/api",
    "http://intranet.local/",
    "http://metadata/latest/meta-data/",
    "file:///etc/passwd",
    "ftp://example.com/x",
])
def test_a_link_never_points_the_server_at_its_own_network(public_dns, url):
    with pytest.raises(FetchError):
        check_public_url(url)


def test_a_public_link_is_fine(public_dns):
    check_public_url("https://www.homedepot.com/p/x/1")


def test_a_redirect_is_checked_hop_by_hop(public_dns, monkeypatch):
    """A public page that redirects to an inside address is stopped at the redirect."""
    class Resp:
        def __init__(self, status, headers=None):
            self.status_code = status
            self.headers = headers or {}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def iter_bytes(self):
            yield b"secret"

    class Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def stream(self, method, url):
            return Resp(302, {"location": "http://metadata/latest/"})

    monkeypatch.setattr(fetch_module.httpx, "Client", Client)
    with pytest.raises(FetchError, match="private"):
        fetch_module.fetch("https://shop.example.com/p/1", 1000)


def test_a_page_gives_its_product_data_and_pictures():
    page = parse_page(PAGE, "https://www.homedepot.com/p/Moen-Arbor/203154422")
    fields, images = page_fields(page)
    assert fields["title"] == "Arbor Single-Handle Pull-Down Sprayer Kitchen Faucet"
    assert fields["brand"] == "MOEN"
    assert fields["sku"] == "203154422"
    assert fields["model_number"] == "7594SRS"
    assert fields["finish"] == "Spot Resist Stainless"
    assert fields["price"] == 229.0
    # Relative pictures made whole; the og picture after the product's own.
    assert images == [
        "https://www.homedepot.com/images/main.jpg",
        "https://images.example-cdn.com/side.jpg",
        "https://images.example-cdn.com/og.jpg",
    ]
    # The visible text, without scripts or styles.
    assert "Spout reach 8.75 in." in page.text
    assert "do not read me" not in page.text and "color: red" not in page.text
    assert not page.blocked


def test_a_bot_check_page_is_told_apart():
    page = parse_page("<html><head><title>Access Denied</title></head><body>Reference #18.abc</body></html>", "https://www.lowes.com/pd/1")
    assert page.blocked


def test_what_the_page_states_wins_and_claude_fills_the_rest():
    stated = {"title": "Arbor Faucet", "price": 229.0, "brand": "MOEN"}
    read = {
        "category": "kitchen_faucet", "title": "Arbor Kitchen Faucet (read)", "price": 199.0, "brand": None,
        "price_unit": "each", "height_in": 15.5, "width_in": None,
        "look": {"color": "#c9cdd0", "material": "stainless_steel", "faucet_style": "pull_down", "door_style": None},
    }
    merged = extract.merge_fields(stated, read)
    assert merged["title"] == "Arbor Faucet" and merged["price"] == 229.0 and merged["brand"] == "MOEN"
    assert merged["category"] == "kitchen_faucet" and merged["height_in"] == 15.5
    assert "width_in" not in merged
    assert merged["look"] == {"color": "#c9cdd0", "material": "stainless_steel", "faucet_style": "pull_down"}
    # An unknown category or unit falls back rather than failing the save later.
    odd = extract.merge_fields({}, {"category": "spaceship", "price_unit": "per_gallon", "look": None})
    assert odd["category"] == "other" and odd["price_unit"] == "each"


def test_a_link_is_read_into_a_draft(public_dns, monkeypatch, session):
    monkeypatch.setattr(service_module, "fetch", lambda url, cap: (url, "text/html; charset=utf-8", PAGE.encode()))
    monkeypatch.setattr(extract, "read_page", lambda page, stated: {
        "category": "kitchen_faucet", "price_unit": "each", "height_in": 15.5,
        "look": {"color": "#c9cdd0", "faucet_style": "pull_down"},
    })
    draft = ProductService(session).draft_from_url("https://www.homedepot.com/p/Moen-Arbor/203154422")
    assert not draft.blocked
    assert draft.fields["retailer"] == "home_depot"
    assert draft.fields["source_url"] == "https://www.homedepot.com/p/Moen-Arbor/203154422"
    assert draft.fields["price"] == 229.0 and draft.fields["height_in"] == 15.5
    assert draft.image_urls[0] == "https://www.homedepot.com/images/main.jpg"


def test_a_page_sent_from_the_browser_is_read_the_same_way(monkeypatch, session):
    """The bookmarklet sends the page as the person's browser has it; no fetch at all."""
    def no_fetch(url, cap):
        raise AssertionError("the server shouldn't fetch a page it was sent")

    monkeypatch.setattr(service_module, "fetch", no_fetch)
    monkeypatch.setattr(extract, "read_page", lambda page, stated: {"category": "kitchen_faucet", "look": {}})
    draft = ProductService(session).draft_from_html(PAGE, "https://www.homedepot.com/p/Moen-Arbor/203154422")
    assert draft.fields["title"] == "Arbor Single-Handle Pull-Down Sprayer Kitchen Faucet"
    assert draft.fields["category"] == "kitchen_faucet" and draft.fields["retailer"] == "home_depot"


def test_a_site_that_turns_the_server_away_asks_for_a_screenshot(monkeypatch, session):
    def refuse(url, cap):
        raise FetchError("The site turned the request away (403)", blocked=True)

    monkeypatch.setattr(service_module, "fetch", refuse)
    draft = ProductService(session).draft_from_url("https://www.lowes.com/pd/x/1")
    assert draft.blocked and draft.fields["retailer"] == "lowes"
    assert "403" in draft.note


def test_saving_keeps_copies_of_the_pictures(monkeypatch, session, stored):
    def give(url, cap):
        if "broken" in url:
            raise FetchError("The page answered 404")
        return url, "image/jpeg", b"\xff\xd8 jpeg " + url.encode()

    monkeypatch.setattr(service_module, "fetch", give)
    svc = ProductService(session)
    product = asyncio.run(svc.create(
        ProductCreate(
            category="backsplash", title="Ivory 3 in. x 6 in. Subway Tile", price=4.98, price_unit="box", box_sf=1.5,
            tile_width_in=3, tile_length_in=6, source_url="https://www.flooranddecor.com/tile/1",
            image_urls=["https://cdn.example.com/a.jpg", "https://cdn.example.com/broken.jpg", "https://cdn.example.com/b.jpg"],
            image_file_ids=["uploaded-1"],
        ),
        None,
    ))
    session.commit()
    # A picture that can't be had is skipped; those fetched come first, then the uploaded one.
    assert product.image_file_ids == ["file-1", "file-2", "uploaded-1"]
    assert [k["type"] for k in stored] == ["image/jpeg", "image/jpeg"]
    assert product.retailer == "floor_decor"

    # Reordering and trimming pictures, and a new price.
    product = asyncio.run(svc.update(product.id, ProductUpdate(image_file_ids=["file-2"], price=5.25)))
    session.commit()
    assert product.image_file_ids == ["file-2"] and float(product.price) == 5.25

    shot = snapshot(product)
    assert shot.title == "Ivory 3 in. x 6 in. Subway Tile" and shot.tile_length_in == 6 and shot.price_unit == "box"


def test_the_list_filters_and_archived_products_drop_out(session, stored):
    svc = ProductService(session)
    faucet = asyncio.run(svc.create(ProductCreate(category="kitchen_faucet", title="Arbor Faucet", brand="MOEN"), None))
    asyncio.run(svc.create(ProductCreate(category="vanity", title="Hayes 36 in. Vanity", brand="Home Decorators"), None))
    asyncio.run(svc.create(ProductCreate(category="floor_tile", title="Carrara Hex", finish="White"), None))
    session.commit()

    assert [p.title for p in svc.list(q="moen")[0]] == ["Arbor Faucet"]
    assert {p.title for p in svc.list(trade="kitchen")[0]} == {"Arbor Faucet", "Carrara Hex"}
    assert {p.title for p in svc.list(trade="bathroom")[0]} == {"Hayes 36 in. Vanity", "Carrara Hex"}
    svc.archive(faucet.id)
    session.commit()
    assert "Arbor Faucet" not in {p.title for p in svc.list()[0]}
    assert "Arbor Faucet" in {p.title for p in svc.list(include_archived=True)[0]}


def test_an_unknown_category_is_refused():
    with pytest.raises(ValueError):
        ProductCreate(category="spaceship", title="x")


def test_a_stored_picture_is_read_back_for_a_pdf(tmp_path, monkeypatch):
    from app.domains.file.models import File

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'files.db'}")
    File.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    picture = tmp_path / "swatch.png"
    picture.write_bytes(b"\x89PNG picture")
    # files.id is text: looked up as a UUID object it never matched
    db.add(File(id="4fb89b60-baa3-40b5-8889-5f682c1c976d", filename="swatch.png", original_name="swatch.png",
                content_type="image/png", size=12, url=str(picture), storage_provider="local",
                context="product", context_id="p1", category="swatch", is_active=True))
    db.commit()
    assert service_module.image_bytes(db, "4fb89b60-baa3-40b5-8889-5f682c1c976d") == b"\x89PNG picture"
    assert service_module.image_bytes(db, "00000000-0000-0000-0000-000000000000") is None
    assert service_module.image_bytes(db, None) is None
