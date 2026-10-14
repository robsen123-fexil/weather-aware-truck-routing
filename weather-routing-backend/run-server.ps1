# Always use the project virtualenv (not conda/base Python).
$Root = $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Creating virtual environment..."
    python -m venv (Join-Path $Root ".venv")
}

& $Python -m pip install -q -r (Join-Path $Root "requirements.txt")
Set-Location $Root
& $Python manage.py runserver 8000
