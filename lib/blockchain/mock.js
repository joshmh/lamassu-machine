import Rx from 'rx'

export function transactionStatus () {
  return Rx.Observable.from(['published', 'authorized', 'confirmed'])
  .zip(Rx.Observable.interval(1500), x => x)
}
