'use strict';

var verifier = './../services/identitymind';

var IdVerify = function() {
  this.idRecord = {};
};

module.exports = IdVerify;

IdVerify.factory = function factory(config) {
  return new IdVerify(config);
};

IdVerify.prototype.addLicense = function addLicense(data) {
  this.idRecord.license = data;

  // North American driver's license
  this.idRecord.documentType = 'driversLicenseNA';
};

// e.g., last 4 of SSN
IdVerify.prototype.addLicenseCode = function addLicenseCode(code) {
  this.idRecord.licenseCode = code;
};

IdVerify.prototype.addTransaction = function addTransaction(transaction) {
  this.idRecord.transaction = transaction;
};

IdVerify.prototype.verifyUser = function verifyUser(cb) {
  var idRecord = this.idRecord;

  if (!idRecord.license) return cb(new Error('idRecord is incomplete'));

  verifier.verifyUser(idRecord, cb);
};

IdVerify.prototype.verifyPhoneUser = function verifyPhoneUser(phone, cb) {
  var idRecord = {
    documentType: 'mobilePhone',
    phone: phone
  };
  verifier.verifyUser(idRecord, cb);
};

IdVerify.prototype.verifySms = function verifySms(phone, code, cb) {
  verifier.verifySms(phone, code, cb);
};

IdVerify.prototype.verifyTransaction = function verifyTransaction(cb) {
  var idRecord = this.idRecord;

  if (!idRecord.license || !idRecord.transaction)
      return cb(new Error('idRecord is incomplete'));

  verifier.verifyTransaction(idRecord, cb);
};

IdVerify.prototype.inProgress = function inProgress() {
  return this.idRecord.license ? true : false;
};

IdVerify.prototype.reset = function reset() {
  this.idRecord = {};
};
