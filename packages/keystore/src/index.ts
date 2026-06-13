import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import type { Address, Hex } from "viem";
import {
  generatePrivateKey as generateViemPrivateKey,
  privateKeyToAddress
} from "viem/accounts";
import { z } from "zod";

export type PrivateKeyHex = Hex;

export type KeystoreFactor = "password" | "webauthn-prf";

export type Argon2idKdfParams = {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: string;
};

export type CreateKdfParams = Partial<
  Pick<Argon2idKdfParams, "memoryKiB" | "iterations" | "parallelism">
>;

export type WebAuthnPrfMetadata = {
  credentialIdB64url: string;
  rpId: string;
  prfSaltB64url: string;
};

export type WebAuthnPrfRequest = {
  credentialId: Uint8Array;
  credentialIdB64url: string;
  rpId: string;
  prfSalt: Uint8Array;
  prfSaltB64url: string;
};

export type WebAuthnPrfHandle = {
  evaluate(request: WebAuthnPrfRequest): Promise<Uint8Array>;
};

export type CreateWebAuthnPrfOptions = {
  credentialId?: Uint8Array;
  credentialIdB64url?: string;
  rpId: string;
  prfSalt?: Uint8Array;
  prfSaltB64url?: string;
  handle?: WebAuthnPrfHandle;
};

export type CreateKeystoreOptions = {
  privateKey?: PrivateKeyHex;
  password: string;
  label?: string;
  webauthn?: CreateWebAuthnPrfOptions;
  kdfParams?: CreateKdfParams;
};

export type UnlockKeystoreSecrets = {
  password: string;
  webauthnHandle?: WebAuthnPrfHandle;
};

export type ChangeKeystoreNewSecrets = {
  password: string;
  /**
   * Omit to preserve the current WebAuthn factor, pass null to remove it,
   * or pass options to add/change it.
   */
  webauthn?: CreateWebAuthnPrfOptions | null;
  kdfParams?: CreateKdfParams;
};

export type UnlockedKeystore = {
  readonly privateKey: PrivateKeyHex;
  zeroize(): void;
};

export class DecryptionFailedError extends Error {
  constructor() {
    super("Unable to decrypt keystore.");
    this.name = "DecryptionFailedError";
  }
}

export class KeystoreValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KeystoreValidationError";
  }
}

export const DEFAULT_KDF_PARAMS = {
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1
} as const satisfies CreateKdfParams;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PRIVATE_KEY_BYTES = 32;
const WEBAUTHN_PRF_SALT_BYTES = 32;
const WEBAUTHN_PRF_OUTPUT_BYTES = 32;
const textEncoder = new TextEncoder();

const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const addressPattern = /^0x[a-fA-F0-9]{40}$/u;

const b64urlBytesSchema = ({
  name,
  length,
  minLength
}: {
  name: string;
  length?: number;
  minLength?: number;
}) =>
  z
    .string()
    .regex(base64UrlPattern, `${name} must be unpadded base64url`)
    .superRefine((value, ctx) => {
      try {
        const bytes = base64UrlToBytes(value);
        if (length !== undefined && bytes.byteLength !== length) {
          ctx.addIssue({
            code: "custom",
            message: `${name} must decode to ${length} bytes`
          });
        }
        if (minLength !== undefined && bytes.byteLength < minLength) {
          ctx.addIssue({
            code: "custom",
            message: `${name} must decode to at least ${minLength} bytes`
          });
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          message: `${name} must be valid base64url`
        });
      }
    });

const addressSchema = z.custom<Address>(
  (value) => typeof value === "string" && addressPattern.test(value),
  "address must be a 20-byte hex address"
);

export const argon2idKdfParamsSchema = z
  .object({
    memoryKiB: z.number().int().min(8).max(1024 * 1024),
    iterations: z.number().int().min(1).max(32),
    parallelism: z.number().int().min(1).max(16),
    salt: b64urlBytesSchema({ name: "salt", length: SALT_BYTES })
  })
  .strict();

export const webAuthnPrfMetadataSchema = z
  .object({
    credentialIdB64url: b64urlBytesSchema({
      name: "credentialIdB64url",
      minLength: 1
    }),
    rpId: z.string().min(1),
    prfSaltB64url: b64urlBytesSchema({
      name: "prfSaltB64url",
      length: WEBAUTHN_PRF_SALT_BYTES
    })
  })
  .strict();

