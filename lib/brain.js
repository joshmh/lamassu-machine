require('longjohn')

var fs = require('fs')
var cp = require('child_process')
var os = require('os')
var path = require('path')
var crypto = require('crypto')
var ursa = require('ursa')
var net = require('net')
var EventEmitter = require('events').EventEmitter
var _ = require('lodash')
var R = require('ramda')
var Rx = require('rx')
var bs10 = require('base-x')('0123456789')
var bip39 = require('bip39')
var rcrypto = require('./raqia-crypto')
var error = require('./error')
var sms = require('./sms/mock')
// var wallet = require('./wallet/coinkite')
var wallet = require('./wallet/mock')
var blockchain = require('./blockchain/mock')
var exchange = require('./exchange/mock')
var prices = require('./prices')
var uuid = require('node-uuid')
var async = require('async')
var State = require('./constants/state.js')
var BillMath = require('./bill_math')
var raqia = require('./raqia-client')
var pairing = require('./pairing')
var Log = require('./log')

var SATOSHI_FACTOR = 1e8
var PRICE_PRECISION = 5
var STATIC_STATES = [State.IDLE, State.PENDING_IDLE, 'dualIdle', State.NETWORK_DOWN,
  'unpaired', 'maintenance', 'virgin', 'wifiList']
var BILL_ACCEPTING_STATES = ['billInserted', 'billRead', 'acceptingBills',
  'acceptingFirstBill', 'maintenance']
var INITIAL_STATE = State.START

const version = require('../package.json').version

const phoneMap = new Map()
const dispenseMap = new Map()
const sessionMap = new Map()
const pendingTxs = new Set()
const confirmedMap = new Map()

// masterKey is the one key to rule them all
let masterKey

let keyGeneration
let publicKey
let machineId
let effectiveBills

var fullLog$

var emitter = new EventEmitter()

console.log('DEBUG33')
var Brain = function (config) {
  if (!(this instanceof Brain)) return new Brain(config)

  console.log('DEBUG41')

  this.rootConfig = config
  this.config = config.brain

  this.dataPath = path.resolve(__dirname, '..', this.config.dataPath)

  var certs = {
    certFile: path.resolve(this.dataPath, this.config.certs.certFile),
    keyFile: path.resolve(this.dataPath, this.config.certs.keyFile)
  }
  if (config.noCert) certs.certFile = null

  this.currency = 'USD'
  this.bootTime = Date.now()

  var wifiConfig = config.wifi
  wifiConfig.wpaConfigPath = wifiConfig.wpaConfigPath &&
  path.resolve(this.dataPath, wifiConfig.wpaConfigPath)
  if (config.mockWifi) {
    this.wifi = require('./mocks/wifi')(wifiConfig)
  } else {
    this.wifi = require('./wifi')(wifiConfig)
  }
  console.log('DEBUG42')

  this.scanner = config.mockCam
    ? require('./mocks/scanner')
    : require('./scanner')
  this.scanner.config(config.scanner)

  config.id003.rs232.device = determineDevicePath(config.id003.rs232.device)
  config.billDispenser.device = determineDevicePath(config.billDispenser.device)
  if (config.id003Device) config.id003.rs232.device = config.id003Device

  config.id003.currency = this.currency
  this.setBillValidator(require('./id003/id003').factory(config.id003))

  var traderConfig = config.trader
  traderConfig.currency = this.currency
  traderConfig.lowestBill = this.getBillValidator().lowestBill()
  traderConfig.certs = certs
  if (config.http) traderConfig.protocol = 'http'

  if (config.mockTrader) {
    this.trader = require('./mocks/trader')(traderConfig)
  } else {
    this.trader = require('./trader')(traderConfig)
  }

  this.idVerify = require('./compliance/id_verify').factory({trader: this.trader})

  this.setBrowser(require('./browser')())
  this._setState(INITIAL_STATE)
  this.address = null
  this.credit = {tokenValue: 0, fiatValue: 0, lastBill: null}
  this.creditConfirmed = {tokenValue: 0, fiatValue: 0}
  this.fiatTx = null
  this.pending = null
  this.billsPending = false
  this.currentScreenTimeout = null
  this.locked = true
  this.wifis = null
  this.screenTimeout = null
  this.lastTransation = null
  this.sendOnValid = false
  this.lastPowerUp = Date.now()
  this.networkDown = true
  this.hasConnected = false
  this.localeInfo = this.config.locale.localeInfo
  this.dirtyScreen = false
  this.billValidatorErrorFlag = false
  this.startDisabled = false
  this.testModeOn = false
  this.uiCartridges = null
  this.powerDown = false

  console.log('DEBUG40')
}

var util = require('util')
util.inherits(Brain, EventEmitter)

var config$ = raqia.stream({interval: 5000})
var balance$ = wallet.balance()

var trader$ = prices.prices({interval: 60000, config$: config$})
.combineLatest(balance$, (config, balance) => {
  config.balance = balance * config.exchangeRate * 0.98 / 1e8
  return config
})

console.log('DEBUG34')

Brain.prototype._initMasterKey = function _initMasterKey () {
  console.log('DEBUG30')
  const masterKeyFile = path.resolve(this.dataPath, 'master-key.dat')
  const masterKeyBakFile = path.resolve(this.dataPath, 'master-key.bak.dat')

  try {
    masterKey = new Buffer(fs.readFileSync(masterKeyFile, 'utf8'), 'base64')
  } catch(e) {
    try {
      masterKey = new Buffer(fs.readFileSync(masterKeyBakFile, 'utf8'), 'base64')
    } catch(e) {
      // no-op
    }
  }
}

console.log('DEBUG35')

Brain.prototype.run = function run () {
  console.log('Bitcoin Machine software initialized.')
  var self = this

  trader$.subscribe(
    function (res) {
      self.trader.sync(res)
    },
    function (err) {
      console.log('Config update error: %s', err)
      console.log(err.stack)
    },
    function () {
      console.log('Config complete')
    }
  )

  this._init()
  this._setUpN7()
  this.browser().listen()
  this._transitionState('booting')
  this.checkWifiStatus()
  this._periodicLog()

  var callback = function () {
    self._transitionState('restart')
    console.log('Scheduled restart after idle time.')
    process.exit()
  }

  this._executeCallbackAfterASufficientIdlePeriod(callback)
}

Brain.prototype._executeCallbackAfterASufficientIdlePeriod =
function _executeCallbackAfterASufficientIdlePeriod (callback) {
  var self = this
  var config = this.config
  var exitTime = config.exitTime
  var exitOnIdle = exitTime + config.idleTime

  setInterval(function () {
    if (_.contains(STATIC_STATES, self.state)) {
      var date = new Date()
      var elapsed = (date.getTime()) - self.bootTime
      if (elapsed > exitOnIdle) {
        callback()
      }
    }
  }, this.config.checkIdle)
}

Brain.prototype._periodicLog = function _periodicLog () {
  var self = this
  var batteryCapacityPath = this.config.batteryCapacityPath
  var tempSensorPath = this.config.tempSensorPath

  var tasks = {}
  if (batteryCapacityPath) {
    tasks.battery = async.apply(fs.readFile, batteryCapacityPath, {encoding: 'utf8'})
  }

  if (tempSensorPath) {
    tasks.temperature = async.apply(fs.readFile, tempSensorPath, {encoding: 'utf8'})
  }

  function reporting () {
    var clauses = ['cpuLoad: %s, memUse: %s, memFree: %s\n  nodeUptime: %s, ' +
    'osUptime: %s']
    async.parallel(tasks, function (err, results) {
      if (err) return console.log(err)
      if (results.battery) {
        clauses.push('battery: ' + results.battery.trim() + '%')
      }
      if (results.temperature) {
        clauses.push('CPU temperature: ' +
          (results.temperature.trim() / 1000) + '° C')
      }
      var cpuLoad = os.loadavg()[1].toFixed(2)
      var memUse = (process.memoryUsage().rss / Math.pow(1000, 2)).toFixed(1) +
      ' MB'
      var memFree = (os.freemem() * 100 / os.totalmem()).toFixed(1) + '%'
      var nodeUptimeMs = Date.now() - self.bootTime
      var nodeUptime = (nodeUptimeMs / 3600000).toFixed(2) + 'h'
      var osUptime = (os.uptime() / 3600).toFixed(2) + 'h'
      var format = clauses.join(', ')
      console.log(format, cpuLoad, memUse, memFree, nodeUptime, osUptime)
    })
  }
  reporting()
  setInterval(reporting, this.config.periodicLogInterval)
}

