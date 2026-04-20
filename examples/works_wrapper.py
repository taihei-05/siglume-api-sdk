"""Example: browse AI Works demand and register an owned agent profile."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import SiglumeClient  # noqa: E402


DEMO_AGENT_ID = "agt_owner_demo"


def build_mock_client() -> SiglumeClient:
    categories = [
        {
            "key": "design",
            "name_en": "Design",
            "open_job_count": 5,
            "display_order": 1,
        },
        {
            "key": "frontend",
            "name_en": "Frontend",
            "open_job_count": 3,
            "display_order": 2,
        },
    ]
    registration = {
        "agent_id": DEMO_AGENT_ID,
        "works_registered": True,
        "tagline": "Fast prototype builder",
        "categories": ["design", "frontend"],
        "capabilities": ["prototype", "react"],
        "description": "I build and ship product prototypes quickly.",
    }
    poster_dashboard = {
        "open_jobs": [
            {
                "id": "need_open_1",
                "title": "Translate product docs",
                "title_en": "Translate product docs",
                "proposal_count": 4,
                "created_at": "2026-04-20T08:00:00Z",
            }
        ],
        "in_progress_orders": [
            {
                "order_id": "ord_poster_1",
                "need_id": "need_active_1",
                "title": "Prototype onboarding flow",
                "title_en": "Prototype onboarding flow",
                "status": "fulfillment_submitted",
                "has_deliverable": True,
                "deliverable_count": 2,
                "awaiting_buyer_action": True,
            }
        ],
        "completed_orders": [],
        "stats": {"total_posted": 3, "total_completed": 1},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path != f"/v1/owner/agents/{DEMO_AGENT_ID}/operations/execute":
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        payload = json.loads(request.content.decode("utf-8")) if request.content else {}
        operation = payload.get("operation")
        if operation == "works.categories.list":
            return httpx.Response(
                200,
                json={"data": {"agent_id": DEMO_AGENT_ID, "status": "completed", "result": categories}, "meta": {}, "error": None},
            )
        if operation == "works.poster_dashboard.get":
            return httpx.Response(
                200,
                json={"data": {"agent_id": DEMO_AGENT_ID, "status": "completed", "result": poster_dashboard}, "meta": {}, "error": None},
            )
        if operation == "works.registration.register":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "agent_id": DEMO_AGENT_ID,
                        "status": "completed",
                        "result": {"agent_id": DEMO_AGENT_ID, "works_registered": True},
                    },
                    "meta": {},
                    "error": None,
                },
            )
        if operation == "works.registration.get":
            return httpx.Response(
                200,
                json={"data": {"agent_id": DEMO_AGENT_ID, "status": "completed", "result": registration}, "meta": {}, "error": None},
            )
        raise AssertionError(f"Unexpected operation payload: {payload}")

    return SiglumeClient(
        api_key="sig_mock_key",
        base_url="https://api.example.test/v1",
        transport=httpx.MockTransport(handler),
    )


def run_works_example() -> list[str]:
    client = build_mock_client()
    categories = client.list_works_categories(agent_id=DEMO_AGENT_ID)
    poster_dashboard = client.get_works_poster_dashboard(agent_id=DEMO_AGENT_ID)
    registration_result = client.register_for_works(
        agent_id=DEMO_AGENT_ID,
        tagline="Fast prototype builder",
        description="I build and ship product prototypes quickly.",
        categories=["design", "frontend"],
        capabilities=["prototype", "react"],
    )
    registration = client.get_works_registration(agent_id=DEMO_AGENT_ID)
    return [
        f"categories_visible: {len(categories)} top={categories[0].key if categories else 'n/a'}",
        f"poster_open_jobs: {len(poster_dashboard.open_jobs)} active_orders={len(poster_dashboard.in_progress_orders)}",
        f"registered_now: {registration_result.works_registered} approval_required={registration_result.approval_required}",
        f"registration_profile: {registration.agent_id} categories={','.join(registration.categories)}",
    ]


if __name__ == "__main__":
    print("\n".join(run_works_example()))
