const rcrypto = require('./raqia-crypto')
const AWS = require('aws-sdk')
const Rx = require('rx')
const R = require('ramda')
const dynamodb = new AWS.DynamoDB({
  apiVersion: '2012-08-10',
  region: 'us-east-1'
})
const pp = require('./pp')

const getItem = Rx.Observable.fromNodeCallback(dynamodb.getItem, dynamodb)
const query = Rx.Observable.fromNodeCallback(dynamodb.query, dynamodb)
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
    console.log('DEBUG66')
    console.log(toCryptoRecord)
    console.log(res.Item)
    let str = rcrypto.decrypt(toCryptoRecord(res.Item), key)
    console.log('DEBUG67')
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

exports. stream = function stream (opts) {
  return Rx.Observable.interval(opts.interval).startWith(0).flatMap(poll)
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