Brain.prototype._connect = function _connect () {
  var self = this
  self._startTrading()
}

Brain.prototype._startTrading = function _startTrading () {
  var self = this
  this.getBillValidator().run(function (err) {
    if (err) return self._billValidatorErr(err)

    console.log('Bill validator connected.')
    self._idle()
  })
}

Brain.prototype.checkWifiStatus = function checkWifiStatus () {
  var self = this
  this.wifi.status(function (err, status, ip) {
    if (err || status === 'pending') {
      if (err) console.log(err.stack)
      if (self.state !== 'wifiConnecting') self._wifiConnecting()
      self.wifi.waitConnection(function (err, ip) {
        if (err) {
          self.wifi.startScanning()
          self._wifiList()
          return
        }
        self.config.ip = ip
        self._wifiConnected()
      })
    } else if (status === 'disconnected') {
      self.wifi.startScanning()
      self._wifiList()
    } else if (status === 'connected') {
      self.config.ip = ip
      self._wifiConnected()
    }
  })
}

console.log('DEBUG37')

Brain.prototype._init = function init () {
  console.log('DEBUG31')
  this._initMasterKey()
  console.log('DEBUG32')
  this._initHearbeat()
  this._initWifiEvents()
  this._initTraderEvents()
  this._initBrowserEvents()
  this._initBillValidatorEvents()
  this._initBrainEvents()
  this._initLog()
  this._initExchange()
}

Brain.prototype.log = function log (cat, data) {
  emitter.emit('log', {category: cat, data: data})
}

Brain.prototype._initExchange = function initExchange () {
  let exchange$ = Rx.Observable.fromEvent(emitter, 'exchange')
  let trades$ = exchange.run(exchange$, config$)
  trades$.subscribe(r => this.log('transactions', {
    event: 'exchange-order',
    fiatValue: r.fiatValue,
    currency: r.currency,
    exchangeDirection: 'buy'
  }))
}

Brain.prototype._initLog = function initLog () {
  let cats = [
    {code: 'transactions', path: path.resolve(this.dataPath, 'transactions.dat'), tableName: 'Transactions'},
    {code: 'errors', path: path.resolve(this.dataPath, 'errors.dat'), tableName: 'Errors'}
  ]

  let newLog$ = Rx.Observable.fromEvent(emitter, 'log')

  let key$ = Rx.Observable.just({
    material: new Buffer([ 197, 132, 27, 114, 98, 251, 79, 5, 34, 77, 5, 157, 26, 215, 183, 72 ]),
    id: 'transactions:0'
  })

  fullLog$ = Log.init('990685c8-80e4-4344-b6d1-bd288f031b2f', cats, newLog$, key$)

  const transactions$ = fullLog$.filter(R.propEq('category', 'transactions'))
  .map(r => R.omit(['status', 'errorStatus', 'errorMessage'], r.data))

  const newTransactions$ = newLog$.filter(R.propEq('category', 'transactions'))
  .map(r => R.omit(['status', 'errorStatus', 'errorMessage'], r.data))

  console.log('DEBUG20')

  // Manage phoneMap for new phone numbers
  transactions$.filter(r =>
    (r.event === 'fiat-phone' || r.event === 'fiat-dispense-request') &&
    r.phone
  )
  .subscribe(r => {
    console.log('DEBUG21')
    let sessions = phoneMap.get(r.phone) || new Set()
    sessions.add(r.sessionId)
    phoneMap.set(r.phone, sessions)
  })

  // Maintain sessionMap
  transactions$
  .subscribe(r => sessionMap.set(r.sessionId, r))

  console.log('DEBUG25')

  // Manage confirmations
  transactions$.filter(r => r.event === 'fiat-dispense-request')
  .subscribe(r => {
    console.log('DEBUG22')
    pendingTxs.add(r.sessionId)
  })

  transactions$.filter(r =>
    r.event === 'fiat-status' && r.blockchainStatus === 'confirmed'
  )
  .subscribe(r => {
    console.log('DEBUG28')
    confirmedMap.set(r.sessionId, true)
    pendingTxs.delete(r.sessionId)
  })

  let cartridges$ = transactions$
  .filter(r => ['fiat-reset', 'fiat-dispense', 'fiat-rejected'].includes(r.event))
  .scan((acc, r) => {
    return r.event === 'fiat-reset'
      ? r.cartridges
      : R.zipWith(R.subtract, acc, r.cartridges)
  }, [0, 0])

  let reserved$ = transactions$
  .filter(r => ['fiat-dispense-request', 'fiat-dispense', 'fiat-cancel'].includes(r.event))
  .scan((acc, r) => {
    if (r.event === 'fiat-dispense-request') return R.zipWith(R.add, acc, r.cartridges)
    return R.zipWith(R.subtract, acc, r.cartridges)
  }, [0, 0])
  .startWith([0, 0])

  Rx.Observable.combineLatest(cartridges$, reserved$)
  .map(([cartridges, reserved]) => R.zipWith(R.subtract, cartridges, reserved))
  .map(r => r.map(R.max(0)))
  .startWith([0, 0])
  .subscribe(r => effectiveBills = r)

  // DEBUG300
  setTimeout(() =>
    this.log('transactions', {
      event: 'fiat-reset',
      cartridges: [10, 10]
    }), 5000)

  Rx.Observable.timer(0, 5000)
  .flatMap(blockchain.checkConfirmations(pendingTxs))
  .subscribe(r => {
    if (confirmedMap.get(r)) return
    let tx = sessionMap.get(r)
    if (!dispenseMap.get(r) && tx.phone) sms.message(tx.phone, 'Your cash is ready.')
    this.log('transactions', R.merge(tx, {
      event: 'fiat-status',
      blockchainStatus: 'confirmed'
    }))
  })

  console.log('DEBUG27')

  // Manage dispenses
  newTransactions$.filter(r => r.event === 'fiat-dispense')
  .subscribe(r => {
    if (r.phone) {
      console.log('DEBUG83')
      let sessions = phoneMap.get(r.phone)
      if (sessions) {
        sessions.delete(r.sessionId)
        phoneMap.set(r.phone, sessions)
      }
    }
    dispenseMap.set(r.sessionId, true)
  })

  newTransactions$.filter(r => {
    return ['note-inserted', 'fiat-dispense-request'].includes(r.event)
  })
  .subscribe(r => emitter.emit('exchange', r))

  const activities$ = fullLog$.filter(R.propEq('category', 'activities'))
  .map(r => r.data)

  activities$.filter(r => r.event === 'initialization')
  .subscribe(r => this._rotateKeys(0))

  activities$.filter(r => r.event === 'rotateKeys')
  .subscribe(r => keyGeneration = r.generation)

  const newActivies$ = newLog$.filter(R.propEq('category', 'activities'))
  .map(r => r.data)

  newActivies$.filter(r => r.event === 'pairing')
  .subscribe(r => raqia.publishKeys(r.devicePubKey, masterKey, keyGeneration))

  console.log('DEBUG28')
}

Brain.prototype._initHearbeat = function _initHeartbeat () {
  var pingIntervalPtr
  var heartbeatServer = net.createServer(function (c) {
    console.log('heartbeat client connected')
    c.on('end', function () {
      clearInterval(pingIntervalPtr)
      console.log('heartbeat client disconnected')
    })

    c.on('error', function (err) {
      console.log('hearbeat server error: %s', err)
    })

    pingIntervalPtr = setInterval(function () {
      c.write('ping')
    }, 5000)
  })

  try { fs.unlinkSync('/tmp/heartbeat.sock') } catch(ex) {}
  heartbeatServer.listen('/tmp/heartbeat.sock', function () {
    console.log('server bound')
  })
}

Brain.prototype._initWifiEvents = function _initWifiEvents () {
  var self = this

  this.wifi.on('scan', function (res) {
    self.wifis = res
    self.browser().send({wifiList: res})
  })

  this.wifi.on('connected', function () {
    if (self.state === 'wifiList') {
      self.wifi.stopScanning()
      self._wifiConnected()
    }
  })
}

Brain.prototype._initTraderEvents = function _initTraderEvents () {
  var self = this
  this.trader.on(State.POLL_UPDATE, function () { self._pollUpdate() })
  this.trader.on(State.NETWORK_DOWN, function () { self._networkDown() })
  this.trader.on('networkUp', function () { self._networkUp() })
  this.trader.on('error', function (err) { console.log(err.stack) })
  this.trader.on('unpair', function () { self._unpair() })
}

