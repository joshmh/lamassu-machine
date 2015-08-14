/*
- Config state
- Use AWS SDK
- Receive transactions
- Receive stats
- Receive prices
*/

var Promise = require('bluebird')
var minimist = require('minimist')
var AWS = require('aws-sdk')
var dynamodb = Promise.promisifyAll(new AWS.DynamoDB({
  apiVersion: '2012-08-10',
  region: 'us-east-1'
}))
var raqiaCrypto = require('../raqia-crypto')

var commandLine = minimist(process.argv.slice(2))
var currency = commandLine.fiat || 'EUR'

var REFRESH_MS = 4 * 86400000

var pubkeys = {
  machine: {
    privkey: '-----BEGIN RSA PRIVATE KEY-----\n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\n-----END RSA PRIVATE KEY-----\n',
    pubkey: '-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAthmMJRwa30unFh0viP/G\nCpM209ID+PL2c8+vBgC3tuLe5B2MfarDODypHtgDqqro/69RrvRCkYBQVyLY6PQw\nABiNZGKby5EPssliP1d79W9CIwmJ2moTwoWXWy7+sA11mLuVqrVoUQqXZ/jIjgSN\n5pTdGpEIXPDwVK9ZGCd34eJFZTYILBrpJii7YHE1lnrtjcBOyUlko2lzIHQUVzvD\n2SGBZ3yQK7iRBvq7Xd2rpcqwDFIpJm5ORhIQ1BhzOPXCaZALVJsM6j3PVGUDxtTB\nSvfEzIvl2xhqOX8I6BSr1I3S7Y1vtfQ22rSpSSEhWSttaSyNx5VmwPDh/0zV4pQS\nYt6B5g+Js+A5tF+MIlGM38sfCtLJxkEx5gDk0iDaGSGv/YB5qOWfVJPR3wv4IedL\nMLDZA4zph6dmAuQIplTSMMPlPSzG+VYb+bkBOytErO/NC1wloi4sH3kPfk1ZEJdL\n6A1+kSlqlNWT45mxaFkpgj3AbjJCz113kN9tV/Js6of7AgMBAAE=\n-----END PUBLIC KEY-----\n'
  },
  device: {
    privkey: '-----BEGIN RSA PRIVATE KEY-----\n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\n-----END RSA PRIVATE KEY-----\n',
    pubkey: '-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAnv7xjMEpAqRG1railRV+\nbmBBxmrdrtoAAneYuzmbEPP9FHBoErGDQJpUDWe861f4Bei66h1aaJYcmdLIewD5\nQJeuniPhQ2ra/rRuKOEOg5/8YmrA4M9CBVtMHmZYVWV86WwmSR+kArN6rSI7hl7I\n3uqu8QIv+TniKtCaZkzo8sTbcbBjNXlfWKbIs1pcVk0QweeKf/Pj5oAMO4HTDG83\n97LcbQ5ylbXfSW2uT9Rik1jGTPbp7pYco79k6WFLqxXyJFTAVHoO8mhNk1+9I/2z\nbq7zjbiXvy8j7lw+7RxFrYSw5A6df30e6nNJfZ976Hy06qTXTebhGioz7kC0exze\nL2OinhQSr2hc7WJJsRHOEg2aa2sDT44T1KvmdDZGOmD8baRDYDvAr3dVootH6vTW\nW0d9NTQRmrM4r55pbYeNIMMZ3NQ/zR6cGTP/iBY0USdnOtS4yscMZ6dJBPe9/d5P\natwgivyEbkVLLnx8+8+intepMK/iohFZRXgYDA/pj5mBAgMBAAE=\n-----END PUBLIC KEY-----\n'
  }
}

var state = {
  exchangeRate: 12.45,
  fiatExchangeRate: 1001.12,
  fiatTxLimit: 250,
  zeroConfLimit: 50,
  balance: 50,
  txLimit: null,
  idVerificationLimit: null,
  idVerificationEnabled: false,
  idData: null,
  isMock: true,
  locale: {
    currency: currency,
    localeInfo: {
      primaryLocale: 'en-US',
      primaryLocales: ['en-US', 'ja-JP', 'es-MX', 'he-IL', 'ar-SA'],
      country: 'US'
    }
  },
  twoWayMode: true,
  cartridges: [
    {denomination: 1, count: 2},
    {denomination: 5, count: 1}
  ],
  virtualCartridges: [100],
  cartridgesUpdateId: 12
}

var deviceId

function init (_deviceId) {
  deviceId = _deviceId
}

function fetchSymmetricKeys (machineId) {
  var params = {
    Key: {MachineId: {S: machineId}, DeviceId: {S: deviceId}},
    TableName: 'EncryptionKeys'
  }
  return dynamodb.getItemAsync(params)
  .then(function (res) {
    var currentBroadcastEnc = res.Item.CurrentBroadcast.B
    var currentDirectEnc = res.Item.CurrentDirect.B
    return {
      currentDirect: raqiaCrypto.privateDecrypt(currentDirectEnc, pubkeys.device.privkey),
      currentBroadcast: raqiaCrypto.privateDecrypt(currentBroadcastEnc, pubkeys.device.privkey)
    }
  })
}

function updateConfig (config, key) {
  var date = new Date()
  var configEnc = raqiaCrypto.encrypt(new Buffer(JSON.stringify(config)), key)
  var params = {
    Item: {
      MachineId: {S: machineId},
      Timestamp: {S: date.toISOString()},
      Content: {B: configEnc}
    },
    TableName: 'Config'
  }
  return dynamodb.putItemAsync(params)
}

function fetchConfig (key) {
  var params = {
    Key: {MachineId: {S: machineId}},
    TableName: 'Config'
  }
  return dynamodb.getItemAsync(params)
  .then(function (res) {
    var str = raqiaCrypto.decrypt(res.Item.Content.B, key)
    return JSON.parse(str)
  })
}

function pair (machineId) {
  var date = new Date()
  var devicePubkey = pubkeys.device.pubkey
  var refreshDate = new Date(date.getTime() + REFRESH_MS)

  var currentBroadcast = new Buffer('NudgEXqv5MMpPoqyQ3h00PWmwyBhudfZ', 'base64')
  var currentDirect = new Buffer('tV9/kUAtTLVLovwGHRWO7usS4834vRLU', 'base64')

  var currentBroadcastEnc = raqiaCrypto.publicEncrypt(currentBroadcast, devicePubkey)
  var currentDirectEnc = raqiaCrypto.publicEncrypt(currentDirect, devicePubkey)
  var params = {
    Item: {
      MachineId: {S: machineId},
      DeviceId: {S: deviceId},
      Timestamp: {S: date.toISOString()},
      CurrentBroadcastRefresh: {S: refreshDate.toISOString()},
      CurrentBroadcast: {B: currentBroadcastEnc},
      CurrentDirectRefresh: {S: refreshDate.toISOString()},
      CurrentDirect: {B: currentDirectEnc}
    },
    TableName: 'EncryptionKeys'
  }
  return dynamodb.putItemAsync(params)
}

module.exports = {
  init: init
}

deviceId = 'ca077d8e-c72b-4000-b40b-61a7761ddda8'
var machineId = '990685c8-80e4-4344-b6d1-bd288f031b2f'

var directKey = new Buffer('tV9/kUAtTLVLovwGHRWO7usS4834vRLU', 'base64')
// updateConfig(state, directKey).then(console.log)
fetchConfig(directKey).then(console.log)
