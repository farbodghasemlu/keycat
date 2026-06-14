import {
  browserWebAuthnPrf,
  changeSecrets,
  createKeystore,
  exportKeystoreFile,
  parseKeystoreFile,
  unlockKeystore,
  type CreateWebAuthnPrfOptions,
  type KeycatKeystoreV1,
  type WebAuthnPrfHandle
} from "@keycat/keystore";
import { getKeycatChain } from "@keycat/shared";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type FormEvent,
  type ReactNode
} from "react";
import {
  createAutoLockController,
  type AutoLockController
} from "./auto-lock.js";
import {
  KeycatProviderController,
  ProviderRpcError,
  createKeycatController,
  serializeProviderError,
  type KeycatControllerSnapshot,
  type KeycatPendingRequest,
  type KeycatProvider,
  type KeycatRequestArguments,
  type KeycatRequestContext
} from "./controller.js";
import type {
  KeycatTransportRequest,
  KeycatTransportResponse,
  KeycatWalletTransport
} from "./transport.js";
import {
  createPlainEoaSigner,
  createSmartAccountSigner,
  createUpgraded7702Signer,
  type KeycatSignerOptions
} from "./signer.js";
import {
  DEFAULT_RECOVERY_TIMELOCK_SECONDS,
  createRecoveryCommitment,
  parseRecoveryControllerAddress,
  readPendingRecovery,
  realRecoveryBlockedMessage,
  submitMockRecoveryRequest,
  submitRecoveryExecution,
  type PendingRecovery
} from "./recovery.js";
import type {
  KeycatAddress,
  KeycatActivityLogEntry,
  KeycatChainConfig,
  KeycatHex,
  KeycatAiReviewDelegationScope,
  KeycatSignableMessage,
  KeycatSigner,
  KeycatSignerSnapshot,
  KeycatTransactionRequest,
  KeycatTypedDataPayload,
  PublicRpcProxy
} from "./types.js";

export type {
  AutoLockController,
  KeycatControllerSnapshot,
  KeycatPendingRequest,
  KeycatProvider,
  KeycatRequestArguments,
  KeycatRequestContext,
  KeycatChainConfig,
  KeycatActivityLogEntry,
  KeycatAiReviewDelegationScope,
  KeycatSignableMessage,
  KeycatSigner,
  KeycatSignerSnapshot,
  KeycatTransactionRequest,
  KeycatTypedDataPayload,
  PublicRpcProxy
};
export {
  ProviderRpcError,
  createAutoLockController,
  createKeycatController,
  serializeProviderError
};
export {
  KEYCAT_SDK_SOURCE,
  KEYCAT_WIDGET_SOURCE,
  createKeycatWindowTransport,
  readKeycatWidgetConfig
} from "./transport.js";
export type {
  KeycatTransportRequest,
  KeycatTransportResponse,
  KeycatWalletTransport,
  KeycatWidgetConfig
} from "./transport.js";
export {
  PlainEoaSigner,
  SmartAccountSigner,
  Upgraded7702Signer,
  buildGaslessDelegationConfig,
  createPlainEoaSigner,
  createSmartAccountSigner,
  createUpgraded7702Signer
} from "./signer.js";
export {
  DEFAULT_RECOVERY_TIMELOCK_SECONDS,
  ZK_EMAIL_RECOVERY_RELAYER_URL,
  createRecoveryCommitment,
  deriveRecoveryAccountSalt,
  parseRecoveryControllerAddress,
  readPendingRecovery,
  readRecoveryConfig,
  realRecoveryBlockedMessage,
  submitMockRecoveryRequest,
  submitRecoveryExecution
} from "./recovery.js";
export type {
  PendingRecovery,
  RecoveryCommitment,
  RecoveryConfig
} from "./recovery.js";
export {
  readActiveDelegations,
  readActivityLog,
  readErc20Balances,
  readNativeBalance,
  readRecoveryStatus,
  useActiveDelegations,
  useErc20Balances,
  useKeycatActivityLog,
  useNativeBalance,
  useRecoveryStatus
} from "./reads.js";
export type {
  KeycatActiveDelegation,
  KeycatBalanceToken,
  KeycatErc20Balance,
  KeycatNativeBalance,
  KeycatReadHookResult,
  KeycatRecoveryReadStatus
} from "./reads.js";

export type KeycatWalletMode = "embedded" | "fullpage";

export type UseKeycatProviderOptions = {
  chain?: KeycatChainConfig;
  chainId?: number;
  rpcUrl?: string;
  publicRpc?: PublicRpcProxy;
  signer?: KeycatSigner;
  aiReviewEndpoint?: string;
};

export type UseKeycatProviderResult = {
  controller: KeycatProviderController;
  provider: KeycatProvider;
  snapshot: KeycatControllerSnapshot;
};

export type UseKeycatWalletStateOptions = {
  controller: KeycatProviderController;
  origin?: string;
};

export type UseKeycatWalletStateResult = {
  snapshot: KeycatControllerSnapshot;
  isUnlocked: boolean;
  account?: KeycatAddress;
  signerAddress?: KeycatAddress;
  signer?: KeycatSignerSnapshot;
  pending?: KeycatPendingRequest;
  activity: KeycatActivityLogEntry[];
  lock(message?: string): void;
  requestAccounts(): Promise<KeycatAddress[]>;
  signPersonalMessage(message: string): Promise<KeycatHex>;
  signTypedData(payload: KeycatTypedDataPayload): Promise<KeycatHex>;
  sendTransaction(transaction: KeycatTransactionRequest): Promise<KeycatHex>;
  setGaslessMode(enabled: boolean): Promise<void>;
  prepareAiReviewScope(): Promise<KeycatAiReviewDelegationScope>;
  setAiReviewMode(
    enabled: boolean,
    scope?: KeycatAiReviewDelegationScope
  ): Promise<void>;
  cancelRecovery(controllerAddress: KeycatAddress): Promise<KeycatHex>;
};

export function useKeycatProvider({
  chain: chainOption,
  chainId,
  rpcUrl,
  publicRpc,
  signer,
  aiReviewEndpoint
}: UseKeycatProviderOptions = {}): UseKeycatProviderResult {
  const chain = useMemo(
    () => chainOption ?? getKeycatChain(chainId),
    [chainId, chainOption]
  );
  const key = `${chain.id}:${rpcUrl ?? ""}:${aiReviewEndpoint ?? ""}`;
  const controllerRef = useRef<{
    key: string;
    controller: KeycatProviderController;
  } | null>(null);

  if (!controllerRef.current || controllerRef.current.key !== key) {
    controllerRef.current?.controller.lock("Network changed.");
    controllerRef.current = {
      key,
      controller: createKeycatController({
        chain,
        rpcUrl,
        publicRpc,
        signer,
        aiReviewEndpoint
      })
    };
  }

  const controller = controllerRef.current.controller;
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot()
  );

  return { controller, provider: controller, snapshot };
}

