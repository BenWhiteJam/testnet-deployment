const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const { mnemonicGenerate } = require('@polkadot/util-crypto');

require('dotenv').config();

const DECIMALS = 1000000000000;
let api;
let keyring;

const TRANSFER = 120;
const BOND = 100;

const NEW_VALIDATOR_ENDPOINT = process.argv[2];
const SUDO_SEED = process.env.SUDO_SEED;

if (!process.argv[2]) {
  console.log(`Error: Missing new validator endpoint 
Usage: node index.js ws://127.0.0.1:9944`
  );
  process.exit(1);
}

(async () => {
  const wsProvider = new WsProvider(NEW_VALIDATOR_ENDPOINT);
  api = await ApiPromise.create({ provider: wsProvider });

  const [chain, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.version()
  ]);

  console.log(`Connected to relay chain: ${chain} ${nodeVersion}`);


  const keyring = new Keyring({ type: 'sr25519' });
  const root = keyring.addFromUri(SUDO_SEED);
  const validator = createValidatorAccount(keyring);
 
  await transfertTokensToValidator(root, validator.address, TRANSFER * DECIMALS);

  await bondTokens(validator, BOND * DECIMALS);
  
  const sessionKeys = await generateSessionKeys();

  await setSessionKeys(sessionKeys, validator);

  await validate(validator);

  await forceNewEra(root);

  console.log(' -- Validator registration complete -- ');
  process.exit(0);
})();

function forceNewEra(root) {
  console.log(`Log: forceNewEra()`);

  const tx = api.tx.staking.forceNewEra();

  return sudo(tx, root);
}

function validate(account) {
  console.log(`Log: validate()`);

  const tx = api.tx.staking.validate({
    commission: 0,
    blocked: true
  });

  return signAndSend(tx, account);
}

function setSessionKeys(sessinKeys, account) {
  console.log(`Log: setSessionKeys()`);

  const tx = api.tx.session.setKeys(sessinKeys, 0);

  return signAndSend(tx, account);
}

function generateSessionKeys() {
  console.log(`Log: generateSessionKeys()`);

  return api.rpc.author.rotateKeys();
}

function createValidatorAccount(keyring) {
  console.log(`Log: createValidatorAccount()`);
 
  const mnemonic = mnemonicGenerate();

  return keyring.addFromUri(mnemonic, 'ed25519'); 
}

function transfertTokensToValidator(origin, destination, amount) {
  console.log(`Log: transfertTokensToValidator()`);

  const tx = api.tx.balances.transfer(destination, amount);

  return signAndSend(tx, origin);
}

function bondTokens(account, amount) {
  console.log(`Log: bondTokens()`);

  const tx = api.tx.staking.bond(account.address, amount, 'None');

  return signAndSend(tx, account);
}

function signAndSend(tx, account) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(account, ({ events = [], status }) => {
        if (status.isInBlock) {
          return resolve();
        }
      });
  });
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
