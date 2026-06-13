# @keycat/sdk

The browser artifact is `dist/widget.js`. It exposes `window.KeycatVault`:

```js
const provider = await KeycatVault.init({ chainId: 11155111, widgetUrl: "https://keycat.net/widget" });
```

The injected iframe uses:

```text
sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
allow="publickey-credentials-create *; publickey-credentials-get *"
```

`allow-scripts` is required for the wallet app, `allow-same-origin` lets WebAuthn and browser crypto run under the widget origin, `allow-forms` keeps file inputs reliable, and `allow-downloads` is required for keystore JSON downloads. The `allow` policy enables WebAuthn PRF create/get inside the embedded wallet. The bridge still pins `postMessage` traffic to the configured widget origin and the parent origin passed into `/widget`.
