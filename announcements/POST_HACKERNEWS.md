# Hacker News — v0.4.0 Draft

> Copy below, review, then paste into https://news.ycombinator.com/submit. Title must be a single line; body goes in "text".

---

Title: Show HN: SDK for publishing APIs that AI agents subscribe to (Python + TS, on-chain payouts)

---

Siglume (https://siglume.com) is an API Store where the API consumer is the AI, not the human — but the subscription decision (opt-in, budget authorize) is still made by the agent's human owner. The SDK I'm releasing — `siglume-api-sdk` v0.4.0 — is for developers who want to publish APIs that autonomous agents discover, subscribe to, and call at runtime after their owner opts in.

The mental model inverts: instead of humans installing apps, agents subscribe to APIs on behalf of their owner. Each subscription pays the developer 93.4% of the revenue (6.6% platform fee), settled on-chain on Polygon (USD-unified, gas sponsored by the platform, no wallet setup required for free listings). Stripe Connect was the original rail; we cut over to smart-wallet / mandate-based auto-debit in Phase 31 (2026-04-18), verified with real userOp on Polygon Amoy.

The v0.4.0 release (https://pypi.org/project/siglume-api-sdk/0.4.0/) has:

- **Python + TypeScript parity**: same AppAdapter / AppTestHarness / CLI in both. Node 18+, Bun, Deno, Edge supported.
- **Offline ToolManual grader**: local 0–100 quality score + A–F grade, parity ±5 points vs. the server scorer. The "tool manual" is the machine-readable contract that tells an LLM when to call your API. Grade B is the publish floor.
- **`siglume` CLI**: `init` / `validate` / `test` / `score --offline|--remote` / `register` / `support` / `diff`. Publish loop is 15 minutes on a clean checkout.
- **Tool schema exporter**: one ToolManual → Anthropic tool_use / OpenAI function calling / OpenAI Responses / MCP tool. Lossless where possible, `lossy_fields` metadata where not.
- **LLM-assisted drafting**: `draft_tool_manual()` and `fill_tool_manual_gaps()` with Anthropic/OpenAI providers, prompt caching on by default. Auto-retry until grade B.
- **Recording harness**: deterministic VCR-style test fixtures for httpx/fetch. No external deps, automatic secret/bearer/private-key redaction, cassette JSON is PR-diffable.
- **Diff tool**: `siglume diff old.json new.json` classifies every change as BREAKING / WARNING / INFO. Exit code 1/2/0. Useful in CI gates.
- **Buyer-side client (experimental)**: `SiglumeBuyerClient.search_capabilities` / `subscribe` / `invoke`, with LangChain and Claude Agent SDK adapter examples. Platform search API is not yet public, so search is in-memory for now.

What works today: free listings, paid subscriptions via on-chain mandate, real execution receipts with PEP 740 attestations on the wheel, seven runnable examples (price-compare, publisher, calendar, email, translation, CRM, wallet-balance, news digest, payment quote).

What's still experimental: the buyer-side SDK (backed by substring search + allow_internal_execute gate), and the TypeScript npm package is not yet on npm — it builds cleanly but publishing is a v0.5 task.

This is a single-person side project with real but limited user base. I'd much rather have honest feedback on the API shape than inflated numbers. GitHub + docs + examples:

https://github.com/taihei-05/siglume-api-sdk

---

## Japanese reference translation (post in English only on HN)

タイトル: Show HN: AI エージェントが購読する API を作るための SDK (Python + TypeScript、オンチェーン決済)

Siglume は、顧客が人間ではなく AI エージェント自身のマーケットプレイス。`siglume-api-sdk` v0.4.0 は、自律エージェントが発見・購読・呼び出しする API を開発者が出品するための SDK です。

モデルを逆転させる: 人間がアプリをインストールする代わりに、エージェントが自分のオーナーのために API を購読する。開発者の取り分は subscription revenue の 93.4% (platform fee 6.6%)、Polygon 上で USD 統一・ガスは platform 負担で決済される。Stripe Connect から smart-wallet / mandate ベースの auto-debit に切り替え済み (Phase 31、2026-04-18、Polygon Amoy で実 userOp 確認済み)。

v0.4.0 の内容:
- Python + TypeScript 同機能 (AppAdapter / AppTestHarness / CLI)
- オフライン ToolManual 品質スコアラー (サーバー parity ±5 点)
- `siglume` CLI (init/validate/test/score/register/support/diff)
- Anthropic / OpenAI Chat+Responses / MCP への tool schema 変換
- LLM 補助 ToolManual 生成 (full draft + gap filler、prompt caching 標準)
- VCR スタイル録画ハーネス (httpx / fetch、秘匿値自動 redact)
- Manifest / ToolManual diff ツール (BREAKING / WARNING / INFO 分類)
- Buyer 側クライアント (LangChain / Claude Agent SDK との連携 example 付き、experimental)

https://github.com/taihei-05/siglume-api-sdk
