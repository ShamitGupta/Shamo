"""Make Python trust the same certificate authorities the operating system does.

WHY THIS IS HERE
----------------
On Windows, Python does not read the OS certificate store. It ships its own
bundle, and when a machine sits behind a proxy that re-signs TLS -- corporate
networks, some antivirus products -- every outbound HTTPS call fails with
CERTIFICATE_VERIFY_FAILED even though the browser and Node on the same machine
connect fine. That is exactly what happened on this developer machine: the n8n
harness reached Supabase over Node without complaint while Python could not.

`truststore` redirects Python's verification at the OS store, which is where the
proxy's root already is. This is the same approach pip itself adopted, and it
makes verification MORE correct rather than weaker -- certificates are still
fully verified, just against the system's trust decisions.

It is deliberately NOT a blanket `verify=False`. Disabling verification would
make the failure go away by removing the check, which on a service holding a
service-role key is not a trade worth making.

Set SHAMO_DISABLE_TRUSTSTORE=1 to skip this, for example on a Linux container
where the default bundle is already correct.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def install() -> None:
    if os.getenv("SHAMO_DISABLE_TRUSTSTORE", "").strip() in {"1", "true", "yes"}:
        return
    try:
        import truststore
    except ImportError:  # pragma: no cover - optional dependency
        logger.debug("truststore is not installed; using the bundled CA list.")
        return
    try:
        truststore.inject_into_ssl()
    except Exception as error:  # noqa: BLE001 - never fail startup over this
        logger.warning("Could not install the OS trust store: %s", error)
