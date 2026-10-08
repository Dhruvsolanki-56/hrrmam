# One-command demo: builds the React app (if needed) and serves everything from FastAPI on :8000
$root = $PSScriptRoot
if (-not (Test-Path "$root\frontend\dist\index.html")) {
  Push-Location "$root\frontend"; npm install; npm run build; Pop-Location
}
python -m pip install -q -r "$root\backend\requirements.txt"
Push-Location "$root\backend"
Start-Process "http://localhost:8000"
python -m uvicorn app.main:app --port 8000
Pop-Location
