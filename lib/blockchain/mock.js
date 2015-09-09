const Rx = require('rx')

exports.transactionStatus = function transactionStatus () {
  const states = ['published', 'authorized']
  const timer$ = Rx.Observable.interval(3000)
  return Rx.Observable.from(states).zip(timer$, x => x)
}

exports.checkConfirmations = function checkConfirmations (pending) {
  return Rx.Observable.from(pending).delay(30000)
}
