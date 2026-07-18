import os

# agents/mcp_tools.py creates its Supabase client at import time. Set dummy
# values before anything in this directory imports it — conftest.py is
# guaranteed to load before sibling test modules are collected.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-dummy-key")
