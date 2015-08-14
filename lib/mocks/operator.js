/*
- Config state
- Use AWS SDK
- Receive transactions
- Receive stats
- Receive prices
*/

var minimist = require('minimist')
var AWS = require('aws-sdk')
var dynamodb = new AWS.DynamoDB({
  apiVersion: '2012-08-10'
})
var commandLine = minimist(process.argv.slice(2))
var currency = commandLine.fiat || 'EUR'

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
  dynamodb.getItem(params)
}

module.exports = {
  init: init
}
