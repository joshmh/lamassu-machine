let totalBuy = 0

exports.run = function run (trades$, config$) {
  return trades$.map(r => {
    if (r.event === 'note-inserted') {
      totalBuy += r.fiatValue
      if (totalBuy > 2) {
        let purchase = totalBuy
        totalBuy = 0
        return {
          fiatValue: purchase,
          currency: r.currency
        }
      }
      return null
    }
  })
  .filter(r => r)
}
