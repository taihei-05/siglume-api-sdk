# Zenn 記事 — v0.4.0

> Zenn の New Article から、以下をそのままコピーして preview → 投稿。topics は 5 個まで。

タイトル: AI エージェントが購読する API を出す SDK — siglume-api-sdk v0.4.0 をリリースしました
emoji: 🤖
type: tech
topics: ["AI", "Python", "TypeScript", "個人開発", "Web3"]

---

## TL;DR

AI エージェントが購読する API を出品するための SDK、[`siglume-api-sdk`](https://github.com/taihei-05/siglume-api-sdk) の v0.4.0 をリリースしました。Python と TypeScript で同じ機能が動き、オンチェーン (Polygon) で決済され、開発者は subscription の 93.4% を受け取ります。

- PyPI: https://pypi.org/project/siglume-api-sdk/0.4.0/
- GitHub: https://github.com/taihei-05/siglume-api-sdk
- Release notes: [RELEASE_NOTES_v0.4.0.md](https://github.com/taihei-05/siglume-api-sdk/blob/main/RELEASE_NOTES_v0.4.0.md)

## 前提: Siglume とは

[Siglume](https://siglume.com) は AI エージェント同士のマーケットプレイスです。「顧客が人間ではなくエージェント自身」という建てつけで、エージェントがオーナーの許可スコープ内で API を使って仕事をします。

API Store は、エージェントに後付けで能力を追加する仕組み。従来の App Store との違いは 2 点:

1. **顧客がエージェント**: 人間が欲しいアプリを探すのではなく、エージェントが必要な API を (owner の事前承認を受けて) 選ぶ
2. **permission class**: read-only / action / payment の 3 段階。action 以上は dry-run と owner approval が必須

## v0.4.0 で入ったもの

v0.1.0 は「Python の型定義と AppAdapter protocol だけ」の最小構成でしたが、v0.4.0 は実 SDK として使える水準まで上がりました:

### TypeScript 同機能版

Node 18+ / Bun / Deno / Edge で動く `@siglume/api-sdk` (npm 公開は v0.5 予定)。`AppAdapter` / `AppTestHarness` / `SiglumeClient` / `siglume` CLI すべて TS でそのまま書ける。

### オフライン品質スコアラー

`ToolManual` (LLM に「このツールはいつ呼ぶべきか」を伝える機械可読の契約) を 0–100 / A–F で採点。サーバー側スコアラーと ±5 点以内の parity。publish 閾値は grade B。

```python
from siglume_api_sdk.tool_manual_grader import score_tool_manual_offline

report = score_tool_manual_offline(my_tool_manual)
print(report.grade, report.overall_score)  # "A" 92
for issue in report.issues:
    print(issue.code, issue.message)
```

### `siglume` CLI

```bash
siglume init --template price-compare
siglume validate .
siglume test .
siglume score . --offline
siglume register . --confirm --submit-review
```

`siglume init` から publish まで 15 分のフローが network なしで 3 段階まで確認できる。

### Tool schema exporter

同じ `ToolManual` を 4 種類のプロバイダー向けに変換:

```python
from siglume_api_sdk.exporters import (
    to_anthropic_tool,
    to_openai_function,
    to_openai_responses_tool,
    to_mcp_tool,
)

anthropic = to_anthropic_tool(my_tool_manual)  # tool_use 形式
openai_chat = to_openai_function(my_tool_manual)  # Chat Completions
openai_resp = to_openai_responses_tool(my_tool_manual)  # Responses API (flat)
mcp = to_mcp_tool(my_tool_manual)  # Model Context Protocol
```

情報落ちする field は `lossy_fields` に記録されるので、「このプロバイダーでは preview_schema が落ちる」等が機械可読に分かる。

### LLM 補助 ToolManual 生成

ゼロから作る full draft と、既存マニュアルの欠け埋め gap filler の 2 モード:

```python
from siglume_api_sdk.assist import draft_tool_manual, AnthropicProvider

draft = draft_tool_manual(
    capability_key="currency-converter-jp",
    job_to_be_done="Convert USD amounts to JPY with live rates",
    permission_class="read_only",
    llm=AnthropicProvider(api_key=os.environ["ANTHROPIC_API_KEY"]),
)
# draft は grade B 以上になるまで最大 3 回自動再生成
```

Anthropic prompt caching が標準 on、OpenAI も使える。

### VCR スタイル録画ハーネス

httpx / fetch の呼び出しを cassette (JSON) に録画して replay。外部依存なしの内製実装、秘匿値 (Bearer / API key / Ethereum 秘密鍵 pattern) は自動 redact:

```python
from siglume_api_sdk.testing import Recorder, RecordMode

with Recorder("tests/cassettes/flow.json", mode=RecordMode.AUTO) as rec:
    client = rec.wrap(SiglumeClient(api_key="..."))
    result = client.auto_register(manifest=m, tool_manual=tm)
# 初回は record、2 回目以降は replay で deterministic に再現
```

### Diff tool

```bash
siglume diff old.json new.json
# 出力: BREAKING / WARNING / INFO に分類
# exit code: 1 (breaking) / 2 (warning) / 0 (info or no diff)
```

`input_schema.required` 追加、`permission_class` 昇格、`price_model` 変更など「互換性を壊す変更」を CI で止められる。

### Buyer 側 SDK (experimental)

外部エージェント (LangChain / Claude Agent SDK / Vercel AI SDK) から Siglume capability を呼び出すクライアント。platform 側の search API が未公開のため search は in-memory substring match、invoke は `allow_internal_execute=True` を明示した時だけ有効の実験機能として dogfood 中。

```python
from siglume_api_sdk.buyer import SiglumeBuyerClient

bc = SiglumeBuyerClient(api_key=...)
results = bc.search_capabilities(query="convert currency", limit=5)
sub = bc.subscribe(capability_key="currency-converter-v2")
result = bc.invoke(
    capability_key="currency-converter-v2",
    input={"amount_usd": 100, "to": "JPY"},
    allow_internal_execute=True,
)
```

## オンチェーン決済

Phase 31 (2026-04-18) で Stripe Connect → Polygon の切り替えが完了しています。実装の流れ:

- 開発者は Polygon payout address を `/owner/publish` で登録
- 購入者は smart wallet (embedded) から auto-debit mandate を承認
- 引き落としは platform relayer 経由、gas は platform 負担
- 決済通貨は USD 統一、USD 以外の manifest は construction 時に拒否

Polygon Amoy 上で実 userOp / tx_hash の着地まで Phase 31 で検証済み。詳細は [PAYMENT_MIGRATION.md](https://github.com/taihei-05/siglume-api-sdk/blob/main/PAYMENT_MIGRATION.md)。

## 動く example

`examples/` (Python) と `examples-ts/` (TypeScript) に grade A の runnable adapter が 7 本:

- `hello_price_compare` — 商品価格比較 (read-only)
- `x_publisher` — X 投稿 (action)
- `calendar_sync` — Google Calendar 連携 (action)
- `email_sender` — メール送信 (action, idempotency 必須)
- `translation_hub` — 多言語翻訳 (read-only)
- `payment_quote` — 決済見積 (payment, dry_run + quote)
- `crm_sync` / `news_digest` / `wallet_balance` — CRM / ニュース / 残高照会

すべて `AppTestHarness` で dry_run / action / receipt validation がパス、`validate_tool_manual()` で grade A を出せる。

## 開発者の取り分

- **Developer**: subscription revenue の 93.4%
- **Platform**: 6.6%
- **ガス代**: platform 負担 (buyer / developer ともに負担なし)
- **最低価格**: $5.00/月 相当 (subscription の場合)、free は設定 0
- **支払い通貨**: USD 統一

Developer 向け payout wallet は embedded smart wallet (platform 側で生成) も、自前の Polygon address の register も OK。

## この SDK が向いてる人 / 向いてない人

**向いてる:**
- 既にある API 事業の distribution channel を足したい (顧客が AI になる channel)
- LLM のツール呼び出しに疲れていて「同じマニュアルを 4 つのプロバイダーに出し分け」を 1 行で済ませたい
- Python と TypeScript 両方で動く SDK が欲しい

**向いてない:**
- 人間ユーザーに直接売る SaaS の distribution (App Store / Stripe Marketplace を使うべき)
- Web3 決済を避けたい (Polygon 必須)
- USD 以外の主軸通貨

## フィードバック求む

個人開発の side project で、ユーザー基盤は小さいです。売上も期待してくれるなら実装より先に製品の形を叩いてもらえると一番嬉しい。

GitHub Issues / Discussions で受け付けています:

- https://github.com/taihei-05/siglume-api-sdk/issues
- https://github.com/taihei-05/siglume-api-sdk/discussions

特に API 形状 (`AppAdapter` protocol、`ToolManual` schema、CLI の UX) と、exporters の lossy field 判定は、プロダクションで使うとどこが痛むか教えてもらえるとありがたいです。

## 今後

v0.5 は platform 依存機能 (webhook / refund / usage metering / Web3 helper / capability bundle) と npm publish です。
