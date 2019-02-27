# mocha-typescript

[![Get it on NPM](https://img.shields.io/npm/v/mocha-typescript.svg)](https://www.npmjs.com/package/mocha-typescript)
[![Downloads per Week](https://img.shields.io/npm/dw/mocha-typescript.svg)](https://www.npmjs.com/package/mocha-typescript)
[![Dependencies](https://img.shields.io/librariesio/github/pana-cc/mocha-typescript.svg)](https://libraries.io/npm/mocha-typescript)
[![Issues](https://img.shields.io/github/issues/pana-cc/mocha-typescript.svg)](https://github.com/pana-cc/mocha-typescript/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/pana-cc/mocha-typescript.svg)](https://github.com/pana-cc/mocha-typescript/pulls)
[![Travis Build Status](https://img.shields.io/travis/pana-cc/mocha-typescript/master.svg)](https://travis-ci.org/pana-cc/mocha-typescript)
[![Appveyor Build Status](https://img.shields.io/appveyor/ci/pana-cc/mocha-typescript.svg)](https://ci.appveyor.com/project/pana-cc/mocha-typescript)
![Apache 2.0 License](https://img.shields.io/npm/l/mocha-typescript.svg)

## The Watcher

There is a watcher script in the package, that runs a `tsc -w` process and watches its output for successful
compilation, upon success it will run a `mocha` process to run the tests.

By adding the following npm script to `package.json`

```json
{
  "scripts": {
    "watch": "mocha-typescript-watch"
  }
}
```

you can now run the watcher from the terminal using

```bash
npm run watch
````

The `mocha-typescript-watch` script is designed as a command line tool. You can provide additional arguments in the 
package.json's script. In case you are not using the default `test.js` file as entrypoint for mocha, you can list the 
test suite files as arguments to mocha-typescript-watch and they will be passed to mocha.

```json
{
  "scripts": {
    "watch": "mocha-typescript-watch -p tsconfig.test.json -o mocha.opts dist/test1.js dist/test2.js",
    "watch-once": "mocha-typescript-watch -n 1"
  }
}
```

For a complete list of options, run

```bash
./node_modules/.bin/mocha-typescript-watch --help
```

which will output something along the line of

```
Options:
  -p, --project  Path to tsconfig file or directory containing tsconfig, passed
                 to `tsc -p <value>`.                    [string] [default: "."]
  -t, --tsc      Path to executable tsc, by default points to typescript
                 installed as dev dependency. Set to 'tsc' for global tsc
                 installation.
                         [string] [default: "./node_modules/typescript/bin/tsc"]
  -o, --opts     Path to mocha.opts file containing additional mocha
                 configuration.          [string] [default: "./test/mocha.opts"]
  -m, --mocha    Path to executable mocha, by default points to mocha installed
                 as dev dependency.
                           [string] [default: "./node_modules/mocha/bin/_mocha"]
  -g, --grep     Passed down to mocha: only run tests matching <pattern>[string]
  -f, --fgrep    Passed down to mocha: only run tests containing <string>
                                                                        [string]
  -h, --help     Show help                                             [boolean]
  -n, --times    Run the watcher at most n times.
                                                       [int] [default: INFINITY]
```