const factorsSchema = z.union([
  z.tuple([z.literal("password")]),
  z.tuple([z.literal("password"), z.literal("webauthn-prf")])
]);

export const keycatKeystoreV1Schema = z
  .object({
    version: z.literal(1),
    kind: z.literal("keycat-keystore"),
    address: addressSchema,
    crypto: z
      .object({
        cipher: z.literal("aes-256-gcm"),
        ciphertext: b64urlBytesSchema({
          name: "ciphertext",
          length: PRIVATE_KEY_BYTES
        }),
        iv: b64urlBytesSchema({ name: "iv", length: IV_BYTES }),
        authTag: b64urlBytesSchema({
          name: "authTag",
          length: AUTH_TAG_BYTES
        }),
        kdf: z.literal("argon2id"),
        kdfparams: argon2idKdfParamsSchema,
        factors: factorsSchema,
        webauthn: webAuthnPrfMetadataSchema.optional()
      })
      .strict()
      .superRefine((value, ctx) => {
        const expectsWebAuthn = value.factors.some(
          (factor) => factor === "webauthn-prf"
        );
        if (expectsWebAuthn && value.webauthn === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["webauthn"],
            message: "webauthn metadata is required when the factor is enabled"
          });
        }
        if (!expectsWebAuthn && value.webauthn !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["webauthn"],
            message: "webauthn metadata is only valid with the webauthn-prf factor"
          });
        }
      }),
    meta: z
      .object({
        createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
          message: "createdAt must be an ISO-compatible timestamp"
        }),
        label: z.string().min(1).max(120).optional()
      })
      .strict()
  })
  .strict();

export type KeycatKeystoreV1 = z.infer<typeof keycatKeystoreV1Schema>;

export const browserWebAuthnPrf: WebAuthnPrfHandle = {
  async evaluate(request) {
    const credentials = globalThis.navigator?.credentials;
    if (!credentials?.get) {
      throw new Error("WebAuthn credentials API is unavailable.");
    }

    const credential = await credentials.get({
      publicKey: {
        challenge: toArrayBuffer(randomBytes(32)),
        rpId: request.rpId,
        allowCredentials: [
          {
            id: toArrayBuffer(request.credentialId),
            type: "public-key"
          }
        ],
        userVerification: "required",
        extensions: {
          prf: {
            eval: {
              first: toArrayBuffer(request.prfSalt)
            }
          }
        } as AuthenticationExtensionsClientInputs
      }
    });

    if (
      typeof PublicKeyCredential === "undefined" ||
      !(credential instanceof PublicKeyCredential)
    ) {
      throw new Error("WebAuthn assertion was not a public-key credential.");
    }

    const extensionResults = credential.getClientExtensionResults() as {
      prf?: {
        results?: {
          first?: ArrayBuffer;
        };
      };
    };
    const output = extensionResults.prf?.results?.first;
    if (output === undefined) {
      throw new Error("WebAuthn PRF output was unavailable.");
    }

    return new Uint8Array(output).slice();
  }
};

export function generatePrivateKey(): PrivateKeyHex {
  const privateKey = generateViemPrivateKey();
  assertValidPrivateKey(privateKey);
  return privateKey;
}

export async function createKeystore(
  options: CreateKeystoreOptions
): Promise<KeycatKeystoreV1> {
  const privateKey = options.privateKey ?? generatePrivateKey();
  const privateKeyBytes = privateKeyToBytes(privateKey);
  const kdfparams = createKdfParams(options.kdfParams);
  const iv = randomBytes(IV_BYTES);
  const webauthn = options.webauthn
    ? normalizeCreateWebAuthnOptions(options.webauthn)
    : undefined;
  const masterKey = await deriveMasterKey({
    password: options.password,
    kdfparams,
    webauthn,
    webauthnHandle: options.webauthn?.handle,
    wrapSecretErrors: false
  });

  try {
    const encrypted = await aesGcmEncrypt(masterKey, privateKeyBytes, iv);
    const keystore: KeycatKeystoreV1 = {
      version: 1,
      kind: "keycat-keystore",
      address: privateKeyToAddress(privateKey),
      crypto: {
        cipher: "aes-256-gcm",
        ciphertext: base64UrlFromBytes(encrypted.ciphertext),
        iv: base64UrlFromBytes(iv),
        authTag: base64UrlFromBytes(encrypted.authTag),
        kdf: "argon2id",
        kdfparams,
        factors: webauthn ? ["password", "webauthn-prf"] : ["password"],
        ...(webauthn
          ? {
              webauthn: {
                credentialIdB64url: webauthn.credentialIdB64url,
                rpId: webauthn.rpId,
                prfSaltB64url: webauthn.prfSaltB64url
              }
            }
          : {}),
      },
      meta: {
        createdAt: new Date().toISOString(),
        ...(options.label ? { label: options.label } : {})
      }
    };

    return keycatKeystoreV1Schema.parse(keystore);
  } finally {
    masterKey.fill(0);
    privateKeyBytes.fill(0);
  }
}

