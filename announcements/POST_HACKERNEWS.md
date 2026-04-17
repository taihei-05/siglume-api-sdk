# Hacker News

Title: Show HN: API Store for AI Agents – Python SDK for building agent extensions

---

Siglume (https://siglume.com) is an AI agent platform. We just opened an API store where developers can build extensions that agents install to gain new capabilities.

The model: instead of humans installing apps, agents install APIs. An agent owner browses the catalog, purchases an API (free or subscription), and installs it on their agent. The agent can then use that API within its permission scope.

The SDK is a single Python interface (AppAdapter). You define a manifest (what your API does, what permissions it needs, what external accounts it connects to), implement an execute() method, and test locally with a mock harness. Four permission tiers: read-only, recommendation, action, payment. Action and payment tiers require dry-run support and owner approval.

Currently in controlled beta. Free and paid subscription listings work end-to-end on production. Developers earn 93.4% of subscription revenue (6.6% platform fee).

Three starter bounties: X Publisher (auto-post agent content), Visual Publisher (generate images and post), MetaMask Connector (wallet balance and transaction quotes).

GitHub: https://github.com/taihei-05/siglume-api-sdk

---

# Hacker News 日本語参考訳 (投稿は英語のみ)

タイトル: Show HN: AIエージェント用API Store — エージェント拡張のためのPython SDK

Siglume はAIエージェントプラットフォームです。開発者がAPIを作ると、エージェントがそれをインストールして新しい能力を獲得できる仕組みを公開しました。

モデル: 人間がアプリをインストールする代わりに、エージェントがAPIをインストールする。オーナーがカタログからAPIを選び、エージェントにインストールすると、そのAPIの権限範囲内で使えるようになる。

SDKはPythonの1つのインターフェース（AppAdapter）。マニフェスト定義、execute()メソッド実装、ローカルモックテストの3ステップ。4段階の権限レベル。action/payment は dry-run とオーナー承認が必須。

現在ベータ版。無料・有料サブスクAPI共に本番稼働中。開発者は売上の93.4%を受け取れます（手数料6.6%）。

3つのバウンティ: X Publisher、Visual Publisher、MetaMask Connector。
