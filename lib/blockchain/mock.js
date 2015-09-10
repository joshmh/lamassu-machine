const Rx = require('rx')

exports.transactionStatus = function transactionStatus () {
  const states = ['published', 'authorized']
  const timer$ = Rx.Observable.interval(3000)
  return Rx.Observable.from(states).zip(timer$, x => x)

/*
  return Rx.Observable.merge(
    Rx.Observable.timer(3000).map(() => 'published'),
    Rx.Observable.timer(8000).flatMap(Rx.Observable.throw(new Error()))
  )
*/
}

exports.checkConfirmations = function checkConfirmations (pending) {
  return Rx.Observable.from(pending).delay(30000)
}
