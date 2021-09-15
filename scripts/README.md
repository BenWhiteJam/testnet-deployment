
# Helper scripts

## Para-register

This script parse provided k8s yaml file(with `deployment`) for docker image, parachain id, chain, generate genesis state and validation code from parsed image and make sudo parachain registration on relaychain.

### Usage

* requirements: `node v14`and newer and `docker`
* env variables can be set in `.env` file, as env at script startup or system env variables. List of env variables to set is in `para-register/env` file.
* run script `cd para-register && npm i && node index.js ./parachain.yaml`

#### Parachain docker image
Binary have to be set as `entrypoint` in docker emage. Example:
```
FROM ubuntu:20.04

workdir /basilisk

RUN useradd -m -u 1000 -U -s /bin/sh -d /basilisk basilisk && \
    mkdir -p /basilisk/.local/share/basilisk && \
    ln -s /basilisk/.local/share/basilisk /data && \
    chown -R basilisk:basilisk /basilisk

USER basilisk
ADD ./basilisk /basilisk

EXPOSE 30333 9933 9944

VOLUME ["/data"]

entrypoint [ "/basilisk/basilisk" ]
```

## Validator-register

This script make every steps required to register new relaychain validator: create account for new validator, set tokens to this account, bond tokens, generate and register `sessionKeys` and start validate.

### Usage
* requirements: `node v14`
* env variables can be set in `.env` file, as env at script startup or system env variables. List of env variables to set is in `validator-register/env` file.
* run script `cd validator-register && npm i && node index.js ws://new-validator-edpoint:9944` !!!WARN this script have to connected to new validator node, this is required to generate `sessionKeys`.
