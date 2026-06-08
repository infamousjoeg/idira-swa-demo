# syntax=docker/dockerfile:1.7
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/acme-carrier .

FROM gcr.io/distroless/static-debian12:nonroot
USER 65532:65532
COPY --from=build /out/acme-carrier /acme-carrier
EXPOSE 8443 8444
ENTRYPOINT ["/acme-carrier"]
