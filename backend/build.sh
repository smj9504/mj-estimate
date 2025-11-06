#!/usr/bin/env bash
# Build script for Render deployment with optimized caching

set -e  # Exit on error

echo "Starting optimized build process..."

# Check if requirements.txt has changed
if [ -f ".requirements_checksum" ]; then
    OLD_CHECKSUM=$(cat .requirements_checksum)
    NEW_CHECKSUM=$(md5sum requirements.txt | awk '{print $1}')

    if [ "$OLD_CHECKSUM" = "$NEW_CHECKSUM" ]; then
        echo "Requirements unchanged - skipping pip install"
    else
        echo "Installing dependencies..."
        pip install --upgrade pip
        pip install -r requirements.txt
        echo "$NEW_CHECKSUM" > .requirements_checksum
    fi
else
    echo "First-time installation..."
    pip install --upgrade pip
    pip install -r requirements.txt
    md5sum requirements.txt | awk '{print $1}' > .requirements_checksum
fi

echo "Running database migrations..."
alembic upgrade head

echo "Build complete!"
