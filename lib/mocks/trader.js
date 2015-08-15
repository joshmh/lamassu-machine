'use strict'

var util = require('util')
var EventEmitter = require('events').EventEmitter
var minimist = require('minimist')
var raqiaClient = require('../raqia-client')

var commandLine = minimist(process.argv.slice(2))
var incomingAddress = commandLine.btcIn

var Trader = function () {
  if (!(this instanceof Trader)) return new Trader()
  EventEmitter.call(this)
}
util.inherits(Trader, EventEmitter)

module.exports = Trader

Trader.prototype.init = function init () {}

Trader.prototype.run = function run () {
  console.log('Using mock trader')
  var self = this

  raqiaClient.configStream.first().toPromise().then(function (res) {
    console.log('DEBUG15')
    self.sync(res)
    self.emit('pollUpdate')
    self.emit('networkUp')

    setInterval(function () {
      self.emit('pollUpdate')
      self.emit('networkUp')
    }, 3000)
  })
}

Trader.prototype.sync = function sync (config) {
  console.log('DEBUG18')
  this.exchangeRate = config.exchangeRate
  this.fiatExchangeRate = config.fiatExchangeRate
  this.fiatTxLimit = config.fiatTxLimit
  this.zeroConfLimit = config.zeroConfLimit
  this.balance = config.balance
  this.txLimit = config.txLimit
  this.idVerificationLimit = config.idVerificationLimit
  this.idVerificationEnabled = config.idVerificationEnabled
  this.idData = config.idData
  this.isMock = true
  this.locale = config.locale
  this.twoWayMode = config.twoWayMode
  this.cartridges = config.cartridges
  this.virtualCartridges = config.virtualCartridges
  this.cartridgesUpdateId = config.cartridgesUpdateId
}

Trader.prototype.trade = function trade (rec, cb) { cb() }

Trader.prototype.sendBitcoins = function sendBitcoins (tx, cb) {
  setTimeout(function () {
    cb(null, 'ed83b95940dbaecd845749d593a260819437838449f87b9257f25dfbd32f7fd6')
  }, 1000)
}

Trader.prototype.resetId = function resetId () {
  this.idData = {}
}

Trader.prototype.verifyUser = function verifyUser (idRecord, cb) {
  console.log(util.inspect(idRecord, {depth: null, colors: true}))
  var response = {success: true}
  var err = null

  setTimeout(function () {
    cb(err, response)
  }, 1300)
}

Trader.prototype.verifyTransaction = function verifyTransaction (idRecord) {
  console.log(util.inspect(idRecord, {depth: null, colors: true}))
  return
}

Trader.prototype.cashOut = function cashOut (tx, cb) {
  cb(null, incomingAddress)
  console.dir(tx)
}

Trader.prototype.dispenseAck = function dispenseAck (tx) {
  console.log(util.inspect(tx, {depth: null, colors: true}))
}