Brain.prototype._initBrowserEvents = function _initBrowserEvents () {
  var self = this
  var browser = this.browser()

  browser.on('connected', function () { self._connectedBrowser() })
  browser.on('message', function (req) { self._processRequest(req) })
  browser.on('closed', function () { self._closedBrowser() })
  browser.on('messageError', function (err) {
    console.log('Browser error: ' + err.message)
  })
  browser.on('error', function (err) {
    console.log('Browser connect error: ' + err.message)
    console.log('Likely that two instances are running.')
  })
}

Brain.prototype._initBillValidatorEvents = function _initBillValidatorEvents () {
  var self = this
  var billValidator = this.getBillValidator()

  billValidator.on('error', function (err) { self._billValidatorErr(err) })
  billValidator.on('disconnected', function () { self._billValidatorErr() })
  billValidator.on('billAccepted', function () { self._billInserted() })
  billValidator.on('billRead', function (data) { self._billRead(data) })
  billValidator.on('billValid', function () { self._billValid() })
  billValidator.on('billRejected', function () { self._billRejected() })
  billValidator.on('timeout', function () { self._billTimeout() })
  billValidator.on('standby', function () { self._billStandby() })
  billValidator.on('jam', function () { self._billJam() })
  billValidator.on('stackerOpen', function () { self._stackerOpen() })
  billValidator.on('enabled', function (data) { self._billsEnabled(data) })
}

Brain.prototype._initBrainEvents = function _initBrainEvents () {
  this.on('newState', function (state) {
    console.log('new brain state:', state)
  })
}

// TODO: abstract this
Brain.prototype._setupWebcam = function _setupWebcam () {
  var rootPath = '/sys/bus/usb/devices/2-1'

  if (!fs.existsSync(rootPath)) return

  var subdirs = fs.readdirSync(rootPath)
  subdirs.forEach(function (dir) {
    if (dir.indexOf('2-1') === 0) {
      var autosuspendPath = rootPath + '/' + dir + '/power/autosuspend'
      try {
        fs.writeFileSync(autosuspendPath, '-1')
      } catch (ex) {
        // File doesn't exist, that's ok.
      }
    }
  })
}

Brain.prototype._setUpN7 = function _setUpN7 () {
  var backlightPath = '/sys/class/backlight/pwm-backlight/brightness'
  if (fs.existsSync(backlightPath)) fs.writeFileSync(backlightPath, '160\n')
  this._setupWebcam()
  this._setupCheckPower()
}

Brain.prototype._connectedBrowser = function _connectedBrowser () {
  //  TODO: have to work on this: console.assert(this.state === State.IDLE)
  console.log('connected to browser')

  var rec = {
    action: this.state,
    localeInfo: this.localeInfo,
    currency: this.currency,
    exchangeRate: this._exchangeRateRec(this.trader.exchangeRate),
    fiatExchangeRate: this.trader.fiatExchangeRate,
    cartridges: this.uiCartridges
  }

  if (this.state === 'wifiList' && this.wifis) rec.wifiList = this.wifis
  this.browser().send(rec)
}

Brain.prototype._processRequest = function _processRequest (req) {
  this._processReal(req)
}

Brain.prototype._processReal = function _processReal (req) {
  switch (req.button) {
    case 'locked':
      this._locked()
      break
    case 'unlock':
      this._unlock(req.data)
      break
    case 'cancelLockPass':
      this._cancelLockPass()
      break
    case 'wifiSelect':
      this._wifiPass(req.data)
      break
    case 'wifiConnect':
      this._wifiConnect(req.data)
      break
    case 'cancelWifiList':
      this._cancelWifiList()
      break
    case 'cancelWifiPass':
      this._cancelWifiPass()
      break
    case 'initialize':
      this._connect()
      break
    case 'pairingScan':
      this._pairingScan()
      break
    case 'pairingScanCancel':
      this.scanner.cancel()
      this._idle()
      break
    case 'testMode':
      this._testMode()
      break
    case State.START:
      this._start()
      break
    case 'idCode':
      this._idCode(req.data)
      break
    case 'cancelIdScan':
      this._cancelIdScan()
      break
    case 'cancelIdCode':
      this._cancelIdCode()
      break
    case 'idVerificationFailedOk':
    case 'idCodeFailedCancel':
    case 'idVerificationErrorOk':
      this._restart()
      break
    case 'idCodeFailedRetry':
      this._transitionState('idCode')
      break
    case 'cancelScan':
      this._cancelScan()
      break
    case 'badPhoneNumberOk':
      this._registerPhone()
      break
    case 'badSecurityCodeOk':
      this._phoneNumber(this.currentPhoneNumber)
      break
    case 'cancelPhoneNumber':
    case 'cancelSecurityCode':
    case 'maxPhoneRetriesOk':
      this._cancelPhone()
      break
    case 'fiatReceipt':
      this._fiatReceipt()
      break
    case 'cancelInsertBill':
      this._cancelInsertBill()
      break
    case 'sendBitcoins':
      this._sendBitcoins()
      break
    case 'completed':
      this._completed()
      break
    case 'machine':
      this._machine()
      break
    case 'cancelMachine':
      this._cancelMachine()
      break
    case 'powerOff':
      this._powerOffButton()
      break
    case 'cam':
      this._cam()
      break
    case 'fixTransaction':
      this._fixTransaction()
      break
    case 'abortTransaction':
      this._abortTransaction()
      break
    case 'startFiat':
      this._chooseFiat()
      break
    case 'chooseFiatCancel':
      this._chooseFiatCancel()
      break
    case 'fiatButton':
      this._fiatButton(req.data)
      break
    case 'clearFiat':
      this._clearFiat()
      break
    case 'depositCancel':
      this._idle()
      break
    case 'depositTimeout':
      this._depositTimeout()
      break
    case 'cashOut':
      this._cashOut()
      break
    case 'phoneNumber':
      this._phoneNumber(req.data)
      break
    case 'securityCode':
      this._securityCode(req.data)
      break
    case 'redeem':
      this._redeem()
      break
    case 'changeLanguage':
      this._timedState('changeLanguage')
      break
    case 'setLocale':
      this._setLocale(req.data)
      break
    case State.IDLE:
      this._idle()
      break
    case 'tapDance':
      this._admin()
      break
    case 'pairingCode':
      this._pairingCode(req.data)
      break
    case 'pairing':
      this._pairing()
      break
    case 'initializeCrypto':
      this._initialize()
      break
  }
}

Brain.prototype._setState = function _setState (state, oldState) {
  if (this.state === state) return

  if (oldState) this._assertState(oldState)

  if (this.currentScreenTimeout) {
    clearTimeout(this.currentScreenTimeout)
    this.currentScreenTimeout = null
  }
  this.state = state
  this.emit(state)
  this.emit('newState', state)
}

Brain.prototype._locked = function _locked () {
  this._setState('lockedPass', 'locked')
  this.browser().send({action: 'lockedPass'})
}

Brain.prototype._unlock = function _unlock () {
  this._wifiList()
}

Brain.prototype._cancelLockPass = function _cancelLockPass () {
  this._setState('locked', 'lockedPass')
  this.browser().send({action: 'locked'})
}

Brain.prototype._wifiList = function _wifiList () {
  this._setState('wifiList')
  this.browser().send({action: 'wifiList'})
}

Brain.prototype._wifiPass = function _wifiPass (data) {
  this.browser().send({action: 'wifiPass', wifiSsid: data})
  this.wifi.stopScanning()
  this._setState('wifiPass')
  console.log('connecting to %s', data.ssid)
}

Brain.prototype._wifiConnect = function _wifiConnect (data) {
  this._setState('wifiConnecting', 'wifiPass')
  this.browser().send({action: 'wifiConnecting'})
  var rawSsid = data.rawSsid
  var ssid = data.ssid
  var self = this
  this.wifi.connect(rawSsid, ssid, data.pass, function (err, ip) {
    if (err) {
      // TODO: error screen
      console.log(err.stack)
      var ssidData = {
        ssid: ssid,
        displaySsid: self.wifi.displaySsid(ssid)
      }
      self._wifiPass(ssidData)
    } else {
      self.config.ip = ip
      self._wifiConnected()
    }
  })
}

Brain.prototype._cancelWifiList = function _cancelWifiList () {
  //  this._setState('locked', 'wifiList')
  //  this.browser().send({action: 'locked'})
}

