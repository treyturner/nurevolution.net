FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
ARG RELEASE_COMMIT
RUN node -e 'if (!/^[a-f0-9]{40}$/.test(process.argv[1])) process.exit(1)' "$RELEASE_COMMIT"
LABEL org.opencontainers.image.source="https://github.com/treyturner/nurevolution.net" \
      org.opencontainers.image.revision="$RELEASE_COMMIT"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NUREVOLUTION_RELEASE=$RELEASE_COMMIT
WORKDIR /app
COPY --chown=node:node .output/ .output/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", ".output/server/index.mjs"]
