'use strict';

var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var _ = require('lodash');

var denominationsTable = require('./denominations');

var CashflowSc = function(config) {
  EventEmitter.call(this);
  this.currency = config.currency;
  this.buf = new Buffer(0);
  this.responseSize = null;
  this.config = config;
  this.serial = null;
  this.ack = 0x0;
  this.enabledDenominations = 0x00;
  this.currentStatus = null;
};

module.exports = CashflowSc;

util.inherits(CashflowSc, EventEmitter);
CashflowSc.factory = function factory(config) {
  return new CashflowSc(config);
};

var STX = 0x02;
var ETX = 0x03;
var ENQ = 0x05;
var EXTENDED_OFFSET = 10;

var STATUS_MASKS = [
  [0, 0x04, 'billRead'],
  [0, 0x10, 'billValid'],
  [0, 0x40, 'billRejected'],
  [1, 0x01, 'billRejected'],
  [1, 0x02, 'billRejected'],
  [1, 0x04, 'jam'],
  [1, 0x08, 'stackerOpen'],
  [0, 0x01, 'idle']
];

function validatePacket(frame) {
  var frameLength = frame.length;
  var checksum = computeChecksum(frame);
  if (frame[frameLength - 1] !== checksum) throw new Error('bad checksum');
  if (frame[frameLength - 2] !== ETX) throw new Error('no ETX present');
}

CashflowSc.prototype.open = function open(callback) {
  var SerialPort = require('serialport').SerialPort;
  var device = this.config.rs232.device;
  var serial = new SerialPort(device,
      {baudRate: 9600, parity: 'even', dataBits: 7, stopBits: 1});

  this.serial = serial;

  var self = this;
  serial.on('error', function(err) { self.emit('error', err); });
  serial.on('open', function () {
    serial.on('data', function(data) {  self._process(data); });
    serial.on('close', function() { self.emit('disconnected'); });
    self.emit('connected');
    if (callback) callback(function () {
      console.log('DEBUG done');
      self.close();
    });
  });
};

CashflowSc.prototype.enable = function enable() {
  this.enabledDenominations = 0x7f;
  this._poll();
};

CashflowSc.prototype.disable = function disable() {
  this.enabledDenominations = 0x00;
  this._poll();
};

CashflowSc.prototype.reject = function reject() {
  this._dispatch([0x7f, 0x5f, 0x10]);
};

CashflowSc.prototype.stack = function stack() {
  this._dispatch([0x7f, 0x3f, 0x10]);
};

CashflowSc.prototype.flash = function flash(path) {
  this.flashData = fs.readFileSync(path);
  this._dispatch([0x00, 0x00, 0x00]);
  this._dispatch([0x00, 0x00, 0x00], 0x50);
};

CashflowSc.prototype._denominations = function _denominations() {
  return denominationsTable[this.currency];
};

CashflowSc.prototype.lowestBill = function lowestBill() {
  var bills = this._denominations();
  return _.min(bills);
};

CashflowSc.prototype.highestBill = function highestBill(fiat) {
  var bills = this._denominations();
  var filtered = _.filter(bills, function(bill) { return bill <= fiat; });
  if (_.isEmpty(filtered)) return null;
  return _.max(filtered);
};

CashflowSc.prototype.hasDenominations = function hasDenominations() {
  return this._denominations() ? true : false;
};

CashflowSc.prototype.run = function run(cb) {
  var self = this;
  this.open(function () {
    self._dispatch([0x00, 0x1b, 0x10]);
    setInterval(function() {
      self._poll();
    }, 10000);
    cb();
  });
};

CashflowSc.prototype.lightOn = function lightOn() {};
CashflowSc.prototype.lightOff = function lightOff() {};
CashflowSc.prototype.monitorHeartbeat = function monitorHeartbeat() {};

CashflowSc.prototype._process = function _process(data) {
  if (this.buf.length === 0 && data.length === 1 && data[0] === ENQ) {
    return this._processEvent();
  }

  this.buf = Buffer.concat([this.buf, data]);
  this.buf = this._acquireSync(this.buf);

  // Wait for size byte
  if (this.buf.length < 2) return;

  var responseSize = this.buf[1];

  // Wait for whole packet
  if (this.buf.length < responseSize) return;

  var packet = this.buf.slice(0, responseSize);
  this.buf = this.buf.slice(responseSize);

  try {
    this._parse(packet);
  } catch (ex) {
    console.log(ex);
    var self = this;
    process.nextTick(function () {
      self._process(data.slice(1));
    });
  }
};

// TODO
// Host -> BV
// - Add commands for stacking, returning
//
// BV -> Host
// - Detect escrow and stacked
// - Detect error conditions, such as cashbox out, rejected, jammed


CashflowSc.prototype._parse = function _parse(packet) {
  var self = this;
  validatePacket(packet);
  var result = interpret(packet);
  if (!result) return;

  var status = result.status;
  if (this.currentStatus === status) return;
  this.currentStatus = status;

  console.log('DEBUG: %s', status);

  // For escrow, need to emit both billAccepted and billRead
  if (status === 'billRead') {
    if (!result.bill || result.bill.code !== this.currency) {
      console.log('WARNING: Bill validator, shouldn\'t happen.');
      console.dir(result.bill && result.bill.code);
      return this.reject();
    }

    this.emit('billAccepted');
    return process.nextTick(function() {
      self.emit('billRead', result.bill);
    });
  }

  // This can happen when cashbox is re-inserted
  if (status === 'billValid' && result.bill && !result.bill.denomination)
    return;

  if (status === 'flash') return this._processFlash(result.frame);
  if (status) return this.emit(status);
};

