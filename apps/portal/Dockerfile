# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.24 AS build
ARG TARGETOS=linux
ARG TARGETARCH=arm64
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
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
