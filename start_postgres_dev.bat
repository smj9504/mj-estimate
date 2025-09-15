@echo off
echo ===========================================
echo  Starting PostgreSQL Development Environment
echo ===========================================

echo.
echo Stopping any existing containers...
docker-compose -f docker-compose.dev.yml down

echo.
echo Starting PostgreSQL development environment...
docker-compose -f docker-compose.dev.yml up -d postgres-dev redis-dev

echo.
echo Waiting for PostgreSQL to be ready...
timeout /t 15

echo.
echo Checking PostgreSQL connection...
docker exec mjestimate_postgres_dev pg_isready -U mjestimate -d mjestimate_dev

echo.
echo ===========================================
echo  PostgreSQL Development Environment Ready!
echo ===========================================
echo.
echo Database connection details:
echo   Host: localhost
echo   Port: 5433
echo   User: mjestimate
echo   Password: dev_password_2024
echo   Database: mjestimate_dev
echo.
echo Optional services:
echo   pgAdmin: http://localhost:8080 (dev@mjestimate.com / dev123)
echo   Redis: localhost:6379
echo.
echo To initialize tables, run:
echo   python backend/scripts/start_dev_postgres.py
echo.
echo To migrate SQLite data, run:
echo   python backend/scripts/migrate_sqlite_to_postgres.py
echo.
pause