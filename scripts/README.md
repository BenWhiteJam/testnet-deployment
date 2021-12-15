
# Helper scripts

## Para-register

This is intended to run as a service and handle single request to perform parachain registration. On register request service will pull latest `galacticcouncil/testnet-deployment` and register every parachain in `testnet-deployment/public-testnet/parachains/`. This service requires pre configured `aws-cli` and access to aws `S3` bucket with chainspec files for all parachains in `K8S_PARA_DEPLOYMENTS` directory. 

### Usage

* requirements: `node v14`and newer and `docker`
* env variables can be set in `.env` file, as env variables at script startup or system env variables. List of env variables to set is in the `para-register/env` file.
* `cd para-register && npm i`
* run service `node index.js` - start service listening on `127.0.0.1:3000`

### API
parachains registration
```
req:
  GET /register`

headers: 
  Authorization: AUTH_TOKEN
```

#### Configuration

* `RELAYCHAIN_ENDPOINT` - relaychain endpoint
* `SUDO_SEED` - sudo seed to perform parachain registration
* `API_AUTH_TOKEN` - auth token for registration req. 
* `TESTNET_DEPLOYMENT_REPO` - path to `testnet-deployment` repo to pull and read files e.g `/home/hydra/testnet-teployment`
* `K8S_PARA_DEPLOYMENTS` - path to dir with parachain deployment files e.g `public-testnet/parachains`
* `CHAINSPEC_S3_BUCKET` - S3 bucket download chainspec files e.g. `s3://hydradx-config-bucket/testnet`



#### Parachain docker image
Binary have to be set as `entrypoint` in docker image. Example:
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
