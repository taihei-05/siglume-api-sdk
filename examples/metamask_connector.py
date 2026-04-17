"""Community API: MetaMask Connector for Siglume

Enable your agent to interact with Ethereum wallets and smart contracts.

Permission: PAYMENT (highest tier  -- can move funds)
Approval: ALWAYS_ASK (owner must approve every transaction)
Dry-run: Yes (creates transaction quote without signing)
Quote: Shows estimated gas + amount before approval
Action: Prepares unsigned transaction
Payment: Submits signed transaction (requires explicit approval)
Connected accounts: MetaMask / WalletConnect

STATUS: Community example  -- looking for contributors!
See API_IDEAS.md for details.

WARNING: This is the most complex API template. It deals with real
financial transactions. Contributors MUST add comprehensive error
handling and testing before this goes live.
"""
# ============================================================================
# THIS IS A STARTER TEMPLATE, NOT A FINISHED IMPLEMENTATION.
# TODO items mark where real Ethereum RPC calls and wallet integration are needed.
# This is a high-sensitivity API -- read the safety notes carefully.
# See GETTING_STARTED.md for how to build and register your API.
# ============================================================================
from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from siglume_api_sdk import (
    AppAdapter, AppManifest, ExecutionContext, ExecutionResult,
    PermissionClass, ApprovalMode, ExecutionKind, PriceModel, AppCategory,
    ConnectedAccountRef, StubProvider, AppTestHarness, HealthCheckResult,
    Environment,
)


# ── Constants ──

# TODO: Move to config or env vars  -- never hardcode chain IDs in production
SUPPORTED_CHAINS = {
    "1": "Ethereum Mainnet",
    "5": "Goerli Testnet",
    "11155111": "Sepolia Testnet",
    "137": "Polygon",
    "42161": "Arbitrum One",
}

# TODO: Replace with real gas oracle integration
DEFAULT_GAS_LIMIT = 21000       # basic ETH transfer
ERC20_GAS_LIMIT = 65000         # ERC-20 token transfer
DEFAULT_GAS_PRICE_GWEI = 30     # stub; real apps must query gas oracle


