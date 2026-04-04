"""Test PDF generation in a thread (mimicking FastAPI context)."""
import sys, os, warnings, logging, asyncio, concurrent.futures
sys.path.insert(0, '.')
warnings.filterwarnings('ignore')

from dotenv import load_dotenv
load_dotenv('.env.development')

import app.main
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from uuid import UUID

engine = create_engine(os.getenv('DATABASE_URL','').replace('postgresql://','postgresql+psycopg2://'))
Session = sessionmaker(bind=engine)
db = Session()

JOB_ID = UUID('f0bb3961-d142-428a-8f0c-85e5d078a61d')

svc = SketchPdfService(db)

# Get the HTML first
import app.main
from app.domains.water_mitigation.models import WaterMitigationJob
from app.domains.water_mitigation.sketch_service import SketchService

job = db.query(WaterMitigationJob).filter(WaterMitigationJob.id == JOB_ID).first()
sketch_service = SketchService(db)
floor_summaries = sketch_service.get_floor_sketches(JOB_ID)
sorted_floors = sorted(floor_summaries, key=lambda f: f.floor_order)

floor_data = []
for summary in sorted_floors:
    detail = sketch_service.get_floor_sketch(summary.id)
    if not detail:
        continue
    svg = svc._generate_floor_svg(detail)
    summary_data = svc._compute_floor_summary(detail)
    floor_data.append({
        "floor_label": detail.floor_label,
        "svg": svg,
        "summary": summary_data,
        "notes": detail.notes,
    })

html_content = svc._render_html(job, floor_data)
print(f"HTML length: {len(html_content)} chars")

# Test thread approach
def run_in_thread():
    async def _generate():
        from playwright.async_api import async_playwright
        print("Starting playwright...")
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            print("Browser launched!")
            try:
                page = await browser.new_page()
                await page.set_content(html_content, wait_until="networkidle")
                print("Content set!")
                pdf_bytes = await page.pdf(format="Letter", print_background=True)
                print(f"PDF generated: {len(pdf_bytes)} bytes")
                return pdf_bytes
            finally:
                await browser.close()

    try:
        result = asyncio.run(_generate())
        return result
    except Exception as e:
        import traceback
        print(f"Thread exception: {type(e).__name__}: {e}")
        traceback.print_exc()
        raise

print("Running in thread pool...")
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(run_in_thread)
        result = future.result(timeout=90)
    print(f"SUCCESS: {len(result)} bytes")
    with open(r'C:\Users\user\Downloads\test_thread_report.pdf', 'wb') as f:
        f.write(result)
    print("Saved!")
except Exception as e:
    import traceback
    print(f"MAIN exception: {type(e).__name__}: {e}")
    traceback.print_exc()

db.close()
