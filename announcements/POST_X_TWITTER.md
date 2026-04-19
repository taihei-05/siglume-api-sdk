# X / Twitter — v0.4.0 Thread

> 5-tweet thread, JP and EN paired. Numbers preserved for manual re-ordering if needed.

---

## Tweet 1 (hook)

🚀 `siglume-api-sdk` v0.4.0 をリリースしました。

AI エージェントが購読する API を、個人開発者が出品する仕組みの SDK です。Python + TypeScript 同機能、オンチェーン決済 (Polygon)、開発者取り分 93.4%。

pip install siglume-api-sdk
(TypeScript 版は v0.5 で npm 公開予定 / TS package lands in v0.5)

https://github.com/taihei-05/siglume-api-sdk

🚀 Released siglume-api-sdk v0.4.0.

Build APIs that autonomous AI agents subscribe to. Python + TypeScript parity, on-chain settlement on Polygon, developer keeps 93.4%.

---

## Tweet 2 (what v0.4 gives you)

v0.4.0 の中身:

🧪 オフライン ToolManual 品質スコアラー (サーバー ±5 点)
🔨 `siglume` CLI (init/validate/test/score/register/diff)
🔁 Anthropic / OpenAI / MCP への tool schema 変換
🧠 LLM で ToolManual を自動下書き (prompt caching 標準)
📼 決定的テスト用の録画ハーネス

What v0.4.0 ships:

🧪 Offline ToolManual grader (±5 vs server)
🔨 `siglume` CLI for the full publish loop
🔁 Exporter → Anthropic / OpenAI Chat+Responses / MCP
🧠 LLM-assisted tool manual drafting
📼 Deterministic VCR-style recording harness

---

## Tweet 3 (example)

出品側は `AppAdapter` を 1 クラス実装するだけ。品質スコアが B 未満なら publish 不可で、manifest と tool manual は CLI でローカル採点できる。

The publish side is one `AppAdapter` class. Grade B is the publish floor; both manifest and tool manual are scored locally by the CLI before network round-trips.

---

## Tweet 4 (buyer side)

購入側 SDK (experimental) は LangChain / Claude Agent SDK adapter 付き。ToolManual を Anthropic / OpenAI / MCP のどれにも変換できるので、自作エージェントに Siglume の capability を即組み込める。

Buyer-side SDK (experimental) ships with LangChain and Claude Agent SDK adapters. The ToolManual exporter converts to whichever tool-calling dialect your agent speaks.

---

## Tweet 5 (CTA)

v0.4.0 wheel + sdist + PEP 740 attestations は PyPI に live、docs / examples / 7 本の runnable adapter は GitHub に。

個人開発の side project なので、API 形状への率直なフィードバックが一番嬉しい。

https://github.com/taihei-05/siglume-api-sdk

v0.4.0 wheel + sdist + PEP 740 attestations on PyPI. Docs, examples, and 7 runnable adapters on GitHub.

This is a single-maintainer side project — honest feedback on the API shape is the most valuable thing you can send back.

#AI #AIAgent #TypeScript #Python #OpenSource #Web3 #Polygon
