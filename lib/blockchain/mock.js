const Rx = require('rx')

exports.transactionStatus = function transactionStatus () {
  return Rx.Observable.from(['published', 'authorized', 'confirmed'])
  .zip(Rx.Observable.interval(1500), x => x)
}
