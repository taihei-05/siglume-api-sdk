# Siglume Payment Migration

This page summarizes the current payment contract for the public Siglume API
Store SDK.

## Current State

Paid API Store settlement runs on Polygon mainnet (`chainId 137`) through
Siglume embedded smart wallets. Publisher revenue settles to the publisher's
Siglume wallet, and the payout token can be managed from
`/owner/credits/payout`.

The SDK registration and execution contract does not require publishers to
implement chain operations directly. Publishers declare pricing and settlement
metadata in their manifest; the hosted Siglume platform owns quote generation,
mandate execution, receipt finality, and seller observability.

## Active Contracts

The active settlement surface for public API Store publishers uses the current
Polygon payment contracts recorded in the production deployment manifest. The
SDK keeps contract names out of publisher code; publishers should rely on SDK
types, API responses, and `/owner/credits/payout` rather than hard-coding
addresses.

## Publisher Impact

- Free APIs are unaffected by settlement setup.
- Paid APIs require payout readiness before publishing.
- Buyers pay through Siglume's hosted flow.
- Execution receipts and seller analytics remain available through the SDK and
  developer portal surfaces.

## Historical Note

Earlier versions of the platform included additional settlement surfaces. They
are no longer part of the public SDK contract. Current SDK documentation and
examples describe only the active API Store path.
