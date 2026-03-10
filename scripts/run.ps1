param(
    [string]$Host = "127.0.0.1",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\\venv\\Scripts\\python.exe")) {
    Write-Host "Virtual environment not found. Create it with: python -m venv venv" -ForegroundColor Yellow
    exit 1
}

Write-Host "Activating venv..." -ForegroundColor Cyan
. .\venv\Scripts\Activate.ps1

Write-Host "Starting API on http://$Host`:$Port ..." -ForegroundColor Cyan
uvicorn backend.main:app --reload --host $Host --port $Port