class MetaMaskConnectorApp(AppAdapter):

    def manifest(self) -> AppManifest:
        return AppManifest(
            capability_key="metamask-connector",
            version="0.1.0",
            name="MetaMask Connector",
            job_to_be_done="Send ETH/tokens, check balances, and interact with smart contracts via MetaMask",
            category=AppCategory.FINANCE,
            permission_class=PermissionClass.PAYMENT,
            approval_mode=ApprovalMode.ALWAYS_ASK,
            dry_run_supported=True,
            required_connected_accounts=["metamask"],
            permission_scopes=[
                "wallet.balance",       # read balance
                "wallet.sign",          # sign transactions
                "wallet.send",          # send transactions
            ],
            price_model=PriceModel.FREE,
            price_value_minor=0,
            currency="USD",
            jurisdiction="US",
            applicable_regulations=["BSA"],  # US Bank Secrecy Act — MSB rules
            short_description="Connect your agent to Ethereum wallets for on-chain actions",
            docs_url="https://github.com/taihei-05/siglume-api-sdk/blob/main/examples/metamask_connector.py",
            example_prompts=[
                "Check my ETH balance",
                "Send 0.1 ETH to 0xAbC...123",
                "Get a gas estimate for this transfer",
            ],
            compatibility_tags=["web3", "ethereum", "defi", "wallet", "metamask"],
        )

    async def execute(self, ctx: ExecutionContext) -> ExecutionResult:
        action = ctx.input_params.get("action", "balance")

        if action == "balance":
            return await self._check_balance(ctx)
        elif action == "transfer":
            return await self._handle_transfer(ctx)
        elif action == "contract_call":
            return await self._handle_contract_call(ctx)
        else:
            return ExecutionResult(
                success=False,
                error_message=f"Unknown action: {action}. Supported: balance, transfer, contract_call",
                execution_kind=ctx.execution_kind,
            )

    async def _check_balance(self, ctx: ExecutionContext) -> ExecutionResult:
        """Check wallet balance. This is a read-only operation."""
        address = ctx.input_params.get("address", "")
        chain_id = ctx.input_params.get("chain_id", "1")

        if not address:
            return ExecutionResult(
                success=False,
                error_message="No wallet address provided",
                execution_kind=ctx.execution_kind,
            )

        # TODO: Replace with real eth_getBalance RPC call
        # provider_url = self._get_rpc_url(chain_id)
        # balance_wei = await self._rpc_call(provider_url, "eth_getBalance", [address, "latest"])
        # balance_eth = int(balance_wei, 16) / 1e18

        chain_name = SUPPORTED_CHAINS.get(chain_id, f"Chain {chain_id}")
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "address": address,
                "chain": chain_name,
                "balance_eth": "1.2345",       # stub
                "balance_wei": "1234500000000000000",  # stub
            },
        )

    async def _handle_transfer(self, ctx: ExecutionContext) -> ExecutionResult:
        """Handle ETH/token transfer through the full execution pipeline."""
        to_address = ctx.input_params.get("to", "")
        amount_eth = ctx.input_params.get("amount", "0")
        chain_id = ctx.input_params.get("chain_id", "1")
        token_contract = ctx.input_params.get("token_contract")  # None = native ETH

        # ── Validation ──
        if not to_address:
            return ExecutionResult(
                success=False,
                error_message="No recipient address provided",
                execution_kind=ctx.execution_kind,
            )
        if not self._is_valid_address(to_address):
            return ExecutionResult(
                success=False,
                error_message=f"Invalid Ethereum address: {to_address}",
                execution_kind=ctx.execution_kind,
            )

        try:
            amount = float(amount_eth)
            if amount <= 0:
                raise ValueError("Amount must be positive")
        except (ValueError, TypeError) as e:
            return ExecutionResult(
                success=False,
                error_message=f"Invalid amount: {amount_eth} ({e})",
                execution_kind=ctx.execution_kind,
            )

        # ── Estimate gas ──
        gas_estimate = await self._estimate_gas(chain_id, to_address, amount, token_contract)

        chain_name = SUPPORTED_CHAINS.get(chain_id, f"Chain {chain_id}")
        tx_summary = {
            "from": "(connected wallet)",
            "to": to_address,
            "amount_eth": str(amount),
            "chain": chain_name,
            "token": token_contract or "ETH (native)",
            "gas_limit": gas_estimate["gas_limit"],
            "gas_price_gwei": gas_estimate["gas_price_gwei"],
            "estimated_gas_cost_eth": gas_estimate["estimated_cost_eth"],
            "total_cost_eth": str(amount + float(gas_estimate["estimated_cost_eth"])),
        }

        # ── DRY RUN: return quote only ──
        if ctx.execution_kind == ExecutionKind.DRY_RUN:
            return ExecutionResult(
                success=True,
                execution_kind=ExecutionKind.DRY_RUN,
                output={"quote": tx_summary},
                needs_approval=True,
                approval_prompt=(
                    f"Transfer {amount} ETH to {to_address[:10]}...{to_address[-6:]}\n"
                    f"  Chain: {chain_name}\n"
                    f"  Estimated gas: {gas_estimate['estimated_cost_eth']} ETH\n"
                    f"  Total: {tx_summary['total_cost_eth']} ETH"
                ),
            )

        # ── QUOTE: same as dry run but with live gas prices ──
        if ctx.execution_kind == ExecutionKind.QUOTE:
            # TODO: Fetch real-time gas prices from gas oracle
            # gas_oracle = await self._fetch_gas_oracle(chain_id)
            return ExecutionResult(
                success=True,
                execution_kind=ExecutionKind.QUOTE,
                output={"quote": tx_summary, "quote_valid_seconds": 30},
                needs_approval=True,
                approval_prompt=(
                    f"Ready to send {amount} ETH to {to_address[:10]}...{to_address[-6:]}\n"
                    f"  Gas: {gas_estimate['estimated_cost_eth']} ETH\n"
                    f"  Quote valid for 30 seconds. Approve to proceed."
                ),
            )

        # ── ACTION: prepare unsigned transaction ──
        if ctx.execution_kind == ExecutionKind.ACTION:
            # TODO: Build real unsigned transaction
            # unsigned_tx = {
            #     "to": to_address,
            #     "value": hex(int(amount * 1e18)),
            #     "gas": hex(gas_estimate["gas_limit"]),
            #     "gasPrice": hex(int(gas_estimate["gas_price_gwei"] * 1e9)),
            #     "nonce": await self._get_nonce(from_address),
            #     "chainId": hex(int(chain_id)),
            # }

            unsigned_tx = {
                "to": to_address,
                "value": f"0x{int(amount * 1e18):x}",
                "gas": hex(gas_estimate["gas_limit"]),
                "gasPrice": hex(int(gas_estimate["gas_price_gwei"] * 1e9)),
                "chainId": f"0x{int(chain_id):x}",
                "nonce": "0x0",  # stub
            }

            return ExecutionResult(
                success=True,
                execution_kind=ExecutionKind.ACTION,
                output={
                    "unsigned_tx": unsigned_tx,
                    "summary": tx_summary,
                    "message": "Transaction prepared. Submit as PAYMENT to sign and broadcast.",
                },
                needs_approval=True,
                approval_prompt=(
                    f"Transaction prepared: {amount} ETH to {to_address[:10]}...\n"
                    f"Approve to sign and broadcast."
                ),
            )

        # ── PAYMENT: sign and broadcast ──
        if ctx.execution_kind == ExecutionKind.PAYMENT:
            # TODO: This is the critical path. Real implementation must:
            #   1. Retrieve the unsigned tx from the previous ACTION step (via idempotency_key)
            #   2. Request MetaMask signature via WalletConnect / browser extension
            #   3. Broadcast signed tx via eth_sendRawTransaction
            #   4. Wait for confirmation (at least 1 block)
            #   5. Return the tx hash and block number
            #
            # SECURITY TODO:
            #   - Verify tx params haven't changed since the QUOTE step
            #   - Check that budget_remaining_minor covers platform fee
            #   - Rate-limit to prevent rapid successive transactions
            #   - Log everything to audit trail

            return ExecutionResult(
                success=True,
                execution_kind=ExecutionKind.PAYMENT,
                output={
                    "tx_hash": "0xstub_tx_hash_abcdef1234567890",
                    "block_number": 12345678,
                    "status": "confirmed",
                    "summary": tx_summary,
                },
                amount_minor=100,  # platform fee
                units_consumed=1,
                receipt_summary={
                    "action": "eth_transfer",
                    "tx_hash": "0xstub_tx_hash_abcdef1234567890",
                    "amount_eth": str(amount),
                    "to": to_address,
                    "chain": chain_name,
                },
            )

        return ExecutionResult(
            success=False,
            error_message=f"Unhandled execution kind: {ctx.execution_kind}",
            execution_kind=ctx.execution_kind,
        )

    async def _handle_contract_call(self, ctx: ExecutionContext) -> ExecutionResult:
        """Interact with a smart contract (read or write).

        TODO: Implement full contract interaction:
          - ABI decoding / encoding
          - eth_call for read-only methods
          - eth_sendTransaction for state-changing methods
          - Event log parsing
        """
        contract = ctx.input_params.get("contract", "")
        method = ctx.input_params.get("method", "")
        args = ctx.input_params.get("args", [])

        if not contract or not method:
            return ExecutionResult(
                success=False,
                error_message="contract and method are required for contract_call",
                execution_kind=ctx.execution_kind,
            )

        # TODO: Replace with real contract interaction
        return ExecutionResult(
            success=True,
            execution_kind=ctx.execution_kind,
            output={
                "contract": contract,
                "method": method,
                "args": args,
                "result": "stub_contract_result",
                "message": "Contract call stubbed. Implement ABI encoding + RPC call.",
            },
        )

    async def _estimate_gas(
        self, chain_id: str, to: str, amount: float, token_contract: str | None
    ) -> dict:
        """Estimate gas for a transaction.

        TODO: Replace with real eth_estimateGas RPC call.
        TODO: Integrate EIP-1559 (baseFee + priorityFee) for supported chains.
        TODO: Add gas oracle integration (e.g., ethgasstation, blocknative).
        """
        gas_limit = ERC20_GAS_LIMIT if token_contract else DEFAULT_GAS_LIMIT
        gas_price_gwei = DEFAULT_GAS_PRICE_GWEI
        estimated_cost_eth = (gas_limit * gas_price_gwei * 1e9) / 1e18

        return {
            "gas_limit": gas_limit,
            "gas_price_gwei": gas_price_gwei,
            "estimated_cost_eth": f"{estimated_cost_eth:.6f}",
        }

    def _is_valid_address(self, address: str) -> bool:
        """Basic Ethereum address validation.

        TODO: Add EIP-55 checksum validation.
        TODO: Add ENS name resolution support.
        """
        if not address.startswith("0x"):
            return False
        if len(address) != 42:
            return False
        try:
            int(address, 16)
            return True
        except ValueError:
            return False

    async def health_check(self) -> HealthCheckResult:
        """Check if Ethereum RPC endpoint is reachable.

        TODO: Actually ping the configured RPC endpoint.
        """
        return HealthCheckResult(
            healthy=True,
            message="Stub health check  -- RPC endpoint not yet configured",
            provider_status={"ethereum_rpc": "stub_ok", "gas_oracle": "stub_ok"},
        )

    def supported_task_types(self) -> list[str]:
        return [
            "check_balance",
            "transfer_eth",
            "transfer_token",
            "contract_read",
            "contract_write",
            "estimate_gas",
        ]


