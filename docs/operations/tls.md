# TLS and preview rehearsal

Caddy 2.11.4 and the Cloudflare DNS module are pinned in [Caddy.Dockerfile](../../deploy/Caddy.Dockerfile). The tested image is published by digest alongside the app. The initial JSON uses Let's Encrypt staging so setup errors do not consume production issuance limits. Its DNS-01 issuer can validate canonical hosts before their public A/AAAA records move. Confirm zone ownership and current rules first.

Configure `CLOUDFLARE_API_TOKEN` only on the edge, scoped to DNS edits for this zone. Persist Caddy's `/data` and `/config` directories. Add the generated site route, validate the entire edge configuration, and exercise staging issuance. Once staging works, remove the staging `ca` override to use the production issuer; validate/reload, verify certificate chain/hostname/expiry, and record issuance. Never disable TLS verification to make acceptance pass.

Recreate the edge container as an explicit host rehearsal while preserving its state; verify the same trusted certificate and continued application/media routing afterwards. This shared-edge restart is separate from ordinary application deployments and must account for other sites. Check certificate storage permissions and renewal configuration; a fresh certificate alone does not prove a future renewal occurred. Back up encrypted ACME account/certificate data as part of host recovery.

Cloudflare website SSL mode must be Full (strict). Keep feed, APIs, HTML and download redirects out of broad cache rules and bot challenges; preserve origin conditional feed semantics. Leave the media hostname DNS-only. Cache bypass alone does not remove large MP3 transfers from Cloudflare's proxy.

Preview sends `X-Robots-Tag: noindex, nofollow` and preserves canonical metadata. Its saved enclosure/artwork URLs may still reach the old production host. To prove the candidate serves them, use an explicit hostname-to-candidate-IP override with the canonical hostname and trusted certificate. For example:

```sh
curl --resolve podcast.nurevolution.net:443:CANDIDATE_IP \
  --head https://podcast.nurevolution.net/EXACT_ENCODED_MP3_PATH
```

Use a controlled resolver/profile for a browser or podcast client, documenting which origin each observation reached. Do not submit preview to podcast directories. Repeat external public-domain feed/client acceptance after M6 cutover; no production A/AAAA changes belong to this rehearsal.
