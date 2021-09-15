const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const shell = require('shelljs');
const yaml = require('js-yaml');
const fs = require('fs');

require('dotenv').config();

let api;
let keyring;

const RELAYCHAIN_ENDPOINT=process.env.RELAYCHAIN_ENDPOINT;
const SUDO_SEED=process.env.SUDO_SEED;

if (!process.argv[2]) {
  console.log(`Error: Missing path to k8s yaml.    
Usage: node index.js ./parachain.yaml`               
  );                                                    
  process.exit(1);                                      
}

(async () => {
  const wsProvider = new WsProvider(RELAYCHAIN_ENDPOINT);
  api = await ApiPromise.create({ provider: wsProvider });

  const [ch, nodeVersion] = await Promise.all([                 
    api.rpc.system.chain(),                                        
    api.rpc.system.version()                                       
  ]);                                                              

  console.log(`Connected to relay chain: ${ch} ${nodeVersion}`);

  const keyring = new Keyring({ type: 'sr25519' });
  const root = keyring.addFromUri(SUDO_SEED);

  const { paraId, chain, image } = parseParaInfoFromDeployment(process.argv[2]);

  const { state, wasm } = getParaStateWasm(chain, paraId, image);

  await registerParachain(paraId, state, wasm, root);

  await sudo(api.tx.paras.forceQueueAction(paraId), root);

  console.log(`-- parachain ${paraId} registered --`);
  process.exit(0);
})();

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

  const chainIdx = args.findIndex((e) => { return e.toLowerCase() == '--chain'; });
  const paraIdIdx = args.findIndex((e) => { return e.toLowerCase() == '--parachain-id'; });

  if (chainIdx < 0) {
    throw new Error(`Failed to parse deployment - "--chain" not found`);
  }

  if (paraIdIdx < 0) {
    throw new Error(`Failed to parse deployment - "--parachain-id" not found`);
  }

  const paraId = args[paraIdIdx + 1];
  const chain = args[chainIdx  + 1];

  if (!paraId || isNaN(paraId * 1)) {
    throw new Error(`Failed to parse deployment - invalid parachain-id: ${paraId}`);
  }

  if (!chain) {
    throw new Error(`Failed to parse deployment - invalid chain`);
  }

  return {
    paraId: paraId,
    chain: chain,
    image: image 
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

function getParaStateWasm(chain, paraId, image) {
  console.log(`Log: getParaStateWasm()`);

  const exportStateCmd = `docker run --rm ${image} export-genesis-state --chain ${chain} --parachain-id ${paraId}`;
  const exportWasmCmd = `docker run --rm ${image} export-genesis-wasm --chain ${chain}`;

  const stateOut = shell.exec(exportStateCmd, { silent: true});
  if (stateOut.code !== 0) {
    console.log(`Error: Failed to export export-genesis-state. \n\t${stateOut.stderr}`);
    process.exit(1);
  }

  const wasmOut = shell.exec(exportWasmCmd, { silent: true});
  if (wasmOut.code !== 0) {
    console.log(`Error: Failed to export export-genesis-wasm. \n\t${wasmOut.stderr}`);
    process.exit(1);
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
