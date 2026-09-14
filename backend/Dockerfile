# Backend Dockerfile
# 3.12 matches the Python version the app already runs on elsewhere (local
# dev venv, Render's prior Python-buildpack deploy) - some code (e.g.
# pdf_service.py's f-strings with a backslash in the expression part) only
# parses starting with 3.12 (PEP 701). Verified locally: importing the app
# under 3.11 raised SyntaxError at container start.
# Pinned to bookworm (Debian 12), not the plain `slim` tag: that tag tracks
# whatever Debian is current (now trixie), and both apt package names below
# and Playwright's `--with-deps` fallback list assume bookworm/ubuntu22.04.
FROM python:3.12-slim-bookworm

# Set working directory
WORKDIR /app

# Install system dependencies including WeasyPrint requirements.
# ghostscript gives the email attachment compressor its best path; without it
# the code falls back to downsampling images with PyMuPDF (as it must on
# Render, whose Python runtime can't install system packages).
# tesseract-ocr + poppler-utils back the scanned-PDF OCR fallback
# (ocr_fallback_extractor.py, xactimate_reference_parser.py). Both import
# pytesseract/pdf2image inside try/except, so without these binaries OCR
# silently returns empty text instead of raising - the pip packages alone
# are not enough.
#
# fontconfig + the font packages fix "Fontconfig error: Cannot load default
# config file" in the WeasyPrint PDF path. libpango can rasterize text but
# has no font database and no fonts to resolve against, so every PDF was
# rendered in a last-resort fallback face instead of the family the template
# asked for. build.sh already installed fontconfig for the old Render
# Python-buildpack deploy; that never got carried over when the service moved
# to this Dockerfile (render.yaml -> dockerfilePath).
#
# Templates request Microsoft/Apple families (Arial, Calibri, Palatino
# Linotype, Helvetica Neue, Trebuchet MS, Segoe UI) that are not
# redistributable on Debian. fontconfig's 30-metric-aliases.conf maps most of
# them to metric-compatible open substitutes, so the names in the CSS resolve
# without touching the templates:
#   Arial            -> Liberation Sans   (fonts-liberation2)
#   Calibri          -> Carlito           (fonts-crosextra-carlito)
#   Palatino Linotype-> P052 / Caladea    (fonts-urw-base35, fonts-crosextra-caladea)
#   Helvetica        -> Nimbus Sans       (fonts-urw-base35)
# Trebuchet MS / Segoe UI / Tahoma / Verdana have no metric alias; they fall
# through their CSS stacks to Carlito or the generic sans-serif/serif, which
# fonts-dejavu-core backstops. Keep dejavu last-resort so no glyph renders as
# tofu.
RUN apt-get update && apt-get install -y \
    gcc \
    ghostscript \
    tesseract-ocr \
    poppler-utils \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    fontconfig \
    fonts-liberation2 \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    fonts-urw-base35 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .
RUN chmod +x start.sh

# Expose port
EXPOSE 8000

# start.sh runs pending migrations, then execs uvicorn against the ASGI
# launcher (see app/asgi.py). docker-compose overrides this CMD for local
# dev (hot-reload via `--reload`, no migration step needed there).
CMD ["./start.sh"]