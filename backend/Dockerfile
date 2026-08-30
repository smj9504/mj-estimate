# Backend Dockerfile
# Pinned to bookworm (Debian 12), not the plain `slim` tag: that tag tracks
# whatever Debian is current (now trixie), and both apt package names below
# and Playwright's `--with-deps` fallback list assume bookworm/ubuntu22.04.
FROM python:3.11-slim-bookworm

# Set working directory
WORKDIR /app

# Install system dependencies including WeasyPrint requirements.
# ghostscript gives the email attachment compressor its best path; without it
# the code falls back to downsampling images with PyMuPDF (as it must on
# Render, whose Python runtime can't install system packages).
RUN apt-get update && apt-get install -y \
    gcc \
    ghostscript \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf2.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Playwright's headless Chromium is used for the highest-quality PDF
# rendering path (sketch_pdf_service.py); WeasyPrint above is its fallback.
# `playwright install-deps` pulls the OS libraries Chromium needs to launch.
RUN playwright install --with-deps chromium

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Default command (can be overridden by docker-compose)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]