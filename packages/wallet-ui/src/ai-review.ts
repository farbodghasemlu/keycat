import {
  CaveatType,
  ScopeType,
  createDelegation,
  getSmartAccountsEnvironment,
  signDelegation as signDelegationWithPrivateKey,
  type Caveats,
  type Delegation
} from "@metamask/smart-accounts-kit";
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import {
  decodePaymentResponseHeader,
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
  type PaymentRequired,
  type PaymentRequirements
} from "@x402/fetch";
import {
  decodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  pad,
  parseAbi,
  type Account
} from "viem";
import { SiweMessage, generateNonce } from "siwe";
import { KEYCAT_AI_REVIEW_MODEL, KEYCAT_AI_REVIEW_PROMPT_VERSION, KEYCAT_AI_REVIEW_SYSTEM_PROMPT } from "./ai-review-prompt.js";
import type {
  KeycatAddress,
  KeycatAiReviewDelegationScope,
  KeycatAiReviewRequest,
  KeycatAiReviewResult,
  KeycatAiReviewRisk,
  KeycatAiReviewSeverity,
  KeycatHex,
  KeycatTransactionRequest,
  KeycatTypedDataPayload
} from "./types.js";

export const AI_REVIEW_DAILY_LIMIT_USD = "0.25" as const;
export const AI_REVIEW_DAILY_LIMIT_ATOMIC = 250_000n;
export const AI_REVIEW_PERIOD_SECONDS = 86_400 as const;
export const AI_REVIEW_EXPIRY_SECONDS = 7 * 86_400;
export const AI_REVIEW_TIMEOUT_MS = 5_000;
export const NATIVE_VALUE_REVIEW_THRESHOLD_WEI = 100_000_000_000_000_000n;
export const VENICE_API_URL = "https://api.venice.ai";
export const VENICE_EVM_AUTH_CHAIN_ID = 8453;

const TRANSFER_PAYEE_CALLDATA_INDEX = 4;
const MAX_UINT256 = (1n << 256n) - 1n;
const UNLIMITED_APPROVAL_THRESHOLD = (1n << 255n) - 1n;
const VENICE_SIGN_IN_EXPIRY_MS = 5 * 60 * 1000;

const ERC20_ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address to,uint256 amount) returns (bool)",
  "function transferFrom(address from,address to,uint256 amount) returns (bool)"
]);

const ROUTER_ABI = parseAbi([
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns (uint256[] amounts)",
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) payable returns (bytes[] results)"
]);

const KNOWN_TARGETS: Record<number, Record<string, string>> = {
  8453: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC"
  },
  84532: {
    "0x036cbd53842c5426634e7929541ec2318f3dcf7e": "USDC"
  },
  11155111: {
    "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": "USDC"
  }
};

export type AiReviewDelegationConfig = {
  scope: {
    type: ScopeType.Erc20PeriodTransfer;
    tokenAddress: KeycatAddress;
    periodAmount: bigint;
    periodDuration: number;
    startDate: number;
  };
  caveats: Caveats;
};

type DecodedHint = {
  label: string;
  details: Record<string, string>;
  verifiedTarget: boolean;
};

type VeniceReviewPayload = {
  promptVersion: string;
  kind: KeycatAiReviewRequest["kind"];
  origin: string;
  to?: string;
  valueWei?: string;
  calldata?: string;
  chainId: number;
  decodedHints: Record<string, unknown>;
};

type PaidJsonResult = {
  body: unknown;
  selectedRequirements?: PaymentRequirements;
  settlementAmount?: string;
};

type VeniceSiweAuth = {
  address: KeycatAddress;
  signMessage(message: string): Promise<KeycatHex>;
  apiUrl?: string;
};

type VeniceModelReview = {
  summary: string;
  risks: string[];
  severity: KeycatAiReviewSeverity;
};

