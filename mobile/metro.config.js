const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Pi's default auth context contains a bundler-opaque dynamic import for
  // optional Node filesystem lookup. Metro rejects that file at parse time,
  // even though mobile injects secure credentials and never needs files/env.
  if (
    moduleName === './auth/context.js' &&
    context.originModulePath.includes(
      `${path.sep}@earendil-works${path.sep}pi-ai${path.sep}dist${path.sep}`,
    )
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/ai/piAuthContextShim.js'),
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
