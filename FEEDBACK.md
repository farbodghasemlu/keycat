# Developer feedback

We spent the week living inside all three stacks to build Keycat, a keystore wallet with email recovery. Here is the candid version of how that went, the parts we loved and the parts that cost us time. Hopefully some of it is useful for the docs.

## MetaMask Smart Accounts Kit

The best decision we made was betting that the smart account signer was pluggable, and it was. Our whole premise is a keystore file acting as the owner key, and the Kit let that key sign without ever pretending to be the MetaMask extension. That signer agnostic design is the reason this project exists. We almost did not try it, because we assumed we would be locked into MetaMask's own auth, and nothing up front told us otherwise. If we could change one thing, it would be to lead with that in the docs. A line as simple as "bring your own signer, here is the interface" would make people attempt more ambitious ideas.

Where we actually lost a day was rotating the owner of a Hybrid deleGator. Recovery is the heart of our product and it has to swap the account's owner key, but the function that does it and the authorization it expects were not clear from the guides. We ended up reading the deleGator source to find the real call and to work out how to grant our recovery controller permission to make it. A short page titled something like "changing the owner signer" with the exact method, who is allowed to call it, and how to delegate that right would have saved most of that day.

ERC-7710 was good once we found the caveat builders, but the examples lean on full app scenarios. A tiny copyable snippet for the raw case, delegate to address X, cap value at Y, expire at Z, would help a lot of teams who just want the scoping primitive without the surrounding tutorial.

## 1Shot permissionless relayer

The no signup, no API key model is exactly right, and for us it was load bearing. We run no backend, so we could not have integrated gas any other way. That deserves to be called out as a real strength, because most relayers assume you have a server with secrets.

The thing that tripped us up: we first designed gasless mode to delegate to a fresh in memory session key and then have the relayer submit on its behalf. But `relayer_send7710Transaction` takes `permissionContext` and `executions` and has no field for an arbitrary session key signature. After rereading, the intended pattern is to delegate to the relayer's advertised target address from its capabilities. That is cleaner than what we tried, and once we saw it the code got simpler. We just wish the quickstart said it in one blunt sentence: delegate to the relayer's redeemer, not to your own key. We lost an evening assuming the wrong shape.

Webhooks were easy to wire and we preferred them to polling, but the payload schema in the docs was thinner than what actually arrives. A documented example payload for each status value would remove the guesswork.

## Venice AI

Privacy first inference is a great fit for a wallet, since transaction details are sensitive, and the explanations were clear enough to flag an unlimited token approval in plain language, which is exactly the safety win we were after. No complaints about the model.

The friction was x402. We came in from the MetaMask x402 buyer with delegations guide, expecting the Venice chat endpoint to answer with a 402 challenge carrying `extra.assetTransferMethod = "erc7710"` for per request settlement. Venice's public x402 guide instead documents `X-Sign-In-With-X` plus a prepaid USDC balance you top up. Both are reasonable, but they are two different mental models, and the cook off framing of "combine Venice with x402 and ERC-7710" points at the per request one. We ended up running our per request x402 and 7710 rail against the MetaMask reference seller for the delegated payment piece, and calling Venice through its real prepaid path for the actual inference. It works and it is honest, but it took a while to figure out that the two flows were not the same thing. One page reconciling Venice's x402 with the MetaMask per request 402 and erc7710 flow, even just "here is what we support today, here is what is coming," would clear this up for everyone in this event.

## On the cook off itself

It took us two reads of the rules to notice that the three sponsor bonuses each gate on qualifying for a main track first. We assumed for a while that using all three tools would automatically place us somewhere. Stating near the top that the path is "qualify for one main track, then the Venice and 1Shot bonuses stack on top" would help teams aim correctly from day one instead of day three.

Thanks for running this. Account abstraction, permissionless relaying, and pay per use inference together really is a new design space, and we would not have landed on the keystore wallet with email recovery idea without being pushed to use all three at once.