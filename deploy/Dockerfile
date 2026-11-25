FROM golang:1.27.4-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY migrations/ migrations/
RUN mkdir -p /out/tenant-credentials && chmod 700 /out/tenant-credentials
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/server ./cmd/server \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/crmfctl ./cmd/crmfctl

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
COPY --from=build /out/crmfctl /crmfctl
COPY --from=build --chown=65532:65532 /out/tenant-credentials /tenant-credentials
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/server"]
CMD ["api"]
