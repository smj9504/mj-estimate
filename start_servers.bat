@echo off
setlocal enabledelayedexpansion
echo ===============================================
echo    MJ React App - Smart Server Manager
echo ===============================================
echo.

:: Check if port 8000 is in use (Backend)
echo Checking Backend (port 8000)...
netstat -aon | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo   ^> Backend is already running on port 8000
    set /p "restart_backend=Stop and restart backend? (Y/n): "
    if /i "!restart_backend!" neq "n" (
        echo   ^> Stopping existing backend processes...

        :: Method 1: Kill by port
        for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
            echo   ^> Killing PID: %%p
            taskkill /F /PID %%p >nul 2>&1
        )

        :: Method 2: Kill all Python processes (aggressive)
        echo   ^> Killing all Python processes to ensure clean start...
        taskkill /F /IM python.exe >nul 2>&1
        taskkill /F /IM pythonw.exe >nul 2>&1

        :: Method 3: Kill uvicorn processes specifically
        taskkill /F /IM uvicorn.exe >nul 2>&1

        echo   ^> Waiting for processes to terminate...
        timeout /t 3 /nobreak >nul

        :: Verify port is free
        netstat -aon | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
        if %errorlevel% equ 0 (
            echo   ^> WARNING: Port 8000 still in use, forcing cleanup...
            for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do (
                echo   ^> Force killing PID: %%p
                powershell "Stop-Process -Id %%p -Force" >nul 2>&1
            )
            timeout /t 2 /nobreak >nul
        ) else (
            echo   ^> Port 8000 successfully freed
        )
    ) else (
        echo   ^> Keeping existing backend
        goto :check_frontend
    )
) else (
    echo   ^> Port 8000 is available
)

echo   ^> Starting new backend server...
start "MJ Backend Server" cmd /c "cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --host 127.0.0.1 && pause"
echo   ^> Backend started in new window
timeout /t 3 /nobreak >nul

:check_frontend
echo.
echo Checking Frontend (port 3000)...
netstat -aon | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo   ^> Frontend is already running on port 3000
    set /p "restart_frontend=Stop and restart frontend? (Y/n): "
    if /i "!restart_frontend!" neq "n" (
        echo   ^> Stopping existing frontend processes...

        :: Method 1: Kill by port
        for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
            echo   ^> Killing PID: %%p
            taskkill /F /PID %%p >nul 2>&1
        )

        :: Method 2: Kill Node.js processes carefully (only development servers)
        echo   ^> Killing Node.js development server processes...
        for /f "tokens=2" %%p in ('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH') do (
            set "pid=%%p"
            set "pid=!pid:"=!"
            :: Check if this Node process is using port 3000
            netstat -aon | findstr ":3000 " | findstr "!pid!" >nul 2>&1
            if !errorlevel! equ 0 (
                echo   ^> Killing Node.js PID: !pid!
                taskkill /F /PID !pid! >nul 2>&1
            )
        )

        echo   ^> Waiting for processes to terminate...
        timeout /t 3 /nobreak >nul

        :: Verify port is free
        netstat -aon | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
        if %errorlevel% equ 0 (
            echo   ^> WARNING: Port 3000 still in use, forcing cleanup...
            for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
                echo   ^> Force killing PID: %%p
                powershell "Stop-Process -Id %%p -Force" >nul 2>&1
            )
            timeout /t 2 /nobreak >nul
        ) else (
            echo   ^> Port 3000 successfully freed
        )
    ) else (
        echo   ^> Keeping existing frontend
        goto :show_summary
    )
) else (
    echo   ^> Port 3000 is available
)

echo   ^> Starting new frontend server...
start "MJ Frontend Server" cmd /c "cd frontend && npm start && pause"
echo   ^> Frontend started in new window
timeout /t 3 /nobreak >nul

:show_summary
echo.
echo ===============================================
echo          Server Status Summary
echo ===============================================
echo   Backend API:      http://localhost:8000
echo   Frontend App:     http://localhost:3000
echo   API Docs:         http://localhost:8000/docs
echo   ReDoc:           http://localhost:8000/redoc
echo ===============================================
echo.
echo Both servers are running in separate windows.
echo Close those windows to stop the servers.
echo.
echo Press any key to exit this launcher...
pause >nul