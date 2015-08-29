import Rx from 'rx'
import R from 'ramda'
import {requestStream} from './http/client'

export function stream (opts) {
  let interval$ = Rx.Observable.interval(opts.interval).startWith(0)

  return Rx.Observable.combineLatest(opts.config$, interval$)
  .flatMap(([config]) =>
    requestStream({
      uri: 'https://api.bitcoinaverage.com/ticker/global/' + config.locale.currency + '/'
    }),
    (config, res) => [config, res]
  )
  .map(([outer, res]) => {
    let config = outer[0]
    let price = JSON.parse(res.body)
    config.exchangeRate = price.bid
    config.fiatExchangeRate = price.ask
    return config
  })
}
