# Headscale on Unraid

These files add Headscale 0.29.3 to the existing `services` Compose project on `vault.local` (`192.168.1.85`). pfSense at `192.168.1.1` routes directly to the container's address on the existing `services` network. There are no published container ports.

The public name is `headscale.treyturner.info`, using the existing `*.treyturner.info` certificate in HAProxy. The embedded relay is enabled, with external relay maps disabled. The service uses SQLite and local CLI administration.

## 1. Place the files and add the service

First check that `/mnt/cache/appdata/headscale` is unused and the Compose project has no existing `headscale` service. Preserve and inspect anything already there before proceeding. For a fresh directory, run as root on Unraid:

```sh
mkdir -m 0700 /mnt/cache/appdata/headscale &&
  mkdir -m 0700 /mnt/cache/appdata/headscale/config /mnt/cache/appdata/headscale/data &&
  chown 99:100 /mnt/cache/appdata/headscale /mnt/cache/appdata/headscale/config /mnt/cache/appdata/headscale/data
```

Save [config.example.yaml](config.example.yaml) as `/mnt/cache/appdata/headscale/config/config.yaml`, and [policy.example.json](policy.example.json) as `/mnt/cache/appdata/headscale/config/policy.json`. Then set their ownership and permissions:

```sh
chown 99:100 /mnt/cache/appdata/headscale/config/config.yaml /mnt/cache/appdata/headscale/config/policy.json
chmod 0600 /mnt/cache/appdata/headscale/config/config.yaml /mnt/cache/appdata/headscale/config/policy.json
```

Copy the `headscale` service from [compose.example.yaml](compose.example.yaml) into the existing Compose file's `services` section. Keep the existing definition for the `services` network; if that network uses a different key within the Compose file, use that key in this service's `networks` list. Preserve existing services and network settings. Follow the project's existing approach to assigning a stable container address, since pfSense/HAProxy will target that address directly.

The pinned container runs as Unraid's `99:100` user/group with a read-only root filesystem. Its configuration mount is read-only; its database and private keys live in the writable `data` mount. The 256 MiB cap is an initial bound for this home service, separate from the DigitalOcean application's memory profile.

From the existing Compose project's directory, using its usual file/project flags if needed:

```sh
docker compose config --quiet &&
  docker compose run --rm --no-deps headscale configtest &&
  docker compose up -d --no-deps headscale
```

Then check the service:

```sh
docker compose exec -T headscale headscale health
docker compose exec -T headscale headscale policy check --file /etc/headscale/policy.json
docker compose logs --tail 30 headscale
```

The service is intentionally plain HTTP behind HAProxy. A log warning that `server_url` uses HTTPS while the internal listener does not use TLS is expected in this arrangement. The public endpoint still requires a trusted certificate.

## 2. Route the hostname and relay

Use the Headscale container's stable address on `services` below, not Unraid's `192.168.1.85` host address.

| Entry point                     | Destination / setting                                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare DNS                  | `headscale.treyturner.info` points to the current pfSense WAN address, **DNS-only**. Only add an AAAA record if the corresponding IPv6 route works.                                                                                                |
| Existing HAProxy HTTPS frontend | Exact Host match for `headscale.treyturner.info`, using the existing wildcard certificate. Route all paths for that host to the Headscale backend.                                                                                                 |
| HAProxy backend                 | HTTP to the Headscale container's address, TCP **8080**. `/health` should return 200. Keep HTTP upgrades, including `tailscale-control-protocol`, intact and allow long-lived tunnels; use a backend tunnel timeout such as one hour.              |
| Forwarding headers              | Replace `True-Client-IP`, `X-Real-IP`, and `X-Forwarded-For` with the actual frontend peer address, and set `X-Forwarded-Proto` to `https`. The configuration trusts `192.168.1.1/32`; adjust only if the observed HAProxy backend source differs. |
| Existing bot/auth rules         | Exempt this hostname from browser challenges, bot user-agent rejection, and interactive login middleware so machine clients can enroll and maintain connections. Keep the exception scoped to this host.                                           |
| pfSense WAN UDP **3478**        | Forward directly to the Headscale container's address, UDP **3478**, with the associated pass rule. STUN does not pass through the HTTP backend.                                                                                                   |

The relay's encrypted traffic uses the same public HTTPS endpoint on TCP 443. Headscale verifies that relay clients belong to this network. Metrics are disabled and gRPC administration listens only on container loopback. No additional administration port needs a public route.

For optional HTTP captive-portal detection, the existing port-80 frontend can return 204 for this hostname's `/generate_204` path before its normal HTTPS redirect. This is separate from the required HTTPS control/relay route.

Verify the backend from pfSense or another host with a route to the container, then verify `https://headscale.treyturner.info/health` from outside the LAN. A 200 health response is the first check; successful client enrollment and relay traffic are the subsequent acceptance tests. Keep the DigitalOcean SSH source restriction unchanged.

## 3. Enroll the deployment clients

After the public endpoint is reachable, enroll the DigitalOcean host and a disposable test runner before changing the live GitHub deployment workflow. The [M5 access plan](../../docs/operations/headscale.md#access-and-enrollment) specifies the enrollment and verification sequence.

The policy grants `tag:nurevolution-deploy` access only to TCP 22 on `tag:nurevolution-droplet`. Empty tag-owner lists reserve registration of these roles for the administrator creating tagged keys through the local CLI. There is no default allow-all rule. Tagged key creation works without adding a human user or identity provider.

Create a short-lived, single-use droplet key only when the host is ready to consume it. Create a separate expiring, reusable, ephemeral-node key for the GitHub deployment environment. These are registration credentials, distinct from the existing SSH private key; neither a Tailscale account nor a Headscale administrator API key is needed in GitHub. Store keys directly in the destination secret store and the owner's password manager, not in these files or chat. Inactive ephemeral nodes are configured for removal after five minutes; test that cleanup instead of assuming it from configuration.

## Backup and maintenance

Add both mount directories to the Unraid backup procedure. For the simplest consistent backup, briefly stop **only this service**, capture `config` and `data` together, then start it again. Ensure it is restarted even if the backup fails. Existing website/media serving is independent of this service. A live SQLite database may have a WAL file, so copying just `db.sqlite` is insufficient.

Keep an encrypted independent copy of that backup and test a restore into a separate location. Server and relay private keys in `data` are part of the server's identity. The DigitalOcean site's backup does not include these Unraid paths. Follow [Headscale's upgrade guide](https://headscale.net/stable/setup/upgrade/) when changing the pinned version; preserve a pre-upgrade backup.

## Validation performed

The pinned Linux/amd64 image passed configuration validation, policy validation, health checks, tagged reusable/ephemeral key creation and revocation, and database/server-key persistence across restart. This used UID/GID `99:100`, a read-only root, removed capabilities, and the same writable-path/resource settings. Compose syntax validation and the repository's full `pnpm verify` gate passed. All 35 local links in the updated setup/operations documents resolve.

These checks used disposable local Docker volumes. Live Unraid network routing, HAProxy upgrades/TLS, client enrollment, allowed/denied network traffic, relay connectivity, restore, and GitHub deployment still need testing.
