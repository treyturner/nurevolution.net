FROM alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
RUN apk add --no-cache python3 openssh openssl iproute2 ca-certificates \
    && adduser -D -u 2000 fixture && passwd -d fixture
ENTRYPOINT ["sleep", "infinity"]
