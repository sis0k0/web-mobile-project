const { normalize, relative, resolve, join, parse } = require("path");
const { statSync } = require("fs");

const webpack = require("webpack");
const nsWebpack = require("nativescript-dev-webpack");
const nativescriptTarget = require("nativescript-dev-webpack/nativescript-target");
const CleanWebpackPlugin = require("clean-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");
const { NativeScriptWorkerPlugin } = require("nativescript-worker-loader/NativeScriptWorkerPlugin");
const UglifyJsPlugin = require("uglifyjs-webpack-plugin");

const { NodeJsSyncHost } = require("@angular-devkit/core/node");
const { virtualFs } = require("@angular-devkit/core");
const { AngularCompilerPlugin } = require("@ngtools/webpack");

module.exports = env => {
    // Add your custom Activities, Services and other Android app components here.
    const appComponents = [
        "tns-core-modules/ui/frame",
        "tns-core-modules/ui/frame/activity",
    ];

    const platform = env && (env.android && "android" || env.ios && "ios");
    if (!platform) {
        throw new Error("You need to provide a target platform!");
    }

    const host = new NodeJsSyncHost();
    // const platformHost = new virtualFs.PatternMatchingHost(host);
    const platformHost = new PlatformReplacementHost(host, ["tns", platform]);
 
    const platforms = ["ios", "android"];
    const projectRoot = __dirname;
    nsWebpack.loadAdditionalPlugins({ projectDir: projectRoot });

    // Default destination inside platforms/<platform>/...
    const dist = resolve(projectRoot, nsWebpack.getAppPath(platform, projectRoot));
    const appResourcesPlatformDir = platform === "android" ? "Android" : "iOS";

    const {
        // The 'appPath' and 'appResourcesPath' values are fetched from
        // the nsconfig.json configuration file
        // when bundling with `tns run android|ios --bundle`.
        appPath = "app",
        appResourcesPath = "app/App_Resources",

        // Aot, snapshot, uglify and report can be enabled by providing
        // the `--env.snapshot`, `--env.uglify` or `--env.report` flags
        // when running 'tns run android|ios'
        aot,
        snapshot,
        uglify,
        report,
    } = env;
    const ngToolsWebpackOptions = { tsConfigPath:
        join(__dirname, 
            aot ? "tsconfig.aot.json" : "tsconfig.tns.json"
        )
    };

    const appFullPath = resolve(projectRoot, appPath);
    const appResourcesFullPath = resolve(projectRoot, appResourcesPath);

    const entryModule = aot ?
        "main.aot.ts" :
        "main.ns.ts";
    const entryPath = `./${entryModule}`;
    const vendorPath = `./vendor.ts`;

    const config = {
        mode: uglify ? "production" : "development",
        context: appFullPath,
        watchOptions: {
            ignored: [
                appResourcesFullPath,
                // Don't watch hidden files
                "**/.*",
            ]
        },
        target: nativescriptTarget,
        entry: {
            bundle: entryPath,
            vendor: vendorPath,
        },
        output: {
            pathinfo: false,
            path: dist,
            libraryTarget: "commonjs2",
            filename: "[name].js",
            globalObject: "global",
        },
        resolve: {
            extensions: [".ts", ".js", ".scss", ".css"],
            // Resolve {N} system modules from tns-core-modules
            modules: [
                resolve(__dirname, "node_modules/tns-core-modules"),
                resolve(__dirname, "node_modules"),
                "node_modules/tns-core-modules",
                "node_modules",
            ],
            alias: {
                '~': appFullPath
            },
            symlinks: true
        },
        resolveLoader: {
            // don't resolve symlinks to symlinked loaders
            symlinks: false
        },
        node: {
            // Disable node shims that conflict with NativeScript
            "http": false,
            "timers": false,
            "setImmediate": false,
            "fs": "empty",
            "__dirname": false,
        },
        devtool: "none",
        optimization: {
            runtimeChunk: { name: "vendor" },
            splitChunks: {
                cacheGroups: {
                    vendor: {
                        name: "vendor",
                        chunks: "all",
                        test: (module, chunks) => {
                            const moduleName = module.nameForCondition ? module.nameForCondition() : '';
                            return /[\\/]node_modules[\\/]/.test(moduleName) ||
                                    appComponents.some(comp => comp === moduleName);
                        },
                        enforce: true,
                    },
                }
            },
            minimize: !!uglify,
            minimizer: [
                // Override default minimizer to work around an Android issue by setting compress = false
                new UglifyJsPlugin({
                    uglifyOptions: {
                        parallel: true,
                        cache: true,
                        output: {
                            comments: false,
                        },
                        compress: {
                            // The Android SBG has problems parsing the output
                            // when these options are enabled
                            'collapse_vars': platform !== "android",
                            sequences: platform !== "android",
                        }
                    }
                })
            ],
        },
        module: {
            rules: [
                {
                    test: new RegExp(entryPath),
                    use: [
                        // Require all Android app components
                        platform === "android" && {
                            loader: "nativescript-dev-webpack/android-app-components-loader",
                            options: { modules: appComponents }
                        },

                        {
                            loader: "nativescript-dev-webpack/bundle-config-loader",
                            options: {
                                loadCss: !snapshot, // load the application css if in debug mode
                            }
                        },
                    ].filter(loader => !!loader)
                },

                { test: /\.html$|\.xml$/, use: "raw-loader" },

                // tns-core-modules reads the app.css and its imports using css-loader
                {
                    test: /[\/|\\]app\.css$/,
                    use: {
                        loader: "css-loader",
                        options: { minimize: false, url: false },
                    }
                },
                {
                    test: /[\/|\\]app\.scss$/,
                    use: [
                        { loader: "css-loader", options: { minimize: false, url: false } },
                        "sass-loader"
                    ]
                },

                // Angular components reference css files and their imports using raw-loader
                { test: /\.css$/, exclude: /[\/|\\]app\.css$/, use: "raw-loader" },
                { test: /\.scss$/, exclude: /[\/|\\]app\.scss$/, use: ["raw-loader", "resolve-url-loader", "sass-loader"] },

                // Compile TypeScript files with ahead-of-time compiler.
                {
                    test: /.ts$/, use: [
                        "nativescript-dev-webpack/moduleid-compat-loader",
                        { loader: "@ngtools/webpack", options: ngToolsWebpackOptions },
                    ]
                },

                // Mark files inside `@angular/core` as using SystemJS style dynamic imports.
                // Removing this will cause deprecation warnings to appear.
                {
                    test: /[\/\\]@angular[\/\\]core[\/\\].+\.js$/,
                    parser: { system: true },
                },
            ],
        },
        plugins: [
            // Define useful constants like TNS_WEBPACK
            new webpack.DefinePlugin({
                "global.TNS_WEBPACK": "true",
            }),
            // Remove all files from the out dir.
            new CleanWebpackPlugin([ `${dist}/**/*` ]),
            // Copy native app resources to out dir.
            new CopyWebpackPlugin([
                {
                    from: `${appResourcesFullPath}/${appResourcesPlatformDir}`,
                    to: `${dist}/App_Resources/${appResourcesPlatformDir}`,
                    context: projectRoot
                },
            ]),
            // Copy assets to out dir. Add your own globs as needed.
            new CopyWebpackPlugin([
                { from: "fonts/**" },
                { from: "**/*.jpg" },
                { from: "**/*.png" },
                { from: "**/*.xml" },
            ], { ignore: [`${relative(appPath, appResourcesFullPath)}/**`] }),
            // Generate a bundle starter script and activate it in package.json
            new nsWebpack.GenerateBundleStarterPlugin([
                "./vendor",
                "./bundle",
            ]),
            // Support for web workers since v3.2
            new NativeScriptWorkerPlugin(),
            // AngularCompilerPlugin with augmented NativeScript filesystem to handle platform specific resource resolution.

            new nsWebpack.NativeScriptAngularCompilerPlugin(
                Object.assign({
                    entryModule: resolve(appPath, "app.module#AppModule"),
                    skipCodeGeneration: !aot,
                    platformOptions: {
                        platform,
                        platforms,
                    },
                    host: platformHost,
                }, ngToolsWebpackOptions)
            ),


          /**
            new AngularCompilerPlugin(
                Object.assign({
                    entryModule: resolve(__dirname, "app/app.module.tns#AppModule"),
                  // skipCodeGeneration: !aot,
                    skipCodeGeneration: false,
                    host: platformHost,
                }, ngToolsWebpackOptions)
            ),
          */


            // Does IPC communication with the {N} CLI to notify events when running in watch mode.
            new nsWebpack.WatchStateLoggerPlugin(),
        ],
    };

    if (platform === "android") {
        // Add your custom Activities, Services and other android app components here.
        const appComponents = [
            "tns-core-modules/ui/frame",
            "tns-core-modules/ui/frame/activity",
        ];

        // Require all Android app components
        // in the entry module (bundle.ts) and the vendor module (vendor.ts).
        config.module.rules.unshift({
            test: new RegExp(`${entryPath}|${vendorPath}`),
            use: {
                loader: "nativescript-dev-webpack/android-app-components-loader",
                options: { modules: appComponents }
            }
        });
    }

    if (report) {
        // Generate report files for bundles content
        config.plugins.push(new BundleAnalyzerPlugin({
            analyzerMode: "static",
            openAnalyzer: false,
            generateStatsFile: true,
            reportFilename: resolve(projectRoot, "report", `report.html`),
            statsFilename: resolve(projectRoot, "report", `stats.json`),
        }));
    }

    if (snapshot) {
        config.plugins.push(new nsWebpack.NativeScriptSnapshotPlugin({
            chunk: "vendor",
            requireModules: [
                "reflect-metadata",
                "@angular/platform-browser",
                "@angular/core",
                "@angular/common",
                "@angular/router",
                "nativescript-angular/platform-static",
                "nativescript-angular/router",
            ],
            projectRoot,
            webpackConfig: config,
        }));
    }

    return config;
};


