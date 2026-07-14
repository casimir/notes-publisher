FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /opt/publisher .

FROM alpine:3
RUN apk add --no-cache diffutils
COPY --from=build /opt/publisher /opt/publisher
ENTRYPOINT ["/opt/publisher"]
