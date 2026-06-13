import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  DecryptionFailedError,
  changeSecrets,
  createKeystore,
  exportKeystoreFile,
  parseKeystoreFile,
  unlockKeystore,
  type WebAuthnPrfHandle,
  type WebAuthnPrfRequest
} from "./index.js";

const testKdfParams = {
  memoryKiB: 512,
  iterations: 1,
  parallelism: 1
};

const fixturePassword = "fixture-password";
const fixturePrivateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const fixtureAddress = "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c";

class DeterministicPrf implements WebAuthnPrfHandle {
  readonly calls: WebAuthnPrfRequest[] = [];

  constructor(private readonly seed: number) {}

  async evaluate(request: WebAuthnPrfRequest): Promise<Uint8Array> {
    this.calls.push(request);
    return Uint8Array.from({ length: 32 }, (_, index) => (this.seed + index) & 0xff);
  }
}

const webAuthnOptions = (handle: WebAuthnPrfHandle) => ({
  credentialId: Uint8Array.from([1, 2, 3, 4, 5]),
  rpId: "keycat.test",
  prfSalt: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  handle
});

describe("@keycat/keystore", () => {
  test("round-trips a password-only keystore", async () => {
    const keystore = await createKeystore({
      privateKey: fixturePrivateKey,
      password: "correct-password",
      label: "Primary",
      kdfParams: testKdfParams
    });

    expect(keystore.crypto.factors).toEqual(["password"]);
    expect(keystore.crypto.webauthn).toBeUndefined();
    expect(keystore.address).toBe(fixtureAddress);

    const unlocked = await unlockKeystore(exportKeystoreFile(keystore), {
      password: "correct-password"
    });
    expect(unlocked.privateKey).toBe(fixturePrivateKey);
    unlocked.zeroize();
    expect(() => unlocked.privateKey).toThrow("zeroized");
  });

  test("round-trips a password plus WebAuthn PRF keystore", async () => {
    const prf = new DeterministicPrf(9);
    const keystore = await createKeystore({
      privateKey: fixturePrivateKey,
      password: "correct-password",
      webauthn: webAuthnOptions(prf),
      kdfParams: testKdfParams
    });

    expect(keystore.crypto.factors).toEqual(["password", "webauthn-prf"]);
    expect(keystore.crypto.webauthn).toMatchObject({
      credentialIdB64url: "AQIDBAU",
      rpId: "keycat.test"
    });

    const unlocked = await unlockKeystore(keystore, {
      password: "correct-password",
      webauthnHandle: new DeterministicPrf(9)
    });
    expect(unlocked.privateKey).toBe(fixturePrivateKey);
    unlocked.zeroize();
  });

  test("throws DecryptionFailedError for wrong password and wrong PRF output", async () => {
    const keystore = await createKeystore({
      privateKey: fixturePrivateKey,
      password: "correct-password",
      webauthn: webAuthnOptions(new DeterministicPrf(1)),
      kdfParams: testKdfParams
    });

    await expect(
      unlockKeystore(keystore, {
        password: "wrong-password",
        webauthnHandle: new DeterministicPrf(1)
      })
    ).rejects.toBeInstanceOf(DecryptionFailedError);

    await expect(
      unlockKeystore(keystore, {
        password: "correct-password",
        webauthnHandle: new DeterministicPrf(2)
      })
    ).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  test("throws DecryptionFailedError for tampered ciphertext", async () => {
    const keystore = await createKeystore({
      privateKey: fixturePrivateKey,
      password: "correct-password",
      kdfParams: testKdfParams
    });
    const tampered = structuredClone(keystore);
    const last = tampered.crypto.ciphertext.at(-1);
    tampered.crypto.ciphertext = `${tampered.crypto.ciphertext.slice(0, -1)}${
      last === "A" ? "B" : "A"
    }`;

    await expect(
      unlockKeystore(tampered, { password: "correct-password" })
    ).rejects.toBeInstanceOf(DecryptionFailedError);
  });

  test("rejects truncated files during validation", async () => {
    const keystore = await createKeystore({
      privateKey: fixturePrivateKey,
      password: "correct-password",
      kdfParams: testKdfParams
    });
    const file = exportKeystoreFile(keystore);

    expect(() => parseKeystoreFile(file.slice(0, 40))).toThrow();
  });

  test("changeSecrets rotates secrets while preserving the address", async () => {
    const original = await createKeystore({
      privateKey: fixturePrivateKey,
      password: "old-password",
      label: "Main",
      kdfParams: testKdfParams
    });

    const withPrf = await changeSecrets(
      original,
      { password: "old-password" },
      {
        password: "new-password",
        webauthn: webAuthnOptions(new DeterministicPrf(7)),
        kdfParams: testKdfParams
      }
    );

    expect(withPrf.address).toBe(original.address);
    expect(withPrf.meta).toEqual(original.meta);
    expect(withPrf.crypto.factors).toEqual(["password", "webauthn-prf"]);
    await expect(
      unlockKeystore(withPrf, { password: "old-password" })
    ).rejects.toBeInstanceOf(DecryptionFailedError);

    const unlockedWithPrf = await unlockKeystore(withPrf, {
      password: "new-password",
      webauthnHandle: new DeterministicPrf(7)
    });
    expect(unlockedWithPrf.privateKey).toBe(fixturePrivateKey);
    unlockedWithPrf.zeroize();

    const passwordOnly = await changeSecrets(
      withPrf,
      { password: "new-password", webauthnHandle: new DeterministicPrf(7) },
      { password: "final-password", webauthn: null, kdfParams: testKdfParams }
    );
    expect(passwordOnly.address).toBe(original.address);
    expect(passwordOnly.meta).toEqual(original.meta);
    expect(passwordOnly.crypto.factors).toEqual(["password"]);
    expect(passwordOnly.crypto.webauthn).toBeUndefined();

    const unlockedPasswordOnly = await unlockKeystore(passwordOnly, {
      password: "final-password"
    });
    expect(unlockedPasswordOnly.privateKey).toBe(fixturePrivateKey);
    unlockedPasswordOnly.zeroize();
  });

  test("decrypts the committed V1 fixture to a known address", async () => {
    const fixturePath = join(
      import.meta.dirname,
      "..",
      "test-fixtures",
      "keycat-v1-password.json"
    );
    const json = await readFile(fixturePath, "utf8");
    const keystore = parseKeystoreFile(json);
    const unlocked = await unlockKeystore(keystore, {
      password: fixturePassword
    });

    expect(keystore.address).toBe(fixtureAddress);
    expect(unlocked.privateKey).toBe(fixturePrivateKey);
    unlocked.zeroize();
  });

  test("uses unique salts and IVs across creates", async () => {
    const keystores = await Promise.all(
      Array.from({ length: 5 }, () =>
        createKeystore({
          privateKey: fixturePrivateKey,
          password: "same-password",
          kdfParams: testKdfParams
        })
      )
    );

    expect(new Set(keystores.map((k) => k.crypto.kdfparams.salt)).size).toBe(
      keystores.length
    );
    expect(new Set(keystores.map((k) => k.crypto.iv)).size).toBe(keystores.length);
  });
});
