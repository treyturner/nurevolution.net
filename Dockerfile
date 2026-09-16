FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
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
