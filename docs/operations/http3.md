# Production HTTP/3 mitigation

HTTP/3 transfers from the DigitalOcean origin can stall before the browser has enough MP3 metadata to start playback. Direct MP3 playback and independent clients reproduce the transport problem. Paired captures show reordering between the droplet and client capture points; server qlogs show packets declared lost and subsequently acknowledged, with a reduced congestion window. The responsible network hop remains unconfirmed, and the DigitalOcean ticket is escalated. HTTP/3 is temporarily disabled at the production origin while that investigation continues.

## Scope and activation

The deployment renderer sets `apps.http.servers.https.protocols` to `["h1", "h2"]` and removes that server's `listen_protocols` overrides, which otherwise take precedence. This applies to existing configurations when a verified release is promoted, as well as new hosts using the initial example. It affects all routes on the shared `https` server. A separate nonterminal `@id: nurevolution-transport` route at the start of that server's route list applies a deferred `Alt-Svc: clear` header without a hostname matcher. Cache clearing has the same scope as the disabled protocol: successful TCP responses from every host on this listener clear previously advertised alternatives, including on redirects, direct media and proxied responses. Existing routes retain their relative order and handlers; other servers, TLS automation and listener addresses are preserved.

Merging the PR does not change the live edge. Promote the verified main release through the normal [deployment workflow](../DEPLOYMENT.md). The host validates the candidate, takes the existing locks and reloads Caddy through the normal transaction. A failed promotion restores the captured pre-deployment configuration, including its prior protocol settings. No Caddy image replacement or firewall change is needed; the existing Docker UDP mapping does not enable HTTP/3 when Caddy has no QUIC listener.

Explicit rollback to a pre-mitigation release uses that release's exact tooling and the current operator profile. Those older tools replace only the `@id: nurevolution` site route, preserving both the listener protocol settings and the separate transport route. Cache clearing therefore remains active even when the operator changes `webOrigin` or `mediaOrigin` before rollback, including reintroduced alternate hosts with cached HTTP/3 alternatives. Repeated promotions update the transport route without duplicating it.

The disposable `nurevolution-quic-test` droplet uses its own independently managed Caddy configuration. Leave its HTTP/3 listener and TCP/UDP test ports enabled for DigitalOcean's investigation. Do not copy the production bootstrap configuration or apply this site's release tooling there.

This controls Caddy's origin listener. Cloudflare can independently offer HTTP/3 for proxied website traffic. The DNS-only `podcast.nurevolution.net` endpoint goes directly to the origin and is covered by this mitigation. No Cloudflare zone-wide setting is changed.

## Verification after promotion

Inspect the active Caddy configuration and confirm the `https` protocol list is `h1,h2`, with no per-listener override. Its first route should be `nurevolution-transport`, with no hostname matcher. Check the Caddy container's network namespace for a TCP/443 listener and no UDP/443 listener. An existing Docker port publication alone is not evidence that Caddy is serving QUIC.

Use an HTTP/2-capable client to request a small range from the affected direct MP3:

```sh
curl --http2 --max-time 15 --range 0-1023 --dump-header - --output /dev/null \
  --write-out 'HTTP version: %{http_version}\n' \
  https://podcast.nurevolution.net/2017_11_01-Trey_Turner-Lost_In_Translation-320kbps.mp3
```

Require HTTP/2, status `206`, a 1,024-byte content range and `Alt-Svc: clear`. Repeat with `--http1.1` to check fallback compatibility. A forced HTTP/3-only request should fail on production; a client that permits automatic TCP fallback is not a negative HTTP/3 test. Keep any negative probe bounded. Verify the website, feed, downloads and direct MP3 playback with QUIC enabled in the browser. An already-stalled tab may need a reload before it receives the new TCP response and cache-clearing header.

The delivery gate checks the initial TLS listener's sockets and the generated cache-clearing header on media HEAD/range requests, redirects, proxied feed responses and another route on the same listener. It also reloads a predecessor-style site route with changed website/media hosts and no cache-clearing middleware, then verifies that both alternate hosts receive `Alt-Svc: clear` and QUIC stays disabled. Deployment tests cover existing HTTP/3 and per-listener settings, preserve unrelated servers, and exercise the normal promotion path.

## Re-enabling HTTP/3

Keep HTTP/3 enabled on the diagnostic droplet and use that host to validate any provider or upstream remedy first. Restore production HTTP/3 through a reviewed follow-up that updates both the renderer's protocol policy and initial configuration, and explicitly removes the retained `@id: nurevolution-transport` route from existing configurations. Deleting only the code that generates that route would leave `Alt-Svc: clear` active. Verify sustained transfers on the previously affected external paths before promotion.

Reverting application code alone does not necessarily re-enable HTTP/3: older release tools preserve the current listener settings. A deliberate protocol update is required. Preserve the usual locks, candidate validation, graceful reload and rollback procedure for any operator-applied edge change.
