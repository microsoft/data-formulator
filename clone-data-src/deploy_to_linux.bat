@echo off
REM Windows Deploy Script - Deploy to Linux Server
REM Usage: cmd /c deploy_to_linux.bat

setlocal enabledelayedexpansion

echo.
echo ============================================================
echo   Oracle to ClickHouse Sync - Deploy to Linux
echo ============================================================
echo.

REM Check if SSH is available
where ssh >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: SSH command not found
    echo.
    echo Please install one of these:
    echo   1. Git Bash: https://git-scm.com/download/win
    echo   2. OpenSSH: https://docs.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse
    echo   3. Windows Subsystem for Linux (WSL)
    echo.
    echo Or use WinSCP/FileZilla for manual file transfer.
    pause
    exit /b 1
)

echo SSH is available - proceeding with deployment...
echo.

set /p SERVER="Enter Linux server address (user@host, e.g., admin@192.168.1.100): "
set /p DEPLOY_PATH="Enter deployment path on server (e.g., /opt/data-sync): "

if "!SERVER!"=="" (
    echo ERROR: Server address is required
    pause
    exit /b 1
)

if "!DEPLOY_PATH!"=="" (
    echo ERROR: Deploy path is required
    pause
    exit /b 1
)

echo.
echo Deployment plan:
echo   From: !cd!
echo   To: !SERVER!:!DEPLOY_PATH!
echo.

setlocal DisableDelayedExpansion
set /p continue="Continue? (y/n): "
setlocal enabledelayedexpansion

if /i not "!continue!"=="y" (
    echo Cancelled.
    exit /b 0
)

REM Step 1: Create directory
echo.
echo Step 1: Creating directory on server...
ssh !SERVER! "mkdir -p !DEPLOY_PATH! && chmod 755 !DEPLOY_PATH!"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create directory
    pause
    exit /b 1
)
echo Done!

REM Step 2: Copy main script
echo.
echo Step 2: Copying Python sync script...
scp sync_oracle_to_clickhouse.py "!SERVER!:!DEPLOY_PATH!/"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy sync script
    pause
    exit /b 1
)
echo Done!

REM Step 3: Copy setup scripts
echo.
echo Step 3: Copying setup and test scripts...
scp setup_daily_sync.sh "!SERVER!:!DEPLOY_PATH!/"
scp test_sync_connection.sh "!SERVER!:!DEPLOY_PATH!/"
echo Done!

REM Step 4: Set permissions
echo.
echo Step 4: Setting execute permissions...
ssh !SERVER! "chmod +x !DEPLOY_PATH!/*.sh"
echo Done!

REM Step 5: Test connection
echo.
echo Step 5: Testing connections...
ssh !SERVER! "cd !DEPLOY_PATH! && bash test_sync_connection.sh"

REM Step 6: Setup automation
echo.
echo Step 6: Setting up automation...
echo 1 = systemd (recommended)
echo 2 = cron
set /p setup_method="Choose setup method (1 or 2): "

if "!setup_method!"=="1" (
    echo Setting up systemd...
    ssh !SERVER! "cd !DEPLOY_PATH! && sudo bash setup_daily_sync.sh systemd"
    set setup_type=systemd
) else if "!setup_method!"=="2" (
    echo Setting up cron...
    ssh !SERVER! "cd !DEPLOY_PATH! && bash setup_daily_sync.sh cron"
    set setup_type=cron
) else (
    echo Invalid choice - skipping automation setup
    set setup_type=none
)

echo.
echo ============================================================
echo         Deployment Completed!
echo ============================================================
echo.
echo Next steps:
echo   1. SSH to server: ssh !SERVER!
echo   2. Go to path: cd !DEPLOY_PATH!
echo   3. Manual run: python3 sync_oracle_to_clickhouse.py
echo   4. View logs: tail -f logs/sync*.log
echo.

if "!setup_type!"=="systemd" (
    echo Check status:
    echo   sudo systemctl list-timers oracle-clickhouse-sync
    echo   sudo journalctl -u oracle-clickhouse-sync -f
) else if "!setup_type!"=="cron" (
    echo Check status:
    echo   crontab -l | grep sync
    echo   tail -f logs/sync*.log
)

echo.
pause