class PlatformReplacementHost {
    constructor(_delegate, _platforms) {
        this._delegate = _delegate;
        this._platforms = _platforms;
        this._patterns = [];
    }

    _resolve(path) {
        const { dir, name, ext } = parse(path);
        // if (path.indexOf("app") > -1 || path.indexOf("main") > -1)console.log(path);

        for (const platform of this._platforms) {
            const newPath = join(dir, `${name}.${platform}${ext}`);

            try {
                const stat = statSync(newPath);
                return stat && stat.isFile() ?
                    newPath :
                    path;
            } catch(_e) {
                return path;
            }
        }
    }

    get capabilities() { return this._delegate.capabilities; }
    write(path, content) {
        return this._delegate.write(this._resolve(path), content);
    }
    read(path) {
        return this._delegate.read(this._resolve(path));
    }
    delete(path) {
        return this._delegate.delete(this._resolve(path));
    }
    rename(from, to) {
        return this._delegate.rename(this._resolve(from), this._resolve(to));
    }
    list(path) {
        return this._delegate.list(this._resolve(path));
    }
    exists(path) {
        return this._delegate.exists(this._resolve(path));
    }
    isDirectory(path) {
        return this._delegate.isDirectory(this._resolve(path));
    }
    isFile(path) {
        return this._delegate.isFile(this._resolve(path));
    }
    // Some hosts may not support stat.
    stat(path) {
        return this._delegate.stat(this._resolve(path));
    }
    // Some hosts may not support watching.
    watch(path, options) {
        return this._delegate.watch(this._resolve(path), options);
    }
}

