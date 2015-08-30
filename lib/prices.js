import Rx from 'rx'
import {requestStream} from './http/client'

export function stream (opts) {
  let interval$ = Rx.Observable.interval(opts.interval).startWith(0)

  return Rx.Observable.combineLatest(opts.config$, interval$, config => config)
  .flatMap((config) =>
    requestStream({
      uri: 'https://api.bitcoinaverage.com/ticker/global/' + config.locale.currency + '/'
    }),
    (config, res) => [config, res]
  )
  .map(([config, res]) => {
    let price = JSON.parse(res.body)
    config.exchangeRate = price.bid
    config.fiatExchangeRate = price.ask
    return config
  })
}
