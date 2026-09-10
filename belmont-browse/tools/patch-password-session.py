#!/usr/bin/env python3
"""Preserve an explicit UI vault lock when refreshing the original 907 expiry."""
from pathlib import Path
import sys

VERSIONS = ("1.26.907.1712", "1.26.909.1820", "907", "909")
ORIGINAL = "function refreshPasswordSessionExpiry(Cn,ei,{persist:ti=!1}={}){let ni=getState(Cn);ni.masterKey&&(ni.expiresAt=sessionExpiresAt(ei),ti?persistToKeychain(Cn,ni.expiresAt):scheduleKeychainClear(Cn,ni.expiresAt))}"
PATCHED = ORIGINAL.replace("{let ni=getState(Cn);", "{if(isPasswordUiSessionExplicitlyLocked(Cn))return;let ni=getState(Cn);", 1)


def patch_password_session(source, version):
    if version not in VERSIONS:
        return source
    if source.count("function isPasswordUiSessionExplicitlyLocked(Cn){") != 1:
        raise ValueError("907 explicit UI lock predicate is missing or ambiguous")
    original_count, patched_count = source.count(ORIGINAL), source.count(PATCHED)
    if (original_count, patched_count) == (0, 1):
        return source
    if (original_count, patched_count) != (1, 0):
        raise ValueError(f"907 password expiry anchor mismatch: original={original_count}, patched={patched_count}")
    return source.replace(ORIGINAL, PATCHED, 1)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: patch-password-session.py INPUT OUTPUT VERSION")
    source = Path(sys.argv[1]).read_text(encoding="utf-8")
    result = patch_password_session(source, sys.argv[3])
    Path(sys.argv[2]).write_text(result, encoding="utf-8")