export function createLocalTransactionReview({
  transaction,
  chainId
}: {
  transaction: KeycatTransactionRequest;
  chainId: number;
}): KeycatAiReviewResult {
  const decoded = decodeTransaction(transaction, chainId);
  const risks = collectTransactionRisks(transaction, chainId, decoded);
  const severity = maxSeverity(risks.map((risk) => risk.severity));
  return {
    status: "local",
    summary: summarizeTransaction(transaction, chainId, decoded),
    risks,
    severity
  };
}

export function createLocalTypedDataReview({
  typedData,
  chainId
}: {
  typedData: KeycatTypedDataPayload;
  chainId: number;
}): KeycatAiReviewResult {
  const verifyingContract = getTypedDataVerifyingContract(typedData);
  const risks: KeycatAiReviewRisk[] = [];
  if (verifyingContract && !isKnownTarget(chainId, verifyingContract)) {
    risks.push({
      label: "Unverified typed-data verifying contract",
      severity: "medium",
      source: "local"
    });
  }
  return {
    status: "local",
    summary: `Sign typed data for ${typedData.primaryType}.`,
    risks,
    severity: maxSeverity(risks.map((risk) => risk.severity))
  };
}

export function toLoadingAiReview(local: KeycatAiReviewResult): KeycatAiReviewResult {
  return {
    ...local,
    status: "loading",
    notice: "AI review pending. You can still approve or reject now."
  };
}

export async function probeAiReviewScope({
  endpoint,
  fetch: fetchImpl = globalThis.fetch,
  now = Math.floor(Date.now() / 1000)
}: {
  endpoint?: string;
  fetch?: typeof fetch;
  now?: number;
}): Promise<KeycatAiReviewDelegationScope> {
  if (!endpoint) {
    throw new Error("NEXT_PUBLIC_VENICE_X402_ENDPOINT is required for AI review.");
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      keycat: "ai-review-scope-probe",
      promptVersion: KEYCAT_AI_REVIEW_PROMPT_VERSION
    })
  });
  if (response.status !== 402) {
    throw new Error(
      `AI review endpoint did not return an x402 challenge. Received HTTP ${response.status}.`
    );
  }
  const paymentRequired = await readPaymentRequired(response);
  const requirement = selectAiReviewPaymentRequirement(paymentRequired.accepts);
  const chainId = parseEip155Network(requirement.network);
  return {
    endpoint,
    chainId,
    network: `eip155:${chainId}`,
    stablecoinAddress: normalizeAddress(requirement.asset, "x402 asset"),
    payeeAddress: normalizeAddress(requirement.payTo, "x402 payee"),
    dailyUsdLimit: AI_REVIEW_DAILY_LIMIT_USD,
    dailyLimitAtomic: AI_REVIEW_DAILY_LIMIT_ATOMIC.toString(),
    periodSeconds: AI_REVIEW_PERIOD_SECONDS,
    expiresAt: now + AI_REVIEW_EXPIRY_SECONDS
  };
}

export function assertAiReviewScope(scope: KeycatAiReviewDelegationScope): void {
  if (scope.dailyUsdLimit !== AI_REVIEW_DAILY_LIMIT_USD) {
    throw new Error("AI review scope must be limited to $0.25 per day.");
  }
  if (scope.dailyLimitAtomic !== AI_REVIEW_DAILY_LIMIT_ATOMIC.toString()) {
    throw new Error("AI review scope has an unexpected stablecoin atomic limit.");
  }
  if (scope.periodSeconds !== AI_REVIEW_PERIOD_SECONDS) {
    throw new Error("AI review scope must use a one-day spending period.");
  }
  normalizeAddress(scope.stablecoinAddress, "AI review stablecoin");
  normalizeAddress(scope.payeeAddress, "AI review payee");
}

