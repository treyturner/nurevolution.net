# Headscale on Unraid

These files add Headscale 0.29.3 to the existing `services` Compose project on `vault.local` (`192.168.1.85`), using a dedicated Docker network named `headscale`. The owner has `172.26.0.0/16` available and already routed to Unraid by pfSense at `192.168.1.1`. The container uses `172.26.0.2`, with gateway `172.26.0.1`. No ports are bound on Unraid's host addresses.

The public name is `headscale.treyturner.info`, using the existing `*.treyturner.info` certificate in HAProxy. The embedded relay is enabled, with external relay maps disabled. The service uses SQLite and local CLI administration.

## 0. Install the host firewall before stack startup

Headscale stays managed by the existing Compose stack, with `restart: unless-stopped`. The host firewall loads synchronously from `/boot/config/go` before `emhttp`. It needs neither a running Docker daemon nor `DOCKER-USER`, a Compose profile, a separate service-start hook, or a polling loop. The owner has already verified the running container and firewall; boot persistence remains to be confirmed. Public control enrollment and authenticated relay traffic now pass.

Save [firewall.sh](firewall.sh) as the User Scripts file `/boot/config/plugins/user.scripts/scripts/isolate_headscale_network/script`. Use **LF line endings**. The owner encountered CRLF (`0d 0a`), which makes direct Bash execution reject `set -euo pipefail`, even when the editor does not display `^M`. Normalize and run the stored file directly as root:

```sh
hs_script=/boot/config/plugins/user.scripts/scripts/isolate_headscale_network/script
sed -i 's/\r$//' "$hs_script"
bash -n "$hs_script" && bash "$hs_script"
```

