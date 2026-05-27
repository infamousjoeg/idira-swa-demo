# syntax=docker/dockerfile:1
FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
    go build -trimpath -ldflags='-s -w' -o /out/carrier .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/carrier /carrier
USER 65532:65532
EXPOSE 8443
ENTRYPOINT ["/carrier"]
