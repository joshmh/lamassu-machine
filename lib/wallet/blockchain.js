const Rx = require('rx')
const requestStream = require('../http/client').requestStream

let config$

exports.init = function init (_config$) {
  config$ = _config$
}

exports.balance = function balance () {
  return Rx.Observable.interval(60000).startWith(0)
  .combineLatest(config$, (a, b) => b)
  .map(r => r.wallet.blockchain)
  .flatMap(config => requestStream({
    uri: 'https://blockchain.info/merchant/$guid/address_balance',
    qs: {
      password: config.password,
      address: config.address,
      confirmations: 1
    }
  }))
}

exports.send = function send (address, amount) {
  console.log('DEBUG: sending %s mBTC to %s', (amount / 1e6).toFixed(3), address)
  let err = new Error('InsufficientFunds')
  err.status = 'InsufficientFunds'
  // return Rx.Observable.throw(err)
  return Rx.Observable.just('a12b34f95483')
}

exports.newAddress = function newAddress () {
  return Rx.Observable.just('1xxxxxxxxxxxx')
}