Brain.prototype._cancelWifiPass = function _cancelWifiPass () {
  this.browser().send({action: 'wifiList'})
  this.wifi.startScanning()
  this._setState('wifiList', 'wifiPass')
}

Brain.prototype._wifiConnecting = function _wifiConnecting () {
  this._setState('wifiConnecting')
  this.browser().send({action: 'wifiConnecting'})
}

Brain.prototype._wifiConnected = function _wifiConnected () {
  if (this.state === 'maintenance') return
  this._setState('wifiConnected')

  this._connect()
}

Brain.prototype._isTestMode = function _isTestMode () {
  return this.testModeOn
}

Brain.prototype._testMode = function _testMode () {
  var self = this
  this.testModeOn = true
  this.traderOld = this.trader
  this.trader.removeAllListeners()
  this.trader = require('./mocks/trader')()
  this._initTraderEvents()
  this.networkDown = false
  this.getBillValidator().run(function () {
    self._idle()
  })
}

Brain.prototype._testModeOff = function _testModeOff () {
  var self = this
  this.getBillValidator().close(function () {
    self.testModeOn = false
    self.pairing._connectionInfo = null
    self.trader.removeAllListeners()
    self.trader = self.traderOld
    self._initTraderEvents()
    self._transitionState('virgin')
  })
}

function buildUiCartridges (cartridges, virtualCartridges) {
  return R.sort(R.union(cartridges, virtualCartridges))
}

Brain.prototype._idle = function _idle (locale) {
  if (!masterKey) return this._transitionState('virgin')
  this.trader.sessionId = uuid.v4()
  console.log('New sessionId: %s', this.trader.sessionId)
  this.getBillValidator().lightOff()
  this.idVerify.reset()
  this.currentPhoneNumber = null
  this.currentSecurityCode = null
  this.secured = false
  this.rejected = false
  this.redeem = false
  this.fiatTx = null
  this.fiatTxStarted = false
  this.pairingDevicePublicKey = null
  this._setState(State.PENDING_IDLE)

  if (this.networkDown) return this._networkDown()

  var localeInfo = _.cloneDeep(this.localeInfo)
  locale = locale || localeInfo.primaryLocale
  localeInfo.primaryLocale = locale

  // We've got our first contact with server
  if (this.trader.twoWayMode) {
    this._idleTwoWay(localeInfo)
  } else {
    this._idleOneWay(localeInfo)
  }
}

Brain.prototype._idleTwoWay = function _idleTwoWay (localeInfo) {
  var self = this
  var cartridges = this.trader.cartridges
  var virtualCartridges = this.trader.virtualCartridges
  var uiCartridges = buildUiCartridges(cartridges, virtualCartridges)
  this.uiCartridges = uiCartridges

  if (!this.billDispenser) {
    this.billDispenser = this.rootConfig.mockBillDispenser
      ? require('./mocks/billdispenser').factory(this.rootConfig.billDispenser)
      : require('./billdispenser').factory(this.rootConfig.billDispenser)
  }

  if (!this.billDispenser.initialized) this._transitionState('booting')
  if (this.billDispenser.initializing) return

  this.billDispenser.init({
    cartridges: cartridges,
    currency: this.trader.locale.currency
  }, function () {
      self._transitionState('dualIdle',
        {localeInfo: localeInfo, cartridges: uiCartridges})
    })
}

Brain.prototype._idleOneWay = function _idleOneWay (localeInfo) {
  this._transitionState(State.IDLE, {localeInfo: localeInfo})
}

Brain.prototype._setLocale = function _setLocale (data) {
  var self = this
  this._idle(data.locale)
  this._screenTimeout(function () { self._idle() }, 30000)
}

Brain.prototype._balanceLow = function _balanceLow () {
  var self = this

  function timeoutHandler () {
    self._idle()
  }

  function timeout () {
    self._screenTimeout(timeoutHandler, 10000)
  }

  this._transitionState('balanceLow')
  timeout()
}

Brain.prototype._start = function _start () {
  if (this.startDisabled) return

  var fiatBalance = this.trader.balance
  var highestBill = this.getBillValidator().highestBill(fiatBalance)

  if (!highestBill) return this._balanceLow()
  this._startAddressScan()
}

Brain.prototype._startIdScan = function _startIdScan () {
  var self = this
  this._transitionState('scanId', {beep: true})
  var sessionId = this.trader.sessionId
  this.idVerify.reset()
  this.getBillValidator().lightOn()
  this.scanner.scanPDF417(function (err, result) {
    self.startDisabled = false
    self.billValidator.lightOff()
    clearTimeout(self.screenTimeout)

    if (err) throw err
    var startState = _.contains(['scanId', 'fakeIdle', 'fakeDualIdle'], self.state)
    var freshState = self.trader.sessionId === sessionId && startState
    if (!freshState) return
    if (!result) return self._idle()
    self.idVerify.addLicense(result)
    self._verifyId({beep: true})
  })
  this.screenTimeout = setTimeout(function () {
    if (self.state !== 'scanId') return
    self.scanner.cancel()
  }, this.config.qrTimeout)
}

Brain.prototype._cancelIdScan = function _cancelIdScan () {
  this.startDisabled = true
  this._fakeIdle()
  this.scanner.cancel()
}

Brain.prototype._cancelIdCode = function _cancelIdCode () {
  this._idle()
}

function gcd (a, b) {
  if (b) return gcd(b, a % b)
  return Math.abs(a)
}

Brain.prototype._startAlternatingLight = function _startAlternatingLight () {
  var self = this
  var lastState = 'on'
  var onInterval = this.config.scanLightOnInterval
  var offInterval = this.config.scanLightOffInterval
  var smallInterval = gcd(onInterval, offInterval)
  var onSkip = onInterval / smallInterval
  var offSkip = offInterval / smallInterval
  var count = 0

  if (!onInterval) return
  if (!offInterval) return this.getBillValidator().lightOn()

  this.getBillValidator().lightOn()
  this.alternatingLightTimer = setInterval(function () {
    count++
    if (lastState === 'off') {
      if (count < offSkip) return
      self.billValidator.lightOn()
      lastState = 'on'
    } else {
      if (count < onSkip) return
      self.billValidator.lightOff()
      lastState = 'off'
    }
    count = 0
  }, smallInterval)
}

Brain.prototype._stopAlternatingLight = function _stopAlternatingLight () {
  clearInterval(this.alternatingLightTimer)
  this.getBillValidator().lightOff()
}

Brain.prototype._startAddressScan = function _startAddressScan () {
  this._transitionState('scanAddress')
  var self = this
  var sessionId = this.trader.sessionId

  this._startAlternatingLight()
  this.scanner.scanMainQR(function (err, address) {
    self._stopAlternatingLight()
    clearTimeout(self.screenTimeout)
    self.startDisabled = false

    if (err) self.emit('error', err)
    var startState = _.contains(['scanAddress', 'fakeIdle', 'fakeDualIdle'],
      self.state)
    var freshState = self.trader.sessionId === sessionId && startState

    if (!freshState) return
    if (!address) return self._idle()
    self._handleScan(address)
  })
  this.screenTimeout = setTimeout(function () {
    if (self.state !== 'scanAddress') return
    self.scanner.cancel()
  }, this.config.qrTimeout)
}

Brain.prototype._verifyId = function _verifyId (options) {
  var beep = options && options.beep
  this._transitionState('verifyingId', {beep: beep})
  var self = this
  this.idVerify.verifyUser(function (err, result) {
    if (!err && result.success) return self._firstBill()

    // The rest of these screens require user input and need a timeout
    var nextState
    if (err) {
      nextState = 'idVerificationError'
    } else if (result.errorCode === 'codeMismatch') {
      nextState = 'idCodeFailed'
    } else {
      nextState = 'idVerificationFailed'
    }

    self._transitionState(nextState)
    self._screenTimeout(self._restart.bind(self), self.config.confirmTimeout)
  })
}

Brain.prototype._idCode = function _idCode (code) {
  if (code === null) return this._restart()    // Timeout
  var paddedCode = String('0000' + code).slice(-4)  // Pad with zeros
  this.idVerify.addLicenseCode(paddedCode)
  this._verifyId()
}

Brain.prototype._fakeIdle = function _fakeIdle () {
  var idleState = this.trader.twoWayMode ? 'fakeDualIdle' : 'fakeIdle'
  this._transitionState(idleState)
}

