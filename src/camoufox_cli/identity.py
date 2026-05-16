"""Persistent identity support for persistent Camoufox profiles."""

from __future__ import annotations

import dataclasses
import datetime
import json
import random
import sys
from pathlib import Path
from typing import Any


IDENTITY_FILENAME = "camoufox-cli.json"
IDENTITY_VERSION = 1


def _host_os() -> str:
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


def _identity_path(persistent_dir: str) -> Path:
    return Path(persistent_dir) / IDENTITY_FILENAME


def load_or_create(
    persistent_dir: str,
    locale: str | None,
    proxy: str | None,
    geoip: bool,
) -> dict:
    """Return the persistent identity dict for this profile directory."""
    path = _identity_path(persistent_dir)
    if path.exists():
        identity = json.loads(path.read_text())
        if _apply_cli_overrides(identity, locale, proxy, geoip):
            path.write_text(json.dumps(identity, indent=2, ensure_ascii=False))
        return identity

    from browserforge.fingerprints import FingerprintGenerator

    os_ = _host_os()
    fingerprint = FingerprintGenerator(browser="firefox", os=os_).generate()
    config: dict[str, Any] = {
        "canvas:aaOffset": random.randint(-50, 50),
        "canvas:aaCapOffset": bool(random.randint(0, 1)),
        "fonts:spacing_seed": random.randint(0, 2**32 - 1),
    }

    if proxy and geoip:
        _merge_geo(config, _geolocate_proxy(proxy))

    identity = {
        "version": IDENTITY_VERSION,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "os": os_,
        "locale": locale,
        "fingerprint": dataclasses.asdict(fingerprint),
        "config": config,
    }

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(identity, indent=2, ensure_ascii=False))
    return identity


def _apply_cli_overrides(
    identity: dict,
    locale: str | None,
    proxy: str | None,
    geoip: bool,
) -> bool:
    changed = False

    if locale is not None and identity.get("locale") != locale:
        identity["locale"] = locale
        changed = True

    if proxy and geoip:
        config = identity.setdefault("config", {})
        derived = _geolocate_proxy(proxy)
        if derived and _merge_geo(config, derived):
            changed = True

    return changed


def _merge_geo(config: dict, derived: dict | None) -> bool:
    if not derived:
        return False

    changed = False
    tz = derived.get("timezone")
    if tz and config.get("timezone") != tz:
        config["timezone"] = tz
        changed = True

    lat = derived.get("latitude")
    lon = derived.get("longitude")
    if lat is not None and lon is not None:
        if config.get("geolocation:latitude") != lat:
            config["geolocation:latitude"] = lat
            changed = True
        if config.get("geolocation:longitude") != lon:
            config["geolocation:longitude"] = lon
            changed = True
        acc = derived.get("accuracy")
        if acc is not None and config.get("geolocation:accuracy") != acc:
            config["geolocation:accuracy"] = acc
            changed = True

    return changed


def to_launch_kwargs(identity: dict) -> dict:
    """Translate an identity dict into Camoufox launch kwargs."""
    from browserforge.fingerprints import Fingerprint

    fingerprint = _rebuild_dataclass(Fingerprint, identity["fingerprint"])
    kwargs: dict[str, Any] = {
        "fingerprint": fingerprint,
        "os": identity["os"],
        "config": dict(identity.get("config") or {}),
    }

    stored_locale = identity.get("locale")
    if stored_locale:
        parts = [s.strip() for s in stored_locale.split(",") if s.strip()]
        if parts:
            kwargs["locale"] = parts if len(parts) > 1 else parts[0]

    return kwargs


def _rebuild_dataclass(cls, value):
    if value is None:
        return None
    if isinstance(cls, type) and dataclasses.is_dataclass(cls) and isinstance(value, dict):
        kwargs = {}
        for field in dataclasses.fields(cls):
            kwargs[field.name] = _rebuild_dataclass(field.type, value.get(field.name))
        return cls(**kwargs)
    return value


def _geolocate_proxy(proxy_url: str) -> dict | None:
    try:
        from camoufox.ip import public_ip, valid_ipv4, valid_ipv6
        from camoufox.locale import get_geolocation
    except Exception:
        return None

    try:
        ip = public_ip(_proxy_url_with_auth(proxy_url))
        if not (valid_ipv4(ip) or valid_ipv6(ip)):
            return None
        geo = get_geolocation(ip)
        out: dict[str, Any] = {
            "timezone": geo.timezone,
            "latitude": geo.latitude,
            "longitude": geo.longitude,
        }
        if geo.accuracy:
            out["accuracy"] = geo.accuracy
        return out
    except Exception:
        return None


def _proxy_url_with_auth(proxy_url: str) -> str:
    from urllib.parse import urlparse

    from .proxy import parse_proxy_settings

    settings = parse_proxy_settings(proxy_url)
    parsed = urlparse(settings["server"])
    if "username" in settings:
        return f"{parsed.scheme}://{settings['username']}:{settings.get('password', '')}@{parsed.netloc}"
    return settings["server"]