export function buildAiReviewDelegationConfig({
  scope,
  startDate = Math.floor(Date.now() / 1000)
}: {
  scope: KeycatAiReviewDelegationScope;
  startDate?: number;
}): AiReviewDelegationConfig {
  assertAiReviewScope(scope);
  return {
    scope: {
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: scope.stablecoinAddress,
      periodAmount: BigInt(scope.dailyLimitAtomic),
      periodDuration: scope.periodSeconds,
      startDate
    },
    caveats: [
      {
        type: CaveatType.AllowedTargets,
        targets: [scope.stablecoinAddress]
      },
      {
        type: CaveatType.AllowedCalldata,
        startIndex: TRANSFER_PAYEE_CALLDATA_INDEX,
        value: pad(scope.payeeAddress, { size: 32 })
      },
      {
        type: CaveatType.Timestamp,
        afterThreshold: 0,
        beforeThreshold: scope.expiresAt
      }
    ] satisfies Caveats
  };
}

export async function createSignedAiReviewDelegation({
  privateKey,
  payerAddress,
  sessionKeyAddress,
  scope,
  salt = randomHex32()
}: {
  privateKey: KeycatHex;
  payerAddress: KeycatAddress;
  sessionKeyAddress: KeycatAddress;
  scope: KeycatAiReviewDelegationScope;
  salt?: KeycatHex;
}): Promise<Delegation> {
  const environment = getSmartAccountsEnvironment(scope.chainId);
  const config = buildAiReviewDelegationConfig({ scope });
  const delegation = createDelegation({
    from: payerAddress,
    to: sessionKeyAddress,
    environment,
    scope: config.scope,
    caveats: config.caveats,
    salt
  });
  const signature = await signDelegationWithPrivateKey({
    privateKey,
    delegation,
    delegationManager: environment.DelegationManager as KeycatAddress,
    chainId: scope.chainId
  });
  return {
    ...delegation,
    signature
  };
}

export async function requestVeniceAiReview({
  request,
  scope,
  parentPermissionContext,
  sessionAccount,
  veniceAuth,
  fetch: fetchImpl = globalThis.fetch,
  signal
}: {
  request: KeycatAiReviewRequest;
  scope: KeycatAiReviewDelegationScope;
  parentPermissionContext: Delegation[];
  sessionAccount: Account;
  veniceAuth?: VeniceSiweAuth;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<KeycatAiReviewResult> {
  const publicPayload = createVeniceReviewPayload(request);
  const body = {
    model: KEYCAT_AI_REVIEW_MODEL,
    messages: [
      { role: "system", content: KEYCAT_AI_REVIEW_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(publicPayload) }
    ],
    response_format: { type: "json_object" },
    venice_parameters: {
      include_venice_system_prompt: false,
      disable_thinking: true
    }
  };
  let paid: PaidJsonResult | undefined;
  let reviewBody: unknown;
  if (veniceAuth) {
    const venice = await postJsonWithVeniceSiwe({
      body,
      auth: veniceAuth,
      fetch: fetchImpl,
      signal
    });
    reviewBody = venice.body;
    paid = await postJsonWithX402({
      endpoint: scope.endpoint,
      body,
      scope,
      parentPermissionContext,
      sessionAccount,
      fetch: fetchImpl,
      signal
    });
  } else {
    paid = await postJsonWithX402({
      endpoint: scope.endpoint,
      body,
      scope,
      parentPermissionContext,
      sessionAccount,
      fetch: fetchImpl,
      signal
    });
    reviewBody = paid.body;
  }
  const modelReview = parseVeniceReviewResponse(reviewBody);
  if (!modelReview) {
    return unavailableReview(request.local, "AI review returned an unreadable response.");
  }
  const amount = paid?.settlementAmount ?? paid?.selectedRequirements?.amount;
  return mergeAiReview(request.local, modelReview, amount ? formatUsdPaid(amount) : undefined);
}

export async function postJsonWithVeniceSiwe({
  body,
  auth,
  fetch: fetchImpl = globalThis.fetch,
  signal
}: {
  body: unknown;
  auth: VeniceSiweAuth;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ body: unknown; balanceRemaining?: string }> {
  const endpoint = `${normalizeVeniceApiUrl(auth.apiUrl)}/api/v1/chat/completions`;
  const authHeader = await createVeniceSignInWithXHeader({
    auth,
    resourceUrl: endpoint
  });
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Sign-In-With-X": authHeader
    },
    body: JSON.stringify(body),
    signal
  });
  if (response.status === 402) {
    throw new Error(
      "Venice prepaid balance is insufficient for AI review. Top up the authenticated wallet's Venice x402 balance and try again."
    );
  }
  if (!response.ok) {
    throw new Error(`Venice AI review request failed with HTTP ${response.status}.`);
  }
  const balanceRemaining = response.headers.get("X-Balance-Remaining") ?? undefined;
  return {
    body: await response.json(),
    ...(balanceRemaining ? { balanceRemaining } : {})
  };
}

