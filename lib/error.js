'use strict';

module.exports = function generateError(name) {
  var CustomErr = function(msg, properties) {
    this.message = msg;
    this.name = name;

    if (properties) {
      var keys = Object.keys(properties);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        this[key] = properties[key];
      }
    }
    Error.captureStackTrace(this, CustomErr);
  };
  CustomErr.prototype = Object.create(Error.prototype);
  CustomErr.prototype.constructor = CustomErr;

  return CustomErr;
};

var E = module.exports;
module.exports.StateTransitionError = E('StateTransitionError');
