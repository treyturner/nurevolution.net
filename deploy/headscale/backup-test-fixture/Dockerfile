FROM alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
RUN apk add --no-cache bash python3 rclone jq coreutils findutils util-linux
COPY restic /usr/bin/restic
ENTRYPOINT ["sleep","infinity"]
