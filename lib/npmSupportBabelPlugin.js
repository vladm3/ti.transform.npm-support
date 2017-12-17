const path = require('path');
const requireResolve = require('require-resolve');

module.exports = ({ types: t }) => ({
  visitor: {
    CallExpression(path, state) {
      visitCallExpression(t, path, state.file, state.opts);
    }
  }
});

function visitCallExpression(t, path, file, opts) {
  const node = path.node;
  const args = node.arguments || [];
  const fileName = file.opts.filename;
  const {
    externalPath,
    bundlePath,
    libPath,
    srcPath
  } = opts;

  if (fileName.indexOf(srcPath) !== 0) {
    return;
  }

  if (node.callee.name === 'require' && args.length === 1 && t.isStringLiteral(args[0])) {
    const requiredModulePath = args[0].value;
    const resolved = requiredModulePath !== bundlePath && requireResolve(requiredModulePath, fileName);
    if (!resolved) {
      return;
    }

    const requiredModulePathAbsolute = resolved.src;
    if (requiredModulePathAbsolute.indexOf(externalPath) === 0) {
      // will be bundled with webpack
      const generatedName = `_$ttn_${requiredModulePathAbsolute.split(externalPath)[1].replace(/\W/g, '')}`;
      args[0] = t.stringLiteral(bundlePath);
      path.replaceWith(t.memberExpression(path.node, t.identifier(generatedName)));
      Object.assign(getMetadata(file), {
        [generatedName]: requiredModulePathAbsolute
      });
    } else {
      const fixedRequirePath = replaceRequirePathFragment(resolved.src, fileName, libPath, srcPath);
      if (fixedRequirePath) {
        args[0] = t.stringLiteral(fixedRequirePath);
      }
    }
  }
}

function replaceRequirePathFragment(requiredModulePathAbsolute, referenceFilePath, fromPath, toPath) {
  if (requiredModulePathAbsolute.indexOf(fromPath) !== 0) {
    return null;
  }

  const absPath = path.relative(toPath, requiredModulePathAbsolute);
  if (absPath.substr(0, 3) === '../') {
    return null;
  }

  let relativePath = absPath;
  const parts = relativePath.split('/');
  if (parts.shift() === 'lib') {
    relativePath = parts.join('/');
  }

  return relativePath;
}

function getMetadata(file) {
  if (!file.metadata.externalDependencies) {
    file.metadata.externalDependencies = {};
  }

  return file.metadata.externalDependencies;
}
