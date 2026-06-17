import type { Address } from "viem";
import { KEYCAT_RECOVERY_CHAIN_ID } from "./chains.js";

export type KeycatRecoveryDeployment = {
  chainId: typeof KEYCAT_RECOVERY_CHAIN_ID;
  keycatRecoveryController: Address;
  zkEmail: {
    verifier: Address;
    userOverrideableDkimRegistry: Address;
    emailAuth: Address;
    relayer: Address;
  };
  metamask: {
    delegationManager: Address;
    ownershipTransferEnforcer: Address;
    hybridDeleGatorImpl: Address;
  };
};

export const KEYCAT_RECOVERY_DEPLOYMENT = {
  chainId: KEYCAT_RECOVERY_CHAIN_ID,
  keycatRecoveryController: "0xEf16C4d27859F5D6Ab2506F7c3a1C0f199C18d89",
  zkEmail: {
    verifier: "0x3E5f29a7cCeb30D5FCD90078430CA110c2985716",
    userOverrideableDkimRegistry: "0x3D3935B3C030893f118a84C92C66dF1B9E4169d6",
    emailAuth: "0x2721a8eB83Ef105f7B30DAB4e8A4da97cD54f970",
    relayer: "0x9401296121FC9B78F84fc856B1F8dC88f4415B2e"
  },
  metamask: {
    delegationManager: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
    ownershipTransferEnforcer: "0x7EEf9734E7092032B5C56310Eb9BbD1f4A524681",
    hybridDeleGatorImpl: "0x48dBe696A4D990079e039489bA2053B36E8FFEC4"
  }
} as const satisfies KeycatRecoveryDeployment;
