const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const shell = require('shelljs');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

let api;
let keyring;

const RELAYCHAIN_ENDPOINT=process.env.RELAYCHAIN_ENDPOINT;
const SUDO_SEED=process.env.SUDO_SEED;
const API_AUTH_TOKEN=process.env.API_AUTH_TOKEN;

const GIT_REPO = process.env.TESTNET_DEPLOYMENT_REPO;
const K8S_PARA_DEPLOYMENTS = process.env.K8S_PARA_DEPLOYMENTS;

const express = require('express');
const app = express();

app.use(express.json());

app.get('/register', async function (req, res) {
  if (req.headers.authorization != API_AUTH_TOKEN) {
    return res.status(401).end();
  };

  try {
    await doParachainRegistration();
    res.status(204).end();  
  } catch(err) {
    console.log(err);
    
    res.status(500).send(err.message).end();
  }

  cleanupTmpDir()
});


(async () => {
  const wsProvider = new WsProvider(RELAYCHAIN_ENDPOINT);
  api = await ApiPromise.create({ provider: wsProvider });

  const [ch, nodeVersion] = await Promise.all([                 
    api.rpc.system.chain(),                                        
    api.rpc.system.version()                                       
  ]);                                                              

  console.log(`Connected to relay chain: ${ch} ${nodeVersion}`);

  app.listen(3000, () => {
    console.log('listenning on: 127.0.0.1:3000');
  });
})()

async function doParachainRegistration() {
  updateRepo();

  let paraDeployments = findParachainDeployments();
  
  const keyring = new Keyring({ type: 'sr25519' });
  const root = keyring.addFromUri(SUDO_SEED);

  ecrLogin();
  for (const deployment of paraDeployments) {
    const { paraId, chainParam, image, cmd } = parseParaInfoFromDeployment(deployment);

    const chain = downloadChainspecAndReturnChain(chainParam);

    const { state, wasm } = getParaStateWasm(chain, paraId, image, cmd);

    await registerParachain(paraId, state, wasm, root);

    await sudo(api.tx.paras.forceQueueAction(paraId), root);

    console.log(`-- parachain ${paraId} registered --`);
  }
}

function cleanupTmpDir() {
  console.log(`Log: cleanupTmpDir()`);
  const rmCmd = `rm -rf ./tmp/*`;

  const rmCmdOut = shell.exec(rmCmd, { silent: true});
  if (rmCmdOut.code !== 0) {
    console.log(`Error: cleanup tmp dir. \n\t${rmCmdOut.stderr}`);
    throw new Error(`Error cleanup tmp dir`);
  }
}

function downloadChainspecAndReturnChain(chainParam) {
  console.log(`Log: downloadChainspecAndReturnChain()`);
  if (/.json$/.test(chainParam)) {
    let lastSlash = chainParam.lastIndexOf('/') + 1;

    const specFile = chainParam.substr(lastSlash);

    const s3DownloadCmd = `aws s3 cp ${process.env.CHAINSPEC_S3_BUCKET}/${specFile} ./tmp/${specFile}`;
    const s3DownloadOut = shell.exec(s3DownloadCmd, { silent: true});
    if (s3DownloadOut.code !== 0) {
      console.log(`Error: Failed to download chainspec. \n\t${s3DownloadOut.stderr}`);
      throw new Error('Fialed to download chainspec');
    }

    return `./tmp/${specFile}`;
  } else {
    return chainParam;
  }
}

function updateRepo() {
  console.log(`Log: updateRepo()`);
  let cmd = `cd ${GIT_REPO} && git pull`;

  const stateOut = shell.exec(cmd, { silent: true});
  if (stateOut.code !== 0) {
    console.log(`Error: Failed to pull repo. \n\t${stateOut.stderr}`);
    throw new Error('Fialed to pull repo');
  }
}

function findParachainDeployments() {
  console.log(`Log: findParachainDeployments()`);
  let path = `${GIT_REPO}/${K8S_PARA_DEPLOYMENTS}`;

  let dirs = fs.readdirSync(path);

  for (var i = 0; i < dirs.length; i++) {
    dirs[i] = `${path}/${dirs[i]}/parachain.yaml`
  };

  return dirs;
}