Brain.prototype._cancelScan = function _cancelScan () {
  this.startDisabled = true
  this._fakeIdle()
  this.scanner.cancel()
}

Brain.prototype._cancelInsertBill = function _cancelInsertBill () {
  this._idle()
  this.getBillValidator().disable()
}

Brain.prototype._exchangeRateRec = function _exchangeRateRec (rate) {
  if (!rate) return null
  var fiatToXbt = truncateBitcoins(1 / rate)
  return {
    xbtToFiat: rate,
    fiatToXbt: fiatToXbt
  }
}

Brain.prototype._needsIdleRefresh = function _needsIdleRefresh () {
  var trader = this.trader
  if (this.state === State.IDLE && trader.twoWayMode) return true
  if (this.state === 'dualIdle' && !trader.twoWayMode) return true
  return false
}

Brain.prototype._pollUpdate = function _pollUpdate () {
  var locale = this.trader.locale
  this.currency = locale.currency
  this.localeInfo = locale.localeInfo
  var rec = {
    currency: this.currency,
    exchangeRate: this._exchangeRateRec(this.trader.exchangeRate),
    fiatExchangeRate: this.trader.fiatExchangeRate
  }

  this.browser().send(rec)

  if (this._needsIdleRefresh()) this._idle()
}

Brain.prototype._networkDown = function _networkDown () {
  this.networkDown = true
  if (_.contains(BILL_ACCEPTING_STATES, this.state)) {
    this.getBillValidator().disable()
    this.browser().send({sendOnly: true})
    return
  }
  if (!_.contains(STATIC_STATES, this.state)) return
  this._forceNetworkDown()
}

Brain.prototype._forceNetworkDown = function _forceNetworkDown () {
  var self = this
  if (!this.hasConnected && this.state !== 'connecting') {
    this._transitionState('connecting')
    setTimeout(function () {
      self.hasConnected = true
      if (self.state === 'connecting') self._idle()
    }, self.config.connectingTimeout)
    return
  }

  if (this.hasConnected) this._transitionState(State.NETWORK_DOWN)
}

Brain.prototype._networkUp = function _networkUp () {
  // Don't go to start screen yet
  if (!this.getBillValidator().hasDenominations()) return

  this.networkDown = false
  if (_.contains([State.NETWORK_DOWN, 'connecting', 'wifiConnected'], this.state)) {
    this._restart()
  }
}

Brain.prototype._timedState = function _timedState (state, opts) {
  var self = this
  opts = opts || {}

  if (this.state === state) {
    console.trace('WARNING: Trying to set to same state: %s', state)
    return
  }
  var timeout = opts.timeout || 30000
  var handler = opts.revertState
    ? function () { self._transitionState(opts.revertState) }
    : function () { self._idle() }

  this._transitionState(state, opts.data)
  this._screenTimeout(handler, timeout)
}

Brain.prototype._transitionState = function _transitionState (state, auxData) {
  // TODO refactor code to use this
  // If we're in maintenance state, we stay there till we die
  if (this.state === state || this.state === 'maintenance') return
  var rec = {action: state}
  if (auxData) _.merge(rec, auxData)
  this._setState(state)
  this.browser().send(rec)
}

Brain.prototype._bitcoinFractionalDigits = function _bitcoinFractionalDigits (amount) {
  var log = Math.floor(Math.log(amount) / Math.log(10))
  return (log > 0) ? 2 : 2 - log
}

Brain.prototype._restart = function _restart () {
  console.assert(!this.billsPending, "Shouldn't restart, bills are pending!")
  this._resetState()
  this.getBillValidator().disable()
  this._idle()
}

Brain.prototype._assertState = function _assertState (expected) {
  var actual = this.state
  console.assert(actual === expected,
    'State should be ' + expected + ', is ' + actual)
}

Brain.prototype._handleScan = function _handleScan (address) {
  this.address = address
  var checkId = this.trader.idVerificationEnabled
  if (checkId) return this._startIdScan()
  this._firstBill()
}

Brain.prototype._firstBill = function _firstBill () {
  var address = this.address
  this.browser().send({action: 'scanned', buyerAddress: address})
  this._setState('acceptingFirstBill')
  this.getBillValidator().enable()
  this._screenTimeout(this._restart.bind(this), this.config.billTimeout)
}

// Bill validating states

Brain.prototype._billInserted = function _billInserted () {
  this.browser().send({action: 'acceptingBill'})
  this._setState('billInserted')
}

Brain.prototype._billRead = function _billRead (data) {
  this._createPendingTransaction(data.denomination)

  var billValidator = this.getBillValidator()
  var highestBill = null
  var totalFiat = this.credit.fiatValue + this.pending.fiatValue
  var returnState

  // Trader balance is balance as of start of user session.
  // Reduce it by fiat we owe user.
  var fiatBalance = this.trader.balance - totalFiat

  var txLimit = this.trader.txLimit
  if (txLimit && totalFiat > txLimit) {
    billValidator.reject()
    this.pending = null
    returnState = this.credit.fiatValue === 0
      ? 'acceptingFirstBill'
      : 'acceptingBills'
    this._setState(returnState, 'billInserted')

    // If we're here, there's a highestBill.
    // Otherwise, we'd be rejecting all bills and we'd be in sendOnly mode.
    highestBill = billValidator.highestBill(txLimit - this.credit.fiatValue)

    this.browser().send({
      action: 'highBill',
      highestBill: highestBill,
      reason: 'transactionLimit'
    })
    return
  }

  if (fiatBalance >= 0) {
    billValidator.stack()
    highestBill = billValidator.highestBill(fiatBalance)
    var sendOnly = (highestBill === null)
    if (sendOnly) {
      billValidator.disable()
    }
    this.browser().send({
      action: 'acceptingBill',
      credit: this._uiCredit(),
      sendOnly: sendOnly
    })
    this._setState('billRead')
  } else {
    billValidator.reject()
    this.pending = null
    returnState = this.credit.fiatValue === 0
      ? 'acceptingFirstBill'
      : 'acceptingBills'
    this._setState(returnState, 'billInserted')
    var newFiatBalance = this.trader.balance - this.credit.fiatValue
    var newHighestBill = billValidator.highestBill(newFiatBalance)

    if (newHighestBill) {
      this.browser().send({
        action: 'highBill',
        highestBill: newHighestBill,
        reason: 'lowBalance'
      })
    } else {
      billValidator.disable()
      this.browser().send({credit: this._uiCredit(), sendOnly: true})
    }
  }
}

Brain.prototype._billValid = function _billValid () {
  this._setState('acceptingBills', 'billRead')
  var pending = this.pending

  // No going back
  this.billsPending = true

  // Update running total
  this.pending = null
  this.credit.fiatValue += pending.fiatValue
  this.credit.tokenValue += pending.tokenValue
  this.credit.lastBill = pending.fiatValue

  var self = this

  // Puts in the trade to cover currency exchange risk
  // and replenish bitcoin reserves
  var tradeRec = _.clone(pending)
  tradeRec.currency = this.currency  // TODO: This should be a per tx attribute
  tradeRec.uuid = uuid.v4() // unique bill ID
  tradeRec.deviceTime = Date.now()
  tradeRec.address = this.address
  tradeRec.partialTx = _.clone(this.credit)

  this.trader.trade(tradeRec, function (err) {
    if (!err) {
      self.creditConfirmed.fiatValue += pending.fiatValue
      self.creditConfirmed.tokenValue += pending.tokenValue
    }
  })

  var txLimit = this.trader.txLimit
  var billValidator = this.getBillValidator()
  if (txLimit !== null &&
    this.credit.fiatValue + billValidator.lowestBill() > txLimit) {
    billValidator.disable()
    this.browser().send({credit: this._uiCredit(), sendOnly: 'transactionLimit'})
  }

  this.log('transactions', {
    event: 'note-inserted',
    sessionId: this.trader.sessionId,
    fiatValue: pending.fiatValue,
    currency: this.currency
  })

  this._screenTimeout(function () { self._sendBitcoins() },
    this.config.billTimeout)

  if (this.sendOnValid) {
    this.sendOnValid = false
    this._doSendBitcoins()
  }
}

