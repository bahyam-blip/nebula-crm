#!/usr/bin/env python3
"""Deploy Firestore rules and composite indexes via the REST APIs.

Why not `firebase deploy`?

The CLI performs a Service Usage precheck before every deploy. That check
needs `serviceusage.services.get`, which our CI service account does not
have, so the CLI aborts with HTTP 403 even though the Firestore and Rules
APIs are enabled and working. Talking to firebaserules.googleapis.com and
firestore.googleapis.com directly skips the precheck entirely and needs
only the permissions we actually use.

Idempotent: re-running publishes a fresh ruleset and treats indexes that
already exist as success.
"""

from __future__ import annotations

import json
import sys

import google.auth
import google.auth.transport.requests as gt
import requests

PROJECT = "nebula-crm-70f58"
DATABASE = "(default)"
RULES_FILE = "firestore.rules"
INDEX_FILE = "firestore.indexes.json"
TIMEOUT = 60


def annotate(level: str, message: str) -> None:
    """Emit a GitHub Actions annotation (visible without downloading logs)."""
    print(f"::{level}::{message}")


def token_headers() -> dict[str, str]:
    creds, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(gt.Request())
    return {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json",
    }


def deploy_rules(headers: dict[str, str]) -> bool:
    """Publish firestore.rules and point the live release at it."""
    with open(RULES_FILE, encoding="utf-8") as fh:
        source = fh.read()

    base = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}"

    created = requests.post(
        f"{base}/rulesets",
        headers=headers,
        json={
            "source": {
                "files": [{"name": RULES_FILE, "content": source}]
            }
        },
        timeout=TIMEOUT,
    )
    if created.status_code not in (200, 201):
        annotate("error", f"RULES create failed {created.status_code} "
                          f"{created.text[:300].replace(chr(10), ' ')}")
        return False

    ruleset = created.json()["name"]
    annotate("warning", f"RULES ruleset created: {ruleset}")

    release_name = f"projects/{PROJECT}/releases/cloud.firestore"
    payload = {"name": release_name, "rulesetName": ruleset}

    # The release exists after the first deploy, so try update then create.
    updated = requests.patch(
        f"https://firebaserules.googleapis.com/v1/{release_name}",
        headers=headers,
        json={"release": payload},
        timeout=TIMEOUT,
    )
    if updated.status_code in (200, 201):
        annotate("warning", "RULES release updated -> live")
        return True

    fresh = requests.post(
        f"{base}/releases", headers=headers, json=payload, timeout=TIMEOUT
    )
    if fresh.status_code in (200, 201):
        annotate("warning", "RULES release created -> live")
        return True

    annotate(
        "error",
        f"RULES release failed: patch {updated.status_code} "
        f"{updated.text[:200].replace(chr(10), ' ')} | "
        f"post {fresh.status_code} {fresh.text[:200].replace(chr(10), ' ')}",
    )
    return False


def deploy_indexes(headers: dict[str, str]) -> bool:
    """Create any composite index that does not already exist."""
    try:
        with open(INDEX_FILE, encoding="utf-8") as fh:
            spec = json.load(fh)
    except FileNotFoundError:
        annotate("warning", "INDEXES no firestore.indexes.json, skipping")
        return True

    base = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
        f"/databases/{DATABASE}/collectionGroups"
    )

    created = existing = 0
    ok = True

    for index in spec.get("indexes", []):
        group = index["collectionGroup"]
        body = {
            "queryScope": index.get("queryScope", "COLLECTION"),
            "fields": [
                {
                    "fieldPath": f["fieldPath"],
                    **(
                        {"order": f["order"]}
                        if "order" in f
                        else {"arrayConfig": f.get("arrayConfig", "CONTAINS")}
                    ),
                }
                for f in index["fields"]
            ],
        }

        response = requests.post(
            f"{base}/{group}/indexes",
            headers=headers,
            json=body,
            timeout=TIMEOUT,
        )

        if response.status_code in (200, 201):
            created += 1
            continue
        # 409 is the API's way of saying this index is already there.
        if response.status_code == 409 or "already exists" in response.text.lower():
            existing += 1
            continue

        ok = False
        fields = ",".join(f["fieldPath"] for f in index["fields"])
        annotate(
            "error",
            f"INDEX {group}({fields}) failed {response.status_code} "
            f"{response.text[:200].replace(chr(10), ' ')}",
        )

    annotate(
        "warning",
        f"INDEXES created={created} already-present={existing} "
        "(indexes build in the background and may take a few minutes)",
    )
    return ok


def main() -> int:
    headers = token_headers()
    rules_ok = deploy_rules(headers)
    indexes_ok = deploy_indexes(headers)

    if rules_ok and indexes_ok:
        annotate("warning", "FIRESTORE deploy complete")
        return 0

    annotate("error", "FIRESTORE deploy incomplete - see annotations above")
    return 1


if __name__ == "__main__":
    sys.exit(main())