CashflowSc.prototype._acquireSync = function _acquireSync(data) {
  var payload = null;
  for (var i = 0; i < data.length ; i++) {
    if (data[i] === STX) {
      payload = data.slice(i);
      break;
    }
  }

  return (payload || new Buffer(0));
};

CashflowSc.prototype._processEvent = function _processEvent() {
  this._poll();
};

CashflowSc.prototype._dispatch = function _dispatch(data, msgType) {
  var frame = this._buildFrame(msgType || 0x10, data);
  this.serial.write(frame);
};

CashflowSc.prototype._poll = function _poll() {
  this._dispatch([this.enabledDenominations, 0x1b, 0x10]);
};

function parseStatus(bytes) {
  for (var i = 0; i < STATUS_MASKS.length; i++) {
    var maskRec = STATUS_MASKS[i];
    var byteIndex = maskRec[0];
    var mask = maskRec[1];
    var status = maskRec[2];
    var byte = bytes[byteIndex];
    if ((byte & mask) === mask) return status;
  }
  return null;
}

function parseStandard(frame) {
  var statusBytes = frame.slice(3, 9);
  var status = parseStatus(statusBytes);
  return {status: status};
}

function parseExtended(frame) {
  var statusBytes = frame.slice(4, 10);
  var status = parseStatus(statusBytes);
  var extended = frame.slice(EXTENDED_OFFSET, EXTENDED_OFFSET + 18);
  var currencyCode = extended.slice(1, 4).toString('utf8');
  var base = parseInt(extended.slice(4, 7), 10);
  var exponent = parseInt(extended.slice(7, 10), 10);
  var denomination = base * Math.pow(10, exponent);

  return {
    status: status,
    bill: {denomination: denomination, code: currencyCode}
  };
}

function parseFlash(frame) {
  return {
    status: 'flash',
    frame: frame
  };
}

function fetchFlashBlock(index, data) {
  var block,
      buf,
      byte;

  block = data.slice(index, index + 32);
  buf = new Buffer(64);
  buf.fill(0x00);

  for (var i = 0; i < block.length; i++) {
    byte = block[i];
    buf[i * 2] = (byte >> 4) & 0xf;
    buf[i * 2 + 1] = byte & 0xf;
  }

  return buf;
}

function computeFlashBlockIndexNibbles(index) {
  return [
    (index >> 12) & 0xf,
    (index >> 8) & 0xf,
    (index >> 4) & 0xf,
    index & 0xf
  ];
}

CashflowSc.prototype._processFlash = function _processFlash(frame) {
  var startFlash,
      firstFrame,
      indexNibbles,
      index,
      blockIndex,
      block,
      nextIndexNibbles,
      data;

  startFlash = (frame[6] & 0x2) === 0x2;
  if (!this.processingFlash && !startFlash) return;
  firstFrame = !this.processingFlash;
  this.processingFlash = true;

  if (firstFrame) {
    blockIndex = 0;
  } else {
    indexNibbles = frame.slice(3, 7);
    index = (indexNibbles[3] + (indexNibbles[2] << 4) +
      (indexNibbles[1] << 8) + (indexNibbles[0] << 12)) - 1;
    blockIndex = (index + 1) * 32;  // Next index to process
  }

  block = fetchFlashBlock(blockIndex, this.flashData);
  nextIndexNibbles = computeFlashBlockIndexNibbles(blockIndex);
  data = nextIndexNibbles.concat(block);
  this._dispatch(data, 0x50);
};

function interpret(frame) {
  var msgTypeAck = frame[2];
  //var ack = msgTypeAck & 0x0f;
  var msgType = (msgTypeAck & 0xf0) >> 4;

  console.log('IN: %s', frame.toString('hex'));

  if (msgType === 0x2)
    return parseStandard(frame);

  if (msgType === 0x7 && frame[3] === 0x02)
    return parseExtended(frame);

  if (msgType === 0x5)
    return parseFlash(frame);

  return null;
}

CashflowSc.prototype._buildFrame = function _buildFrame(msgType, data) {
  var length = data.length + 5;
  if (length > 0xff) throw new Error('Data length is too long!');
  this.ack = 0x1 - this.ack;
  var msgTypeAck = msgType + this.ack;
  var frame = [STX, length, msgTypeAck].concat(data, ETX, 0x00);
  var checksum = computeChecksum(frame);
  frame[frame.length - 1] = checksum;
  return new Buffer(frame);
};

// Works on both buffers and arrays
function computeChecksum(frame) {
  var cs = 0x00;
  // Exclude STX, ETX and checksum fields
  for (var i = 1; i < frame.length - 2; i++) {
    cs = frame[i] ^ cs;
  }
  return cs;
}

var bv = CashflowSc.factory({
  currency: 'EUR'
});

bv.serial = {
  write: function(data) {
    console.log('OUT: %s', data.toString('hex'));
  }
};

bv.flash('/Users/josh/Downloads/510065352_SCN83_USD_Variant/510065352_SCN83_USD_FLASH.BIN');

/*
var bv = CashflowSc.factory({
  rs232: {device: '/dev/ttyUSB0'},
  currency: 'EUR'
});

bv.on('connected', function () { console.log('connected.'); });
bv.on('error', function (err) { console.log('Error: %s', err); });
bv.open(function () {
  bv._dispatch([0x7f, 0x1b, 0x10]);
  bv.enable();
  setInterval(function() {
    bv._poll();
  }, 10000);
});


//setTimeout(function() { bv.enable(); }, 5000);

bv.on('billRead', function(denomination) {
  console.log('Got a bill: %d', denomination);
  bv.reject();
//  if (denomination === 5) bv.reject();
//  else bv.stack();
});

bv.on('billRejected', function() { console.log('Bill rejected'); });
bv.on('billAccepted', function() { console.log('Bill accepted'); });
bv.on('billValid', function() { console.log('Bill valid'); });
*/
