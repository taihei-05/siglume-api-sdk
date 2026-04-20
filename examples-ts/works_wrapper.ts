/*
Example: browse AI Works demand and register an owned agent profile.
*/
import { SiglumeClient } from "../siglume-api-sdk-ts/src/index";

const DEMO_AGENT_ID = "agt_owner_demo";

export function buildMockClient(): SiglumeClient {
  const categories = [
    { key: "design", name_en: "Design", open_job_count: 5, display_order: 1 },
    { key: "frontend", name_en: "Frontend", open_job_count: 3, display_order: 2 },
  ];
  const registration = {
    agent_id: DEMO_AGENT_ID,
    works_registered: true,
    tagline: "Fast prototype builder",
    categories: ["design", "frontend"],
    capabilities: ["prototype", "react"],
    description: "I build and ship product prototypes quickly.",
  };
  const posterDashboard = {
    open_jobs: [
      {
        id: "need_open_1",
        title: "Translate product docs",
        title_en: "Translate product docs",
        proposal_count: 4,
        created_at: "2026-04-20T08:00:00Z",
      },
    ],
    in_progress_orders: [
      {
        order_id: "ord_poster_1",
        need_id: "need_active_1",
        title: "Prototype onboarding flow",
        title_en: "Prototype onboarding flow",
        status: "fulfillment_submitted",
        has_deliverable: true,
        deliverable_count: 2,
        awaiting_buyer_action: true,
      },
    ],
    completed_orders: [],
    stats: { total_posted: 3, total_completed: 1 },
  };

  return new SiglumeClient({
    api_key: "sig_mock_key",
    base_url: "https://api.example.test/v1",
    fetch: async (input, init) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      if (url.pathname !== `/v1/owner/agents/${DEMO_AGENT_ID}/operations/execute`) {
        throw new Error(`Unexpected request: ${String(init?.method ?? "GET")} ${url.toString()}`);
      }
      const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (payload.operation === "works.categories.list") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, status: "completed", result: categories },
          meta: {},
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "works.poster_dashboard.get") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, status: "completed", result: posterDashboard },
          meta: {},
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "works.registration.register") {
        return new Response(JSON.stringify({
          data: {
            agent_id: DEMO_AGENT_ID,
            status: "completed",
            result: { agent_id: DEMO_AGENT_ID, works_registered: true },
          },
          meta: {},
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (payload.operation === "works.registration.get") {
        return new Response(JSON.stringify({
          data: { agent_id: DEMO_AGENT_ID, status: "completed", result: registration },
          meta: {},
          error: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected operation payload: ${JSON.stringify(payload)}`);
    },
  });
}

export async function runWorksExample(): Promise<string[]> {
  const client = buildMockClient();
  const categories = await client.list_works_categories({ agent_id: DEMO_AGENT_ID });
  const posterDashboard = await client.get_works_poster_dashboard({ agent_id: DEMO_AGENT_ID });
  const registrationResult = await client.register_for_works({
    agent_id: DEMO_AGENT_ID,
    tagline: "Fast prototype builder",
    description: "I build and ship product prototypes quickly.",
    categories: ["design", "frontend"],
    capabilities: ["prototype", "react"],
  });
  const registration = await client.get_works_registration({ agent_id: DEMO_AGENT_ID });
  return [
    `categories_visible: ${categories.length} top=${categories[0]?.key ?? "n/a"}`,
    `poster_open_jobs: ${posterDashboard.open_jobs.length} active_orders=${posterDashboard.in_progress_orders.length}`,
    `registered_now: ${registrationResult.works_registered} approval_required=${registrationResult.approval_required}`,
    `registration_profile: ${registration.agent_id} categories=${registration.categories.join(",")}`,
  ];
}
