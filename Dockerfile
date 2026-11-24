# One container for free hosts (Render etc.): metroserver (rooms) + server.js (page, search proxy, /ws forwarder).
# Only server.js's port is exposed; it forwards /ws to metroserver on localhost:8080.

FROM golang:1.25.6-alpine AS metroserver
RUN apk add --no-cache git protobuf-dev bash
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
ENV PATH="/root/go/bin:${PATH}"
# Built from our own copies (forks) of MetrolistGroup/metroserver and metroproto, which a daily GitHub
# Action keeps in sync with the originals. If the originals disappear, the copies (and this build) keep working.
# Pinned so a breaking upstream change can't silently take the site down; bump deliberately.
ARG METROSERVER_REPO=https://github.com/HarouneKESSAL/metroserver
ARG METROPROTO_REPO=https://github.com/HarouneKESSAL/metroproto
ARG METROSERVER_REF=159861612e8b8a42cc1bc7c0cc0b46395720d46f
RUN git clone "$METROSERVER_REPO" /build \
 && cd /build && git checkout "$METROSERVER_REF" \
 && git config submodule.metroproto.url "$METROPROTO_REPO" \
 && git submodule update --init --recursive
WORKDIR /build
# Room chat: our addition on top of upstream (new proto messages + Go handler). The server's own test
# suite runs here, so a patch that stops applying or breaks anything fails the build, not the live site.
COPY metroserver-chat /chat
RUN cat /chat/chat.proto >> metroproto/listentogether.proto && git apply /chat/chat.patch
RUN bash scripts/generate_proto.sh \
 && go test ./internal/server/ \
 && CGO_ENABLED=0 go build -o metroserver -ldflags="-w -s" ./cmd/metroserver

FROM node:22-alpine
WORKDIR /app
COPY --from=metroserver /build/metroserver ./
COPY index.html server.js manifest.webmanifest sw.js icon-192.png icon-512.png apple-touch-icon.png ./
ENV DATABASE_FILE=/tmp/metroserver.db
# Shown by /health, so it's easy to see which room server version is live and where it was built from.
ARG METROSERVER_REPO=https://github.com/HarouneKESSAL/metroserver
ARG METROSERVER_REF=159861612e8b8a42cc1bc7c0cc0b46395720d46f
ENV METROSERVER_BUILD="$METROSERVER_REPO@$METROSERVER_REF"
USER node
# metroserver restarts itself if it ever exits; node is the main process the host watches.
CMD ["sh", "-c", "(while true; do PORT=8080 ./metroserver; sleep 1; done) & exec node server.js"]