export async function unlockKeystore(
  json: string | unknown,
  secrets: UnlockKeystoreSecrets
): Promise<UnlockedKeystore> {
  const keystore = coerceKeystore(json);
  let masterKey: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;

  try {
    masterKey = await deriveMasterKey({
      password: secrets.password,
      kdfparams: keystore.crypto.kdfparams,
      webauthn: keystore.crypto.webauthn,
      webauthnHandle: secrets.webauthnHandle,
      wrapSecretErrors: true
    });
    plaintext = await aesGcmDecrypt(masterKey, {
      ciphertext: base64UrlToBytes(keystore.crypto.ciphertext),
      iv: base64UrlToBytes(keystore.crypto.iv),
      authTag: base64UrlToBytes(keystore.crypto.authTag)
    });
    return createUnlockedKeystore(plaintext, keystore.address);
  } catch (error) {
    if (error instanceof DecryptionFailedError) {
      throw error;
    }
    throw new DecryptionFailedError();
  } finally {
    masterKey?.fill(0);
    plaintext?.fill(0);
  }
}

export async function changeSecrets(
  keystoreInput: KeycatKeystoreV1 | string | unknown,
  oldSecrets: UnlockKeystoreSecrets,
  newSecrets: ChangeKeystoreNewSecrets
): Promise<KeycatKeystoreV1> {
  const keystore = coerceKeystore(keystoreInput);
  const unlocked = await unlockKeystore(keystore, oldSecrets);

  try {
    const nextWebAuthn = resolveNextWebAuthnOptions(
      keystore,
      oldSecrets,
      newSecrets
    );
    const nextKeystore = await createKeystore({
      privateKey: unlocked.privateKey,
      password: newSecrets.password,
      label: keystore.meta.label,
      webauthn: nextWebAuthn,
      kdfParams: newSecrets.kdfParams
    });
    return keycatKeystoreV1Schema.parse({
      ...nextKeystore,
      meta: keystore.meta
    });
  } finally {
    unlocked.zeroize();
  }
}

export function exportKeystoreFile(keystore: KeycatKeystoreV1): string {
  return `${JSON.stringify(keycatKeystoreV1Schema.parse(keystore), null, 2)}\n`;
}

export function parseKeystoreFile(json: string): KeycatKeystoreV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new KeystoreValidationError("Keystore file is not valid JSON.", {
      cause: error
    });
  }
  return keycatKeystoreV1Schema.parse(parsed);
}

export function validateKeystore(value: unknown): KeycatKeystoreV1 {
  return keycatKeystoreV1Schema.parse(value);
}

function coerceKeystore(value: string | unknown): KeycatKeystoreV1 {
  return typeof value === "string" ? parseKeystoreFile(value) : validateKeystore(value);
}

type NormalizedWebAuthnPrf = WebAuthnPrfMetadata & {
  credentialId: Uint8Array;
  prfSalt: Uint8Array;
};

type DeriveMasterKeyOptions = {
  password: string;
  kdfparams: Argon2idKdfParams;
  webauthn?: WebAuthnPrfMetadata;
  webauthnHandle?: WebAuthnPrfHandle;
  wrapSecretErrors: boolean;
};

