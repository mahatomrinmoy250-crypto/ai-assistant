"""
JARVIS API Server — VPS pe chalane ke liye
Starts Flask web API on port 8000

Usage:
  python start_api.py           # port 8000
  PORT=5000 python start_api.py # custom port
"""

import os
import sys

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Check API key
if not os.environ.get("ANTHROPIC_API_KEY"):
    print("ERROR: ANTHROPIC_API_KEY not set in .env file")
    sys.exit(1)

from api.index import app

port = int(os.environ.get("PORT", 8000))
host = os.environ.get("HOST", "0.0.0.0")

print(f"JARVIS API starting on http://{host}:{port}")
print(f"Health check: http://{host}:{port}/api/health")
print(f"Press Ctrl+C to stop")

app.run(host=host, port=port, debug=False, threaded=True)
