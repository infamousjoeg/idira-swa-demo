# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.24 AS build
ARG TARGETOS=linux
ARG TARGETARCH=arm64
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags='-s -w' -o /out/carrier .

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/infamousjoeg/idira-swa-demo"
LABEL org.opencontainers.image.description="Internal carrier app (Praetor Logistics) for the Idira SWA demo"
LABEL org.opencontainers.image.licenses="MIT"
COPY --from=build /out/carrier /carrier
USER 65532:65532
EXPOSE 8443
ENTRYPOINT ["/carrier"]