async function deriveMasterKey({
  password,
  kdfparams,
  webauthn,
  webauthnHandle,
  wrapSecretErrors
}: DeriveMasterKeyOptions): Promise<Uint8Array> {
  const passwordBytes = textEncoder.encode(password);
  let input: Uint8Array<ArrayBufferLike> = passwordBytes;
  let prfOutput: Uint8Array<ArrayBufferLike> | undefined;

  try {
    if (webauthn) {
      const normalized = normalizeStoredWebAuthnMetadata(webauthn);
      const handle = webauthnHandle ?? browserWebAuthnPrf;
      prfOutput = await handle.evaluate({
        credentialId: normalized.credentialId.slice(),
        credentialIdB64url: normalized.credentialIdB64url,
        rpId: normalized.rpId,
        prfSalt: normalized.prfSalt.slice(),
        prfSaltB64url: normalized.prfSaltB64url
      });
      if (prfOutput.byteLength !== WEBAUTHN_PRF_OUTPUT_BYTES) {
        throw new Error("WebAuthn PRF output must be 32 bytes.");
      }
      input = concatBytes(passwordBytes, prfOutput);
    }

    const derived = await argon2idAsync(input, base64UrlToBytes(kdfparams.salt), {
      t: kdfparams.iterations,
      m: kdfparams.memoryKiB,
      p: kdfparams.parallelism,
      dkLen: 32
    });
    return new Uint8Array(derived);
  } catch (error) {
    if (wrapSecretErrors) {
      throw new DecryptionFailedError();
    }
    throw error;
  } finally {
    passwordBytes.fill(0);
    if (input !== passwordBytes) {
      input.fill(0);
    }
    prfOutput?.fill(0);
  }
}

function createKdfParams(overrides?: CreateKdfParams): Argon2idKdfParams {
  return argon2idKdfParamsSchema.parse({
    memoryKiB: overrides?.memoryKiB ?? DEFAULT_KDF_PARAMS.memoryKiB,
    iterations: overrides?.iterations ?? DEFAULT_KDF_PARAMS.iterations,
    parallelism: overrides?.parallelism ?? DEFAULT_KDF_PARAMS.parallelism,
    salt: base64UrlFromBytes(randomBytes(SALT_BYTES))
  });
}

function resolveNextWebAuthnOptions(
  keystore: KeycatKeystoreV1,
  oldSecrets: UnlockKeystoreSecrets,
  newSecrets: ChangeKeystoreNewSecrets
): CreateWebAuthnPrfOptions | undefined {
  if (newSecrets.webauthn === null) {
    return undefined;
  }
  if (newSecrets.webauthn !== undefined) {
    return newSecrets.webauthn;
  }
  if (!keystore.crypto.webauthn) {
    return undefined;
  }
  return {
    credentialIdB64url: keystore.crypto.webauthn.credentialIdB64url,
    rpId: keystore.crypto.webauthn.rpId,
    prfSaltB64url: keystore.crypto.webauthn.prfSaltB64url,
    handle: oldSecrets.webauthnHandle
  };
}

function normalizeCreateWebAuthnOptions(
  options: CreateWebAuthnPrfOptions
): NormalizedWebAuthnPrf {
  const credentialId = normalizeOptionalBytesPair({
    bytes: options.credentialId,
    encoded: options.credentialIdB64url,
    name: "credentialId"
  });
  if (credentialId.byteLength < 1) {
    throw new TypeError("credentialId must not be empty.");
  }

  const prfSalt =
    options.prfSalt !== undefined || options.prfSaltB64url !== undefined
      ? normalizeOptionalBytesPair({
          bytes: options.prfSalt,
          encoded: options.prfSaltB64url,
          name: "prfSalt"
        })
      : randomBytes(WEBAUTHN_PRF_SALT_BYTES);
  if (prfSalt.byteLength !== WEBAUTHN_PRF_SALT_BYTES) {
    throw new TypeError("prfSalt must be 32 bytes.");
  }

  return {
    credentialId,
    credentialIdB64url: base64UrlFromBytes(credentialId),
    rpId: options.rpId,
    prfSalt,
    prfSaltB64url: base64UrlFromBytes(prfSalt)
  };
}

function normalizeStoredWebAuthnMetadata(
  metadata: WebAuthnPrfMetadata
): NormalizedWebAuthnPrf {
  const parsed = webAuthnPrfMetadataSchema.parse({
    credentialIdB64url: metadata.credentialIdB64url,
    rpId: metadata.rpId,
    prfSaltB64url: metadata.prfSaltB64url
  });
  return {
    ...parsed,
    credentialId: base64UrlToBytes(parsed.credentialIdB64url),
    prfSalt: base64UrlToBytes(parsed.prfSaltB64url)
  };
}