# ── Stub Provider ──

class MockEthereumRPC(StubProvider):
    """Stub for Ethereum JSON-RPC in sandbox testing.

    TODO: Add more method stubs as contract interaction is implemented.
    """

    def __init__(self, provider_key: str = "metamask"):
        super().__init__(provider_key)
        self._balances: dict[str, int] = {}  # address -> balance in wei
        self._nonces: dict[str, int] = {}

    async def handle(self, method: str, params: dict) -> dict:
        if method == "eth_getBalance":
            address = params.get("address", "0x0")
            return {"result": hex(self._balances.get(address, 1_234_500_000_000_000_000))}

        if method == "eth_estimateGas":
            return {"result": hex(DEFAULT_GAS_LIMIT)}

        if method == "eth_gasPrice":
            return {"result": hex(DEFAULT_GAS_PRICE_GWEI * 10**9)}

        if method == "eth_getTransactionCount":
            address = params.get("address", "0x0")
            return {"result": hex(self._nonces.get(address, 0))}

        if method == "eth_sendRawTransaction":
            return {"result": "0xstub_tx_hash_abcdef1234567890"}

        if method == "eth_getTransactionReceipt":
            return {
                "result": {
                    "transactionHash": params.get("tx_hash", "0xstub"),
                    "blockNumber": hex(12345678),
                    "status": "0x1",  # success
                    "gasUsed": hex(DEFAULT_GAS_LIMIT),
                }
            }

        if method == "eth_chainId":
            return {"result": "0x1"}

        if method == "eth_blockNumber":
            return {"result": hex(12345678)}

        return await super().handle(method, params)


