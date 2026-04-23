"""Register an app through the typed SiglumeClient."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (  # noqa: E402
    AppCategory,
    AppManifest,
    ApprovalMode,
    PermissionClass,
    PriceModel,
    SiglumeClient,
    ToolManual,
    ToolManualPermissionClass,
)


def build_manifest() -> AppManifest:
    return AppManifest(
        capability_key="price-compare-helper",
        name="Price Compare Helper",
        job_to_be_done="Compare retailer prices for a product and return the best current offer.",
        category=AppCategory.COMMERCE,
        permission_class=PermissionClass.READ_ONLY,
        approval_mode=ApprovalMode.AUTO,
        dry_run_supported=True,
        required_connected_accounts=[],
        price_model=PriceModel.FREE,
        jurisdiction="US",
        short_description="Search multiple retailers and summarize the best current price.",
        docs_url="https://github.com/taihei-05/siglume-api-sdk/blob/main/examples/register_via_client.py",
        support_contact="https://github.com/taihei-05/siglume-api-sdk/issues",
        example_prompts=["Compare prices for Sony WH-1000XM5."],
    )


def build_tool_manual() -> ToolManual:
    return ToolManual(
        tool_name="price_compare_helper",
        job_to_be_done="Search multiple retailers for a product and return a ranked price comparison the agent can cite.",
        summary_for_model="Looks up current retailer offers and returns a structured comparison with the best deal first.",
        trigger_conditions=[
            "owner asks to compare prices for a product before deciding where to buy",
            "agent needs retailer offer data to support a shopping recommendation",
            "request is to find the cheapest or best-value option for a product query",
        ],
        do_not_use_when=[
            "the request is to complete checkout or place an order instead of comparing offers",
            "the owner already chose a seller and only wants post-purchase support",
        ],
        permission_class=ToolManualPermissionClass.READ_ONLY,
        dry_run_supported=True,
        requires_connected_accounts=[],
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Product name, model number, or search phrase."},
                "max_results": {"type": "integer", "description": "Maximum number of offers to return.", "default": 5},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "One-line overview of the best available deal."},
                "offers": {"type": "array", "items": {"type": "object"}, "description": "Ranked retailer offers."},
                "best_offer": {"type": "object", "description": "Top-ranked offer selected from the comparison."},
            },
            "required": ["summary", "offers", "best_offer"],
            "additionalProperties": False,
        },
        usage_hints=[
            "Use this tool after the owner has named a product and wants evidence-backed price comparison.",
        ],
        result_hints=[
            "Lead with the best_offer and then explain notable trade-offs such as shipping or stock.",
        ],
        error_hints=[
            "If no offers are found, ask the owner for a clearer product name or model number.",
        ],
    )


def build_runtime_validation() -> dict[str, object]:
    """Build the production runtime validation payload from explicit env vars."""
    public_base_url = os.environ.get("SIGLUME_RUNTIME_BASE_URL", "").strip().rstrip("/")
    review_key = os.environ.get("SIGLUME_REVIEW_KEY", "").strip()
    if not public_base_url:
        raise SystemExit("SIGLUME_RUNTIME_BASE_URL is required, for example https://api.your-domain.com")
    if not review_key:
        raise SystemExit("SIGLUME_REVIEW_KEY is required. Use a dedicated review/test secret, not an owner token.")

    return {
        "public_base_url": public_base_url,
        "healthcheck_url": os.environ.get("SIGLUME_HEALTHCHECK_URL", urljoin(f"{public_base_url}/", "health")),
        "invoke_url": os.environ.get("SIGLUME_INVOKE_URL", urljoin(f"{public_base_url}/", "v1/price-compare")),
        "invoke_method": "POST",
        "test_auth_header_name": os.environ.get("SIGLUME_REVIEW_HEADER", "X-Siglume-Review-Key"),
        "test_auth_header_value": review_key,
        "request_payload": {"query": "Sony WH-1000XM5", "max_results": 5},
        "expected_response_fields": ["summary", "offers", "best_offer"],
        "timeout_seconds": 10,
    }


def main() -> None:
    api_key = os.environ.get("SIGLUME_API_KEY")
    if not api_key:
        raise SystemExit("SIGLUME_API_KEY is required.")

    manifest = build_manifest()
    tool_manual = build_tool_manual()
    runtime_validation = build_runtime_validation()

    with SiglumeClient(api_key=api_key) as client:
        receipt = client.auto_register(manifest, tool_manual, runtime_validation=runtime_validation)
        print(f"Draft listing created: {receipt.listing_id} ({receipt.status})")
        if receipt.review_url:
            print(f"Review URL: {receipt.review_url}")

        confirmation = client.confirm_registration(receipt.listing_id)
        print(
            "Confirmation:",
            confirmation.listing_id,
            confirmation.status,
            confirmation.quality.grade,
            confirmation.quality.overall_score,
        )


if __name__ == "__main__":
    main()
