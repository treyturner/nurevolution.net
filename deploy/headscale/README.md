# Headscale on Unraid

These files add Headscale 0.29.3 to the existing `services` Compose project on `vault.local` (`192.168.1.85`), using a dedicated Docker network named `headscale`. The owner has `172.26.0.0/16` available and already routed to Unraid by pfSense at `192.168.1.1`. The container uses `172.26.0.2`, with gateway `172.26.0.1`. No ports are bound on Unraid's host addresses.

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

For an existing installation using the earlier shared-network template, apply the Compose/network update below using the existing configuration and data directories.

Copy the `headscale` service from [compose.example.yaml](compose.example.yaml) into the existing Compose file's `services` section, and add its `headscale` network definition alongside the existing networks. Leave the existing `services` network and its containers unchanged. Confirm the new network name and subnet are still unused before creating them. Attach Headscale only to `headscale`; its address is fixed at `172.26.0.2`.

The network uses Docker's `routed` gateway mode. Its two `ports` entries allow direct routing to container TCP 8080 and UDP 3478; they have no `published` host-port value. **Keep those entries:** routed mode otherwise filters the ports even though pfSense has a route. Unlike the existing `services` network's `nat-unprotected` mode, undeclared ports are filtered. See [Docker's gateway modes](https://docs.docker.com/engine/network/port-publishing/#gateway-modes).

The owner prefers containers reachable from the LAN and has not requested additional Unraid firewall rules. This setup preserves that model. The dedicated network separates addressing and configuration; it is not a source-address firewall or a complete LAN security boundary. The local test confirmed that Headscale can still reach a peer's listening ports on a separate `nat-unprotected` network. HAProxy's public hostname rules do not filter traffic between containers on Unraid. Stronger separation would require additional host/network firewall rules, which this setup does not install. Headscale clients receive no LAN/subnet routes from this configuration.

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

If Headscale is already running, validate configuration with `docker compose exec -T headscale headscale configtest` instead of starting a second `compose run` container with the same fixed IP. Apply this network change with `docker compose up -d --no-deps headscale`; the service is recreated with its existing data mounts. Verify the resulting network and absence of host-port bindings:

```sh
docker network inspect headscale --format 'Driver={{.Driver}} IPAM={{json .IPAM.Config}} Options={{json .Options}}'
docker compose ps -q headscale | xargs -r docker inspect --format '{{json .NetworkSettings.Ports}}'
```

Expect `routed`, subnet `172.26.0.0/16`, and an empty `HostPort` for each of `8080/tcp` and `3478/udp`. A numeric host port indicates that the intended routed setup was not applied.

The service is intentionally plain HTTP behind HAProxy. A log warning that `server_url` uses HTTPS while the internal listener does not use TLS is expected in this arrangement. The public endpoint still requires a trusted certificate.

## 2. Route the hostname and relay

Use the Headscale container's fixed address **`172.26.0.2`** below. The existing pfSense route for `172.26.0.0/16` must use Unraid as its next hop. Routed mode also preserves the container's source IP for outbound connections; verify that the existing pfSense rules/outbound NAT cover this subnet where needed.

| Entry point                     | Destination / setting                                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare DNS                  | `headscale.treyturner.info` points to the current pfSense WAN address, **DNS-only**. Only add an AAAA record if the corresponding IPv6 route works.                                                                                                |
| Existing HAProxy HTTPS frontend | Exact Host match for `headscale.treyturner.info`, using the existing wildcard certificate. Route all paths for that host to the Headscale backend.                                                                                                 |
| HAProxy backend                 | HTTP to **172.26.0.2:8080**. `/health` should return 200. Keep HTTP upgrades, including `tailscale-control-protocol`, intact and allow long-lived tunnels; use a backend tunnel timeout such as one hour.                                          |
| Forwarding headers              | Replace `True-Client-IP`, `X-Real-IP`, and `X-Forwarded-For` with the actual frontend peer address, and set `X-Forwarded-Proto` to `https`. The configuration trusts `192.168.1.1/32`; adjust only if the observed HAProxy backend source differs. |
| Existing bot/auth rules         | Exempt this hostname from browser challenges, bot user-agent rejection, and interactive login middleware so machine clients can enroll and maintain connections. Keep the exception scoped to this host.                                           |
| pfSense WAN UDP **3478**        | Forward directly to **172.26.0.2:3478/UDP**, with the associated pass rule. STUN does not pass through the HTTP backend.                                                                                                                           |

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

The pinned Linux/amd64 image passed configuration validation, policy validation, health checks, tagged reusable/ephemeral key creation and revocation, and database/server-key persistence across restart. This used UID/GID `99:100`, a read-only root, removed capabilities, and the same writable-path/resource settings. Compose syntax validation and the repository's full `pnpm verify` gate passed, including after the routed-network revision.

A separate [disposable network check](../../docs/milestones/evidence/M05-headscale-network.json) uses the prepared Compose network and port declarations with fixture listeners. It verifies that the declared TCP/UDP ports are reachable from another bridge, undeclared listening ports are filtered, and Docker allocates no host ports. It also records that connections toward a separate `nat-unprotected` peer remain possible; the configuration does not claim otherwise. This is separate from the later Headscale client policy test.

These checks used disposable local Docker volumes. Live Unraid network routing, HAProxy upgrades/TLS, client enrollment, allowed/denied network traffic, relay connectivity, restore, and GitHub deployment still need testing.
