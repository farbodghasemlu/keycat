import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader
} from "@x402/core/http";
import { ScopeType, CaveatType } from "@metamask/smart-accounts-kit";
import { describe, expect, it, vi } from "vitest";
import { pad, type Account } from "viem";
import {
  buildAiReviewDelegationConfig,
  createLocalTransactionReview,
  parseVeniceReviewResponse,
  postJsonWithX402,
  requestVeniceAiReview,
  resolveAiReviewWithTimeout
} from "../src/ai-review.js";
import type {
  KeycatAddress,
  KeycatAiReviewDelegationScope,
  KeycatAiReviewResult,
  KeycatHex
} from "../src/types.js";
import type { Delegation } from "@metamask/smart-accounts-kit";

const payee = "0x00000000000000000000000000000000000000a1" as KeycatAddress;
const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as KeycatAddress;
const session = "0x00000000000000000000000000000000000000b1" as KeycatAddress;
const payer = "0x00000000000000000000000000000000000000c1" as KeycatAddress;
const facilitator = "0x00000000000000000000000000000000000000d1" as KeycatAddress;

const scope: KeycatAiReviewDelegationScope = {
  endpoint: "https://review.example/api",
  chainId: 84532,
  network: "eip155:84532",
  stablecoinAddress: asset,
  payeeAddress: payee,
  dailyUsdLimit: "0.25",
  dailyLimitAtomic: "250000",
  periodSeconds: 86400,
  expiresAt: 1_800_000_000
};

function parentDelegation(): Delegation {
  return {
    delegate: session,
    delegator: payer,
    authority: ROOT_AUTHORITY as KeycatHex,
    caveats: [],
    salt: `0x${"00".repeat(32)}`,
    signature: `0x${"11".repeat(65)}`
  };
}

function sessionAccount(): Account {
  return {
    address: session,
    type: "local",
    async signMessage() {
      return `0x${"22".repeat(65)}`;
    },
    async signTransaction() {
      return "0x";
    },
    async signTypedData() {
      return `0x${"33".repeat(65)}`;
    }
  } as Account;
}

describe("AI transaction review", () => {
  it("handles an HTTP 402 x402 challenge and retries with a payment header", async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: scope.endpoint },
      accepts: [
        {
          scheme: "exact",
          network: scope.network,
          asset: scope.stablecoinAddress,
          amount: "3000",
          payTo: scope.payeeAddress,
          maxTimeoutSeconds: 60,
          extra: {
            assetTransferMethod: "erc7710",
            facilitatorAddresses: [facilitator]
          }
        }
      ]
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      if (fetchImpl.mock.calls.length === 1) {
        return new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired)
          }
        });
      }
      expect(
        request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT-SIGNATURE")
      ).toBeTruthy();
      return new Response(
        JSON.stringify({
          summary: "Approve a token allowance.",
          risks: ["Unlimited approval"],
          severity: "high"
        }),
        {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": encodePaymentResponseHeader({
              success: true,
              transaction: `0x${"44".repeat(32)}`,
              network: scope.network,
              amount: "3000"
            })
          }
        }
      );
    });

    const result = await postJsonWithX402({
      endpoint: scope.endpoint,
      body: { hello: "world" },
      scope,
      parentPermissionContext: [parentDelegation()],
      sessionAccount: sessionAccount(),
      fetch: fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.settlementAmount).toBe("3000");
    expect(result.selectedRequirements?.payTo).toBe(scope.payeeAddress);
  });

  it("rejects malformed model output so callers can keep the local fallback", () => {
    expect(
      parseVeniceReviewResponse({
        choices: [{ message: { content: "not json" } }]
      })
    ).toBeUndefined();
    expect(
      parseVeniceReviewResponse({
        choices: [{ message: { content: '{"summary":"ok","risks":[]}' } }]
      })
    ).toBeUndefined();
  });

  it("falls back to local decode after paying when Venice returns malformed JSON", async () => {
    const local = createLocalTransactionReview({
      chainId: 11155111,
      transaction: {
        to: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        data: `0x095ea7b3${"0".repeat(24)}0000000000000000000000000000000000c0ffee${"f".repeat(64)}` as KeycatHex
      }
    });
    const paymentRequired = {
      x402Version: 2,
      resource: { url: scope.endpoint },
      accepts: [
        {
          scheme: "exact",
          network: scope.network,
          asset: scope.stablecoinAddress,
          amount: "3000",
          payTo: scope.payeeAddress,
          maxTimeoutSeconds: 60,
          extra: {
            assetTransferMethod: "erc7710",
            facilitatorAddresses: [facilitator]
          }
        }
      ]
    };
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired)
          }
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "not json" } }]
        }),
        { status: 200 }
      );
    });

    const result = await requestVeniceAiReview({
      request: {
        kind: "transaction",
        origin: "https://kittyswap.example",
        chainId: 11155111,
        transaction: {
          to: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
          data: `0x095ea7b3${"0".repeat(24)}0000000000000000000000000000000000c0ffee${"f".repeat(64)}` as KeycatHex
        },
        local
      },
      scope,
      parentPermissionContext: [parentDelegation()],
      sessionAccount: sessionAccount(),
      fetch: fetchImpl
    });

    expect(result.status).toBe("unavailable");
    expect(result.summary).toBe(local.summary);
    expect(result.notice).toContain("unreadable");
  });

  it("builds the exact daily stablecoin/payee/expiry delegation scope", () => {
    const config = buildAiReviewDelegationConfig({ scope, startDate: 1_700_000_000 });

    expect(config.scope).toEqual({
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: scope.stablecoinAddress,
      periodAmount: 250000n,
      periodDuration: 86400,
      startDate: 1_700_000_000
    });
    expect(config.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: CaveatType.AllowedTargets,
          targets: [scope.stablecoinAddress]
        }),
        expect.objectContaining({
          type: CaveatType.AllowedCalldata,
          startIndex: 4,
          value: pad(scope.payeeAddress, { size: 32 })
        }),
        expect.objectContaining({
          type: CaveatType.Timestamp,
          beforeThreshold: scope.expiresAt
        })
      ])
    );
  });

  it("falls back to local decode on timeout", async () => {
    vi.useFakeTimers();
    const local: KeycatAiReviewResult = createLocalTransactionReview({
      chainId: 11155111,
      transaction: {
        to: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        data: `0x095ea7b3${"0".repeat(24)}0000000000000000000000000000000000c0ffee${"f".repeat(64)}` as KeycatHex
      }
    });

    const resultPromise = resolveAiReviewWithTimeout({
      local,
      review: new Promise<KeycatAiReviewResult>(() => undefined),
      timeoutMs: 10
    });
    await vi.advanceTimersByTimeAsync(10);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result.status).toBe("unavailable");
    expect(result.summary).toBe(local.summary);
    expect(result.risks.some((risk) => risk.label === "Unlimited token approval")).toBe(true);
  });
});