function normalizeOptionalBytesPair({
  bytes,
  encoded,
  name
}: {
  bytes?: Uint8Array;
  encoded?: string;
  name: string;
}): Uint8Array {
  if (bytes === undefined && encoded === undefined) {
    throw new TypeError(`${name} is required.`);
  }
  if (bytes !== undefined && encoded !== undefined) {
    const decoded = base64UrlToBytes(encoded);
    if (!bytesEqual(bytes, decoded)) {
      throw new TypeError(`${name} byte and encoded values do not match.`);
    }
  }
  return (bytes ?? base64UrlToBytes(encoded as string)).slice();
}

async function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  iv: Uint8Array
): Promise<{ ciphertext: Uint8Array; authTag: Uint8Array }> {
  const cryptoKey = await getSubtleCrypto().importKey(
    "raw",
    toArrayBuffer(key),
    "AES-GCM",
    false,
    ["encrypt"]
  );
  const combined = new Uint8Array(
    await getSubtleCrypto().encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), tagLength: AUTH_TAG_BYTES * 8 },
      cryptoKey,
      toArrayBuffer(plaintext)
    )
  );
  return {
    ciphertext: combined.slice(0, -AUTH_TAG_BYTES),
    authTag: combined.slice(-AUTH_TAG_BYTES)
  };
}

async function aesGcmDecrypt(
  key: Uint8Array,
  encrypted: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }
): Promise<Uint8Array> {
  const cryptoKey = await getSubtleCrypto().importKey(
    "raw",
    toArrayBuffer(key),
    "AES-GCM",
    false,
    ["decrypt"]
  );
  const combined = concatBytes(encrypted.ciphertext, encrypted.authTag);
  try {
    return new Uint8Array(
      await getSubtleCrypto().decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(encrypted.iv),
          tagLength: AUTH_TAG_BYTES * 8
        },
        cryptoKey,
        toArrayBuffer(combined)
      )
    );
  } finally {
    combined.fill(0);
  }
}

function createUnlockedKeystore(
  plaintext: Uint8Array,
  expectedAddress: Address
): UnlockedKeystore {
  if (plaintext.byteLength !== PRIVATE_KEY_BYTES) {
    throw new DecryptionFailedError();
  }

  const privateKeyBytes = plaintext.slice();
  let zeroized = false;
  try {
    const privateKey = bytesToPrivateKey(privateKeyBytes);
    if (privateKeyToAddress(privateKey).toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new DecryptionFailedError();
    }
  } catch (error) {
    privateKeyBytes.fill(0);
    if (error instanceof DecryptionFailedError) {
      throw error;
    }
    throw new DecryptionFailedError();
  }

  return {
    get privateKey() {
      if (zeroized) {
        throw new Error("Unlocked keystore has been zeroized.");
      }
      return bytesToPrivateKey(privateKeyBytes);
    },
    zeroize() {
      privateKeyBytes.fill(0);
      zeroized = true;
    }
  };
}

function privateKeyToBytes(privateKey: PrivateKeyHex): Uint8Array {
  if (!/^0x[a-fA-F0-9]{64}$/u.test(privateKey)) {
    throw new TypeError("Private key must be 32 bytes of hex.");
  }
  const bytes = hexToBytes(privateKey.slice(2));
  if (!secp256k1.utils.isValidSecretKey(bytes)) {
    throw new TypeError("Private key is not valid for secp256k1.");
  }
  return bytes;
}

function bytesToPrivateKey(bytes: Uint8Array): PrivateKeyHex {
  if (!secp256k1.utils.isValidSecretKey(bytes)) {
    throw new TypeError("Private key is not valid for secp256k1.");
  }
  return `0x${bytesToHex(bytes)}`;
}

function assertValidPrivateKey(privateKey: PrivateKeyHex): void {
  privateKeyToBytes(privateKey).fill(0);
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is required.");
  }
  return subtle;
}

function randomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error("WebCrypto getRandomValues is required.");
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.byteLength;
  }
  return output;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!base64UrlPattern.test(value)) {
    throw new TypeError("Invalid base64url value.");
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
