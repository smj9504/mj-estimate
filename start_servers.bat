@echo off
echo Starting MJ React App Servers...

echo.
echo Starting backend server (FastAPI)...
start "Backend Server" cmd /c "cd backend && set G_MESSAGES_DEBUG= && set GSETTINGS_BACKEND=memory && python -m uvicorn app.main:app --reload --port 8000 --host 127.0.0.1"

echo.
echo Waiting 5 seconds for backend to start...
timeout /t 5 /nobreak > nul

echo.
echo Starting frontend server (React)...
start "Frontend Server" cmd /c "cd frontend && npm start"

echo.
echo Both servers are starting...
echo Backend: http://localhost:8000
echo Frontend: http://localhost:3000
echo API Documentation: http://localhost:8000/docs
echo.
echo Press any key to exit...
pause > nul