export async function createVeniceSignInWithXHeader({
  auth,
  resourceUrl,
  now = new Date()
}: {
  auth: VeniceSiweAuth;
  resourceUrl: string;
  now?: Date;
}): Promise<string> {
  const apiUrl = new URL(normalizeVeniceApiUrl(auth.apiUrl));
  const address = getAddress(auth.address);
  const message = new SiweMessage({
    domain: apiUrl.host,
    address,
    statement: "Sign in to Venice AI",
    uri: resourceUrl,
    version: "1",
    chainId: VENICE_EVM_AUTH_CHAIN_ID,
    nonce: generateNonce(),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + VENICE_SIGN_IN_EXPIRY_MS).toISOString()
  });
  const messageString = message.prepareMessage();
  const signature = await auth.signMessage(messageString);
  return encodeBase64Utf8(
    JSON.stringify({
      address,
      message: messageString,
      signature,
      timestamp: now.getTime(),
      chainId: VENICE_EVM_AUTH_CHAIN_ID
    })
  );
}

export async function postJsonWithX402({
  endpoint,
  body,
  scope,
  parentPermissionContext,
  sessionAccount,
  fetch: fetchImpl = globalThis.fetch,
  signal
}: {
  endpoint: string;
  body: unknown;
  scope: KeycatAiReviewDelegationScope;
  parentPermissionContext: Delegation[];
  sessionAccount: Account;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PaidJsonResult> {
  const environment = getSmartAccountsEnvironment(scope.chainId);
  let selectedRequirements: PaymentRequirements | undefined;
  const delegationProvider = createx402DelegationProvider({
    account: sessionAccount,
    environment,
    parentPermissionContext,
    expirySeconds: Math.max(
      0,
      Math.min(300, scope.expiresAt - Math.floor(Date.now() / 1000))
    ),
    redeemers: { requireRedeemers: true }
  });
  const erc7710Client = new x402Erc7710Client({
    delegationProvider: delegationProvider as never
  });
  const coreClient = new x402Client((_version, requirements) => {
    selectedRequirements = selectScopedPaymentRequirement(requirements, scope);
    return selectedRequirements;
  }).register("eip155:*", erc7710Client);
  coreClient.onAfterPaymentCreation(async (context) => {
    selectedRequirements = context.selectedRequirements;
  });
  const httpClient = new x402HTTPClient(coreClient);
  const fetchWithPayment = wrapFetchWithPayment(fetchImpl, httpClient);
  const response = await fetchWithPayment(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) {
    throw new Error(`AI review request failed with HTTP ${response.status}.`);
  }
  const settlementAmount = readSettlementAmount(response);
  return {
    body: await response.json(),
    selectedRequirements,
    ...(settlementAmount ? { settlementAmount } : {})
  };
}

export function parseVeniceReviewResponse(input: unknown): VeniceModelReview | undefined {
  const content = extractModelContent(input);
  if (content === undefined) {
    return undefined;
  }
  const parsed = typeof content === "string" ? parseJsonObject(content) : content;
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.risks) ||
    !isSeverity(parsed.severity)
  ) {
    return undefined;
  }
  const risks = parsed.risks.filter((risk): risk is string => typeof risk === "string");
  return {
    summary: parsed.summary.slice(0, 280),
    risks: risks.slice(0, 6).map((risk) => risk.slice(0, 180)),
    severity: parsed.severity
  };
}