export function useKeycatWalletState({
  controller,
  origin = "keycat://local"
}: UseKeycatWalletStateOptions): UseKeycatWalletStateResult {
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot()
  );

  return useMemo(
    () => ({
      snapshot,
      isUnlocked: snapshot.isUnlocked,
      account: snapshot.address,
      signerAddress: snapshot.signer?.signerAddress,
      signer: snapshot.signer,
      pending: snapshot.pending,
      activity: snapshot.activity,
      lock: (message?: string) => controller.lock(message),
      requestAccounts: async () =>
        controller.request(
          { method: "eth_requestAccounts" },
          { origin }
        ) as Promise<KeycatAddress[]>,
      signPersonalMessage: async (message: KeycatSignableMessage) =>
        controller.request(
          {
            method: "personal_sign",
            params: [typeof message === "string" ? message : message.raw, snapshot.address]
          },
          { origin }
        ) as Promise<KeycatHex>,
      signTypedData: async (payload: KeycatTypedDataPayload) => {
        if (!snapshot.address) {
          throw new ProviderRpcError(4100, "Unlock Keycat before signing typed data.");
        }
        return controller.request(
          {
            method: "eth_signTypedData_v4",
            params: [snapshot.address, payload]
          },
          { origin }
        ) as Promise<KeycatHex>;
      },
      sendTransaction: async (transaction: KeycatTransactionRequest) =>
        controller.request(
          {
            method: "eth_sendTransaction",
            params: [{ ...transaction, from: transaction.from ?? snapshot.address }]
          },
          { origin }
        ) as Promise<KeycatHex>,
      setGaslessMode: (enabled: boolean) => controller.setGaslessMode(enabled),
      prepareAiReviewScope: () => controller.prepareAiReviewScope(),
      setAiReviewMode: (
        enabled: boolean,
        scope?: KeycatAiReviewDelegationScope
      ) => controller.setAiReviewMode(enabled, scope),
      cancelRecovery: (controllerAddress: KeycatAddress) =>
        controller.cancelRecovery(controllerAddress)
    }),
    [controller, origin, snapshot]
  );
}

export type KeycatWalletProps = {
  mode: KeycatWalletMode;
  chain?: KeycatChainConfig;
  chainId?: number;
  rpcUrl?: string;
  bundlerUrl?: string;
  oneShotRelayerUrl?: string;
  oneShotWebhookUrl?: string;
  veniceX402Endpoint?: string;
  recoveryControllerAddress?: string;
  demoMockRecovery?: boolean;
  autoLockMs?: number;
  lockOnVisibilityHidden?: boolean;
  transport?: KeycatWalletTransport;
};

export function KeycatWallet({
  mode,
  chain: chainOption,
  chainId,
  rpcUrl,
  bundlerUrl,
  oneShotRelayerUrl,
  oneShotWebhookUrl,
  veniceX402Endpoint,
  recoveryControllerAddress,
  demoMockRecovery = false,
  autoLockMs = 10 * 60 * 1000,
  lockOnVisibilityHidden = true,
  transport
}: KeycatWalletProps) {
  const chain = useMemo(
    () => chainOption ?? getKeycatChain(chainId),
    [chainId, chainOption]
  );
  const { controller, snapshot } = useKeycatProvider({
    chain,
    rpcUrl,
    aiReviewEndpoint: veniceX402Endpoint
  });
  const signerOptions = useMemo(
    () => ({
      rpcUrl,
      bundlerUrl,
      oneShotRelayerUrl,
      oneShotWebhookUrl
    }),
    [bundlerUrl, oneShotRelayerUrl, oneShotWebhookUrl, rpcUrl]
  );
  const recoveryController = parseRecoveryControllerAddress(recoveryControllerAddress);
  const [screen, setScreen] = useState<"welcome" | "create" | "unlock" | "recover" | "settings">(
    "welcome"
  );
  const [activeKeystore, setActiveKeystore] = useState<KeycatKeystoreV1>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const hideWhenIdle = mode === "embedded" && transport !== undefined;
  const visible = !hideWhenIdle || snapshot.pending !== undefined;

  useEffect(() => {
    if (!transport) {
      return undefined;
    }
    return transport.subscribe(async (request) => {
      try {
        const result = await controller.request(
          { method: request.method, params: request.params },
          { origin: request.origin }
        );
        transport.respond(request, { result });
      } catch (requestError) {
        transport.respond(request, {
          error: serializeProviderError(requestError)
        });
      }
    });
  }, [controller, transport]);

  useEffect(() => {
    if (!transport) {
      return undefined;
    }
    const accountsChanged = (...params: unknown[]) => {
      transport.emit("accountsChanged", params);
    };
    const disconnect = (...params: unknown[]) => {
      transport.emit("disconnect", params);
    };
    controller.on("accountsChanged", accountsChanged);
    controller.on("disconnect", disconnect);
    return () => {
      controller.removeListener("accountsChanged", accountsChanged);
      controller.removeListener("disconnect", disconnect);
    };
  }, [controller, transport]);

  useEffect(() => {
    transport?.setVisible?.(visible);
  }, [transport, visible]);

  useEffect(() => {
    if (!snapshot.isUnlocked || typeof window === "undefined") {
      return undefined;
    }
    const locker = createAutoLockController({
      timeoutMs: autoLockMs,
      onLock: () => controller.lock("Auto-locked after idle timeout.")
    });
    const poke = () => locker.poke();
    const lockIfHidden = () => {
      if (lockOnVisibilityHidden && document.visibilityState === "hidden") {
        controller.lock("Locked because the tab was hidden.");
      }
    };
    const lockForUnload = () => {
      controller.lock("Locked because the tab was closed.");
    };
    locker.start();
    for (const event of ["pointerdown", "mousemove", "keydown", "touchstart"]) {
      window.addEventListener(event, poke, { passive: true });
    }
    document.addEventListener("visibilitychange", lockIfHidden);
    window.addEventListener("pagehide", lockForUnload);
    window.addEventListener("beforeunload", lockForUnload);
    return () => {
      locker.stop();
      for (const event of ["pointerdown", "mousemove", "keydown", "touchstart"]) {
        window.removeEventListener(event, poke);
      }
      document.removeEventListener("visibilitychange", lockIfHidden);
      window.removeEventListener("pagehide", lockForUnload);
      window.removeEventListener("beforeunload", lockForUnload);
    };
  }, [
    autoLockMs,
    controller,
    lockOnVisibilityHidden,
    snapshot.isUnlocked
  ]);

  if (!visible) {
    return null;
  }

  const hasPending = snapshot.pending !== undefined;
  const shellClass = `kc-wallet kc-wallet--${mode}`;

  return (
    <section className={shellClass} aria-label="Keycat wallet">
      <style>{KEYCAT_STYLES}</style>
      <div className="kc-panel">
        <Header
          mode={mode}
          pending={snapshot.pending}
          address={snapshot.address}
          signer={snapshot.signer}
          onClose={
            hasPending
              ? () => controller.rejectPending("User dismissed the request.")
              : undefined
          }
          onSettings={
            snapshot.isUnlocked && mode === "fullpage"
              ? () => {
                  setError(undefined);
                  setNotice(undefined);
                  setScreen("settings");
                }
              : undefined
          }
          onLock={
            snapshot.isUnlocked
              ? () => {
                  setNotice(undefined);
                  controller.lock("Wallet locked.");
                  setScreen("welcome");
                }
              : undefined
          }
        />

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}
        {demoMockRecovery ? (
          <Banner tone="danger">MOCK RECOVERY MODE</Banner>
        ) : null}
        {snapshot.pending && !snapshot.isUnlocked ? (
          <Banner tone="pending">
            {snapshot.pending.origin} is waiting for your wallet.
          </Banner>
        ) : null}

        {snapshot.pending && snapshot.isUnlocked ? (
          <ConfirmRequest
            pending={snapshot.pending}
            onApprove={() => controller.approvePending()}
            onReject={() => controller.rejectPending()}
          />
        ) : snapshot.isUnlocked && screen === "settings" ? (
          <SettingsScreen
            keystore={activeKeystore}
            chain={chain}
            rpcUrl={rpcUrl}
            signer={snapshot.signer}
            signerOptions={signerOptions}
            onAiReviewScope={() => controller.prepareAiReviewScope()}
            onAiReviewToggle={async (enabled, scope) => {
              setError(undefined);
              try {
                await controller.setAiReviewMode(enabled, scope);
              } catch (toggleError) {
                setError(
                  toggleError instanceof Error
                    ? toggleError.message
                    : "Could not change AI transaction review."
                );
              }
            }}
            onDone={(message) => {
              setNotice(message);
              setScreen("welcome");
            }}
            onError={setError}
            onSigner={(signer, keystore) => {
              controller.setSigner(signer);
              setActiveKeystore(keystore);
            }}
          />
        ) : snapshot.isUnlocked && mode === "fullpage" ? (
          <UnlockedHome
            signer={snapshot.signer}
            chainName={chain.name}
            chain={chain}
            rpcUrl={rpcUrl}
            recoveryControllerAddress={recoveryController}
            onSettings={() => setScreen("settings")}
            onLock={() => {
              controller.lock("Wallet locked.");
              setScreen("welcome");
            }}
            onRecoveryCancel={async () => {
              if (!recoveryController) {
                throw new Error("Recovery controller is not configured.");
              }
              await controller.cancelRecovery(recoveryController);
            }}
            onGaslessToggle={async (enabled) => {
              setError(undefined);
              try {
                await controller.setGaslessMode(enabled);
              } catch (toggleError) {
                setError(
                  toggleError instanceof Error
                    ? toggleError.message
                    : "Could not change gasless mode."
                );
              }
            }}
          />
        ) : screen === "create" ? (
          <CreateScreen
            chain={chain}
            rpcUrl={rpcUrl}
            signerOptions={signerOptions}
            recoveryControllerAddress={recoveryController}
            demoMockRecovery={demoMockRecovery}
            onBack={() => {
              setError(undefined);
              setScreen("welcome");
            }}
            onError={setError}
            onCreated={(signer, keystore, recoveryMessage) => {
              controller.setSigner(signer);
              setActiveKeystore(keystore);
              setNotice(`Created ${signer.address}${recoveryMessage ?? ""}`);
              setScreen("welcome");
            }}
          />
        ) : screen === "unlock" ? (
          <UnlockScreen
            chain={chain}
            rpcUrl={rpcUrl}
            signerOptions={signerOptions}
            onBack={() => {
              setError(undefined);
              setScreen("welcome");
            }}
            onError={setError}
            onUnlocked={(signer, keystore) => {
              controller.setSigner(signer);
              setActiveKeystore(keystore);
              setNotice(`Unlocked ${signer.address}`);
              setScreen("welcome");
            }}
          />
        ) : screen === "recover" ? (
          <RecoverScreen
            chain={chain}
            rpcUrl={rpcUrl}
            signerOptions={signerOptions}
            recoveryControllerAddress={recoveryController}
            demoMockRecovery={demoMockRecovery}
            onBack={() => {
              setError(undefined);
              setScreen("welcome");
            }}
            onError={setError}
            onRecovered={(signer, keystore, message) => {
              controller.setSigner(signer);
              setActiveKeystore(keystore);
              setNotice(message);
              setScreen("welcome");
            }}
          />
        ) : (
          <WelcomeScreen
            onCreate={() => {
              setError(undefined);
              setNotice(undefined);
              setScreen("create");
            }}
            onUnlock={() => {
              setError(undefined);
              setNotice(undefined);
              setScreen("unlock");
            }}
            onRecover={() => {
              setError(undefined);
              setNotice(undefined);
              setScreen("recover");
            }}
          />
        )}
      </div>
    </section>
  );
}

