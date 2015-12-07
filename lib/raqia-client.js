const rcrypto = require('./raqia-crypto')
const AWS = require('aws-sdk')
const Rx = require('rx')
const R = require('ramda')
const crypto = require('crypto')
const uuid = require('node-uuid')
const dynamodb = new AWS.DynamoDB({
  apiVersion: '2012-08-10',
  region: 'us-east-1'
})
const KEY_SUBJECTS = ['transactions', 'activities']
const KEY_HISTORY_GENERATIONS = 3

const getItem = Rx.Observable.fromNodeCallback(dynamodb.getItem, dynamodb)
const query = Rx.Observable.fromNodeCallback(dynamodb.query, dynamodb)
const putItem = Rx.Observable.fromNodeCallback(dynamodb.putItem, dynamodb)
exports.batchWriteItem = Rx.Observable.fromNodeCallback(dynamodb.batchWriteItem, dynamodb)
/*

- pair
- poll (sync config, pull commands, update price feed, update stats)

*/

let configNonce = null
let machineId = '990685c8-80e4-4344-b6d1-bd288f031b2f'
let keys = {
  broadcast: [new Buffer([ 197, 132, 27, 114, 98, 251, 79, 5, 34, 77, 5, 157, 26, 215, 183, 72 ])]
}

function toCryptoRecord (r) {
  return {
    iv: r.Iv.B,
    ciphertext: r.Ciphertext.B
  }
}

function poll () {
  let key = keys.broadcast[0]
  let params = {
    Key: {MachineId: {S: machineId}},
    TableName: 'Config',
    ProjectionExpression: 'Nonce'
  }

  return getItem(params)
  .filter(res => !configNonce || !res.Item.Nonce.B.equals(configNonce))
  .flatMap(getItem(R.dissoc('ProjectionExpression', params)))
  .map(res => {
    configNonce = res.Item.Nonce.B
    let str = rcrypto.decrypt(toCryptoRecord(res.Item), key)
    return JSON.parse(str)
  })
}

exports.currentLogIndexes = function currentLogIndexes (categories) {
  let params = categories.map(cat => ({
    TableName: cat.tableName,
    Limit: 1,
    KeyConditionExpression: 'MachineId = :machineId',
    ExpressionAttributeValues: {':machineId': {S: machineId}},
    ProjectionExpression: 'SerialNumber',
    ScanIndexForward: false
  }))

  return Rx.Observable.from(params)
  .concatMap(r => query(r))
  .map((r, i) => ({
    category: categories[i].code,
    currentIndex: r.Items[0] ? parseInt(r.Items[0].SerialNumber.N, 10) + 1 : 0
  }))
  .toArray()
}

exports.stream = function stream (opts) {
  return Rx.Observable.interval(opts.interval).startWith(0).flatMap(poll)
}

exports.registerPairing = function registerPairing (rec) {
  const params = {
    TableName: 'Pairing',
    Item: {
      Id: {S: rec.recordId},
      Iv: {B: rec.iv},
      Version: {N: rec.version.toString()},
      Ciphertext: {B: rec.ciphertext},
      Timestamp: {S: new Date().toISOString()}
    }
  }
  return putItem(params)
}

exports.fetchPairing = function fetchDevice (pairingId, key) {
  const params = {
    TableName: 'Pairing',
    Key: {Id: {S: pairingId}}
  }
  return getItem(params)
  .map(r => r.Item ? JSON.parse(rcrypto.decrypt(toCryptoRecord(r.Item), key)) : null)
}

function deriveDeviceId (devicePubKey) {
  const hash = crypto.createHash('sha256').update(devicePubKey).digest()
  return uuid.unparse(hash.slice(0, 16))
}

function deriveBroadcastKeyGenerator (masterKey, gen) {
  return function deriveBroadcastKey (subject) {
    return rcrypto.hkdf(masterKey, gen.toString() + ':broadcast-key:' + subject)
  }
}

function computeEncryptionKeysGeneration (deviceId, masterKey, gen) {
  const _deriveBroadcastKey = deriveBroadcastKeyGenerator(masterKey, gen)
  const directKey = rcrypto.hkdf(masterKey, gen.toString() + ':direct-key:' + deviceId)
  const broadcastKeys = R.zipObj(KEY_SUBJECTS.map(r => [r, _deriveBroadcastKey(r)]))
  return R.merge({direct: directKey}, broadcastKeys)
}

function computeEncryptionKeys (deviceId, masterKey, gen) {
  const minGen = Math.max(0, gen - KEY_HISTORY_GENERATIONS + 1)
  let encryptionKeys = {}
  for (let i = minGen; i <= gen; i++) {
    let genKeys = computeEncryptionKeysGeneration(deviceId, masterKey, i)
    encryptionKeys = R.merge(encryptionKeys, genKeys)
  }
}

exports.publishKeys = function publishKeys (machineId, devicePublicKey, masterKey, gen) {
  const deviceId = deriveDeviceId(devicePublicKey)
  const transientKey = crypto.randomBytes(16)
  const encryptedKey = rcrypto.publicEncrypt(transientKey, devicePublicKey)
  const encryptionKeys = computeEncryptionKeys(deviceId, masterKey, gen)
  const cipherRec = rcrypto.encrypt(encryptionKeys, transientKey)

  const params = {
    TableName: 'EncryptionKeys',
    Item: R.merge(cipherRec, {
      MachineId: {S: machineId},
      DeviceId: {S: deviceId},
      EncryptedKey: {B: encryptedKey}
    })
  }

  return putItem(params).map(() => true)
}

exports.registerDeviceOtp = function registerDeviceOtp (machineId, recordId, nonce) {
  const params = {
    TableName: 'DeviceOtp',
    Item: {
      Id: {S: recordId},
      Nonce: {S: nonce},
      MachineId: {S: machineId},
      Timestamp: {S: new Date().toISOString()}
    }
  }
  return putItem(params)
}

/*
dbStream.subscribe(
  function (x) {
    console.log('Next: %s', x)
    console.dir(x)
  },
  function (err) {
    console.log('Error: %s', err)
    console.log(err.stack)
  },
  function () {
    console.log('Completed')
  }
)
*/
