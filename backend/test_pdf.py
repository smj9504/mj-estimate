"""Test script for sketch PDF generation."""
import sys, os, warnings, logging
sys.path.insert(0, '.')
warnings.filterwarnings('ignore')
logging.disable(logging.CRITICAL)

from dotenv import load_dotenv
load_dotenv('.env.development')

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(
    os.getenv('DATABASE_URL','').replace('postgresql://','postgresql+psycopg2://')
)
Session = sessionmaker(bind=engine)
db = Session()

import app.main  # registers all models
from app.domains.water_mitigation.sketch_pdf_service import SketchPdfService
from uuid import UUID

JOB_ID = UUID('f0bb3961-d142-428a-8f0c-85e5d078a61d')
OUTPUT = r'C:\Users\user\Downloads\test_sketch_report.pdf'

try:
    svc = SketchPdfService(db)
    pdf_bytes = svc.generate_sketch_report(JOB_ID)
    print(f'SUCCESS: {len(pdf_bytes)} bytes')
    with open(OUTPUT, 'wb') as f:
        f.write(pdf_bytes)
    print(f'Saved to: {OUTPUT}')
except Exception as e:
    import traceback
    print(f'FAILED: {e}')
    traceback.print_exc()
finally:
    db.close()
