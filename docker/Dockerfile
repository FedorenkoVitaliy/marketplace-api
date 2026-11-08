FROM node:22-slim AS build
WORKDIR /app
COPY docker/server.mjs ./server.mjs
RUN --mount=type=secret,id=npmtoken \
    token="$(cat /run/secrets/npmtoken)" \
    && test -n "$token" \
    && test -s ./server.mjs

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build /app/server.mjs ./server.mjs
USER 65532
ENV PORT=8080
EXPOSE 8080
CMD ["server.mjs"]
