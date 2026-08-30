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

# Copy application code
COPY . .
RUN chmod +x start.sh

# Expose port
EXPOSE 8000

# start.sh runs pending migrations, then execs uvicorn against the ASGI
# launcher (see app/asgi.py). docker-compose overrides this CMD for local
# dev (hot-reload via `--reload`, no migration step needed there).
CMD ["./start.sh"]