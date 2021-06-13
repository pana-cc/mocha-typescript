import * as core from "@testdeck/core";
declare class MochaClassTestUI extends core.ClassTestUI {
    constructor(runner?: core.TestRunner);
}

interface MochaClassTestUI {
    readonly context: unique symbol;
}

declare global {
    interface Function {
        [mochaDecorators.context]: Mocha.Suite;
    }
    interface Object {
        [mochaDecorators.context]: Mocha.Context
    }
}

declare const mochaDecorators: MochaClassTestUI;
export = mochaDecorators;