# ── Self-test ──

async def main():
    app = MetaMaskConnectorApp()
    harness = AppTestHarness(app, stubs={"metamask": MockEthereumRPC("metamask")})

    # Validate manifest
    issues = harness.validate_manifest()
    if issues:
        print(f"Manifest issues: {issues}")
        return
    print("[OK] Manifest valid")

    # Health check
    health = await harness.health()
    print(f"[OK] Health: {health.healthy} ({health.message})")

    # --- Balance check (read-only) ---
    result = await harness.dry_run(
        task_type="check_balance",
        input_params={"action": "balance", "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28"},
    )
    print(f"[OK] Balance check: success={result.success}")
    print(f"  Balance: {result.output.get('balance_eth', 'n/a')} ETH")

    # --- Transfer: Dry run (gas quote) ---
    transfer_params = {
        "action": "transfer",
        "to": "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
        "amount": "0.1",
        "chain_id": "1",
    }
    result = await harness.dry_run(
        task_type="transfer_eth",
        input_params=transfer_params,
    )
    print(f"[OK] Transfer dry run: success={result.success}")
    print(f"  Quote: {result.output.get('quote', {}).get('total_cost_eth', 'n/a')} ETH total")
    print(f"  Needs approval: {result.needs_approval}")

    # --- Transfer: Action (prepare unsigned tx) ---
    result = await harness.execute_action(
        task_type="transfer_eth",
        input_params=transfer_params,
    )
    print(f"[OK] Transfer action: success={result.success}")
    print(f"  Unsigned tx prepared: {'unsigned_tx' in result.output}")
    print(f"  Message: {result.output.get('message', 'n/a')}")

    # --- Transfer: Payment (sign and broadcast) ---
    # Build a payment context manually since harness doesn't have execute_payment
    payment_ctx = ExecutionContext(
        agent_id="test-agent-001",
        owner_user_id="test-owner-001",
        task_type="transfer_eth",
        environment=Environment.SANDBOX,
        execution_kind=ExecutionKind.PAYMENT,
        input_params=transfer_params,
        connected_accounts={
            "metamask": ConnectedAccountRef(
                provider_key="metamask",
                session_token="stub-token-metamask",
            )
        },
        budget_remaining_minor=10000,
    )
    result = await app.execute(payment_ctx)
    print(f"[OK] Transfer payment: success={result.success}")
    print(f"  Tx hash: {result.output.get('tx_hash', 'n/a')}")
    print("  Cost: free")

    # --- Edge case: invalid address ---
    result = await harness.dry_run(
        task_type="transfer_eth",
        input_params={"action": "transfer", "to": "not-an-address", "amount": "1.0"},
    )
    print(f"[OK] Invalid address handled: success={result.success}, error={result.error_message}")

    # --- Edge case: zero amount ---
    result = await harness.dry_run(
        task_type="transfer_eth",
        input_params={"action": "transfer", "to": "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", "amount": "0"},
    )
    print(f"[OK] Zero amount handled: success={result.success}, error={result.error_message}")

    # --- Contract call (stubbed) ---
    result = await harness.dry_run(
        task_type="contract_read",
        input_params={
            "action": "contract_call",
            "contract": "0x1234567890abcdef1234567890abcdef12345678",
            "method": "balanceOf",
            "args": ["0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"],
        },
    )
    print(f"[OK] Contract call: success={result.success}")

    print("\nAll checks passed!")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
