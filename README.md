# F1 Calendar 2026

Small FastAPI service + static frontend to view the 2026 F1 race weekend schedule.

## Requirements

- Python 3.11+ (venv recommended)

## Setup

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run the API

```powershell
uvicorn backend.main:app --reload
```

Or use the helper script:

```powershell
.\scripts\run.ps1
```

API endpoints:

- `GET /races`
- `GET /races/next`
- `GET /races/{race_name}`

Optional timezone conversion:

- `GET /races?tz=America/Sao_Paulo`
- `GET /races/next?tz=America/Sao_Paulo`

## Run the Frontend

Open `frontend/index.html` in a browser while the API is running on `http://127.0.0.1:8000`.

## Tests

Minimal tests are included for core helpers. To run them, install `pytest`:

```powershell
pip install pytest
pytest
```

## Data Sources

Primary data comes from OpenF1:

- `https://api.openf1.org/v1/sessions?year=2026`

If the API is unavailable, the backend falls back to `data/races.json`.
