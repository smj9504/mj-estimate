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

# Check if ALEMBIC_STAMP_ONLY is set to skip migrations and just stamp
if [ "$ALEMBIC_STAMP_ONLY" = "true" ]; then
    echo "⚠️  ALEMBIC_STAMP_ONLY is set - stamping database as 'head' without running migrations"
    alembic stamp head
    echo "✅ Database stamped successfully"
elif [ "$SKIP_MIGRATIONS" = "true" ]; then
    echo "⚠️  SKIP_MIGRATIONS is set - skipping database migrations"
else
    # Try to run migrations, if it fails and AUTO_STAMP_ON_ERROR is set, stamp the database
    if ! alembic upgrade head; then
        if [ "$AUTO_STAMP_ON_ERROR" = "true" ]; then
            echo "⚠️  Migration failed but AUTO_STAMP_ON_ERROR is set"
            echo "Stamping database as 'head'..."
            alembic stamp head
            echo "✅ Database stamped successfully"
        else
            echo "❌ Migration failed. Set AUTO_STAMP_ON_ERROR=true to auto-stamp on error"
            exit 1
        fi
    fi
fi

echo "Build complete!"
