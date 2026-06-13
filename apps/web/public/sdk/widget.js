"use strict";
(function () {
    var SDK_SOURCE = "keycat-sdk";
    var WIDGET_SOURCE = "keycat-widget";
    var DEFAULT_WIDGET_URL = "https://keycat.net/widget";
    var DEFAULT_CHAIN_ID = 11155111;
    var EIP6963_EVENT = "eip6963:announceProvider";
    var EIP6963_REQUEST_EVENT = "eip6963:requestProvider";
    var ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%231f8a6b'/%3E%3Cpath d='M16 25 25 10l7 13 7-13 9 15v22H16z' fill='%23fffefa'/%3E%3Cpath d='M24 35h4v4h-4zm12 0h4v4h-4zm-11 12h14' stroke='%23182322' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E";
    var state = null;
    var listeners = {};
    var requestCounter = 0;
    function init(options) {
        var settings = normalizeOptions(options || {});
        var key = settings.widgetUrl.href + ":" + settings.chainId;
        if (state && state.key === key) {
            announce(state.provider);
            return Promise.resolve(state.provider);
        }
        if (state) {
            state.destroy();
            state = null;
        }
        var frame = document.createElement("iframe");
        frame.title = "Keycat wallet";
        frame.src = settings.widgetUrl.href;
        frame.sandbox = "allow-scripts allow-same-origin allow-forms allow-downloads";
        frame.allow = "publickey-credentials-create *; publickey-credentials-get *";
        frame.referrerPolicy = "origin";
        frame.style.position = "fixed";
        frame.style.inset = "0";
        frame.style.width = "100%";
        frame.style.height = "100%";
        frame.style.border = "0";
        frame.style.zIndex = "2147483647";
        frame.style.display = "none";
        frame.style.background = "transparent";
        document.documentElement.appendChild(frame);
        var pending = {};
        var widgetOrigin = settings.widgetUrl.origin;
        function setVisible(visible) {
            frame.style.display = visible ? "block" : "none";
        }
        function handleMessage(event) {
            var data = event.data;
            if (event.origin !== widgetOrigin || !isRecord(data)) {
                return;
            }
            if (data.source !== WIDGET_SOURCE) {
                return;
            }
            if (data.ui === "visible") {
                setVisible(true);
                return;
            }
            if (data.ui === "hidden") {
                setVisible(false);
                return;
            }
            if (typeof data.event === "string") {
                emit(data.event, Array.isArray(data.params) ? data.params : []);
                return;
            }
            if (typeof data.id !== "string" || !pending[data.id]) {
                return;
            }
            var deferred = pending[data.id];
            delete pending[data.id];
            if (isRecord(data.error)) {
                deferred.reject(toProviderError(data.error));
            }
            else {
                deferred.resolve(data.result);
            }
        }
        function post(args) {
            var id = createRequestId();
            var target = frame.contentWindow;
            if (!target) {
                return Promise.reject(createError(4900, "Keycat iframe is unavailable."));
            }
            var promise = new Promise(function (resolve, reject) {
                pending[id] = { resolve: resolve, reject: reject };
            });
            target.postMessage({
                source: SDK_SOURCE,
                id: id,
                origin: window.location.origin,
                method: args.method,
                params: args.params
            }, widgetOrigin);
            return promise;
        }
        var provider = {
            request: function (args) {
                if (!args || typeof args.method !== "string") {
                    return Promise.reject(createError(-32602, "Provider request requires a method."));
                }
                var interactive = isInteractiveMethod(args.method);
                if (interactive) {
                    setVisible(true);
                }
                return post(args).finally(function () {
                    if (interactive) {
                        setVisible(false);
                    }
                });
            },
            on: function (event, listener) {
                if (!listeners[event]) {
                    listeners[event] = [];
                }
                listeners[event].push(listener);
            },
            removeListener: function (event, listener) {
                var eventListeners = listeners[event] || [];
                listeners[event] = eventListeners.filter(function (candidate) {
                    return candidate !== listener;
                });
            }
        };
        function destroy() {
            window.removeEventListener("message", handleMessage);
            window.removeEventListener(EIP6963_REQUEST_EVENT, requestAnnouncement);
            frame.remove();
            Object.keys(pending).forEach(function (id) {
                pending[id].reject(createError(4900, "Keycat bridge closed."));
                delete pending[id];
            });
        }
        function requestAnnouncement() {
            announce(provider);
        }
        window.addEventListener("message", handleMessage);
        window.addEventListener(EIP6963_REQUEST_EVENT, requestAnnouncement);
        state = { key: key, provider: provider, destroy: destroy };
        announce(provider);
        return Promise.resolve(provider);
    }
    function announce(provider) {
        var detail = {
            info: {
                uuid: "f2c9f3a2-9bb1-4df4-8a08-70d98f6d6049",
                name: "Keycat",
                icon: ICON,
                rdns: "net.keycat"
            },
            provider: provider
        };
        window.dispatchEvent(new CustomEvent(EIP6963_EVENT, { detail: detail }));
    }
    function normalizeOptions(options) {
        var script = document.currentScript;
        var dataset = script instanceof HTMLScriptElement ? script.dataset : {};
        var chainId = Number(options.chainId || dataset.chainId || DEFAULT_CHAIN_ID);
        var widgetUrl = new URL(options.widgetUrl || dataset.widgetUrl || DEFAULT_WIDGET_URL, window.location.href);
        widgetUrl.searchParams.set("chainId", String(chainId));
        widgetUrl.searchParams.set("keycatOrigin", window.location.origin);
        return { chainId: chainId, widgetUrl: widgetUrl };
    }
    function createRequestId() {
        requestCounter += 1;
        var random = "";
        if (window.crypto && window.crypto.getRandomValues) {
            var bytes = new Uint32Array(2);
            window.crypto.getRandomValues(bytes);
            random = bytes[0].toString(36) + bytes[1].toString(36);
        }
        else {
            random = Math.random().toString(36).slice(2);
        }
        return Date.now().toString(36) + "-" + requestCounter.toString(36) + "-" + random;
    }
    function emit(event, params) {
        (listeners[event] || []).forEach(function (listener) {
            listener.apply(null, params);
        });
    }
    function isInteractiveMethod(method) {
        return (method === "eth_requestAccounts" ||
            method === "personal_sign" ||
            method === "eth_signTypedData_v4" ||
            method === "eth_sendTransaction");
    }
    function toProviderError(error) {
        return createError(typeof error.code === "number" ? error.code : -32603, typeof error.message === "string" ? error.message : "Keycat request failed.", error.data);
    }
    function createError(code, message, data) {
        var error = new Error(message);
        error.name = "KeycatProviderError";
        error.code = code;
        if (data !== undefined) {
            error.data = data;
        }
        return error;
    }
    function isRecord(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    window.KeycatVault = {
        init: init
    };
    init({}).catch(function () {
        state = null;
    });
})();
//# sourceMappingURL=widget.js.map