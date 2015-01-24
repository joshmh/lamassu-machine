/*

WIP, not currently used.

Sketch:

Brain won't be an object, just a module.
We will have a single state object, possibly immutable.
These flows will have access to browser and hardware.
Incoming events will be processed through brain and routed to flows.

*/

'use strict';

var machina = require('machina');
var R = require('ramda');

var transitionScreen, transitionTimedScreen;

var Base = machina.Fsm.extend({
  states: {
    start: {
      requestPhonePhone: screen('registerPhone', 'requestingPhone'),
      requestLicense: 'license'
    },
    requestingPhone: {
      phoneNumber: phoneNumber,
      cancel: 'fail'
    },

  },
  initialState: 'start'
});

module.exports = {
  config: config,
  Fsm: Base
};

function phoneNumber(number) {
  if (!number) this.transition('fail');


}

function config(opts) {
  transitionTimedScreen = function transitionTimedScreen(screen, payload) {
    var self = this;
    var handler = function() {
      self.transition('fail');
    };
    opts.screen.call(screen, payload);
    opts.screenTimeout(handler, opts.timeout);
  };
  transitionScreen = function transitionScreen(payload) {
    opts.screen.call(screen, payload);
  };
}

function screen(nextScreen, nextState) {
  return function(payload) {
    transitionScreen(nextScreen, payload);
    this.transtion(nextState);
  };
}

function timedScreen(nextScreen, nextState) {
  return function(payload) {
    transitionTimedScreen(nextScreen, payload);
    this.transtion(nextState);
  };
}

/*
module.exports = function(state, increaseRisk, reduceRisk, registerConfirm) {
  return Base.extend({
    initialState: state,
    states: {
      authorized: {
        _onEnter: function() {
          var success = increaseRisk();
          if (!success) this.transition('rejected');
        },
        confirm: function() {
          reduceRisk();
          this.transition('confirmed');
        }
      },
      notSeen: {
        _onExit: function() {
          if (this._currentAction !== 'confirm') registerConfirm();
        }
      }
    }
  });
};
*/
