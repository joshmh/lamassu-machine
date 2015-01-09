'use strict';

var url = require('url');
var _ = require('lodash');
var _request = require('./request');
var sessionId = null;
var config;
var disabled = false;

var HOST = 'https://api.raqia.is';
//var HOST = 'http://localhost:3100'; DEBUG

exports.ConnectivityError = _request.ConnectivityError;
exports.PollTimeoutError = _request.PollTimeoutError;

exports.reset = function reset(_sessionId) {
  _request.reset();
  sessionId = _sessionId;
};

exports.configure = function configure(_config) {
  config = _config;
};

function request(uri, method, specialOpts, cb) {
  if (disabled || !config) return cb(new Error('Raqia is not registered.'));

  var originalSessionId = sessionId;
  var params = opts(uri, method, specialOpts);

  _request(params)
  .then(function(res) {
    if (sessionId !== originalSessionId) return;
    cb(null, res);
  })
  .catch(function(err) {
    if (sessionId !== originalSessionId) return;
    console.log(err);
    cb(err);
  });
}

function opts(uri, method, specialOpts) {
  return _.merge({
    method: method,
    uri: uri,
    timeout: 5000,
    pollTimeout: 10000,
    retryDelay: 1000,
    sessionId: sessionId,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret
  }, specialOpts);
}

exports.phoneCode = function phoneCode(number, cb) {
  var uri = url.resolve(HOST, '/zero_conf/phone_code/' +
    encodeURIComponent(number));
  return request(uri, 'POST', null, cb);
};

exports.registerTx = function registerTx(tx, cb) {
  var uri = url.resolve(HOST, '/zero_conf/session/' + sessionId);
  return request(uri, 'PUT', {payload: {tx: tx}}, cb);
};

exports.fetchPhoneTx = function fetchPhoneTx(number, cb) {
  var uri = url.resolve(HOST, '/zero_conf/sessions?phone=' +
    encodeURIComponent(number));
  return request(uri, 'GET', null, cb);
};

exports.waitForDispense = function waitForDispense(status, cb) {
  var urlPath = '/zero_conf/session/' + sessionId + '?not_status=' + status;
  var uri = url.resolve(HOST, urlPath);
  var specialOpts = {pollTimeout: 75000, retryDelay: 500}; // DEBUG
  return request(uri, 'GET', specialOpts, cb);
};

exports.dispense = function dispense(_sessionId, cb) {
  var uri = url.resolve(HOST, '/zero_conf/dispense/' + _sessionId);
  return request(uri, 'POST', null, cb);
};

exports.isRegistered = function isRegistered() {
  return disabled || !!config;
};

exports.disable = function disable() {
  disabled = true;
};
