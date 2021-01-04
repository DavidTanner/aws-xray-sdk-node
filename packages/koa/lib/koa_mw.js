const AWSXRay = require('aws-xray-sdk-core');
const { logger } = require('aws-xray-sdk-core/lib/middleware/sampling/service_connector');

const mwUtils = AWSXRay.middleware;

/**
 * Koa middleware module.
 *
 * Exposes Koa middleware functions to enable automated data capturing on a web service. To enable on a Node.js/Koa application,
 * use 'app.use(AWSXRayKoa.openSegment())' before defining your routes.  After your routes, before any extra error
 * handling middleware, use 'app.use(AWSXRayKoa.closeSegment())'.
 * Use AWSXRay.getSegment() to access the current sub/segment.
 * Otherwise, for manual mode, this appends the Segment object to the request object as req.segment.
 * @module koa_mw
 */
const koaMW = {

  /**
   * Use 'app.use(AWSXRayKoa.openSegment('defaultName'))' before defining your routes.
   * Use AWSXRay.getSegment() to access the current sub/segment.
   * Otherwise, for manual mode, this appends the Segment object to the request object as req.segment.
   * @param {string} defaultName - The default name for the segment.
   * @alias module:koa_mw.openSegment
   * @returns {function}
   */
  createMiddlewareSegment (defaultName) {
    if (!defaultName || typeof defaultName !== 'string')
      throw new Error('Default segment name was not supplied.  Please provide a string.');

    mwUtils.setDefaultName(defaultName);

    return async (ctx, next) => {
      const segment = mwUtils.traceRequestResponseCycle(ctx.request, ctx.response);
      try {
        if (AWSXRay.isAutomaticMode()) {
          const ns = AWSXRay.getNamespace();

          await ns.runPromise(async () => {
            AWSXRay.setSegment(segment);

            await next();
          });
        } else {
          ctx.req.segment = segment;
          await next();
        }
      } catch (error) {
        segment.addError(error);
      }
    };
  },
};

module.exports = koaMW;