function Header({
  mode,
  pending,
  address,
  signer,
  onClose,
  onSettings,
  onLock
}: {
  mode: KeycatWalletMode;
  pending?: KeycatPendingRequest;
  address?: string;
  signer?: KeycatSignerSnapshot;
  onClose?: () => void;
  onSettings?: () => void;
  onLock?: () => void;
}) {
  return (
    <header className="kc-header">
      <div>
        <div className="kc-brand">Keycat</div>
        <div className="kc-subtitle">
          {pending
            ? pending.method
            : address
              ? `${shortAddress(address)} ${
                  signer?.mode === "eip7702" ? "7702" : signer?.mode === "smart-account" ? "smart" : "EOA"
                }`
              : mode === "embedded"
                ? "Widget"
                : "Wallet"}
        </div>
      </div>
      <div className="kc-header-actions">
        {onSettings ? (
          <button className="kc-icon-button" type="button" onClick={onSettings} title="Settings">
            <span className="kc-css-icon kc-css-icon-settings" aria-hidden="true" />
          </button>
        ) : null}
        {onLock ? (
          <button className="kc-icon-button" type="button" onClick={onLock} title="Lock">
            <span className="kc-css-icon kc-css-icon-lock" aria-hidden="true" />
          </button>
        ) : null}
        {onClose ? (
          <button className="kc-icon-button" type="button" onClick={onClose} title="Reject">
            <span aria-hidden="true">x</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

function Banner({ tone, children }: { tone: "danger" | "success" | "pending"; children: ReactNode }) {
  return <div className={`kc-banner kc-banner--${tone}`}>{children}</div>;
}

function WelcomeScreen({
  onCreate,
  onUnlock,
  onRecover
}: {
  onCreate(): void;
  onUnlock(): void;
  onRecover(): void;
}) {
  return (
    <div className="kc-stack">
      <div className="kc-intro">
        <div className="kc-cat-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <h1>Non-custodial keystore wallet</h1>
          <p>Your encrypted Keycat file opens this wallet on any site that embeds it.</p>
        </div>
      </div>
      <div className="kc-action-grid">
        <button className="kc-primary" type="button" onClick={onCreate}>
          Create wallet
        </button>
        <button className="kc-secondary" type="button" onClick={onUnlock}>
          Open keystore file
        </button>
        <button className="kc-secondary" type="button" onClick={onRecover}>
          Recover wallet
        </button>
      </div>
    </div>
  );
}

function CreateScreen({
  chain,
  rpcUrl,
  signerOptions,
  recoveryControllerAddress,
  demoMockRecovery,
  onBack,
  onError,
  onCreated
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  signerOptions: KeycatSignerOptions;
  recoveryControllerAddress?: KeycatAddress;
  demoMockRecovery: boolean;
  onBack(): void;
  onError(message: string): void;
  onCreated(
    signer: KeycatSigner,
    keystore: KeycatKeystoreV1,
    recoveryMessage?: string
  ): void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [useBiometric, setUseBiometric] = useState(false);
  const [upgradeInPlace, setUpgradeInPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const strength = getPasswordStrength(password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    onError("");
    if (password.length < 10) {
      onError("Use at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      onError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const webauthn = useBiometric ? await registerWebAuthnPrfFactor() : undefined;
      const keystore = await createKeystore({
        password,
        label: "Keycat",
        webauthn
      });
      const unlocked = await unlockKeystore(keystore, {
        password,
        webauthnHandle: webauthn ? browserWebAuthnPrf : undefined
      });
      const signer = upgradeInPlace
        ? await createUpgraded7702Signer(unlocked, chain, {
            ...signerOptions,
            relayUpgrade: true
          })
        : await createSmartAccountSigner(unlocked, chain, signerOptions);
      let recoveryMessage: string | undefined;
      if (recoveryEmail.trim()) {
        if (!demoMockRecovery) {
          throw new Error(realRecoveryBlockedMessage());
        }
        if (upgradeInPlace) {
          throw new Error("Recovery setup requires a Hybrid smart account.");
        }
        if (!recoveryControllerAddress) {
          throw new Error("NEXT_PUBLIC_RECOVERY_CONTROLLER_ADDRESS is required for recovery setup.");
        }
        if (!signer.configureRecovery) {
          throw new Error("This signer cannot configure recovery.");
        }
        const commitment = await createRecoveryCommitment({
          account: signer.address,
          email: recoveryEmail
        });
        await signer.configureRecovery({
          controllerAddress: recoveryControllerAddress,
          emailGuardianCommitment: commitment.accountSalt,
          timelockSeconds: DEFAULT_RECOVERY_TIMELOCK_SECONDS
        });
        recoveryMessage = ` Recovery enabled with a ${formatDuration(DEFAULT_RECOVERY_TIMELOCK_SECONDS)} timelock.`;
      }
      const nextKeystore = withSignerMetadata(keystore, signer, chain);
      downloadTextFile(
        exportKeystoreFile(nextKeystore),
        `keycat-${nextKeystore.address}.json`
      );
      onCreated(signer, nextKeystore, recoveryMessage);
      setPassword("");
      setConfirm("");
      setRecoveryEmail("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not create wallet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="kc-stack" onSubmit={submit}>
      <h2>Create wallet</h2>
      <Field label="Password">
        <input
          autoComplete="new-password"
          minLength={10}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>
      <PasswordStrength strength={strength} />
      <Field label="Confirm password">
        <input
          autoComplete="new-password"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </Field>
      <label className="kc-toggle">
        <input
          type="checkbox"
          checked={useBiometric}
          onChange={(event) => setUseBiometric(event.target.checked)}
        />
        <span>Add device biometric (WebAuthn PRF)</span>
      </label>
      <label className="kc-toggle">
        <input
          type="checkbox"
          checked={upgradeInPlace}
          onChange={(event) => setUpgradeInPlace(event.target.checked)}
        />
        <span>Upgrade my key in place (EIP-7702)</span>
      </label>
      {upgradeInPlace ? (
        <Banner tone="pending">
          7702 recovery restores access after key loss but cannot fully expel a
          stolen root key.
        </Banner>
      ) : null}
      <Field label="Recovery email">
        <input
          type="email"
          placeholder="name@example.com"
          value={recoveryEmail}
          onChange={(event) => setRecoveryEmail(event.target.value)}
        />
      </Field>
      {recoveryEmail ? (
        <div className="kc-muted">Recovery setup pending - enabled in a later step.</div>
      ) : null}
      <div className="kc-action-grid">
        <button className="kc-primary" type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create and download"}
        </button>
        <button className="kc-secondary" type="button" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </form>
  );
}

function UnlockScreen({
  chain,
  rpcUrl,
  signerOptions,
  onBack,
  onError,
  onUnlocked
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  signerOptions: KeycatSignerOptions;
  onBack(): void;
  onError(message: string): void;
  onUnlocked(signer: KeycatSigner, keystore: KeycatKeystoreV1): void;
}) {
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [keystore, setKeystore] = useState<KeycatKeystoreV1>();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadFile(file: File) {
    onError("");
    try {
      const text = await file.text();
      const parsed = parseKeystoreFile(text);
      setFileName(file.name);
      setFileText(text);
      setKeystore(parsed);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Invalid keystore file.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    onError("");
    if (!keystore) {
      onError("Choose a Keycat keystore file.");
      return;
    }
    setBusy(true);
    try {
      const unlocked = await unlockKeystore(fileText, {
        password,
        webauthnHandle: hasWebAuthn(keystore) ? browserWebAuthnPrf : undefined
      });
      const signer = await createSignerForKeystore(
        unlocked,
        keystore,
        chain,
        signerOptions
      );
      const nextKeystore = withSignerMetadata(keystore, signer, chain);
      onUnlocked(signer, nextKeystore);
      setPassword("");
      setFileText("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not unlock wallet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="kc-stack" onSubmit={submit}>
      <h2>Open keystore</h2>
      <DropZone onFile={loadFile} fileName={fileName} />
      {keystore ? (
        <div className="kc-file-summary">
          <span>{shortAddress(keystore.address)}</span>
          <span>
            {keystore.meta.walletMode === "eip7702"
              ? "7702"
              : keystore.meta.walletMode === "plain-eoa"
                ? "EOA"
                : "Smart"}
            {" / "}
            {hasWebAuthn(keystore) ? "Password + biometric" : "Password"}
          </span>
        </div>
      ) : null}
      <Field label="Password">
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>
      {keystore && hasWebAuthn(keystore) ? (
        <div className="kc-muted">Device biometric is required for this file.</div>
      ) : null}
      <div className="kc-action-grid">
        <button className="kc-primary" type="submit" disabled={busy}>
          {busy ? "Unlocking..." : "Unlock"}
        </button>
        <button className="kc-secondary" type="button" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </form>
  );
}

function RecoverScreen({
  chain,
  rpcUrl,
  signerOptions,
  recoveryControllerAddress,
  demoMockRecovery,
  onBack,
  onError,
  onRecovered
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  signerOptions: KeycatSignerOptions;
  recoveryControllerAddress?: KeycatAddress;
  demoMockRecovery: boolean;
  onBack(): void;
  onError(message: string): void;
  onRecovered(
    signer: KeycatSigner,
    keystore: KeycatKeystoreV1,
    message: string
  ): void;
}) {
  const [account, setAccount] = useState("");
  const [accountSalt, setAccountSalt] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingRecovery>();
  const [recoveredSigner, setRecoveredSigner] = useState<KeycatSigner>();
  const [recoveredKeystore, setRecoveredKeystore] = useState<KeycatKeystoreV1>();

  async function requestRecovery(event: FormEvent) {
    event.preventDefault();
    onError("");
    if (!recoveryControllerAddress) {
      onError("NEXT_PUBLIC_RECOVERY_CONTROLLER_ADDRESS is required for recovery.");
      return;
    }
    if (!demoMockRecovery) {
      onError(realRecoveryBlockedMessage());
      return;
    }
    if (!isRecoveryAddress(account)) {
      onError("Enter the smart account address to recover.");
      return;
    }
    if (!isRecoveryBytes32(accountSalt)) {
      onError("Enter the salted recovery commitment as bytes32.");
      return;
    }
    if (password.length < 10) {
      onError("Use at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      onError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const keystore = await createKeystore({
        password,
        label: "Keycat"
      });
      const unlocked = await unlockKeystore(keystore, { password });
      const signer = await createSmartAccountSigner(unlocked, chain, {
        ...signerOptions,
        accountAddress: account as KeycatAddress
      });
      const nextKeystore = withSignerMetadata(keystore, signer, chain);
      downloadTextFile(
        exportKeystoreFile(nextKeystore),
        `keycat-${nextKeystore.address}.json`
      );
      await submitMockRecoveryRequest({
        chain,
        rpcUrl,
        oneShotRelayerUrl: signerOptions.oneShotRelayerUrl,
        controllerAddress: recoveryControllerAddress,
        account: account as KeycatAddress,
        newOwner: signer.signerAddress,
        accountSalt: accountSalt as KeycatHex
      });
      const nextPending = await readPendingRecovery({
        chain,
        rpcUrl,
        controllerAddress: recoveryControllerAddress,
        account: account as KeycatAddress
      });
      setPending(nextPending);
      setRecoveredSigner(signer);
      setRecoveredKeystore(nextKeystore);
      setPassword("");
      setConfirm("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not request recovery.");
    } finally {
      setBusy(false);
    }
  }

  async function executeRecovery() {
    if (!recoveryControllerAddress || !recoveredSigner || !recoveredKeystore) {
      return;
    }
    setBusy(true);
    try {
      await submitRecoveryExecution({
        chain,
        rpcUrl,
        oneShotRelayerUrl: signerOptions.oneShotRelayerUrl,
        controllerAddress: recoveryControllerAddress,
        account: account as KeycatAddress
      });
      onRecovered(
        recoveredSigner,
        recoveredKeystore,
        `Recovered ${account}. Unlocking now uses the new keystore.`
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not execute recovery.");
    } finally {
      setBusy(false);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const canExecute = Boolean(pending?.exists && pending.executeAfter <= now);

  return (
    <form className="kc-stack" onSubmit={requestRecovery}>
      <h2>Recover wallet</h2>
      <Field label="Account address">
        <input
          autoComplete="off"
          placeholder="0x..."
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          required
        />
      </Field>
      <Field label="Salted recovery commitment">
        <input
          autoComplete="off"
          placeholder="0x..."
          value={accountSalt}
          onChange={(event) => setAccountSalt(event.target.value)}
          required
        />
      </Field>
      <Field label="New keystore password">
        <input
          autoComplete="new-password"
          minLength={10}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required={!pending}
        />
      </Field>
      <Field label="Confirm new password">
        <input
          autoComplete="new-password"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required={!pending}
        />
      </Field>
      {pending?.exists ? (
        <div className="kc-file-summary">
          <span>Execute after</span>
          <span>{formatUnixTime(pending.executeAfter)}</span>
        </div>
      ) : null}
      <div className="kc-action-grid">
        {pending?.exists ? (
          <button
            className="kc-primary"
            type="button"
            onClick={() => void executeRecovery()}
            disabled={busy || !canExecute}
          >
            {busy ? "Executing..." : canExecute ? "Execute recovery" : "Waiting"}
          </button>
        ) : (
          <button className="kc-primary" type="submit" disabled={busy}>
            {busy ? "Requesting..." : "Create new key"}
          </button>
        )}
        <button className="kc-secondary" type="button" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </form>
  );
}

function SettingsScreen({
  keystore,
  chain,
  rpcUrl,
  signer,
  signerOptions,
  onAiReviewScope,
  onAiReviewToggle,
  onDone,
  onError,
  onSigner
}: {
  keystore?: KeycatKeystoreV1;
  chain: KeycatChainConfig;
  rpcUrl?: string;
  signer?: KeycatSignerSnapshot;
  signerOptions: KeycatSignerOptions;
  onAiReviewScope(): Promise<KeycatAiReviewDelegationScope>;
  onAiReviewToggle(
    enabled: boolean,
    scope?: KeycatAiReviewDelegationScope
  ): Promise<void>;
  onDone(message: string): void;
  onError(message: string): void;
  onSigner(signer: KeycatSigner, keystore: KeycatKeystoreV1): void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [useBiometric, setUseBiometric] = useState(Boolean(keystore && hasWebAuthn(keystore)));
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    onError("");
    if (!keystore) {
      onError("Open a keystore before changing settings.");
      return;
    }
    if (nextPassword.length < 10) {
      onError("Use at least 10 characters.");
      return;
    }
    if (nextPassword !== confirm) {
      onError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const currentHasWebAuthn = hasWebAuthn(keystore);
      const nextWebAuthn = await resolveNextWebAuthn(currentHasWebAuthn, useBiometric);
      const nextKeystore = await changeSecrets(
        keystore,
        {
          password: currentPassword,
          webauthnHandle: currentHasWebAuthn ? browserWebAuthnPrf : undefined
        },
        {
          password: nextPassword,
          webauthn: nextWebAuthn
        }
      );
      const unlocked = await unlockKeystore(nextKeystore, {
        password: nextPassword,
        webauthnHandle: hasWebAuthn(nextKeystore) ? browserWebAuthnPrf : undefined
      });
      const signer = await createSignerForKeystore(
        unlocked,
        nextKeystore,
        chain,
        signerOptions
      );
      const nextKeystoreWithSigner = withSignerMetadata(
        nextKeystore,
        signer,
        chain
      );
      downloadTextFile(
        exportKeystoreFile(nextKeystoreWithSigner),
        `keycat-${nextKeystoreWithSigner.address}.json`
      );
      setCurrentPassword("");
      setNextPassword("");
      setConfirm("");
      onSigner(signer, nextKeystoreWithSigner);
      onDone("New keystore downloaded. The old file is obsolete.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="kc-stack" onSubmit={submit}>
      <h2>Settings</h2>
      {signer?.mode !== "plain-eoa" ? (
        <>
          <AiReviewToggleControl
            signer={signer}
            onAiReviewScope={onAiReviewScope}
            onAiReviewToggle={onAiReviewToggle}
          />
          {signer?.aiReview?.message ? (
            <Banner tone="pending">{signer.aiReview.message}</Banner>
          ) : null}
        </>
      ) : null}
      <Banner tone="pending">Changing secrets downloads a new keystore. The old file becomes obsolete.</Banner>
      <Field label="Current password">
        <input
          autoComplete="current-password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </Field>
      <Field label="New password">
        <input
          autoComplete="new-password"
          type="password"
          value={nextPassword}
          onChange={(event) => setNextPassword(event.target.value)}
          required
        />
      </Field>
      <PasswordStrength strength={getPasswordStrength(nextPassword)} />
      <Field label="Confirm new password">
        <input
          autoComplete="new-password"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </Field>
      <label className="kc-toggle">
        <input
          type="checkbox"
          checked={useBiometric}
          onChange={(event) => setUseBiometric(event.target.checked)}
        />
        <span>Use device biometric (WebAuthn PRF)</span>
      </label>
      <button className="kc-primary" type="submit" disabled={busy}>
        {busy ? "Updating..." : "Download new keystore"}
      </button>
    </form>
  );
}

function ConfirmRequest({
  pending,
  onApprove,
  onReject
}: {
  pending: KeycatPendingRequest;
  onApprove(): void;
  onReject(): void;
}) {
  const executing = pending.status === "executing";
  return (
    <div className="kc-stack">
      <div>
        <h2>{pending.detail.title}</h2>
        <p className="kc-request-description">{pending.detail.description}</p>
      </div>
      <div className="kc-detail-table">
        {pending.detail.rows.map((row) => (
          <div className="kc-detail-row" key={`${row.label}:${row.value}`}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      {pending.detail.raw ? (
        <details className="kc-raw">
          <summary>{pending.detail.raw.label}</summary>
          <code>{pending.detail.raw.value}</code>
        </details>
      ) : null}
      {pending.detail.aiReview ? (
        <AiReviewPanel review={pending.detail.aiReview} />
      ) : null}
      <div className="kc-action-grid">
        <button className="kc-primary" type="button" onClick={onApprove} disabled={executing}>
          {executing ? "Confirming..." : "Approve"}
        </button>
        <button className="kc-secondary" type="button" onClick={onReject} disabled={executing}>
          Reject
        </button>
      </div>
    </div>
  );
}

function AiReviewPanel({
  review
}: {
  review: NonNullable<KeycatPendingRequest["detail"]["aiReview"]>;
}) {
  return (
    <div className={`kc-ai-review kc-ai-review--${review.severity}`}>
      <div className="kc-ai-review-head">
        <strong>AI review</strong>
        <span>{review.status}</span>
      </div>
      <p>{review.summary}</p>
      {review.risks.length > 0 ? (
        <div className="kc-risk-list">
          {review.risks.map((risk) => (
            <span className={`kc-risk kc-risk--${risk.severity}`} key={`${risk.source}:${risk.label}`}>
              {risk.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="kc-muted">No specific risks flagged.</div>
      )}
      {review.pricePaid ? (
        <div className="kc-paid">{review.pricePaid}</div>
      ) : null}
      {review.notice ? (
        <div className="kc-muted">{review.notice}</div>
      ) : null}
    </div>
  );
}

function AiReviewToggleControl({
  signer,
  onAiReviewScope,
  onAiReviewToggle
}: {
  signer?: KeycatSignerSnapshot;
  onAiReviewScope(): Promise<KeycatAiReviewDelegationScope>;
  onAiReviewToggle(
    enabled: boolean,
    scope?: KeycatAiReviewDelegationScope
  ): Promise<void>;
}) {
  const [aiBusy, setAiBusy] = useState(false);
  const [aiScope, setAiScope] = useState<KeycatAiReviewDelegationScope>();
  const aiEnabled = signer?.aiReview?.enabled ?? false;
  const aiStatus = signer?.aiReview?.state ?? "disabled";

  async function requestAiToggle(next: boolean) {
    setAiBusy(true);
    try {
      if (!next) {
        setAiScope(undefined);
        await onAiReviewToggle(false);
        return;
      }
      const scope = await onAiReviewScope();
      setAiScope(scope);
    } finally {
      setAiBusy(false);
    }
  }

  async function approveAiScope() {
    if (!aiScope) {
      return;
    }
    setAiBusy(true);
    try {
      await onAiReviewToggle(true, aiScope);
      setAiScope(undefined);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      <label className="kc-toggle kc-toggle--split">
        <input
          type="checkbox"
          checked={aiEnabled}
          disabled={aiBusy}
          onChange={(event) => void requestAiToggle(event.target.checked)}
        />
        <span>AI transaction review (paid per use from your wallet)</span>
        <small>{aiBusy ? "Updating" : aiStatus}</small>
      </label>
      {aiScope ? (
        <div className="kc-scope-preview">
          <strong>AI review delegation scope</strong>
          <div className="kc-detail-table">
            <div className="kc-detail-row">
              <span>Daily cap</span>
              <strong>$0.25 stablecoin payments</strong>
            </div>
            <div className="kc-detail-row">
              <span>Payee</span>
              <strong>{aiScope.payeeAddress}</strong>
            </div>
            <div className="kc-detail-row">
              <span>Stablecoin</span>
              <strong>{aiScope.stablecoinAddress}</strong>
            </div>
            <div className="kc-detail-row">
              <span>Chain</span>
              <strong>{aiScope.network}</strong>
            </div>
            <div className="kc-detail-row">
              <span>Expiry</span>
              <strong>{formatUnixTime(aiScope.expiresAt)}</strong>
            </div>
          </div>
          <div className="kc-action-grid">
            <button className="kc-primary" type="button" onClick={() => void approveAiScope()} disabled={aiBusy}>
              {aiBusy ? "Enabling..." : "Approve scope"}
            </button>
            <button className="kc-secondary" type="button" onClick={() => setAiScope(undefined)} disabled={aiBusy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function UnlockedHome({
  signer,
  chainName,
  chain,
  rpcUrl,
  recoveryControllerAddress,
  onSettings,
  onLock,
  onRecoveryCancel,
  onGaslessToggle
}: {
  signer?: KeycatSignerSnapshot;
  chainName: string;
  chain: KeycatChainConfig;
  rpcUrl?: string;
  recoveryControllerAddress?: KeycatAddress;
  onSettings(): void;
  onLock(): void;
  onRecoveryCancel(): Promise<void>;
  onGaslessToggle(enabled: boolean): Promise<void>;
}) {
  const [gaslessBusy, setGaslessBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecovery>();
  const gaslessEnabled = signer?.gasless?.enabled ?? false;
  const gaslessStatus = signer?.gasless?.state ?? "idle";

  useEffect(() => {
    if (!signer?.address || !recoveryControllerAddress) {
      setPendingRecovery(undefined);
      return undefined;
    }
    let stopped = false;
    const poll = async () => {
      try {
        const next = await readPendingRecovery({
          chain,
          rpcUrl,
          controllerAddress: recoveryControllerAddress,
          account: signer.address
        });
        if (!stopped) {
          setPendingRecovery(next.exists ? next : undefined);
        }
      } catch {
        if (!stopped) {
          setPendingRecovery(undefined);
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [chain, recoveryControllerAddress, rpcUrl, signer?.address]);

  async function toggleGasless(next: boolean) {
    setGaslessBusy(true);
    try {
      await onGaslessToggle(next);
    } finally {
      setGaslessBusy(false);
    }
  }

  async function cancelRecovery() {
    setRecoveryBusy(true);
    try {
      await onRecoveryCancel();
      setPendingRecovery(undefined);
    } finally {
      setRecoveryBusy(false);
    }
  }

  return (
    <div className="kc-stack">
      {pendingRecovery ? (
        <div className="kc-recovery-alert">
          <strong>Recovery requested</strong>
          <span>
            New owner {shortAddress(pendingRecovery.newOwner)} after{" "}
            {formatUnixTime(pendingRecovery.executeAfter)}
          </span>
          <button
            className="kc-secondary"
            type="button"
            onClick={() => void cancelRecovery()}
            disabled={recoveryBusy}
          >
            {recoveryBusy ? "Cancelling..." : "Cancel recovery"}
          </button>
        </div>
      ) : null}
      <div className="kc-account-block">
        <div className="kc-address-row">
          <span
            title="The account address is the wallet account exposed to dApps."
          >
            Account
          </span>
          <strong>{signer?.address}</strong>
        </div>
        <div className="kc-address-row">
          <span
            title="The signer address is the encrypted keystore key that owns the account."
          >
            Signer
          </span>
          <strong>{signer?.signerAddress}</strong>
        </div>
        <div className="kc-address-meta">
          <span>{chainName}</span>
          <span>{formatSignerMode(signer)}</span>
        </div>
      </div>
      {signer?.mode !== "plain-eoa" ? (
        <label className="kc-toggle kc-toggle--split">
          <input
            type="checkbox"
            checked={gaslessEnabled}
            disabled={gaslessBusy}
            onChange={(event) => void toggleGasless(event.target.checked)}
          />
          <span>Gasless mode</span>
          <small>{gaslessBusy ? "Updating" : gaslessStatus}</small>
        </label>
      ) : null}
      {signer?.gasless?.taskId ? (
        <div className="kc-file-summary">
          <span>1Shot task</span>
          <span>{shortHash(signer.gasless.taskId)}</span>
        </div>
      ) : null}
      {signer?.gasless?.message ? (
        <Banner tone="pending">{signer.gasless.message}</Banner>
      ) : null}
      <div className="kc-action-grid">
        <button className="kc-primary" type="button" onClick={onSettings}>
          Settings
        </button>
        <button className="kc-secondary" type="button" onClick={onLock}>
          Lock
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kc-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DropZone({
  fileName,
  onFile
}: {
  fileName: string;
  onFile(file: File): void;
}) {
  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (file) {
      onFile(file);
    }
  }

  return (
    <label
      className="kc-dropzone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <input
        accept="application/json,.json"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          if (file) {
            onFile(file);
          }
        }}
      />
      <span>{fileName || "Drop keystore file or choose JSON"}</span>
    </label>
  );
}

function PasswordStrength({
  strength
}: {
  strength: { score: number; label: string };
}) {
  return (
    <div className="kc-strength" aria-label={`Password strength: ${strength.label}`}>
      <div>
        {Array.from({ length: 4 }, (_, index) => (
          <span
            className={index < strength.score ? "kc-strength-on" : ""}
            key={index}
          />
        ))}
      </div>
      <small>{strength.label}</small>
    </div>
  );
}

async function resolveNextWebAuthn(
  currentHasWebAuthn: boolean,
  nextUsesWebAuthn: boolean
): Promise<CreateWebAuthnPrfOptions | null | undefined> {
  if (!nextUsesWebAuthn) {
    return null;
  }
  if (currentHasWebAuthn) {
    return undefined;
  }
  return registerWebAuthnPrfFactor();
}

async function registerWebAuthnPrfFactor(): Promise<CreateWebAuthnPrfOptions> {
  const credentials = globalThis.navigator?.credentials;
  if (!credentials?.create) {
    throw new Error("WebAuthn credentials API is unavailable.");
  }
  const rpId = globalThis.location?.hostname;
  if (!rpId) {
    throw new Error("WebAuthn requires a browser origin.");
  }
  const credential = await credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { id: rpId, name: "Keycat" },
      user: {
        id: randomBytes(16),
        name: "Keycat Wallet",
        displayName: "Keycat Wallet"
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required"
      },
      attestation: "none",
      timeout: 60_000,
      extensions: {
        prf: {}
      }
    } as PublicKeyCredentialCreationOptions
  });
  if (
    typeof PublicKeyCredential === "undefined" ||
    !(credential instanceof PublicKeyCredential)
  ) {
    throw new Error("WebAuthn did not return a public-key credential.");
  }
  return {
    credentialId: new Uint8Array(credential.rawId),
    rpId,
    handle: browserWebAuthnPrf as WebAuthnPrfHandle
  };
}

function hasWebAuthn(keystore: KeycatKeystoreV1): boolean {
  return keystore.crypto.factors.length > 1;
}

async function createSignerForKeystore(
  unlocked: Awaited<ReturnType<typeof unlockKeystore>>,
  keystore: KeycatKeystoreV1,
  chain: KeycatChainConfig,
  signerOptions: KeycatSignerOptions
): Promise<KeycatSigner> {
  if (keystore.meta.walletMode === "plain-eoa") {
    return createPlainEoaSigner(unlocked, chain, signerOptions.rpcUrl);
  }
  if (keystore.meta.walletMode === "eip7702") {
    return createUpgraded7702Signer(unlocked, chain, signerOptions);
  }
  return createSmartAccountSigner(unlocked, chain, {
    ...signerOptions,
    accountAddress: keystore.meta.accountAddress as KeycatAddress | undefined
  });
}

function withSignerMetadata(
  keystore: KeycatKeystoreV1,
  signer: KeycatSigner,
  chain: KeycatChainConfig
): KeycatKeystoreV1 {
  return {
    ...keystore,
    meta: {
      ...keystore.meta,
      walletMode: signer.mode,
      accountAddress: signer.address,
      signerAddress: signer.signerAddress,
      smartAccountImplementation: signer.implementation,
      smartAccountChainId: chain.id,
      smartAccountDeploySalt: signer.mode === "smart-account" ? "0x" : undefined
    }
  };
}

function formatSignerMode(signer?: KeycatSignerSnapshot): string {
  if (!signer) {
    return "Locked";
  }
  if (signer.mode === "eip7702") {
    return "EIP-7702 upgraded";
  }
  if (signer.mode === "smart-account") {
    return "Hybrid smart account";
  }
  return "Plain EOA";
}

function getPasswordStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 10) {
    score += 1;
  }
  if (password.length >= 14) {
    score += 1;
  }
  if (/[0-9]/u.test(password) && /[A-Za-z]/u.test(password)) {
    score += 1;
  }
  if (/[^A-Za-z0-9]/u.test(password)) {
    score += 1;
  }
  const bounded = Math.min(score, 4);
  return {
    score: bounded,
    label: ["Too short", "Basic", "Good", "Strong", "Excellent"][bounded] ?? "Basic"
  };
}

function downloadTextFile(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isRecoveryAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/u.test(value);
}

function isRecoveryBytes32(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/u.test(value);
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function formatUnixTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}

const KEYCAT_STYLES = `
.kc-wallet {
  color: #182322;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.4;
  width: 100%;
}
.kc-wallet * {
  box-sizing: border-box;
}
.kc-wallet--embedded {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 14px;
  background: rgba(12, 18, 20, 0.58);
}
.kc-wallet--fullpage {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 18px;
  background: #f6f3ee;
}
.kc-panel {
  width: min(100%, 420px);
  border: 1px solid #d7ded7;
  border-radius: 8px;
  background: #fffefa;
  box-shadow: 0 20px 70px rgba(19, 27, 30, 0.24);
  padding: 18px;
}
.kc-wallet--fullpage .kc-panel {
  width: min(100%, 760px);
  padding: 24px;
}
.kc-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.kc-brand {
  font-size: 1.05rem;
  font-weight: 800;
}
.kc-subtitle {
  color: #68736c;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.kc-header-actions {
  display: flex;
  gap: 8px;
}
.kc-icon-button {
  align-items: center;
  background: #f0f3ef;
  border: 1px solid #d6ded6;
  border-radius: 8px;
  color: #1d2b28;
  cursor: pointer;
  display: inline-flex;
  font-size: 1rem;
  height: 34px;
  justify-content: center;
  width: 34px;
}
.kc-css-icon {
  display: inline-block;
  height: 16px;
  position: relative;
  width: 16px;
}
.kc-css-icon-settings {
  border: 2px solid #1d2b28;
  border-radius: 999px;
}
.kc-css-icon-settings::before {
  background: #1d2b28;
  border-radius: 999px;
  content: "";
  height: 4px;
  left: 4px;
  position: absolute;
  top: 4px;
  width: 4px;
}
.kc-css-icon-settings::after {
  background: #1d2b28;
  box-shadow: 0 -7px 0 #1d2b28, 0 7px 0 #1d2b28;
  content: "";
  height: 3px;
  left: 5px;
  position: absolute;
  top: 5px;
  width: 2px;
}
.kc-css-icon-lock::before {
  border: 2px solid #1d2b28;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  content: "";
  height: 8px;
  left: 3px;
  position: absolute;
  top: 0;
  width: 10px;
}
.kc-css-icon-lock::after {
  background: #1d2b28;
  border-radius: 2px;
  content: "";
  height: 8px;
  left: 2px;
  position: absolute;
  top: 7px;
  width: 12px;
}
.kc-stack {
  display: grid;
  gap: 14px;
}
.kc-stack h1,
.kc-stack h2,
.kc-stack p {
  margin: 0;
}
.kc-stack h1 {
  font-size: 1.45rem;
  line-height: 1.12;
}
.kc-stack h2 {
  font-size: 1.22rem;
}
.kc-intro {
  align-items: center;
  display: grid;
  gap: 14px;
  grid-template-columns: auto 1fr;
}
.kc-intro p,
.kc-muted,
.kc-request-description {
  color: #68736c;
  font-size: 0.92rem;
}
.kc-cat-mark {
  align-items: center;
  aspect-ratio: 1;
  background: #de684f;
  border-radius: 8px;
  display: grid;
  height: 54px;
  justify-items: center;
  position: relative;
}
.kc-cat-mark::before,
.kc-cat-mark::after {
  border-bottom: 18px solid #de684f;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  content: "";
  position: absolute;
  top: -10px;
}
.kc-cat-mark::before {
  left: 7px;
  transform: rotate(-18deg);
}
.kc-cat-mark::after {
  right: 7px;
  transform: rotate(18deg);
}
.kc-cat-mark span {
  background: #fffefa;
  border-radius: 999px;
  height: 10px;
  position: relative;
  width: 28px;
}
.kc-cat-mark span::before,
.kc-cat-mark span::after {
  background: #182322;
  border-radius: 999px;
  content: "";
  height: 4px;
  position: absolute;
  top: -8px;
  width: 4px;
}
.kc-cat-mark span::before {
  left: 5px;
}
.kc-cat-mark span::after {
  right: 5px;
}
.kc-action-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.kc-primary,
.kc-secondary {
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-weight: 750;
  min-height: 44px;
  padding: 10px 12px;
}
.kc-primary {
  background: #1f8a6b;
  border: 1px solid #1a7359;
  color: white;
}
.kc-secondary {
  background: #f2f5f2;
  border: 1px solid #d7ded7;
  color: #1d2b28;
}
.kc-primary:disabled,
.kc-secondary:disabled {
  cursor: wait;
  opacity: 0.62;
}
.kc-field {
  display: grid;
  gap: 6px;
}
.kc-field span {
  color: #44514d;
  font-size: 0.85rem;
  font-weight: 700;
}
.kc-field input {
  background: #ffffff;
  border: 1px solid #cfd8d1;
  border-radius: 8px;
  color: #182322;
  font: inherit;
  min-height: 42px;
  padding: 9px 10px;
  width: 100%;
}
.kc-toggle {
  align-items: center;
  border: 1px solid #d7ded7;
  border-radius: 8px;
  display: flex;
  gap: 10px;
  padding: 11px;
}
.kc-toggle input {
  accent-color: #1f8a6b;
}
.kc-toggle--split {
  display: grid;
  grid-template-columns: auto 1fr auto;
}
.kc-toggle small {
  color: #68736c;
  font-size: 0.78rem;
  text-transform: capitalize;
}
.kc-dropzone {
  align-items: center;
  border: 1px dashed #9aa79e;
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  min-height: 96px;
  padding: 16px;
  text-align: center;
}
.kc-dropzone input {
  height: 1px;
  opacity: 0;
  position: absolute;
  width: 1px;
}
.kc-file-summary,
.kc-account-block {
  background: #f5f8f5;
  border: 1px solid #dbe3dc;
  border-radius: 8px;
  display: grid;
  gap: 5px;
  padding: 12px;
  overflow-wrap: anywhere;
}
.kc-recovery-alert {
  background: #fff0ed;
  border: 1px solid #d76c5d;
  border-radius: 8px;
  color: #6f1d13;
  display: grid;
  gap: 8px;
  padding: 12px;
}
.kc-recovery-alert span {
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}
.kc-file-summary {
  grid-template-columns: 1fr auto;
}
.kc-account-block span,
.kc-file-summary span:last-child {
  color: #68736c;
  font-size: 0.85rem;
}
.kc-address-row {
  display: grid;
  gap: 6px;
  grid-template-columns: 86px 1fr;
}
.kc-address-row strong {
  min-width: 0;
  overflow-wrap: anywhere;
}
.kc-address-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}
.kc-banner {
  border-radius: 8px;
  font-size: 0.9rem;
  margin-bottom: 12px;
  padding: 10px 12px;
}
.kc-banner--danger {
  background: #fff0ed;
  border: 1px solid #e5aaa0;
  color: #8a2618;
}
.kc-banner--success {
  background: #edf8f2;
  border: 1px solid #9acdb2;
  color: #15573f;
}
.kc-banner--pending {
  background: #fff8e8;
  border: 1px solid #e4c375;
  color: #5c4717;
}
.kc-strength {
  align-items: center;
  display: flex;
  gap: 10px;
  justify-content: space-between;
}
.kc-strength div {
  display: grid;
  flex: 1;
  gap: 5px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.kc-strength span {
  background: #e3e8e3;
  border-radius: 99px;
  height: 7px;
}
.kc-strength .kc-strength-on {
  background: #de684f;
}
.kc-strength small {
  color: #68736c;
}
.kc-detail-table {
  border: 1px solid #dbe3dc;
  border-radius: 8px;
  overflow: hidden;
}
.kc-detail-row {
  display: grid;
  gap: 8px;
  grid-template-columns: 118px minmax(0, 1fr);
  padding: 10px 12px;
}
.kc-detail-row + .kc-detail-row {
  border-top: 1px solid #dbe3dc;
}
.kc-detail-row span {
  color: #68736c;
}
.kc-detail-row strong {
  font-weight: 700;
  overflow-wrap: anywhere;
}
.kc-raw {
  border: 1px solid #dbe3dc;
  border-radius: 8px;
  padding: 10px 12px;
}
.kc-raw summary {
  cursor: pointer;
  font-weight: 750;
}
.kc-raw code {
  background: #f6f3ee;
  border-radius: 6px;
  display: block;
  margin-top: 10px;
  max-height: 180px;
  overflow: auto;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-all;
}
.kc-ai-review,
.kc-scope-preview {
  border: 1px solid #dbe3dc;
  border-radius: 8px;
  display: grid;
  gap: 10px;
  padding: 12px;
}
.kc-ai-review--medium {
  border-color: #e4c375;
}
.kc-ai-review--high {
  border-color: #e5aaa0;
}
.kc-ai-review-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
}
.kc-ai-review-head span,
.kc-paid {
  color: #68736c;
  font-size: 0.82rem;
}
.kc-risk-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kc-risk {
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 750;
  padding: 4px 8px;
}
.kc-risk--low {
  background: #edf8f2;
  color: #15573f;
}
.kc-risk--medium {
  background: #fff8e8;
  color: #5c4717;
}
.kc-risk--high {
  background: #fff0ed;
  color: #8a2618;
}
@media (max-width: 520px) {
  .kc-wallet--fullpage,
  .kc-wallet--embedded {
    padding: 10px;
  }
  .kc-panel,
  .kc-wallet--fullpage .kc-panel {
    padding: 16px;
  }
  .kc-action-grid,
  .kc-detail-row {
    grid-template-columns: 1fr;
  }
  .kc-intro {
    grid-template-columns: 1fr;
  }
}
`;
