#!/usr/bin/env python3
"""Install Camoufox from a release tag when the package release index is stale."""

import json
import os
import platform
import re
import sys
from urllib.request import Request, urlopen

from camoufox.pkgman import (
    AvailableVersion,
    CamoufoxFetcher,
    RepoConfig,
    Version,
    installed_verstr,
)


RELEASES_API = "https://api.github.com/repos/daijro/camoufox/releases"
FALLBACK_TAG = "v152.0.4-beta.28"


def get_json(url):
    request = Request(url, headers={"User-Agent": "easystreams-camoufox-installer"})
    with urlopen(request, timeout=30) as response:  # nosec B310 - fixed HTTPS GitHub API
        return json.load(response)


def get_release():
    requested_tag = os.environ.get("CAMOUFOX_RELEASE_TAG", "").strip()
    if not requested_tag or requested_tag.lower() == "latest":
        try:
            return get_json(f"{RELEASES_API}/latest")
        except Exception as error:
            print(
                f"Camoufox latest lookup failed ({error}); using {FALLBACK_TAG}.",
                file=sys.stderr,
            )
            requested_tag = FALLBACK_TAG

    if not requested_tag.startswith("v"):
        requested_tag = f"v{requested_tag}"
    return get_json(f"{RELEASES_API}/tags/{requested_tag}")


def get_asset_name(tag):
    platform_name = {"linux": "lin", "win32": "win", "darwin": "mac"}.get(sys.platform)
    architecture = {
        "x86_64": "x86_64",
        "amd64": "x86_64",
        "aarch64": "arm64",
        "arm64": "arm64",
    }.get(platform.machine().lower())
    if not platform_name or not architecture:
        raise RuntimeError(f"Unsupported Camoufox platform: {sys.platform}/{platform.machine()}")
    return f"camoufox-{tag.lstrip('v')}-{platform_name}.{architecture}.zip"


def main():
    try:
        print(f"Camoufox already installed: {installed_verstr()}")
        return
    except Exception:
        pass

    release = get_release()
    tag = release.get("tag_name", "")
    version_match = re.fullmatch(r"v?(\d+\.\d+\.\d+)-(.+)", tag)
    if not version_match:
        raise RuntimeError(f"Unsupported Camoufox release tag: {tag}")

    asset_name = get_asset_name(tag)
    asset = next((item for item in release.get("assets", []) if item.get("name") == asset_name), None)
    if not asset:
        raise RuntimeError(f"Asset {asset_name} not found in release {tag}")

    digest = asset.get("digest") or ""
    selected = AvailableVersion(
        version=Version(version=version_match.group(1), build=version_match.group(2)),
        url=asset["browser_download_url"],
        is_prerelease=bool(release.get("prerelease")),
        asset_id=asset.get("id"),
        asset_size=asset.get("size"),
        sha256=digest.removeprefix("sha256:") or None,
        asset_created_at=asset.get("created_at"),
    )

    repo_config = RepoConfig.find_by_name("Official") or RepoConfig.load_repos()[0]
    repo_config.repos = ["daijro/camoufox"] + [
        repo for repo in repo_config.repos if repo != "daijro/camoufox"
    ]

    print(f"Installing Camoufox {tag} from {asset_name}...")
    CamoufoxFetcher(repo_config=repo_config, selected_version=selected).install()
    print(f"Camoufox installed: {installed_verstr()}")


if __name__ == "__main__":
    main()
