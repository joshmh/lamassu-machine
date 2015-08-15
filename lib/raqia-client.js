var rcrypto = require('./raqia-crypto')
var Promise = require('bluebird')
var AWS = require('aws-sdk')
var dynamodb = Promise.promisifyAll(new AWS.DynamoDB({
  apiVersion: '2012-08-10',
  region: 'us-east-1'
}))
var Rx = require('rx')
var R = require('ramda')
var pp = require('./pp')

/*

- pair
- poll (sync config, pull commands, update price feed, update stats)

*/

var configFingerprint = null
var machineId = '990685c8-80e4-4344-b6d1-bd288f031b2f'
var keys = {
  broadcast: [new Buffer('AAAFqCyZlG6KhpFrQAbhI8AU95xpD5J2RJc', 'base64')]
}

function poll () {
  var key = keys.broadcast[0]
  var params = {
    Key: {MachineId: {S: machineId}},
    TableName: 'Config',
    ProjectionExpression: 'Fingerprint'
  }
  return dynamodb.getItemAsync(params)
  .then(function (res) {
    if (configFingerprint && res.Item.Fingerprint.B.equals(configFingerprint)) {
      return null
    }
    return dynamodb.getItemAsync(R.dissoc('ProjectionExpression', params))
    .then(function (res) {
      configFingerprint = res.Item.Fingerprint.B
      var str = rcrypto.decrypt(res.Item.Content.B, key)
      return JSON.parse(str)
    })
  })
}

function notNull (a) { return a !== null }

var dbStream = Rx.Observable.timer(0, 5000).flatMap(function () {
  return Rx.Observable.fromPromise(poll())
}).filter(notNull)

module.exports = {
  configStream: dbStream
}

/*
dbStream.subscribe(
  function (x) {
    console.log('Next: %s', x)
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
