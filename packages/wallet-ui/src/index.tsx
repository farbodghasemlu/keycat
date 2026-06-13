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
import { createLocalEoaSigner } from "./signer.js";
import type {
  KeycatChainConfig,
  KeycatSigner,
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
  KeycatSigner,
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

export type KeycatWalletMode = "embedded" | "fullpage";

export type KeycatTransportRequest = {
  id: string;
  origin: string;
  method: string;
  params?: unknown;
};

export type KeycatTransportResponse =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } };

export type KeycatWalletTransport = {
  subscribe(
    handler: (request: KeycatTransportRequest) => void | Promise<void>
  ): () => void;
  respond(request: KeycatTransportRequest, response: KeycatTransportResponse): void;
  emit(event: "accountsChanged" | "disconnect", params: unknown[]): void;
  setVisible?(visible: boolean): void;
};

export type UseKeycatProviderOptions = {
  chain?: KeycatChainConfig;
  chainId?: number;
  rpcUrl?: string;
  publicRpc?: PublicRpcProxy;
  signer?: KeycatSigner;
};

export type UseKeycatProviderResult = {
  controller: KeycatProviderController;
  provider: KeycatProvider;
  snapshot: KeycatControllerSnapshot;
};

export function useKeycatProvider({
  chain: chainOption,
  chainId,
  rpcUrl,
  publicRpc,
  signer
}: UseKeycatProviderOptions = {}): UseKeycatProviderResult {
  const chain = useMemo(
    () => chainOption ?? getKeycatChain(chainId),
    [chainId, chainOption]
  );
  const key = `${chain.id}:${rpcUrl ?? ""}`;
  const controllerRef = useRef<{
    key: string;
    controller: KeycatProviderController;
  } | null>(null);

  if (!controllerRef.current || controllerRef.current.key !== key) {
    controllerRef.current?.controller.lock("Network changed.");
    controllerRef.current = {
      key,
      controller: createKeycatController({ chain, rpcUrl, publicRpc, signer })
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

export type KeycatWalletProps = {
  mode: KeycatWalletMode;
  chain?: KeycatChainConfig;
  chainId?: number;
  rpcUrl?: string;
  autoLockMs?: number;
  lockOnVisibilityHidden?: boolean;
  transport?: KeycatWalletTransport;
};

export function KeycatWallet({
  mode,
  chain: chainOption,
  chainId,
  rpcUrl,
  autoLockMs = 10 * 60 * 1000,
  lockOnVisibilityHidden = true,
  transport
}: KeycatWalletProps) {
  const chain = useMemo(
    () => chainOption ?? getKeycatChain(chainId),
    [chainId, chainOption]
  );
  const { controller, snapshot } = useKeycatProvider({ chain, rpcUrl });
  const [screen, setScreen] = useState<"welcome" | "create" | "unlock" | "settings">(
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
    locker.start();
    for (const event of ["pointerdown", "mousemove", "keydown", "touchstart"]) {
      window.addEventListener(event, poke, { passive: true });
    }
    document.addEventListener("visibilitychange", lockIfHidden);
    return () => {
      locker.stop();
      for (const event of ["pointerdown", "mousemove", "keydown", "touchstart"]) {
        window.removeEventListener(event, poke);
      }
      document.removeEventListener("visibilitychange", lockIfHidden);
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
            address={snapshot.address}
            chainName={chain.name}
            onSettings={() => setScreen("settings")}
            onLock={() => {
              controller.lock("Wallet locked.");
              setScreen("welcome");
            }}
          />
        ) : screen === "create" ? (
          <CreateScreen
            chain={chain}
            rpcUrl={rpcUrl}
            onBack={() => {
              setError(undefined);
              setScreen("welcome");
            }}
            onError={setError}
            onCreated={(signer, keystore) => {
              controller.setSigner(signer);
              setActiveKeystore(keystore);
              setNotice(`Created ${keystore.address}`);
              setScreen("welcome");
            }}
          />
        ) : screen === "unlock" ? (
          <UnlockScreen
            chain={chain}
            rpcUrl={rpcUrl}
            onBack={() => {
              setError(undefined);
              setScreen("welcome");
            }}
            onError={setError}
            onUnlocked={(signer, keystore) => {
              controller.setSigner(signer);
              setActiveKeystore(keystore);
              setNotice(`Unlocked ${keystore.address}`);
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
  onClose,
  onSettings,
  onLock
}: {
  mode: KeycatWalletMode;
  pending?: KeycatPendingRequest;
  address?: string;
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
              ? shortAddress(address)
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
  onUnlock
}: {
  onCreate(): void;
  onUnlock(): void;
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
      </div>
    </div>
  );
}

function CreateScreen({
  chain,
  rpcUrl,
  onBack,
  onError,
  onCreated
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  onBack(): void;
  onError(message: string): void;
  onCreated(signer: KeycatSigner, keystore: KeycatKeystoreV1): void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [useBiometric, setUseBiometric] = useState(false);
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
      downloadTextFile(exportKeystoreFile(keystore), `keycat-${keystore.address}.json`);
      const unlocked = await unlockKeystore(keystore, {
        password,
        webauthnHandle: webauthn ? browserWebAuthnPrf : undefined
      });
      onCreated(createLocalEoaSigner(unlocked, chain, rpcUrl), keystore);
      setPassword("");
      setConfirm("");
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
  onBack,
  onError,
  onUnlocked
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
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
      onUnlocked(createLocalEoaSigner(unlocked, chain, rpcUrl), keystore);
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
          <span>{hasWebAuthn(keystore) ? "Password + biometric" : "Password"}</span>
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

function SettingsScreen({
  keystore,
  chain,
  rpcUrl,
  onDone,
  onError,
  onSigner
}: {
  keystore?: KeycatKeystoreV1;
  chain: KeycatChainConfig;
  rpcUrl?: string;
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
      downloadTextFile(
        exportKeystoreFile(nextKeystore),
        `keycat-${nextKeystore.address}.json`
      );
      const unlocked = await unlockKeystore(nextKeystore, {
        password: nextPassword,
        webauthnHandle: hasWebAuthn(nextKeystore) ? browserWebAuthnPrf : undefined
      });
      onSigner(createLocalEoaSigner(unlocked, chain, rpcUrl), nextKeystore);
      setCurrentPassword("");
      setNextPassword("");
      setConfirm("");
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

function UnlockedHome({
  address,
  chainName,
  onSettings,
  onLock
}: {
  address?: string;
  chainName: string;
  onSettings(): void;
  onLock(): void;
}) {
  return (
    <div className="kc-stack">
      <div className="kc-account-block">
        <span>Account</span>
        <strong>{address}</strong>
        <span>{chainName}</span>
      </div>
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
.kc-file-summary {
  grid-template-columns: 1fr auto;
}
.kc-account-block span,
.kc-file-summary span:last-child {
  color: #68736c;
  font-size: 0.85rem;
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
