const xray = require('aws-xray-sdk-core');
const assert = require('chai').assert;
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');

const koaMW = require('../../lib/koa_mw');
const SegmentEmitter = require('../../../core/lib/segment_emitter.js');
const ServiceConnector = require('../../../core/lib/middleware/sampling/service_connector.js');

const mwUtils = xray.middleware;
const IncomingRequestData = xray.middleware.IncomingRequestData;
const Segment = xray.Segment;

chai.should();
chai.use(sinonChai);

const utils = require('../test_utils');

describe('Koa middleware', () => {
  const defaultName = 'defaultName';
  const hostName = 'koaMiddlewareTest';
  const parentId = '2c7ad569f5d6ff149137be86';
  const traceId = '1-f9194208-2c7ad569f5d6ff149137be86';

  describe('#openSegment', () => {
    const openSegment = koaMW.openSegment;

    it('should throw an error if no default name is supplied', () => {
      assert.throws(openSegment);
    });

    it('should return a middleware function', () => {
      assert.isTrue(typeof openSegment(defaultName) === 'function');
    });
  });

  describe('#open', () => {
    let req, res, sandbox;
    const open = koaMW.openSegment(defaultName);

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      sandbox.stub(xray, 'isAutomaticMode').returns(false);

      req = {
        method: 'GET',
        url: '/',
        connection: {
          remoteAddress: 'localhost'
        },
        headers: { host: 'myHostName' }
      };

      req.emitter = new utils.TestEmitter();
      req.on = utils.onEvent;

      res = {
        req: req,
        header: {}
      };
      res.emitter = new utils.TestEmitter();
      res.on = utils.onEvent;
    });

    afterEach(() => {
      sandbox.restore();
    });

    describe('when handling a request', () => {
      var addReqDataSpy, newSegmentSpy, onEventStub, processHeadersStub, resolveNameStub, sandbox;

      beforeEach(() => {
        sandbox = sinon.createSandbox();
        newSegmentSpy = sandbox.spy(Segment.prototype, 'init');
        addReqDataSpy = sandbox.spy(Segment.prototype, 'addIncomingRequestData');

        onEventStub = sandbox.stub(res, 'on');

        processHeadersStub = sandbox.stub(mwUtils, 'processHeaders').returns({ root: traceId, parent: parentId, sampled: '0' });
        resolveNameStub = sandbox.stub(mwUtils, 'resolveName').returns(defaultName);

        req.headers = { host: hostName };
      });

      afterEach(() => {
        sandbox.restore();
        delete process.env.AWS_XRAY_TRACING_NAME;
      });

      it('should call mwUtils.processHeaders to split the headers, if any', () => {
        open(req, res, () => Promise.resolve());

        processHeadersStub.should.have.been.calledOnce;
        processHeadersStub.should.have.been.calledWithExactly(req);
      });

      it('should call mwUtils.resolveName to find the name of the segment', () => {
        open(req, res, () => Promise.resolve());

        resolveNameStub.should.have.been.calledOnce;
        resolveNameStub.should.have.been.calledWithExactly(req.headers.host);
      });

      it('should create a new segment', () => {
        open(req, res, () => Promise.resolve());

        newSegmentSpy.should.have.been.calledOnce;
        newSegmentSpy.should.have.been.calledWithExactly(defaultName, traceId, parentId);
      });

      it('should add a new http property on the segment', () => {
        open(req, res, () => Promise.resolve());

        addReqDataSpy.should.have.been.calledOnce;
        addReqDataSpy.should.have.been.calledWithExactly(sinon.match.instanceOf(IncomingRequestData));
      });

      it('should add a finish and close event to the response', () => {
        open(req, res, () => Promise.resolve());

        onEventStub.should.have.been.calledTwice;
        onEventStub.should.have.been.calledWithExactly('finish', sinon.match.typeOf('function'));
        onEventStub.should.have.been.calledWithExactly('close', sinon.match.typeOf('function'));
      });
    });

    describe('when the request completes', () => {
      var sandbox;

      beforeEach(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(SegmentEmitter);
        sandbox.stub(ServiceConnector);
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should add the error flag on the segment on 4xx', () => {
        var getCauseStub = sandbox.stub(xray.utils, 'getCauseTypeFromHttpStatus').returns('error');
        open(req, res, () => Promise.resolve());

        res.statusCode = 400;
        res.emitter.emit('finish');

        assert.equal(req.segment.error, true);
        getCauseStub.should.have.been.calledWith(400);
      });

      it('should add the fault flag on the segment on 5xx', () => {
        var getCauseStub = sandbox.stub(xray.utils, 'getCauseTypeFromHttpStatus').returns('fault');
        open(req, res, () => Promise.resolve());

        res.statusCode = 500;
        res.emitter.emit('finish');

        assert.equal(req.segment.fault, true);
        getCauseStub.should.have.been.calledWith(500);
      });

      it('should add the throttle flag and error flag on the segment on a 429', () => {
        open(req, res, () => Promise.resolve());

        res.statusCode = 429;
        res.emitter.emit('finish');

        assert.equal(req.segment.throttle, true);
        assert.equal(req.segment.error, true);
      });

      it('should add nothing on anything else', () => {
        open(req, res, () => {});

        res.statusCode = 200;
        res.emitter.emit('finish');

        assert.notProperty(req.segment, 'error');
        assert.notProperty(req.segment, 'fault');
        assert.notProperty(req.segment, 'throttle');
      });
    });



    describe('#close', () => {
      it('should add error using express middleware', () => {
        const segment = req.segment;
        close(new Error(), req, res);

        assert.property(segment, 'cause');
        assert.property(segment.cause, 'exceptions');
      });
    });
  });
});
