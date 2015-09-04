import Rx from 'rx'

export function balance () {
  let interval$ = Rx.Observable.interval(60000).startWith(0)
  .map(() => 1 * 1e8)
  return interval$
}

export function send (address, amount) {
  console.log('DEBUG: sending %s mBTC to %s', (amount / 1e6).toFixed(3), address)
  return Rx.Observable.just(true)
}