// TODO: clean this up
Brain.prototype._billRejected = function _billRejected () {
  this.browser().send({action: 'rejectedBill'})
  this.pending = null
  var returnState = this.credit.fiatValue === 0
  ? 'acceptingFirstBill'
  : 'acceptingBills'
  this._setState(returnState)
  var credit = this._uiCredit()
  if (!credit.fiatValue || credit.fiatValue === 0) credit = null
  var response = {
    action: 'rejectedBill',
    credit: credit
  }

  if (this.sendOnValid) {
    this.sendOnValid = false
    if (credit !== null) {
      this._setState('acceptingBills')
      this._doSendBitcoins()
      this.browser().send({credit: credit})
      return
    }
    response.action = 'acceptingFirstBill'
  }

  this.browser().send(response)
}

Brain.prototype._billStandby = function _billStandby () {
  if (this.state === 'acceptingBills' || this.state === 'acceptingFirstBill') {
    this.getBillValidator().enable()
  }
}

Brain.prototype._billJam = function _billJam () {
  // TODO FIX: special screen and state for this
  this.browser().send({action: State.NETWORK_DOWN})
}

Brain.prototype._billsEnabled = function _billsEnabled (data) {
  console.log('Bills enabled codes: 0x%s, 0x%s', data.data1.toString(16),
    data.data2.toString(16))
}

Brain.prototype._uiCredit = function _uiCredit () {
  var credit = this.credit
  var fiat = credit.fiatValue
  var tokenValue = credit.tokenValue
  var lastBill = null

  if (this.pending) {
    var pending = this.pending
    fiat += pending.fiatValue
    tokenValue += pending.tokenValue
    lastBill = pending.fiatValue
  } else {
    lastBill = credit.lastBill
  }

  return {
    fiatValue: fiat,
    tokenValue: tokenValue,
    lastBill: lastBill
  }
}

Brain.prototype._createPendingTransaction = function _createPendingTransaction (bill) {
  console.assert(this.pending === null, "pending is null, can't start tx")
  var exchangeRate = this.trader.exchangeRate
  console.assert(exchangeRate, 'Exchange rate not set')
  var satoshiRate = SATOSHI_FACTOR / exchangeRate
  var tokenValue = truncatetokenValue(bill * satoshiRate)

  this.pending = {
    fiatValue: bill,
    exchangeRate: exchangeRate.toFixed(PRICE_PRECISION),
    tokenValue: tokenValue
  }
}

Brain.prototype._sendBitcoins = function _sendBitcoins () {
  this.browser().send({
    action: 'bitcoinTransferPending',
    buyerAddress: this.address
  })

  if (this.state === 'acceptingBills') this._doSendBitcoins()
  else this.sendOnValid = true
}

Brain.prototype._doSendBitcoins = function _doSendBitcoins () {
  this._setState('bitcoinsSent', 'acceptingBills')
  this.getBillValidator().disable()

  this.pending = null

  this.lastTransaction = {
    address: this.address,
    credit: this._uiCredit()
  }

  var self = this
  var tokenValue = truncatetokenValue(this.credit.tokenValue)
  this.credit.tokenValue = tokenValue

  this._verifyTransaction()

  let tx = {
    event: 'token-send-request',
    sessionId: this.trader.sessionId,
    tokenValue: tokenValue,
    fiatValue: this.credit.fiatValue,
    address: this.address,
    currency: this.currency
  }

  this.log('transactions', tx)

  let send$ = wallet.send(tx.address, tx.tokenValue)
  send$.subscribe(
    txHash => self._cashInComplete(txHash),
    err => self._sendBitcoinsError(err)
  )
}

// Giving up, go to special screens asking user to contact operator
Brain.prototype._sendBitcoinsError = function _sendBitcoinsError (err) {
  console.log('Error sending bitcoins: %s', err.message)

  this.log('transactions', {
    event: 'token-send',
    sessionId: this.trader.sessionId,
    tokenValue: this.credit.tokenValue,
    fiatValue: this.credit.fiatValue,
    address: this.address,
    currency: this.currency,
    errorStatus: err.status,
    errorMessage: err.message,
    status: 'error'
  })

  var withdrawFailureRec = {
    credit: this._uiCredit(),
    sessionId: this.trader.sessionId
  }

  // Giving up
  this.billsPending = false
  this._resetState()

  var self = this

  if (err.status === 'InsufficientFunds') {
    setTimeout(function () { self._idle() }, self.config.insufficientFundsTimeout)
    return this._transitionState('insufficientFunds')
  }

  this._transitionState('withdrawFailure', withdrawFailureRec)
  this._timeoutToIdle(60000)
}

function bitcoinFractionalDigits (amount) {
  var log = Math.floor(Math.log(amount) / Math.log(10))
  return (log > 0) ? 2 : 2 - log
}

function truncateBitcoins (bitcoins) {
  var decimalDigits = bitcoinFractionalDigits(bitcoins)
  var adjuster = Math.pow(10, decimalDigits)
  return (Math.round(bitcoins * adjuster) / adjuster)
}

function truncatetokenValue (tokenValue) {
  var bitcoins = tokenValue / SATOSHI_FACTOR
  var truncated = truncateBitcoins(bitcoins)
  return Math.round(truncated * SATOSHI_FACTOR)
}

// And... we're done!
Brain.prototype._cashInComplete = function _cashInComplete (txHash) {
  this._setState('completed')

  this.browser().send({
    action: 'bitcoinTransferComplete',
    sessionId: this.trader.sessionId
  })

  this.log('transactions', {
    event: 'token-send',
    sessionId: this.trader.sessionId,
    tokenValue: this.credit.tokenValue,
    fiatValue: this.credit.fiatValue,
    address: this.address,
    currency: this.currency,
    txHash: txHash,
    status: 'success'
  })

  this.billsPending = false
  this._resetState()
  this._screenTimeout(this._completed.bind(this), this.config.completedTimeout)
}

Brain.prototype._verifyTransaction = function _verifyTransaction () {
  if (!this.idVerify.inProgress()) return

  var transaction = {
    address: this.address,
    currency: this.currency,
    tokenValue: this.credit.fiatValue,
    buyOrSell: 'buy'
  }
  this.idVerify.addTransaction(transaction)
  this.idVerify.verifyTransaction(function (err) { console.log(err) })
}

Brain.prototype._screenTimeoutHandler = function _screenTimeoutHandler (callback) {
  this.currentScreenTimeout = null
  callback()
}

Brain.prototype._screenTimeout = function _screenTimeout (callback, timeout) {
  console.assert(!this.currentScreenTimeout,
    "Can't have two screen timeouts at once")
  var self = this
  this.currentScreenTimeout =
    setTimeout(function () { self._screenTimeoutHandler(callback) }, timeout)
}

Brain.prototype._timeoutToIdle = function _timeoutToIdle (timeout) {
  var self = this
  this._screenTimeout(function () { self._idle() }, timeout)
}

Brain.prototype._completed = function _completed () {
  if (this.state === 'goodbye' || this.state === 'maintenance') return
  if (this._isTestMode()) return this._testModeOff()

  this._transitionState('goodbye')

  this.trader.sessionId = null

  var elapsed = Date.now() - this.bootTime
  if (elapsed > this.config.exitTime) {
    console.log('Scheduled restart.')
    process.exit()
  }

  if (this.billValidatorErrorFlag) {
    this._transitionState('maintenance')
    this.emit('error', new Error('Bill validator error, exiting post transaction.'))
  }

  this._screenTimeout(this._restart.bind(this), this.config.goodbyeTimeout)
}

Brain.prototype._machine = function _machine () {
  this.browser().send({action: 'machine', machineInfo: this.config.unit})
  this._setState('machine')
}

Brain.prototype._cancelMachine = function _cancelMachine () {
  this._idle()
}

Brain.prototype._powerOffButton = function _powerOffButton () {
  var self = this
  this.wifi.clearConfig(function () {
    self._powerOff()
  })
}

Brain.prototype._powerOff = function _powerOff () {
  this._setState('powerOff')
  console.log('powering off')
  cp.execFile('poweroff', ['-d', '2'], {}, function () {
    process.exit(0)
  })
}

Brain.prototype._fixTransaction = function _fixTransaction () {
  this._setState('fixTransaction')
  this.browser().send({
    action: 'fixTransaction',
    lastTransaction: this.lastTransaction
  })
}

Brain.prototype._abortTransaction = function _abortTransaction () {
  this.billsPending = false
  this._restart()
}

Brain.prototype._resetState = function _resetState () {
  console.assert(!this.billsPending, "Can't reset, bills are pending.")
  this.address = null
  this.credit.fiatValue = 0
  this.credit.tokenValue = 0
  this.credit.lastBill = null
  this.creditConfirmed.fiatValue = 0
  this.creditConfirmed.tokenValue = 0
  this.pending = null
}