Expect `Headscale firewall installed.` The [User Scripts launcher](https://github.com/Squidly271/user.scripts/blob/master/source/user.scripts/usr/local/emhttp/plugins/user.scripts/startSchedule.php) strips carriage returns from a temporary copy; running successfully through that plugin does not establish that the stored file is suitable for direct Bash execution. Check again after editing if its editor saves CRLF.

Keep the other contents of `/boot/config/go` and replace its final `emhttp` section with the [boot fragment](go.example.sh):

```sh
# Load Headscale firewall before emhttp can start Docker.
if ! /bin/bash /boot/config/plugins/user.scripts/scripts/isolate_headscale_network/script; then
  logger -t headscale 'Early Headscale firewall setup failed.'
fi

# Start the Management Utility
/usr/local/sbin/emhttp
```

Set this User Script's schedule to **Disabled**; the foreground call in `go` supplies startup ordering. Unraid's [boot script](https://github.com/unraid/webgui/blob/master/etc/rc.d/rc.local) invokes `go` before the management utility starts. The selected fragment logs firewall installation failure and continues boot, so it does **not** guarantee isolation if installation fails. Confirm successful installation before enabling normal stack autostart. No reboot has yet verified this ordering on the owner's host.

The earlier `docker_started` hook and Compose profile proposal is superseded. If applied, remove only its block from `go`, its generated `/usr/local/emhttp/plugins/nurevolution.headscale/event/docker_started` file, and the proposed `headscale` profile exclusion. Once the stored script and boot call are checked, restore `restart: unless-stopped` if it was temporarily set to `no`, and manage the service through the normal stack.

The firewall applies to IPv4 packets entering Unraid from `172.26.0.0/16`, in `mangle PREROUTING`. It allows replies to incoming connections and new TCP/UDP DNS traffic to pfSense at `192.168.1.1:53`; it drops other connections initiated by Headscale, including to Unraid, other containers, the LAN, and public destinations. Incoming HAProxy and STUN requests retain their reply paths. Other containers' LAN access is unaffected. Docker bridge IPv6 is disabled; this script does not implement IPv6 filtering. Enabling it or adding outbound integrations requires revisiting the policy.

The script populates its own chain before attaching it, does not flush unrelated rules, and can be run repeatedly. It does not continuously repair a subsequently removed rule. After a reboot, Docker restart, or firewall change, verify the hook and repeat the health and blocked-connection checks:

```sh
iptables -w 5 -t mangle -C PREROUTING -s 172.26.0.0/16 -j NUREV-HS-EGRESS
iptables -w 5 -t mangle -nvxL NUREV-HS-EGRESS
curl --noproxy '*' --connect-timeout 5 -sS -o /dev/null \
  -w 'Headscale HTTP status: %{http_code}\n' http://172.26.0.2:8080/health
```

The previous `NUREV-HS-OUT` hooks in filter `DOCKER-USER` and `INPUT` were removed after the owner verified the mangle policy. They are not part of the final installation. See [firewall evidence](../../docs/milestones/evidence/M05-headscale-firewall.json) for the positive controls and blocked targets used on Unraid.

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

The dedicated network alone does not isolate Headscale from other networks. The host firewall above blocks connections initiated by its container while preserving incoming HAProxy/STUN replies and other containers' LAN access. Headscale clients receive no LAN/subnet routes from this configuration; their permitted overlay traffic is controlled separately by the access policy.

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
| Existing HAProxy HTTPS frontend | Case-insensitive Host match for `headscale.treyturner.info` with optional `:443`, using the existing wildcard certificate. Route all paths for that host to the Headscale backend.                                                                 |
| HAProxy backend                 | HTTP to **172.26.0.2:8080**. `/health` should return 200. Keep HTTP upgrades, including `tailscale-control-protocol`, intact and allow long-lived tunnels; use a backend tunnel timeout such as one hour.                                          |
| Forwarding headers              | Replace `True-Client-IP`, `X-Real-IP`, and `X-Forwarded-For` with the actual frontend peer address, and set `X-Forwarded-Proto` to `https`. The configuration trusts `192.168.1.1/32`; adjust only if the observed HAProxy backend source differs. |
| Existing bot/auth rules         | Exempt this hostname from browser challenges, bot user-agent rejection, and interactive login middleware so machine clients can enroll and maintain connections. Keep the exception scoped to this host.                                           |
| pfSense WAN UDP **3478**        | Forward directly to **172.26.0.2:3478/UDP**, with the associated pass rule. STUN does not pass through the HTTP backend.                                                                                                                           |

For local clients, a [pfSense DNS Resolver host override](https://docs.netgate.com/pfsense/en/latest/nat/reflection.html#dns-resolver-forwarder-overrides) can resolve `headscale.treyturner.info` to **192.168.1.1**. The HTTPS frontend and UDP 3478 path at that LAN address both passed on 2026-09-11. Preserve the public DNS record for external clients. If recreating the LAN UDP forward, ensure replies return through pfSense; when routing would bypass it, source NAT is needed for that scoped path. See [pfSense's explanation of the return path](https://docs.netgate.com/pfsense/en/latest/nat/reflection.html#configuring-nat-reflection).

Tailscale's [control client](https://github.com/tailscale/tailscale/blob/v1.98.10/control/controlhttp/client.go) explicitly includes `:443` in the HTTPS control-upgrade URL. The Headscale Host ACL must accept both the bare hostname and `headscale.treyturner.info:443`; use a case-insensitive regex such as `^headscale[.]treyturner[.]info(:443)?$` for backend selection and the bot-rule exception. A bare-host `/health` check passed while the port-qualified form returned 404 during rehearsal, preventing enrollment. Check both forms from an external client before retrying:

```sh
curl --fail --show-error --silent https://headscale.treyturner.info/health
curl --fail --show-error --silent \
  -H 'Host: headscale.treyturner.info:443' https://headscale.treyturner.info/health
```

The relay's encrypted traffic uses the same public HTTPS endpoint on TCP 443. Headscale verifies that relay clients belong to this network. Metrics are disabled and gRPC administration listens only on container loopback. No additional administration port needs a public route.

For optional HTTP captive-portal detection, the existing port-80 frontend can return 204 for this hostname's `/generate_204` path before its normal HTTPS redirect. This is separate from the required HTTPS control/relay route.

Verify the backend from pfSense or another host with a route to the container, then verify `https://headscale.treyturner.info/health` from outside the LAN. A 200 health response is the first check; successful client enrollment and relay traffic are the subsequent acceptance tests. Keep the DigitalOcean SSH source restriction unchanged.

## 3. Enroll the deployment clients

After the public endpoint is reachable, enroll the DigitalOcean host and a disposable test runner before changing the live GitHub deployment workflow. The [M5 access plan](../../docs/operations/headscale.md#access-and-enrollment) specifies the enrollment and verification sequence.

The policy grants `tag:nurevolution-deploy` access only to TCP 22 on `tag:nurevolution-droplet`. Empty tag-owner lists reserve registration of these roles for the administrator creating tagged keys through the local CLI. There is no default allow-all rule. Tagged key creation works without adding a human user or identity provider.

Create a short-lived, single-use droplet key only when the host is ready to consume it. Create a separate expiring, reusable, ephemeral-node key for the GitHub deployment environment. These are registration credentials, distinct from the existing SSH private key; neither a Tailscale account nor a Headscale administrator API key is needed in GitHub. Store keys directly in the destination secret store and the owner's password manager, not in these files or chat. Inactive ephemeral nodes are configured for removal after five minutes; test that cleanup instead of assuming it from configuration.

### Droplet client and key entry

The [client pin](tailscale-client.json) selects Linux/amd64 Tailscale **1.98.10**, the patched 1.98 family present in Headscale 0.29.3's [client capability table](https://github.com/juanfont/headscale/blob/v0.29.3/hscontrol/capver/capver_generated.go). Download the official tarball, compare its SHA-256 to the pin before extraction or execution, and preserve an existing installation for inspection. Both client roles now pass actual enrollment, SSH policy checks, and authenticated relay traffic; see the live evidence below.

The droplet now has this client installed at `/usr/local/bin/tailscale` and `/usr/local/sbin/tailscaled`. Its upstream systemd unit is installed at `/etc/systemd/system/tailscaled.service`, with only the daemon path changed to `/usr/local/sbin/tailscaled`. `/etc/default/tailscaled` sets `PORT="41641"` and `FLAGS="--no-logs-no-support"`. The service is enabled, with private persistent state under `/var/lib/tailscale`. After the owner corrected the proxy Host ACL, enrollment succeeded at `100.64.0.1`. The client service is active and retained that address after restart. Its single-use key file was removed after enrollment. No public SSH firewall rule changed.

The initial resource drop-in, `/etc/systemd/system/tailscaled.service.d/nurevolution-resources.conf`, is:

```ini
[Service]
Environment="GOMEMLIMIT=64MiB" "GOMAXPROCS=1"
MemoryHigh=96M
MemoryMax=128M
```

These are rehearsal bounds, not capacity acceptance. Measure the enrolled client alongside the application and backup workload. Keep the client's existing resolver behavior, subnet/exit routing, and OpenSSH configuration by enrolling with `--accept-dns=false --accept-routes=false --ssh=false` and no advertised subnet routes.

The tested [key-entry helper](enrollment-key.py) is installed as `/usr/local/sbin/nurevolution-headscale-key`. It accepts keys at a hidden interactive prompt and creates exclusive, mode-0600 files in root's mode-0700 `/run/nurevolution-enrollment` directory. It rejects existing files, symlinks, non-private directories, and malformed input. These temporary files disappear at reboot and must be removed after consumption; they are not application backup inputs. The helper does not enroll a client or send a credential anywhere by itself.

From the existing Unraid Compose directory, create the droplet key first and the deployment-runner key second:

```sh
docker compose exec -T headscale headscale preauthkeys create \
  --tags tag:nurevolution-droplet --expiration 1h

docker compose exec -T headscale headscale preauthkeys create \
  --tags tag:nurevolution-deploy --reusable --ephemeral --expiration 2160h
```

The first key permits one enrollment within one hour. The second expires after 90 days and creates temporary runner nodes; label it **Nurevolution — Headscale GitHub enrollment key** in the password manager. In the droplet's root SSH session, enter the corresponding key at each hidden prompt:

```sh
nurevolution-headscale-key droplet
nurevolution-headscale-key runner
```

Keep credential values out of chat, shell arguments, logs, commits, and artifacts. The droplet consumes its key with `--auth-key=file:/run/nurevolution-enrollment/droplet.key`; the runner key is used for the disposable client rehearsal and then stored as the deployment environment's `HEADSCALE_AUTH_KEY` secret. The owner confirmed the current runner key as ID 2, expiring on **2026-12-10 at 17:27:47 UTC**; rotate before that date. Neither key grants Headscale administrator access.

On a replacement droplet, install the pinned client and re-enroll with a fresh single-use droplet key using the existing public operator SSH route. Remove the superseded node, verify the new private address and SSH identity, and update the deployment environment before resuming promotion. The site backup does not currently restore Tailscale client state; do not assume it covers `/var/lib/tailscale` or start two hosts with the same copied client identity.

## Backup and maintenance

Add both mount directories to the Unraid backup procedure. For the simplest consistent backup, briefly stop **only this service**, capture `config` and `data` together, then start it again. Ensure it is restarted even if the backup fails. Existing website/media serving is independent of this service. A live SQLite database may have a WAL file, so copying just `db.sqlite` is insufficient.

Keep an encrypted independent copy of that backup and test a restore into a separate location. Server and relay private keys in `data` are part of the server's identity. The DigitalOcean site's backup does not include these Unraid paths. Follow [Headscale's upgrade guide](https://headscale.net/stable/setup/upgrade/) when changing the pinned version; preserve a pre-upgrade backup.

For the owner's configured `gdrive.fracturetrey` remote, follow [Headscale backup to Google Drive](../../docs/operations/headscale-backup.md). It uses the existing rclone config and restic 0.19.1, restarts Headscale before uploading, and tests a restored server without network access. Run `python3 deploy/headscale/check-backup.py /path/to/restic-0.19.1` from the repository to repeat the isolated encryption/restore and lifecycle-failure tests; Docker and a Linux/amd64 restic binary are required. No live credentials are used by that test.

## Validation performed

The pinned Linux/amd64 image passed configuration validation, policy validation, health checks, tagged reusable/ephemeral key creation and revocation, and database/server-key persistence across restart. This used UID/GID `99:100`, a read-only root, removed capabilities, and the same writable-path/resource settings. Compose syntax validation and the repository's full `pnpm verify` gate passed, including after the routed-network revision.

The earlier [disposable network check](../../docs/milestones/evidence/M05-headscale-network.json) verified declared TCP/UDP ports and absence of host bindings. It also demonstrated outbound access to a separate `nat-unprotected` peer **before** the host firewall was added.

The reproducible [firewall check](check-firewall.py) installs the actual script inside a disposable privileged container's own network namespace. It checks both legacy and nft-backed iptables frontends without `DOCKER-USER`, repeated application, incoming TCP/UDP replies, TCP/UDP DNS, blocked outbound targets, and unaffected unrelated traffic. Run it from the repository with `python3 deploy/headscale/check-firewall.py`. It requires Docker, downloads test utilities inside the disposable container, and never uses host networking, host mounts, or the host PID namespace. It does not run against the public droplet or change the Docker host's firewall.

The owner verified the live Unraid container as healthy with HTTP 200. Connections from Headscale to Unraid SSH, pfSense HTTPS, and a listening services container were blocked; the same targets were reachable from Unraid. The mangle DROP counter recorded nine packets, and health remained 200 after removing the old hooks. These results and remaining limits are recorded in [firewall evidence](../../docs/milestones/evidence/M05-headscale-firewall.json).

The owner confirmed successful direct execution after CRLF conversion and that neither the custom startup hook nor Compose profile was installed. The owner confirmed the foreground `go` call before `emhttp` and the Disabled User Script schedule. The owner recreated Headscale with the saved `restart: unless-stopped` policy; external HTTPS and the existing droplet client connection passed afterward. A later boot check remains pending. Public DNS resolves through `wan.treyturner.info` to `136.49.253.125`; the workspace's earlier lookup failure is local. Trusted HTTPS passed through WAN and pfSense LAN. Correct Tailscale STUN requests passed from the droplet over WAN and from the workspace through both paths and directly to the backend. Initial bare STUN requests omitted required SOFTWARE/FINGERPRINT attributes; their timeouts did not establish a NAT failure.

The owner applied both the hostname-scoped bot exception and the optional-`:443` Host ACL correction. Both Host forms now return 200, and actual control-protocol enrollment passed. The droplet is `100.64.0.1`; disposable clients enrolled with the deployment tag and authenticated as `nurevolution-deploy` against the original pinned SSH identity. Connections to private TCP 443 timed out while the droplet's Caddy listener was positively confirmed. SSH used the authenticated embedded DERP relay; no direct UDP path was established. Restarting the droplet client preserved its private address and SSH access. Normal runner logout removed its peer entry. The [client evidence](../../docs/milestones/evidence/M05-headscale-client.json) records these checks and interrupted-run cleanup separately. Actual GitHub promotion, loaded capacity, and both site and Headscale backup/restore have since passed; Unraid boot verification remains outstanding. See the latest M5 live evidence. See [workflow configuration and rotation](../../docs/operations/headscale.md#github-environment-and-rotation).
