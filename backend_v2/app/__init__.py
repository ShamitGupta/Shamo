"""Shamo tutor API package."""

# Installed before any HTTP client exists, because the Supabase and OpenAI
# clients capture their SSL context at construction. See ssl_trust.py.
from . import ssl_trust

ssl_trust.install()