Brain.prototype._setupCheckPower = function _setupCheckPower () {
  var self = this
  setInterval(function () {
    self._checkPower()
  }, this.config.checkPowerTime)
}

// This can only get called when we're not in a transaction
Brain.prototype._checkPower = function _checkPower () {
  if (!_.contains(STATIC_STATES, this.state)) return

  // TODO: factor this out to a device-specific module
  var powerStatusPath = this.config.powerStatus
  if (!powerStatusPath) return

  var self = this
  fs.readFile(powerStatusPath, {encoding: 'utf8'}, function (err, res) {
    if (err) {
      console.log(err.stack)
      return
    }
    if (res.match(/^Discharging/)) {
      console.log('Sensed power down.')
      self.powerDown = true
      var elapsed = Date.now() - self.lastPowerUp > self.config.checkPowerTimeout
      if (!elapsed) return
      console.log('Device unplugged. Powering down. Forgetting WiFi.')
      self._setState('powerDown')
      self.wifi.clearConfig(function () {
        self._powerOff()
        return
      })
    }
    self.powerDown = false
    self.lastPowerUp = Date.now()
  })
}

Brain.prototype._restartService = function _restartService () {
  return process.exit(0)
}

Brain.prototype._unpair = function _unpair () {
  var self = this

  console.log('Unpairing')
  self.trader.stop()
  self.pairing.unpair(function () {
    console.log('Unpaired. Rebooting...')
    self._setState('unpaired')
    self.browser().send({action: 'unpaired'})
    setTimeout(function () { self._restartService() }, 2000)
  })
}

Brain.prototype._billValidatorErr = function _billValidatorErr (err) {
  var self = this
  if (!err) err = new Error('Bill Validator error')

  if (this.billValidatorErrorFlag) return // Already being handled

  if (this.billsPending) {
    this.billValidatorErrorFlag = true
    this.getBillValidator().disable() // Just in case. If error, will get throttled.
    this.browser().send({credit: this._uiCredit(), sendOnly: true})
    return
  }

  if (this.powerDown) return
  self._transitionState('maintenance')
  setTimeout(function () { self.emit('error', err) }, 15000)
}

Brain.prototype._getFiatButtonResponse = function _getFiatButtonResponse () {
  var tx = this.fiatTx
  var cartridges = this.trader.cartridges
  var virtualCartridges = this.trader.virtualCartridges
  var txLimit = this.trader.fiatTxLimit
  var txAmount = tx.fiatValue

  function denominationIsAvailable (denom) {
    var pendingAmount = txAmount + denom
    var active = !!BillMath.makeChange(effectiveBills, cartridges, pendingAmount)
    console.log(active)
    return active
  }

  function denominationUnderLimit (denom) {
    var pendingAmount = txAmount + denom
    return pendingAmount <= txLimit
  }

  var denominationIsActive = R.both(denominationUnderLimit, denominationIsAvailable)
  var denoms = R.union(virtualCartridges, cartridges)
  var activeDenoms = R.zip(denoms, R.map(denominationIsActive, denoms))
  var activeMap = R.fromPairs(activeDenoms)
  var noMore = !R.any(R.identity, R.values(activeMap))
  var txLimitReached = noMore && R.any(denominationIsAvailable, denoms)
  var isEmpty = noMore && !txLimitReached

  var response = {
    credit: tx,
    activeDenominations: {
      isEmpty: isEmpty,
      txLimitReached: txLimitReached,
      activeMap: activeMap
    }
  }

  return response
}

Brain.prototype._outOfCash = function _outOfCash () {
  var self = this

  function timeoutHandler () {
    self._idle()
  }

  function timeout () {
    self._screenTimeout(timeoutHandler, 10000)
  }

  this._transitionState('outOfCash')
  timeout()
}

Brain.prototype._chooseFiat = function _chooseFiat () {
  var sessionId = this.trader.sessionId
  this.fiatTx = {
    sessionId: this.trader.sessionId,
    tokenValue: 0,
    fiatValue: 0,
    currency: this.currency,
    address: null
  }

  var response = this._getFiatButtonResponse()
  if (response.activeDenominations.isEmpty) return this._outOfCash()
  this._transitionState('chooseFiat', {chooseFiat: response})
  var self = this
  this.dirtyScreen = false
  var interval = setInterval(function () {
    var doClear = self.state !== 'chooseFiat' ||
      self.trader.sessionId !== sessionId
    if (doClear) return clearInterval(interval)

    var isDirty = self.dirtyScreen
    self.dirtyScreen = false
    if (isDirty) return
    clearInterval(interval)
    self._idle()
  }, 120000)
}

Brain.prototype._chooseFiatCancel = function _chooseFiatCancel () {
  this._idle()
}

Brain.prototype._fiatButtonResponse = function _fiatButtonResponse () {
  this.dirtyScreen = true
  var response = this._getFiatButtonResponse()
  this.browser().send({fiatCredit: response})
}

Brain.prototype._fiatButton = function _fiatButton (data) {
  var denomination = parseInt(data.denomination, 10)
  var rate = this.trader.fiatExchangeRate
  var tx = this.fiatTx

  var buttons = this._getFiatButtonResponse()

  // We should always have enough available if the button could be pressed,
  // just double-checking
  if (buttons.activeDenominations.activeMap[denomination]) {
    tx.fiatValue += denomination
    tx.tokenValue += truncatetokenValue((denomination / rate) * 1e8)
  }

  this._fiatButtonResponse()
}

Brain.prototype._clearFiat = function _clearFiat () {
  var tx = this.fiatTx

  tx.fiatValue = 0
  tx.tokenValue = 0

  this._fiatButtonResponse()
}

Brain.prototype._registerPhone = function _registerPhone () {
  this._transitionState('registerPhone', {redeem: this.redeem})
}

Brain.prototype._registerCode = function _registerCode () {
  this._transitionState('registerCode')
}

Brain.prototype._sendSecurityCode = function _sendSecurityCode (number) {
  var self = this

  sms.phoneCode(number)
  .then(code => {
    self.currentPhoneNumber = number
    self.currentSecurityCode = code
  })
  .catch(err => {
    if (err instanceof error.BadPhoneNumberError) {
      return self._timedState('badPhoneNumber')
    }
    self.logError(err)
    return self._fiatError()
  })
}

Brain.prototype.logError = function logError (err) {
  this.log('errors', {
    version: version,
    name: err.name,
    message: err.message,
    stack: err.stack,
    sessionId: this.trader.sessionId
  })
}

Brain.prototype._processPhoneNumber = function _processPhoneNumber (number) {
  if (this.redeem) {
    let sessionIds = phoneMap.get(number)
    if (!sessionIds || sessionIds.size === 0) return this._timedState('unknownPhoneNumber')

    let tx = Array.from(sessionIds).map(r => sessionMap.get(r))
    .filter(r => r.blockchainStatus === 'confirmed')[0]

    this.fiatTx = tx
  }

  this._sendSecurityCode(number)
}

Brain.prototype._phoneNumber = function _phoneNumber (number) {
  var self = this

  if (!number) return this._idle()

  process.nextTick(function () { self._processPhoneNumber(number) })
  this._registerCode()
}

Brain.prototype._securityCode = function _securityCode (code) {
  if (!code) return this._idle()

  if (code !== this.currentSecurityCode) {
    return this._timedState('badSecurityCode')
  }

  if (this.redeem && !this.fiatTx) {
    return this._timedState('unconfirmedDeposit')
  }

  this.secured = true
  this.fiatTx.phone = this.currentPhoneNumber

  if (this.redeem) return this._dispense()

  if (this.fiatTxStarted) {
    let tx = this.fiatTx
    this.log('transactions', R.merge(tx, {event: 'fiat-phone'}))
  }

  this._cashOut()
}

Brain.prototype._cancelPhone = function _cancelPhone () {
  if (this.redeem) return this._idle()
  if (this.rejected) return this._timedState('preReceipt')
  this._idle()
}

