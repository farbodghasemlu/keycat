import { CaveatType, ScopeType } from "@metamask/smart-accounts-kit";
import { describe, expect, it } from "vitest";
import { buildGaslessDelegationConfig } from "../src/signer.js";
import type { KeycatAddress } from "../src/types.js";

const target = "0x0000000000000000000000000000000000000001" as KeycatAddress;

describe("smart account signer helpers", () => {
  it("includes target, value cap, and expiry caveats for native transfers", () => {
    const config = buildGaslessDelegationConfig({
      transaction: {
        to: target,
        value: 10n
      },
      expiresAt: 1_800_000_000
    });

    expect(config.scope).toMatchObject({
      type: ScopeType.NativeTokenTransferAmount,
      maxAmount: 10n
    });
    expect(config.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: CaveatType.AllowedTargets,
          targets: [target]
        }),
        expect.objectContaining({
          type: CaveatType.ValueLte,
          maxValue: 10n
        }),
        expect.objectContaining({
          type: CaveatType.Timestamp,
          beforeThreshold: 1_800_000_000
        })
      ])
    );
  });

  it("scopes contract calls to the exact target, selector, value cap, and calldata", () => {
    const data =
      "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000000";
    const config = buildGaslessDelegationConfig({
      transaction: {
        to: target,
        value: 0n,
        data
      },
      expiresAt: 1_800_000_123
    });

    expect(config.scope).toEqual({
      type: ScopeType.FunctionCall,
      targets: [target],
      selectors: ["0xa9059cbb"],
      valueLte: { maxValue: 0n },
      exactCalldata: { calldata: data }
    });
    expect(config.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: CaveatType.AllowedTargets,
          targets: [target]
        }),
        expect.objectContaining({
          type: CaveatType.Timestamp,
          beforeThreshold: 1_800_000_123
        })
      ])
    );
  });
});