export async function resolveAiReviewWithTimeout({
  local,
  review,
  timeoutMs = AI_REVIEW_TIMEOUT_MS
}: {
  local: KeycatAiReviewResult;
  review: Promise<KeycatAiReviewResult>;
  timeoutMs?: number;
}): Promise<KeycatAiReviewResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      review.catch(() => unavailableReview(local, "AI review unavailable. Showing local decode only.")),
      new Promise<KeycatAiReviewResult>((resolve) => {
        timeout = setTimeout(() => {
          resolve(unavailableReview(local, "AI review timed out. Showing local decode only."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function unavailableReview(
  local: KeycatAiReviewResult,
  notice: string
): KeycatAiReviewResult {
  return {
    ...local,
    status: "unavailable",
    notice
  };
}

export function createVeniceReviewPayload(
  request: KeycatAiReviewRequest
): VeniceReviewPayload {
  if (request.kind === "transaction") {
    const decoded = decodeTransaction(request.transaction, request.chainId);
    return {
      promptVersion: KEYCAT_AI_REVIEW_PROMPT_VERSION,
      kind: "transaction",
      origin: request.origin,
      to: request.transaction.to,
      valueWei: (request.transaction.value ?? 0n).toString(),
      calldata: request.transaction.data ?? "0x",
      chainId: request.chainId,
      decodedHints: decoded
    };
  }
  return {
    promptVersion: KEYCAT_AI_REVIEW_PROMPT_VERSION,
    kind: "typed-data",
    origin: request.origin,
    to: getTypedDataVerifyingContract(request.typedData),
    valueWei: "0",
    calldata: "0x",
    chainId: request.chainId,
    decodedHints: {
      primaryType: request.typedData.primaryType,
      domainName:
        typeof request.typedData.domain?.name === "string"
          ? request.typedData.domain.name
          : undefined,
      verifyingContract: getTypedDataVerifyingContract(request.typedData)
    }
  };
}

function decodeTransaction(
  transaction: KeycatTransactionRequest,
  chainId: number
): DecodedHint {
  const targetLabel = transaction.to ? getTargetLabel(chainId, transaction.to) : undefined;
  const base = {
    target: transaction.to ?? "Contract creation",
    targetLabel: targetLabel ?? "Unknown target",
    valueEth: formatEther(transaction.value ?? 0n)
  };
  const data = transaction.data ?? "0x";
  if (data === "0x") {
    return {
      label: "Native transfer",
      details: base,
      verifiedTarget: Boolean(targetLabel || transaction.to)
    };
  }

  try {
    const decoded = decodeFunctionData({ abi: ERC20_ABI, data });
    if (decoded.functionName === "approve") {
      const [spender, amount] = decoded.args;
      return {
        label: "ERC-20 approve",
        details: {
          ...base,
          spender,
          amount: amount === MAX_UINT256 ? "unlimited" : amount.toString()
        },
        verifiedTarget: Boolean(targetLabel)
      };
    }
    if (decoded.functionName === "transfer") {
      const [recipient, amount] = decoded.args;
      return {
        label: "ERC-20 transfer",
        details: { ...base, recipient, amount: amount.toString() },
        verifiedTarget: Boolean(targetLabel)
      };
    }
    if (decoded.functionName === "transferFrom") {
      const [from, recipient, amount] = decoded.args;
      return {
        label: "ERC-20 transferFrom",
        details: { ...base, from, recipient, amount: amount.toString() },
        verifiedTarget: Boolean(targetLabel)
      };
    }
  } catch {
    // Try router selectors below.
  }

  try {
    const decoded = decodeFunctionData({ abi: ROUTER_ABI, data });
    return {
      label: `Router ${decoded.functionName}`,
      details: {
        ...base,
        function: decoded.functionName
      },
      verifiedTarget: Boolean(targetLabel)
    };
  } catch {
    return {
      label: "Unknown contract call",
      details: {
        ...base,
        selector: data.slice(0, 10)
      },
      verifiedTarget: Boolean(targetLabel)
    };
  }
}

function summarizeTransaction(
  transaction: KeycatTransactionRequest,
  chainId: number,
  decoded: DecodedHint
): string {
  if (decoded.label === "ERC-20 approve") {
    const target = getTargetLabel(chainId, transaction.to);
    return `Approve ${decoded.details.spender} to spend ${decoded.details.amount} ${target ?? "tokens"}.`;
  }
  if (decoded.label === "ERC-20 transfer") {
    const target = getTargetLabel(chainId, transaction.to);
    return `Transfer ${decoded.details.amount} ${target ?? "tokens"} to ${decoded.details.recipient}.`;
  }
  if (decoded.label.startsWith("Router ")) {
    return `Call ${decoded.label.replace("Router ", "")} on ${decoded.details.targetLabel}.`;
  }
  if ((transaction.value ?? 0n) > 0n && (transaction.data ?? "0x") === "0x") {
    return `Send ${formatEther(transaction.value ?? 0n)} ETH to ${transaction.to}.`;
  }
  return `${decoded.label} on ${decoded.details.targetLabel}.`;
}

function collectTransactionRisks(
  transaction: KeycatTransactionRequest,
  chainId: number,
  decoded: DecodedHint
): KeycatAiReviewRisk[] {
  const risks: KeycatAiReviewRisk[] = [];
  if (decoded.label === "ERC-20 approve") {
    const amount = decoded.details.amount;
    if (amount === "unlimited" || BigInt(amount) >= UNLIMITED_APPROVAL_THRESHOLD) {
      risks.push({
        label: "Unlimited token approval",
        severity: "high",
        source: "local"
      });
    }
    const spender = decoded.details.spender;
    if (isAddress(spender) && !isKnownTarget(chainId, spender)) {
      risks.push({
        label: "Unverified approval spender",
        severity: "medium",
        source: "local"
      });
    }
  }
  if (transaction.to && !decoded.verifiedTarget) {
    risks.push({
      label: "Unverified target",
      severity: "medium",
      source: "local"
    });
  }
  if ((transaction.value ?? 0n) > NATIVE_VALUE_REVIEW_THRESHOLD_WEI) {
    risks.push({
      label: "Value is above the local review threshold",
      severity: "medium",
      source: "local"
    });
  }
  return risks;
}

function selectAiReviewPaymentRequirement(
  requirements: PaymentRequirements[]
): PaymentRequirements {
  const selected = requirements.find(
    (requirement) =>
      requirement.network.startsWith("eip155:") &&
      requirement.extra?.assetTransferMethod === "erc7710" &&
      isAddress(requirement.asset) &&
      isAddress(requirement.payTo)
  );
  if (!selected) {
    throw new Error("AI review endpoint did not advertise an ERC-7710 EVM x402 payment option.");
  }
  return selected;
}

function selectScopedPaymentRequirement(
  requirements: PaymentRequirements[],
  scope: KeycatAiReviewDelegationScope
): PaymentRequirements {
  const selected = requirements.find((requirement) => {
    if (requirement.extra?.assetTransferMethod !== "erc7710") {
      return false;
    }
    return (
      requirement.network === scope.network &&
      addressesEqual(requirement.asset, scope.stablecoinAddress) &&
      addressesEqual(requirement.payTo, scope.payeeAddress) &&
      BigInt(requirement.amount) <= BigInt(scope.dailyLimitAtomic)
    );
  });
  if (!selected) {
    throw new Error("x402 challenge is outside the approved AI review delegation scope.");
  }
  return selected;
}

async function readPaymentRequired(response: Response): Promise<PaymentRequired> {
  const httpClient = new x402HTTPClient(new x402Client());
  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return httpClient.getPaymentRequiredResponse((name) => response.headers.get(name), body);
}

function readSettlementAmount(response: Response): string | undefined {
  const header =
    response.headers.get("PAYMENT-RESPONSE") ??
    response.headers.get("X-PAYMENT-RESPONSE");
  if (!header) {
    return undefined;
  }
  try {
    const decoded = decodePaymentResponseHeader(header);
    return decoded.amount;
  } catch {
    return undefined;
  }
}

function mergeAiReview(
  local: KeycatAiReviewResult,
  model: VeniceModelReview,
  pricePaid?: string
): KeycatAiReviewResult {
  const veniceRisks = model.risks.map<KeycatAiReviewRisk>((risk) => ({
    label: risk,
    severity: model.severity,
    source: "venice"
  }));
  const risks = dedupeRisks([...local.risks, ...veniceRisks]);
  return {
    status: "ready",
    summary: model.summary,
    risks,
    severity: maxSeverity([local.severity, model.severity]),
    ...(pricePaid ? { pricePaid } : {})
  };
}

function extractModelContent(input: unknown): unknown {
  if (!isRecord(input)) {
    return undefined;
  }
  if (typeof input.summary === "string") {
    return input;
  }
  const choices = input.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) {
    return undefined;
  }
  const first = choices[0];
  if (isRecord(first.message)) {
    return first.message.content;
  }
  return undefined;
}

function parseJsonObject(input: string): unknown {
  const trimmed = input.trim().replace(/^```(?:json)?/u, "").replace(/```$/u, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function getTypedDataVerifyingContract(
  typedData: KeycatTypedDataPayload
): KeycatAddress | undefined {
  const verifyingContract = typedData.domain?.verifyingContract;
  if (typeof verifyingContract === "string" && isAddress(verifyingContract)) {
    return getAddress(verifyingContract) as KeycatAddress;
  }
  return undefined;
}

function getTargetLabel(chainId: number, address?: string): string | undefined {
  if (!address || !isAddress(address)) {
    return undefined;
  }
  return KNOWN_TARGETS[chainId]?.[address.toLowerCase()];
}

function isKnownTarget(chainId: number, address: string): boolean {
  return getTargetLabel(chainId, address) !== undefined;
}

function normalizeAddress(value: string, label: string): KeycatAddress {
  if (!isAddress(value)) {
    throw new Error(`${label} must be an EVM address.`);
  }
  return getAddress(value) as KeycatAddress;
}

function addressesEqual(left: string, right: string): boolean {
  return isAddress(left) && isAddress(right) && getAddress(left) === getAddress(right);
}

function parseEip155Network(network: string): number {
  const [namespace, reference] = network.split(":");
  const chainId = Number(reference);
  if (namespace !== "eip155" || !Number.isSafeInteger(chainId)) {
    throw new Error(`Unsupported x402 network: ${network}.`);
  }
  return chainId;
}

function normalizeVeniceApiUrl(value?: string): string {
  const url = new URL(value ?? VENICE_API_URL);
  return url.origin;
}

function encodeBase64Utf8(value: string): string {
  if (typeof globalThis.btoa === "function") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary);
  }
  const bufferCtor = (globalThis as unknown as {
    Buffer?: {
      from(input: string, encoding: "utf8"): { toString(encoding: "base64"): string };
    };
  }).Buffer;
  if (!bufferCtor) {
    throw new Error("No base64 encoder is available for Venice authentication.");
  }
  return bufferCtor.from(value, "utf8").toString("base64");
}

function formatUsdPaid(amountAtomic: string): string {
  return `$${trimFixed(formatUnits(BigInt(amountAtomic), 6), 6)} via x402`;
}

function trimFixed(value: string, maxFractionDigits: number): string {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/u, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function maxSeverity(values: KeycatAiReviewSeverity[]): KeycatAiReviewSeverity {
  if (values.includes("high")) {
    return "high";
  }
  if (values.includes("medium")) {
    return "medium";
  }
  return "low";
}

function isSeverity(value: unknown): value is KeycatAiReviewSeverity {
  return value === "low" || value === "medium" || value === "high";
}

function dedupeRisks(risks: KeycatAiReviewRisk[]): KeycatAiReviewRisk[] {
  const seen = new Set<string>();
  const deduped: KeycatAiReviewRisk[] = [];
  for (const risk of risks) {
    const key = risk.label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(risk);
  }
  return deduped;
}

function randomHex32(): KeycatHex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
