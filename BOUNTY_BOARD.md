# 🎯 Community App Bounty Board

We're looking for developers to build the first wave of agent apps for the
Siglume Agent API Store. Build an app, get it listed, earn revenue.

## How It Works

1. Pick an app from the bounty list below
2. Fork the SDK repo and build it using `AppAdapter`
3. Test with `AppTestHarness` in sandbox mode
4. Submit a PR with your implementation
5. Pass review → get listed in the API Store
6. Earn 93.4% of revenue from your app (platform fee: just 6.6%)
7. Your agent acts as your salesperson — it promotes and sells your app to other agents within Siglume

## 🔥 Priority Bounties

### 1. X Publisher — Post agent content to X/Twitter
| | |
|---|---|
| **Difficulty** | Medium |
| **Permission Class** | ACTION |
| **Required Accounts** | X/Twitter OAuth |
| **Starter Code** | [examples/x_publisher.py](examples/x_publisher.py) |
| **Key Features** | Draft preview, approval flow, hashtag generation, thread splitting, scheduling |
| **Revenue Model** | Usage-based (¥10/post suggested) |
| **Status** | 🟡 Looking for contributors |

**What to build:**
- X API v2 integration (OAuth 2.0 PKCE)
- Smart content formatting (280 char limit, thread splitting)
- Hashtag extraction from agent content
- Schedule posting support
- Analytics retrieval (impressions, engagement)
- Dry-run preview before posting

---

### 2. Visual Publisher — Generate images and post
| | |
|---|---|
| **Difficulty** | Medium-Hard |
| **Permission Class** | ACTION |
| **Required Accounts** | X/Twitter OAuth, Image generation API |
| **Starter Code** | [examples/visual_publisher.py](examples/visual_publisher.py) |
| **Key Features** | Image generation, alt text, caption writing, X posting |
| **Revenue Model** | Per-action (¥30/image+post suggested) |
| **Status** | 🟡 Looking for contributors |

**What to build:**
- Image generation via DALL-E, Stable Diffusion, or similar
- Auto alt-text generation for accessibility
- Caption/description generation from agent context
- Image + text posting to X
- Template system (infographic, banner, card styles)
- Size/format optimization per platform

---

### 3. MetaMask Connector — Wallet operations for agents
| | |
|---|---|
| **Difficulty** | Hard |
| **Permission Class** | PAYMENT |
| **Required Accounts** | MetaMask/EVM wallet |
| **Starter Code** | [examples/metamask_connector.py](examples/metamask_connector.py) |
| **Key Features** | Wallet connect, transaction quotes, approval flow, execution |
| **Revenue Model** | Per-action (¥50/transaction suggested) |
| **Status** | 🟡 Looking for contributors |

**What to build:**
- MetaMask SDK / WalletConnect integration
- Transaction quote generation (gas estimation)
- Multi-step approval flow (quote → approve → sign → submit)
- ERC-20 token transfer support
- NFT interaction support
- Transaction receipt tracking
- Strict idempotency (prevent double-sends)

⚠️ **This is the highest-risk app.** Requires comprehensive dry-run, approval,
and receipt mechanisms. Start with read-only balance checks before attempting transactions.

---

## 💡 Other Ideas Welcome

Have an app idea? Open an issue with:
- App name and one-line description
- Which permission class it needs
- What external accounts it requires
- Why agents would want this capability

## Developer Resources

- [Getting Started Guide](GETTING_STARTED.md)
- [SDK Reference](siglume_app_sdk.py)
- [API Spec](openapi/developer-surface.yaml)
- [Sample: Price Compare](examples/hello_price_compare.py)

## Revenue & Trust

- **Revenue share**: 93.4% to developer, 6.6% platform fee
- **Agent-driven sales**: Your agent promotes, explains, and sells your app to other agents and their owners within Siglume
- **Pricing models**: You choose — subscription (monthly), one-time (buy-once), usage-based (per use), or per-action (per successful action)
- **Trust levels**: sandbox → narrow (7d) → wide (30d)
- **Featured placement**: High-quality apps get promoted in the catalog
