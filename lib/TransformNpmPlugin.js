const path = require('path');
const babel = require('babel-core');
const webpack = require('webpack');
const fs = require('fs-extra');
const npmSupportBabelPlugin = require('./npmSupportBabelPlugin');
const pkg = require('../package.json');

class TransformNpmPlugin {
  constructor() {
    this.id = pkg.name;
    this.version = pkg.version;
    this.cliVersion = '>=3.x';

    this.handleTransformFile = this.handleTransformFile.bind(this);
    this.handlePostTransform = this.handlePostTransform.bind(this);
  }

  init(logger, config, cli) {
    this.logger = logger;
    this.config = config;
    this.cli = cli;

    this.addHooks();
  }

  addHooks() {
    this.cli.on('ti.transform.file', {
      post: this.handleTransformFile,
      priority: 10100
    });

    this.cli.on('ti.transform.post', this.handlePostTransform);
  }

  handleTransformFile(data, next) {
    if (!this.shouldTransform(data)) {
      next();
      return;
    }

    this.transformFile(data)
      .then(genPaths => {
        data.processed = true;
        data.gen = [...new Set(data.gen.concat(genPaths))];
        next();
      }, e => next(e));
  }

  handlePostTransform({ lock, paths }, next) {
    const externalDependencies = {};
    Object.keys(lock).forEach((srcPath) => {
      const extra = lock[srcPath].extra || {};
      Object.assign(externalDependencies, extra.externalDependencies);
    });

    const bundleFileName = 'node_modules.bundle.js';
    const bundlePath = path.join(path.join(paths.dst, 'lib'), bundleFileName);
    const externalModulesLibCode = Object.keys(externalDependencies).map((key) => {
      const relativePath = path.relative(path.dirname(bundlePath), externalDependencies[key]);
      return `exports.${key} = require("${relativePath.substr(0, 3) === '../' ? relativePath : `./${relativePath}`}");`;
    }).join('\n');

    fs.outputFile(bundlePath, externalModulesLibCode)
      .then(() => this.runWebpack(bundlePath))
      .then(() => next(), (e) => next(e));
  }

  transformFile({ gen, paths, extra }) {
    const srcPath = paths.dst;
    const libPath = path.join(srcPath, 'lib');
    const bundleFileName = 'node_modules.bundle.js';
    const bundlePath = path.join(libPath, bundleFileName);
    const externalPath = path.join(paths.root, 'node_modules');
    const jsFiles = gen.filter(file => file !== bundlePath && path.extname(file) === '.js');

    return Promise.all(jsFiles.map(file => this.babelTransform(file, {
      babelrc: false,
      plugins: [[
        npmSupportBabelPlugin, {
          srcPath,
          libPath,
          externalPath,
          bundlePath: bundleFileName
        }
      ]]
    }).then(result => {
      if (result.metadata.externalDependencies) {
        extra.externalDependencies = extra.externalDependencies || {};
        Object.assign(extra.externalDependencies, result.metadata.externalDependencies);
      }

      return fs.outputFile(file, result.code)
        .then(() => result.metadata.externalDependencies ? bundlePath : file);
    })));
  }

  babelTransform(srcPath, babelConf = {}) {
    this.log(`Working on JS file ${srcPath}`);
    return new Promise((resolve, reject) => {
      babel.transformFile(srcPath, babelConf, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  runWebpack(file) {
    return new Promise((resolve, reject) => {
      webpack({
        target: 'node',
        entry: file,
        output: {
          filename: path.basename(file),
          path: path.dirname(file),
          libraryTarget: 'umd',
          library: 'bundle'
        }
      }, (err, stats) => {
        if (err || stats.hasErrors()) {
          reject(err);
        }

        resolve();
      });
    });
  }

  shouldTransform(data) {
    return data && data.processed && data.gen && data.gen.length;
  }

  log(message, level = 'info') {
    level = this.logger[level] ? level : 'info';
    this.logger[level](message);
  }
}

module.exports = TransformNpmPlugin;