Brain.prototype._cashOut = function _cashOut () {
  var self = this
  var tx = this.fiatTx
  var cartridges = this.trader.cartridges

  tx.cartridges = BillMath.makeChange(effectiveBills, cartridges, tx.fiatValue)

  // Need this here because user may have indicated he didn't send coins
  // after trader.cashOut().
  this.fiatTxStarted = false

  if (tx.fiatValue > this.trader.zeroConfLimit && !this.secured) {
    return this._registerPhone()
  }

  if (this.rejected && this.secured) {
    return this._timedState('redeemLater')
  }

  this._transitionState('deposit', {tx: tx})

  console.log('DEBUG34')

  // User asked for another chance
  if (tx.address) {
    this._waitForDispense()
    return this.browser().send({depositInfo: tx})
  }

  wallet.newAddress().subscribe(
    address => {
      tx.address = address
      self.fiatTxStarted = true
      self.log('transactions', R.merge(tx, {event: 'fiat-dispense-request'}))
      self.browser().send({depositInfo: tx})
      self._waitForDispense()
    },
    () => self._fiatError()
  )
}

// User has deposited bitcoins but we haven't received them after waiting
Brain.prototype._depositTimeout = function _depositTimeout () {
  this.rejected = true
  this.fiatTxStarted = true

  if (this.secured) {
    return this._timedState('redeemLater')
  }

  this._registerPhone()
}

Brain.prototype._waitForDispense = function _waitForDispense () {
  var tx = this.fiatTx
  var transactionStatus$ = blockchain.transactionStatus(tx.address, tx.tokenValue)
  console.log('DEBUG33')
  transactionStatus$.subscribe(
    r => {
      tx.blockchainStatus = r
      this.log('transactions', R.merge(tx, {event: 'fiat-status'}))
      this._dispenseUpdate()
    },
    () => {
      this.log('transactions', R.merge(tx, {
        event: 'fiat-status',
        blockchainStatus: 'timeout'
      }))
      this._timedState('depositTimeout')
    }
  )
}

Brain.prototype._fiatError = function _fiatError () {
  console.trace('DEBUG: _fiatError')
  var state = this.fiatTxStarted ? 'fiatTransactionError' : 'fiatError'
  this._timedState(state)
}

Brain.prototype._dispense = function _dispense () {
  var fiatTx = this.fiatTx
  var dispensed = dispenseMap.get(fiatTx.sessionId)
  if (dispensed) return this._fiatError()
  this._physicalDispense(fiatTx)
}

Brain.prototype._physicalDispense = function _physicalDispense (tx) {
  var self = this
  var currency = tx.currency

  if (currency !== this.billDispenser.currency) {
    console.log('Wrong dispenser currency; dispenser: %s, tx: %s',
      this.billDispenser.currency, currency)
    return this._timedState('wrongDispenserCurrency')
  }

  this.billDispenser.dispense(tx.cartridges, function (err, result) {
    if (err) {
      return self._fiatError()
    }

    var cartridges = self.trader.cartridges
    var tx = self.fiatTx
    var sessionId = self.trader.sessionId
    var bills = result.bills
    var accepted = bills.map(r => r.accepted)
    var dispensed = R.sum(R.zipWith(R.multiply, accepted, cartridges))

    tx.cartridges = accepted

    let rejected = bills.map(r => r.rejected)
    if (rejected.some(r => r > 0)) {
      self.log({
        event: 'fiat-rejected',
        sessionId: tx.sessionId,
        cartridges: rejected
      })
    }

    self.log('transactions', R.merge(tx, {
      event: 'fiat-dispense',
      fiatValue: dispensed,
      errorStatus: result.err,
      status: result.err ? 'error' : 'success'
    }))

    var wasFullDispense = dispensed === tx.fiatValue

    if (!wasFullDispense) {
      return self._transitionState('outOfCash')
    }

    setTimeout(function () {
      var doComplete = self.state === 'fiatComplete' &&
        self.trader.sessionId === sessionId
      if (doComplete) {
        self._completed()
      }
    }, 60000)
    self._transitionState('fiatComplete', {tx: tx})
  })
  this._transitionState('dispensing')
}

Brain.prototype._dispenseUpdate = function _dispenseUpdate () {
  var tx = this.fiatTx
  if (this.state !== 'deposit' && this.state !== 'pendingDeposit') return

  var status = tx.blockchainStatus
  if (status !== 'confirmed' && this.secured) return this._timedState('redeemLater')

  var overZeroConfLimit = tx.fiatValue > this.trader.zeroConfLimit
  if (overZeroConfLimit) {
    console.log('WARNING: This shouldn\'t happen; over zero-conf limit and not secured')
    return this._registerPhone()
  }

  switch (status) {
    case 'rejected':
      this.rejected = true
      this._registerPhone()
      break
    case 'published':
      this._transitionState('pendingDeposit')
      break
    case 'authorized':
    case 'confirmed':
      this._dispense()
      break
  }
}

Brain.prototype._redeem = function _redeem () {
  this.redeem = true
  this._registerPhone()
}

Brain.prototype._fiatReceipt = function _fiatReceipt () {
  var tx = this.fiatTx
  this._timedState('fiatReceipt', {
    data: {tx: tx},
    timeout: 120000
  })
}

Brain.prototype._stackerOpen = function _stackerOpen () {
  if (!this.adminEntry) return
  this.adminEntry = false

  if (!masterKey) return this._timedState('initializeProceed')
  this._timedState('admin')
}

Brain.prototype._admin = function _admin () {
  if (!STATIC_STATES.includes(this.state)) return

  console.log('DEBUG50')
  var self = this
  var browser = this.browser()
  this.adminEntry = true
  browser.send({action: 'adminMode'})
  setTimeout(function () {
    self.adminEntry = false
    browser.send({action: 'unAdminMode'})
  }, 120000)
}

Brain.prototype._pairing = function _pairing () {
  const browser = this.browser()
  this._transitionState('pairing')
  pairing.register({
    machineId: machineId,
    publickKey: publicKey
  })
  .then(otp => {
    const mnemonic = bip39.entropyToMnemonic(otp.toString('hex'))
    browser.send({pairingMnemonic: mnemonic})
    return pairing.fetchDeviceRecord(machineId, otp)
  })
  .then(devicePublicKey => {
    this.pairingDevicePublicKey = devicePublicKey
    const hash = crypto.createHash('sha256').update(devicePublicKey).digest()
    const pairingAuth = bs10.encode(hash).slice(0, 4)
    this._timedState('pairingAuth', {data: {pairingAuth: pairingAuth}})
  })
}

Brain.prototype._pairingCode = function _pairingCode (code) {
  if (!code) return this._idle()
  const devicePubKey = this.pairingDevicePublicKey

  this.log('activity', {
    event: 'pairing',
    devicePubKey: devicePubKey
  })
}

Brain.prototype._initialize = function _initialize (code) {
  masterKey = crypto.randomBytes(16)
  const masterBs64 = masterKey.toString('base64')
  const mnemonic = bip39.entropyToMnemonic(masterKey.toString('hex'))
  const privKey = ursa.generatePrivateKey(4096)
  const privKeyEncKey = rcrypto.hkdf(masterKey, 'private-key-encryption-key')
  const privKeyEnc = rcrypto.encrypt(privKey, privKeyEncKey)
  const masterKeyFile = path.resolve(this.dataPath, 'master-key.dat')
  const masterKeyBakFile = path.resolve(this.dataPath, 'master-key.bak.dat')

  fs.writeFileSync(masterKeyFile, masterBs64)
  fs.writeFileSync(masterKeyBakFile, masterBs64)

  this.log('activity', {
    event: 'initialization',
    privKeyEnc: privKeyEnc
  })

  this.browser().send({initialize: mnemonic})
}

Brain.prototype.keyGeneration = function keyGeneration (gen) {
  this.log('activities', {
    event: 'rotateKeys',
    generation: gen
  })
}

Brain.prototype.getBillValidator = function getBillValidator () {
  return this.billValidator
}

Brain.prototype.setBillValidator = function setBillValidator (obj) {
  this.billValidator = obj
}

Brain.prototype.browser = function browser () {
  return this.browserObj
}

Brain.prototype.setBrowser = function setBrowser (obj) {
  this.browserObj = obj
}

function startsWithUSB (file) {
  return file.indexOf('ttyUSB') === 0
}

// This maps /sys style paths from USB hub positions to actual device paths
// Device paths are arbitrary, so we want to go by fixed hub positions, but
// node-serialport only takes device paths.
function determineDevicePath (path) {
  if (!path || path.indexOf('/sys/') !== 0) return path
  try {
    var files = fs.readdirSync(path)
    var device = _.find(files, startsWithUSB)
    return device ? '/dev/' + device : null
  } catch (e) {
    console.log('hub path not connected: ' + path)
    return null
  }
}

console.log('DEBUG38')

module.exports = Brain
