var rcrypto = require('./raqia-crypto')
var Promise = require('bluebird')
var AWS = require('aws-sdk')
var dynamodb = Promise.promisifyAll(new AWS.DynamoDB({
  apiVersion: '2012-08-10',
  region: 'us-east-1'
}))
var Rx = require('rx')

/*

- pair
- poll (sync config, pull commands, update price feed, update stats)

*/

var config
var machineId = '990685c8-80e4-4344-b6d1-bd288f031b2f'
var keys = {
  broadcast: [new Buffer('AAAFqCyZlG6KhpFrQAbhI8AU95xpD5J2RJc', 'base64')]
}

function poll () {
  var key = keys.broadcast[0]
  var params = {
    Key: {MachineId: {S: machineId}},
    TableName: 'Config'
  }
  return dynamodb.getItemAsync(params)
  .then(function (res) {
    var str = rcrypto.decrypt(res.Item.Content.B, key)
    return JSON.parse(str)
  })
}

var pollStream = Rx.Observable.fromPromise(poll())
var dbStream = Rx.Observable.interval(1000).flatMap(pollStream)

module.exports = {
  configStream: dbStream
}

/*
dbStream.subscribe(
  function (x) {
    console.log('Next: %s', x)
    console.dir(x)
  },
  function (err) {
    console.log('Error: %s', err)
  },
  function () {
    console.log('Completed')
  }
)
*/
