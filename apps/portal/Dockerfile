# syntax=docker/dockerfile:1

# Stage 1: build the React/Vite UI from ui-src/ into a temp output.
FROM --platform=$BUILDPLATFORM node:22-slim AS ui-build
RUN corepack enable pnpm
WORKDIR /app/ui-src
COPY ui-src/package.json ui-src/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui-src/ .
# vite.config.ts outputs to ../ui/ (i.e. /app/ui/).
RUN pnpm run build

# Stage 2: build the Go portal binary.
FROM --platform=$BUILDPLATFORM golang:1.24 AS build
ARG TARGETOS=linux
ARG TARGETARCH=arm64
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Overwrite the committed ui/ with the freshly built Vite output.
COPY --from=ui-build /app/ui/ ./ui/
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags='-s -w' -o /out/portal .

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/infamousjoeg/idira-swa-demo"
LABEL org.opencontainers.image.description="Portal app for the Idira SWA demo (SPIFFE workload identity, RESOLVE SECRET flow, foreign-TD inspector)"
LABEL org.opencontainers.image.licenses="MIT"
COPY --from=build /out/portal /portal
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/portal"]
