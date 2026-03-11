API_TITLE = "F1 calendar API"
LOG_LEVEL = "INFO"

OPENF1_SESSIONS_URL = "https://api.openf1.org/v1/sessions"
TARGET_YEAR = 2026
CACHE_TTL_SECONDS = 15 * 60

# Default TTL for the OpenF1 proxy cache (used for resources not listed in main.py).
# Resource-specific overrides are defined in main.py; historical data such as
# session_result, drivers, and laps is cached for 24 hours since it never changes.
OPENF1_PROXY_TTL_SECONDS = 5 * 60

CORS_ALLOW_ORIGINS = ["*"]
CORS_ALLOW_CREDENTIALS = False
CORS_ALLOW_METHODS = ["*"]
CORS_ALLOW_HEADERS = ["*"]