function parseParaInfoFromDeployment(path) {
  console.log(`Log: parseParaInfoFromDeployment()`);
  const deployment = yaml.loadAll(fs.readFileSync(path, 'utf8')).find((doc) => {
    return doc.kind.toLowerCase() == 'deployment';
  });

  if (deployment.spec.template.spec.containers.length !== 1) {
    throw new Error(`Failed to parse deployment - multiple containers found`);
  }

  const image = deployment.spec.template.spec.containers[0].image;
  const args = deployment.spec.template.spec.containers[0].args;
  const envs = deployment.spec.template.spec.containers[0].env;
  let cmd = deployment.spec.template.spec.containers[0].command;

  if (cmd) {
    cmd = cmd[0]
  } else {
    cmd = false;
  }

  const chainIdx = args.findIndex((e) => { return e.toLowerCase() == '--chain'; });

  if (chainIdx < 0) {
    throw new Error(`Failed to parse deployment - "--chain" not found`);
  }

  let paraId = NaN;
  for (let i = 0; i < envs.length; i++) {
    if (envs[i].name.toUpperCase() == "CI_PARA_ID") {
      paraId = envs[i].value;
      break;
    }
  }

  const chain = args[chainIdx  + 1];

  if (!paraId || isNaN(paraId * 1)) {
    throw new Error(`Failed to find or parse CI_PARA_ID in deployment - invalid parachain-id: ${paraId}`);
  }

  if (!chain) {
    throw new Error(`Failed to parse deployment - invalid chain`);
  }

  return {
    cmd: cmd,
    paraId: paraId,
    chainParam: chain,
    image: image 
  }
}

function ecrLogin() {
  console.log(`Log: ecrLogin()`);
  const ecrLoginCmd = 'aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin 601305236792.dkr.ecr.eu-west-1.amazonaws.com';

  const ecrLoginOut = shell.exec(ecrLoginCmd, { silent: true});
  if (ecrLoginOut.code !== 0) {
    console.log(`Error: Failed ECR login \n\t${ecrLoginOut.stderr}`);
    throw new Error('Fialed ECR login');
  }
}

function registerParachain(paraId, state, wasm, root) {
  console.log(`Log: registerParachain()`);

  const tx = api.tx.parasSudoWrapper.sudoScheduleParaInitialize(paraId, {
    genesisHead: state,
    validationCode: wasm,
    parachain: true
  });

  return sudo(tx, root);
}

function getParaStateWasm(chain, paraId, image, cmd) {
  console.log(`Log: getParaStateWasm()`);
 
  const pullImageCmd = `docker pull ${image}`;
  const cleanupCmd = `docker rmi ${image}`;

  let maybeEntrypoint = "";
  if (cmd) {
    maybeEntrypoint = ` --entrypoint ${cmd}`; 
  }

  let maybeVolume = "";
  let inDockerChain = chain;
  if (/.json$/.test(chain)) {
    inDockerChain = chain.substr(1);
    maybeVolume = ` -v ${path.resolve(chain)}:${inDockerChain}`;
  }

  const cleanupImage = "--rm";

  const exportStateCmd = `docker run ${cleanupImage}${maybeVolume}${maybeEntrypoint} ${image} export-genesis-state --chain ${inDockerChain}`;
  const exportWasmCmd = `docker run ${cleanupImage}${maybeVolume}${maybeEntrypoint} ${image} export-genesis-wasm --chain ${inDockerChain}`;

  const pullImageOut = shell.exec(pullImageCmd, { silent: true});
  if (pullImageOut.code !== 0) {
    console.log(`Error: Failed to pull image. \n\t${pullImageOut.stderr}`);
    throw new Error('Fialed to pull docker image');
  }

  const stateOut = shell.exec(exportStateCmd, { silent: true});
  if (stateOut.code !== 0) {
    console.log(`Error: Failed to export export-genesis-state. \n\t${stateOut.stderr}`);
    throw new Error('Fialed to export-genesis-state');
  }

  const wasmOut = shell.exec(exportWasmCmd, { silent: true});
  if (wasmOut.code !== 0) {
    console.log(`Error: Failed to export export-genesis-wasm. \n\t${wasmOut.stderr}`);
    throw new Error('Fialed to export-genesis-wasm');
  }

  const cleanupOut = shell.exec(cleanupCmd, { silent: true});
  if (cleanupOut.code !== 0) {
    console.log(`Error: Failed to remove image. \n\t${cleanupOut.stderr}`);
    throw new Error('Fialed to remove image');
  }

  return { 
    state: stateOut.stdout,
    wasm: wasmOut.stdout 
  };
}

function sudo(tx, account) {
  return new Promise((resolve, reject) => {
    api.tx.sudo
      .sudo(tx)
      .signAndSend(account, ({ events = [], status }) => {
        if (status.isInBlock) {
          return resolve();
        }
      });
  });
}
