/* globals $, formatE164, formatInternational, Damm */
var TIMEOUT = 60000
var LENGTHS = {
  phoneNumber: 15,
  code: 10
}

var damm = Damm()

var Keypad = function (keypadId, opts, callback) {
  this.keypadId = keypadId
  this.keypad = $('#' + keypadId)
  this.result = ''
  this.count = 0
  this.type = opts.type
  this.opts = opts
  this.callback = callback
  this.timeoutRef = null
  var self = this

  function keyHandler (e) {
    self._restartTimeout()
    var target = $(e.target)
    if (target.hasClass('clear')) {
      self.callback(null)
      return self.reset()
    }

    if (target.hasClass('enter')) {
      return self._enter()
    }

    if (target.hasClass('key')) {
      return self._keyPress(target)
    }
  }

  this.keypad.get(0).addEventListener('mousedown', keyHandler)
}

Keypad.prototype._enter = function _enter () {
  this.deactivate()
  var result = this.type === 'phoneNumber' ?
    formatE164(this.opts.country, this.result) :
    this.result
  return this.callback(result)
}

Keypad.prototype._invalid = function _invalid () {
  return this.callback(false)
}

Keypad.prototype._restartTimeout = function _restartTimeout () {
  var self = this

  clearTimeout(this.timeoutRef)
  this.timeoutRef = setTimeout(function () {
    self.reset()
    self.callback(null)
  }, TIMEOUT)
}

Keypad.prototype.activate = function activate () {
  this.reset()
  this._restartTimeout()
}

Keypad.prototype.deactivate = function deactivate () {
  clearTimeout(this.timeoutRef)
}

Keypad.prototype.setCountry = function setCountry (country) {
  if (country) this.opts.country = country
}

Keypad.prototype.reset = function reset () {
  this.keypad.find('.box').text('')
  this.count = 0
  this.result = ''
  if (this.type === 'phoneNumber') {
    this.keypad.find('.enter-plus').removeClass('enter').addClass('plus').text('+')
  }
}

Keypad.prototype._keyPress = function _keyPress (target) {
  if (this.result.replace('+', '').length >= LENGTHS[this.type]) return
  if (this.result.length > 0 && this.type === 'phoneNumber') {
    this.keypad.find('.enter-plus').addClass('enter').removeClass('plus').text('Enter')
  }

  var numeral = target.text()
  this.result += numeral

  if (this.result.length >= 7 && this.type === 'pairingCode') {
    if (this.result.length > 7) return
    this.keypad.find('.box').text(this.result)
    if (damm.verify(this.result)) return this._enter()
    return this._invalid()
  }

  var display = this.type === 'phoneNumber' ?
    formatInternational(this.opts.country, this.result) :
    this.result
  this.keypad.find('.box').text(display)
}
