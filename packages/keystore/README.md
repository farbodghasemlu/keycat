# @keycat/keystore

Pure browser crypto for Keycat V1 keystore files. This package has no chain access, no UI, and no Keycat-operated infrastructure dependency.

## Format

`KeycatKeystoreV1` is a strict, versioned JSON object:

```json
{
  "version": 1,
  "kind": "keycat-keystore",
  "address": "0x...",
  "crypto": {
    "cipher": "aes-256-gcm",
    "ciphertext": "...",
    "iv": "...",
    "authTag": "...",
    "kdf": "argon2id",
    "kdfparams": {
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1,
      "salt": "..."
    },
    "factors": ["password"]
  },
  "meta": {
    "createdAt": "2026-06-13T00:00:00.000Z",
    "label": "optional label"
  }
}
```

Binary fields are unpadded base64url. AES-GCM stores the encrypted 32-byte secp256k1 private key as `ciphertext` plus a separate 16-byte `authTag`; `iv` is 12 bytes and the Argon2id salt is 16 bytes.

For WebAuthn PRF protection, `crypto.factors` is `["password", "webauthn-prf"]` and `crypto.webauthn` is present:

```json
{
  "credentialIdB64url": "...",
  "rpId": "keycat.net",
  "prfSaltB64url": "..."
}
```

Decryption is fully self-describing: the file plus the user's password and, when enabled, the WebAuthn PRF output are sufficient.

## Cryptography

- Private keys are secp256k1 EOA owner keys.
- Addresses are derived with viem account utilities.
- The master key is `argon2id(password)` for password-only files.
- With WebAuthn PRF, the master key is `argon2id(password || prfOutput)`.
- Argon2id defaults are 64 MiB memory, 3 iterations, parallelism 1.
- AES-256-GCM runs through WebCrypto.

Wrong passwords, wrong PRF output, and authentication/tag failures all throw `DecryptionFailedError`.

## API

```ts
import {
  changeSecrets,
  createKeystore,
  exportKeystoreFile,
  generatePrivateKey,
  parseKeystoreFile,
  unlockKeystore
} from "@keycat/keystore";
```

- `generatePrivateKey()` returns a valid secp256k1 private key as `0x...`.
- `createKeystore({ privateKey?, password, label?, webauthn?, kdfParams? })` returns a `KeycatKeystoreV1`.
- `unlockKeystore(json, { password, webauthnHandle? })` returns `{ privateKey, zeroize() }`.
- `changeSecrets(keystore, oldSecrets, newSecrets)` decrypts the same private key and re-encrypts it with fresh salt and IV.
- `exportKeystoreFile(keystore)` serializes validated JSON.
- `parseKeystoreFile(json)` parses and validates strict V1 JSON.

Production code exports the WebAuthn PRF interface and a browser adapter. Test fakes should live in test files only.
