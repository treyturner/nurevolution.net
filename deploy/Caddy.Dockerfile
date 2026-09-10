FROM caddy:2.11.4-builder@sha256:b8f9c720f13f64c13dd42db28e8f38a3fab54c11fce4d93bda26d710c448dcfd AS builder
RUN xcaddy build v2.11.4 --with github.com/caddy-dns/cloudflare@a8737d095ad5a48ca031cea6ab704057dbc2d250
FROM caddy:2.11.4@sha256:df7f1c2fb114453b951de51a98efc010db1655a92c2e86be6706714e2417a78d
ARG CADDY_POLICY_SHA256
LABEL net.nurevolution.caddy-policy=$CADDY_POLICY_SHA256
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
