# One container for free hosts (Render etc.): metroserver (rooms) + server.js (page, search proxy, /ws forwarder).
# Only server.js's port is exposed; it forwards /ws to metroserver on localhost:8080.

FROM golang:1.25.6-alpine AS metroserver
RUN apk add --no-cache git protobuf-dev bash
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
ENV PATH="/root/go/bin:${PATH}"
# Pinned so a breaking upstream change can't silently take the site down; bump deliberately.
ARG METROSERVER_REF=159861612e8b8a42cc1bc7c0cc0b46395720d46f
RUN git clone https://github.com/MetrolistGroup/metroserver /build \
 && cd /build && git checkout "$METROSERVER_REF" && git submodule update --init --recursive
WORKDIR /build
RUN bash scripts/generate_proto.sh \
 && CGO_ENABLED=0 go build -o metroserver -ldflags="-w -s" ./cmd/metroserver

FROM node:22-alpine
WORKDIR /app
COPY --from=metroserver /build/metroserver ./
COPY index.html server.js manifest.webmanifest sw.js icon-192.png icon-512.png apple-touch-icon.png ./
ENV DATABASE_FILE=/tmp/metroserver.db
USER node
# metroserver restarts itself if it ever exits; node is the main process the host watches.
CMD ["sh", "-c", "(while true; do PORT=8080 ./metroserver; sleep 1; done) & exec node server.js"]
