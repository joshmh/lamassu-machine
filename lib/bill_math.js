const pp = require('./pp')

// For now, just do special case of two cartridges; general problem is harder
exports.makeChange = function makeChange (cartridges, denominations, amount) {
  pp([cartridges, denominations, amount])
  var small = cartridges[0]
  var large = cartridges[1]
  var smallDenom = denominations[0]
  var largeDenom = denominations[1]
  var largeBills = Math.min(large, Math.floor(amount / largeDenom))
  for (var i = largeBills; i >= 0; i--) {
    var remainder = amount - (largeDenom * i)
    if (remainder % smallDenom !== 0) continue
    var smallCount = remainder / smallDenom
    if (smallCount > small) continue
    return [smallCount, i]
  }
  return null
}
