# syntax=docker/dockerfile:1.7
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS build
ARG TARGETOS=linux
ARG TARGETARCH=arm64
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags='-s -w' -o /out/acme-carrier .

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/infamousjoeg/idira-swa-demo"
LABEL org.opencontainers.image.description="Foreign-trust-domain carrier (Acme Couriers, spiffe://acme.courier/...) for M7 of the Idira SWA demo"
LABEL org.opencontainers.image.licenses="MIT"
USER 65532:65532
COPY --from=build /out/acme-carrier /acme-carrier
EXPOSE 8443 8444
ENTRYPOINT ["/acme-carrier"]
