'use strict';

var SerialPort = require('serialport').SerialPort;
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var CashflowSc = function(config) {
  EventEmitter.call(this);
  this.currency = config.currency;
  this.buf = new Buffer(0);
  this.responseSize = null;
  this.config = config;
  this.serial = null;
  this.ack = 0x0;
  this.device = config.device;
};

util.inherits(CashflowSc, EventEmitter);
CashflowSc.factory = function factory(config) {
  return new CashflowSc(config);
};

var POLL_INTERVAL = 200;
var STX = 0x02;
var ETX = 0x03;
var ENQ = 0x05;
var EXTENDED_OFFSET = 10;


function validatePacket(frame) {
  var frameLength = frame.length;
  var checksum = computeChecksum(frame);
  if (frame[frameLength - 1] !== checksum) throw new Error('bad checksum');
  if (frame[frameLength - 2] !== ETX) throw new Error('no ETX present');
}

CashflowSc.prototype.open = function open(callback) {
  var serial = new SerialPort(this.device,
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

CashflowSc.prototype._process = function _process(data) {
  if (this.buf.length === 0 && data.length === 1 && data[0] === ENQ) {
    return this._processEvent();
  }

  this.buf = Buffer.concat([this.buf, data]);
  this.buf = this._acquireSync(this.buf);

  console.log(this.buf.toString('hex'));

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
  validatePacket(packet);
  interpret(packet);
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

CashflowSc.prototype._dispatch = function _dispatch(data) {
  var frame = this._buildFrame(data);
  this.serial.write(frame);
};

CashflowSc.prototype._poll = function _poll() {
  var buf = this._dispatch([0x7f, 0x1b, 0x10]);
  //var buf = this._buildFrame([0x7f, 0x0a, 0x10]);
  //console.log('OUT: %s', buf.toString('hex'));
};

function interpret(frame) {
  var msgTypeAck = frame[2];
  var ack = msgTypeAck & 0x0f;
  var msgType = (msgTypeAck & 0xf0) >> 4;

  // if (frame[3] & 0x01 === 0x01) return;
  console.log('IN: %s', frame.toString('hex'));

  if (msgType === 0x7 && frame[3] === 0x02) parseBill(frame);
}

function parseBill(frame) {
  var extended = frame.slice(EXTENDED_OFFSET, EXTENDED_OFFSET + 18);
  var currencyCode = extended.slice(1, 4).toString('utf8');
  var base = parseInt(extended.slice(4, 7), 10);
  var exponent = parseInt(extended.slice(7, 10), 10);
  var denomination = base * Math.pow(10, exponent);

  console.log('Got bill: %d %s', denomination, currencyCode);

  // TODO, Temp Return bill
  bv._dispatch([0x7f, 0x5f, 0x10]);
}

CashflowSc.prototype._buildFrame = function _buildFrame(data) {
  var length = data.length + 5;
  if (length > 0xff) throw new Error('Data length is too long!');
  this.ack = 0x1 - this.ack;
  var msgTypeAck = 0x10 + this.ack;
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
  device: '/dev/ttyUSB0'
});

bv.on('connected', function () { console.log('connected.'); });
bv.on('error', function (err) { console.log('Error: %s', err); });
bv.open(function () {
  bv._dispatch([0x7f, 0x1b, 0x10]);
});
setInterval(function() {
  bv._poll();
}, 10000);
