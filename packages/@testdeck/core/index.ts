import { SuiteFunction } from "mocha";

export abstract class ClassTestUI {
  /**
   * This is supposed to create a `Symbol(key)` but some platforms does not support Symbols yet so fallback to string keys for now.
   * @param key 
   */
  protected static MakeSymbol(key: string): symbol | string { return "__testdeck_" + key; }

  private static readonly suiteSymbol = ClassTestUI.MakeSymbol("suite");
  private static readonly nameSymbol = ClassTestUI.MakeSymbol("name");
  private static readonly parametersSymbol = ClassTestUI.MakeSymbol("parametersSymbol");
  private static readonly nameForParametersSymbol = ClassTestUI.MakeSymbol("nameForParameters");
  private static readonly slowSymbol = ClassTestUI.MakeSymbol("slow");
  private static readonly timeoutSymbol = ClassTestUI.MakeSymbol("timeout");
  private static readonly retriesSymbol = ClassTestUI.MakeSymbol("retries");
  private static readonly executionSymbol = ClassTestUI.MakeSymbol("execution");
  private static readonly isDecoratorSymbol = ClassTestUI.MakeSymbol("isDecorator");

  public readonly runner: TestRunner;

  public readonly suite: SuiteDecorator;
  public readonly test: TestDecorator;

  public readonly slow: ExecutionOptionDecorator;
  public readonly timeout: ExecutionOptionDecorator;
  public readonly retries: ExecutionOptionDecorator;

  public readonly pending: ExecutionModifierDecorator;
  public readonly only: ExecutionModifierDecorator;
  public readonly skip: ExecutionModifierDecorator;

  public readonly params: ParameterisedTestDecorator;

  private readonly dependencyInjectionSystems: DependencyInjectionSystem[] = [{
    handles() { return true; },
    create<T>(cls: TestClass<T>) {
      return new cls();
    }
  }];

  public constructor(runner: TestRunner) {
    this.runner = runner;

    this.suite = this.makeSuiteObject();
    this.test = this.makeTestObject();
    this.params = this.makeParamsObject();

    this.slow = this.createExecutionOption(ClassTestUI.slowSymbol);
    this.timeout = this.createExecutionOption(ClassTestUI.timeoutSymbol);
    this.retries = this.createExecutionOption(ClassTestUI.retriesSymbol);

    this.pending = this.createExecutionModifier("pending");
    this.only = this.createExecutionModifier("only");
    this.skip = this.createExecutionModifier("skip");
  }

  /**
   * Register a dependency injection system to be used when instantiating test classes.
   * @param instantiator The dependency injection system implementation.
   */
  public registerDI(instantiator: DependencyInjectionSystem) {
    // Maybe check if it is not already added?
    /* istanbul ignore else */
    if (!this.dependencyInjectionSystems.some((di) => di === instantiator)) {
      this.dependencyInjectionSystems.unshift(instantiator);
    }
  }

  /**
   * Declares the provided function as decorator.
   * Used to mark decorators such as `@timeout` that can sometimes be provided as single argument to `@suite(timeout(1000))`.
   * In those cases the `suite()` overload should be able to distinguish the timeout function from class constructor.
   */
  protected markAsDecorator<Arg extends ClassDecorator | SuiteDecorator>(arg: Arg): Arg {
    arg[ClassTestUI.isDecoratorSymbol] = true;
    return arg;
  }

  private getSettings(obj: any): LifecycleSettings | TestSettings | SuiteSettings {
    let settings = undefined;
    if (ClassTestUI.slowSymbol in obj) (settings || (settings = {})).slow = obj[ClassTestUI.slowSymbol];
    if (ClassTestUI.timeoutSymbol in obj) (settings || (settings = {})).timeout = obj[ClassTestUI.timeoutSymbol];
    if (ClassTestUI.retriesSymbol in obj) (settings || (settings = {})).retries = obj[ClassTestUI.retriesSymbol];
    if (ClassTestUI.executionSymbol in obj) (settings || (settings = {})).execution = obj[ClassTestUI.executionSymbol];
    return settings;
  }

  private createInstance<T>(testClass: TestClass<T>) {
    const di = this.dependencyInjectionSystems.find((di) => di.handles(testClass));
    const instance = di.create(testClass);
    return instance;
  }

  private suiteCallbackFromClass<T extends TestInstance>(target: TestClass<T>): () => void {
    const theTestUI = this;
    return function() {
      // Regsiter the static before method of the class to be called before-all tests.  
      if (target.before) {
        const settings = theTestUI.getSettings(target.before);
        if (isAsync(target.before)) {
          theTestUI.runner.beforeAll("static before", wrap(function(done) {
            return target.before(done);
          }, target.before), settings);
        } else {
          theTestUI.runner.beforeAll("static before", wrap(function() {
            return target.before();
          }, target.before), settings);
        }
      }

      let instance;

      // Register the first "before each" callback to be one that will instantiate the class.
      theTestUI.runner.beforeEach("setup instance", function() {
        instance = theTestUI.createInstance(target);
      });
      
      const prototype = target.prototype;

      // Register the instance before method to be called before-each test method.
      if (prototype.before) {
        if (isAsync(prototype.before)) {
          theTestUI.runner.beforeEach("before", wrap(function(done: Function) {
            return prototype.before.call(instance, done);
          }, prototype.before), theTestUI.getSettings(prototype.before));
        } else {
          theTestUI.runner.beforeEach("before", wrap(function() {
            return prototype.before.call(instance);
          }, prototype.before), theTestUI.getSettings(prototype.before));
        }
      }

      function isAsync(method: Function): boolean {
        const isParameterised = method[ClassTestUI.parametersSymbol] !== undefined;
        const length = method.length;
        return (isParameterised && length > 1) || (!isParameterised && length > 0);
      }

      // All suite before/after each/all calls and instantiation have been set in place.
      // Now collect all potential test methods and declare them in the underlying test framework.
      const collectedTests: { [key: string]: any[] } = {};
      let currentPrototype = prototype;
      while (currentPrototype !== Object.prototype) {
        Object.getOwnPropertyNames(currentPrototype).forEach((key) => {
          if (typeof prototype[key] === "function") {
            const method = prototype[key];
            if (method[ClassTestUI.nameSymbol] && !collectedTests[key]) {
              collectedTests[key] = [prototype, method];
            }
          }
        });
        currentPrototype = (Object as any).getPrototypeOf(currentPrototype);
        if (currentPrototype !== Object.prototype && currentPrototype.constructor[ClassTestUI.suiteSymbol]) {
          throw new Error(`@suite ${prototype.constructor.name} cannot be a subclass of @suite ${currentPrototype.constructor.name}.`);
        }
      }

      function declareTestMethod(prototype: any, method: Function) {
        const testName = method[ClassTestUI.nameSymbol];
        const parameters = method[ClassTestUI.parametersSymbol] as TestParams[];
        if (parameters) {
          // we make the parameterised test a child suite so we can late bind the parameterised tests
          const settings = theTestUI.getSettings(method);
          theTestUI.runner.suite(testName, function() {
            const nameForParameters = method[ClassTestUI.nameForParametersSymbol];
            parameters.forEach((parameterOptions, i) => {
              const { execution, name, params } = parameterOptions;
              let parametersTestName = `${testName}_${i}`;
              if (name) {
                parametersTestName = name;
              } else if (nameForParameters) {
                parametersTestName = nameForParameters(params);
              }
              applyTestFunc(parametersTestName, method, [params], { execution });
            });
          }, theTestUI.getSettings(method));
        } else {
          applyTestFunc(testName, method, [], theTestUI.getSettings(method));
        }
      }

      function applyTestFunc(testName: string, method: Function, callArgs: any[], testSettings: TestSettings) {
        if (isAsync(method)) {
          theTestUI.runner.test(testName, function(done) {
            return method.call(instance, done, ...callArgs);
          }, testSettings);
        } else {
          theTestUI.runner.test(testName, function() {
            return method.call(instance, ...callArgs);
          }, testSettings);
        }
      }

      // run all collected tests
      for (const key in collectedTests) {
        const value = collectedTests[key];
        declareTestMethod(value[0], value[1]);
      }

      // Register the instance after method to be called after-each test method.
      if (prototype.after) {
        if (isAsync(prototype.after)) {
          theTestUI.runner.afterEach("after", wrap(function(done) {
            return prototype.after.call(instance, done);
          }, prototype.after), theTestUI.getSettings(prototype.after));
        } else {
          theTestUI.runner.afterEach("after", wrap(function() {
            return prototype.after.call(instance);
          }, prototype.after), theTestUI.getSettings(prototype.after));
        }
      }

      // Register a final after-each method to clear the instance reference.
      theTestUI.runner.afterEach("teardown instance", function() {
        instance = null;
      });

      // Register the static after method of the class to be called after-all tests.
      if (target.after) {
        if (isAsync(target.after)) {
          theTestUI.runner.afterAll("static after", wrap(function(done) {
            return target.after(done);
          }, target.after), theTestUI.getSettings(target.before));
        } else {
          theTestUI.runner.afterAll("static after", wrap(function() {
            return target.after();
          }, target.after), theTestUI.getSettings(target.before));
        }
      }
    };
  }

  private makeSuiteObject(): SuiteDecorator {
    return Object.assign(this.makeSuiteFunction(), {
      skip: this.makeSuiteFunction("skip"),
      only: this.makeSuiteFunction("only"),
      pending: this.makeSuiteFunction("pending")
    });
  }

  private makeSuiteFunction(execution?: Execution): SuiteDecoratorOrName {
    const theTestUI = this;
    const decorator = function() {
      // Used as `@suite() class MySuite {}`
      if (arguments.length === 0) {
        return decorator;
      }

      // Used as `@suite class MySuite {}`
      if (arguments.length === 1 && typeof arguments[0] === "function" && !arguments[0][ClassTestUI.isDecoratorSymbol]) {
        const ctor = arguments[0];
        ctor[ClassTestUI.suiteSymbol] = true;
        if (execution) {
          ctor[ClassTestUI.executionSymbol] = execution;
        }
        theTestUI.runner.suite(ctor.name, theTestUI.suiteCallbackFromClass(ctor), theTestUI.getSettings(ctor));
      }

      // Used as `@suite("name", timeout(1000))`, return a decorator function,
      // that when applied to a class will first apply the execution symbol and timeout decorators, and then register the class as suite.
      let hasName = typeof arguments[0] === "string";
      let name: string = hasName ? arguments[0] : undefined;
      let decorators: ClassDecorator[] = [];
      for(let i = hasName ? 1 : 0; i < arguments.length; i++) {
        decorators.push(arguments[i]);
      }
      
      return function(ctor) {
        ctor[ClassTestUI.suiteSymbol] = true;
        if (execution) {
          ctor[ClassTestUI.executionSymbol] = execution;
        }
        for(const decorator of decorators) {
          decorator(ctor);
        }
        theTestUI.runner.suite(hasName ? name : ctor.name, theTestUI.suiteCallbackFromClass(ctor), theTestUI.getSettings(ctor));
      }
    }

    return decorator;
  }

  // Things regarding test, abstract in a separate class...
  private makeTestObject(): TestDecorator {
    return Object.assign(this.makeTestFunction(), {
      skip: this.makeTestFunction("skip"),
      only: this.makeTestFunction("only"),
      pending: this.makeTestFunction("pending")
    });
  }

  private makeTestFunction(execution?: Execution) {
    return this.testOverload({
      testProperty(target: Object, propertyKey: string | symbol, descriptor?: PropertyDescriptor): void {
        target[propertyKey][ClassTestUI.nameSymbol] = propertyKey.toString();
        if (execution) {
          target[propertyKey][ClassTestUI.executionSymbol] = execution;
        }
      },
      testDecorator(...decorators: MethodDecorator[]): PropertyDecorator & MethodDecorator {
        return function(target: Object, propertyKey: string | symbol, descriptor?: PropertyDescriptor): void {
          target[propertyKey][ClassTestUI.nameSymbol] = propertyKey.toString();
          for(const decorator of decorators) {
            decorator(target, propertyKey, descriptor);
          }
          if (execution) {
            target[propertyKey][ClassTestUI.executionSymbol] = execution;
          }
        };
      },
      testDecoratorNamed(name: string, ...decorators: MethodDecorator[]): PropertyDecorator & MethodDecorator {
        return function(target: Object, propertyKey: string | symbol, descriptor?: PropertyDescriptor): void {
          target[propertyKey][ClassTestUI.nameSymbol] = name;
          for(const decorator of decorators) {
            decorator(target, propertyKey, descriptor);
          }
          if (execution) {
            target[propertyKey][ClassTestUI.executionSymbol] = execution;
          }
        };
      }
    });
  }

  private testOverload({testProperty, testDecorator, testDecoratorNamed}: {
    testProperty(target: Object, propertyKey: string | symbol, descriptor?: PropertyDescriptor): void;
    testDecorator(...decorators: MethodDecorator[]): MethodDecorator;
    testDecoratorNamed(name: string, ...decorators: MethodDecorator[]): MethodDecorator;
  }) {
    return function() {
      const args = [];
      for (let idx = 0; idx < arguments.length; idx++) {
        args[idx] = arguments[idx];
      }

      if (arguments.length >= 2 && typeof arguments[0] !== "string" && typeof arguments[0] !== "function") {
        return testProperty.apply(this, args);
      } else if (arguments.length >= 1 && typeof arguments[0] === "string") {
        return testDecoratorNamed.apply(this, args);
      } else {
        return testDecorator.apply(this, args);
      }
    };
  }

  private makeParamsFunction(execution?: Execution) {
    return (params: any, name?: string) => {
      return (target: Object, propertyKey: string) => {
        target[propertyKey][ClassTestUI.nameSymbol] = propertyKey.toString();
        target[propertyKey][ClassTestUI.parametersSymbol] = target[propertyKey][ClassTestUI.parametersSymbol] || [];
        target[propertyKey][ClassTestUI.parametersSymbol].push({ execution, name, params } as TestParams);
      };
    };
  }

  private makeParamsNameFunction() {
    return (nameForParameters: (parameters: any) => string) => {
      return (target: Object, propertyKey: string) => {
        target[propertyKey][ClassTestUI.nameForParametersSymbol] = nameForParameters;
      };
    };
  }

  private makeParamsObject() {
    return Object.assign(this.makeParamsFunction(), {
      skip: this.makeParamsFunction("skip"),
      only: this.makeParamsFunction("only"),
      pending: this.makeParamsFunction("pending"),
      naming: this.makeParamsNameFunction()
    });
  }

  /**
   * Create execution options such as `@slow`, `@timeout` and `@retries`.
   */
  private createExecutionOption(key: symbol | string): ExecutionOptionDecorator {
    const classTestUIInstance = this;
    return function(value: number): ClassDecorator & MethodDecorator {
      return classTestUIInstance.markAsDecorator(function() {
        if (arguments.length === 1) {
          const target = arguments[0];
          target[key] = value;
        } else {
          const proto = arguments[0];
          const prop = arguments[1];
          const descriptor = arguments[2];
          proto[prop][key] = value;
        }
      });
    };
  }

  /**
   * Creates the decorators `@pending`, `@only`, `@skip`.
   */
  private createExecutionModifier(execution: Execution): ExecutionModifierDecorator {
    const decorator = function(target: Function | boolean, propertyKey?: string | symbol): any {
      if (typeof target === "undefined" || typeof target === "boolean") {
        if (target) {
          return decorator;
        } else {
          return () => {};
        }
      }
      if (arguments.length === 1) {
        target[ClassTestUI.executionSymbol] = execution;
      } else {
        target[propertyKey][ClassTestUI.executionSymbol] = execution;
      }
    };
    return decorator;
  }
}

export type Done = (err?: any) => void;
export type CallbackOptionallyAsync = (done?: Done) => void | Promise<void>;

export interface SuiteDecoratorOrName extends ClassDecorator {
  /**
   * Callable with optional name, followed by decorators. Allows:
   * ```
   * @suite
   * @timeout(1000)
   * @slow(500)
   * ```
   * To condensed on a single line:
   * ```
   * @suite(timeout(1000), slow(500))
   * ```
   * Please note the pit fall in the first case - the `@suite` must be the first decorator.
   */
  (name: string, ...decorators: ClassDecorator[]): ClassDecorator;
  /**
   * Called with decorators only, such as:
   * ```
   * @suite(timeout(1000), slow(500))
   * ```
   */
  (...decorator: ClassDecorator[]): ClassDecorator;
}

export interface SuiteDecorator extends SuiteDecoratorOrName {
  only: SuiteDecoratorOrName;
  skip: SuiteDecoratorOrName;
  pending: SuiteDecoratorOrName;
}

export interface TestDecoratorOrName extends MethodDecorator {
  /**
   * Callable with optional name, followed by decorators. Allows:
   * ```
   * @test
   * @timeout(1000)
   * @slow(500)
   * ```
   * To condensed on a single line:
   * ```
   * @test(timeout(1000), slow(500))
   * ```
   * Please note the pit fall in the first case - the `@test` must be the first decorator.
   */
  (name: string, ...decorator: MethodDecorator[]): MethodDecorator;
  /**
   * Called as:
   * ```
   * @test(timeout(1000), slow(500))
   * ```
   */
  (...decorator: MethodDecorator[]): MethodDecorator;
}

/**
 * The type of the `@test` decorator.
 * The decorator can be used as: `@test`, `@test()`, `@test("name")`, `@test.only`, `@test.only()`, `@test.only("name")`, etc.
 */
export interface TestDecorator extends TestDecoratorOrName {
  only: TestDecoratorOrName;
  skip: TestDecoratorOrName;
  pending: TestDecoratorOrName;
}

/**
 * After a `@suite` or `@test`,
 * these decortors can be used as `@slow(1000)`, `@timeout(2000)` and `@retries(3)`.
 * These can also be used as traits - such as `@suite(timeout(2000))`.
 */
export interface ExecutionOptionDecorator {
  (value: number): ClassDecorator & MethodDecorator;
}

/**
 * An execution modifier decorators. Used to control which tests will be executed on test-run.
 * Decorators can be used as `@pending`, `@only` and `@skip`.
 * Or with condition: `@only(isWindows)`.
 */
export interface ExecutionModifierDecorator extends ClassDecorator, MethodDecorator {
  (condition: boolean): ClassDecorator & MethodDecorator;
}

export interface ParameterisedTestDecorator {
  (params: any, name?: string): MethodDecorator;
  skip(params: any, name?: string): MethodDecorator;
  only(params: any, name?: string): MethodDecorator;
  pending(params: any, name?: string): MethodDecorator;
  naming(nameForParameters: (params: any) => string): MethodDecorator;
}

export interface TestInstance {
  /**
   * An instance method, that if defined, is executed before every test method.
   */
  before?(done?: Done): void | Promise<void>;

  /**
   * An instance method, that if defined, is executed after every test method.
   */
  after?(done?: Done): void | Promise<void>;
}

export interface TestClass<T extends TestInstance> {
  new(...args: any[]): T;
  prototype: T;

  /**
   * A static method, that if defined, is executed once, before all test methods. 
   */
  before?(done?: Done): void | Promise<void>;

  /**
   * A static method, that if defined, is executed once, after all test methods.
   */
  after?(done?: Done): void | Promise<void>;
}

export interface DependencyInjectionSystem {
  handles<T>(cls: TestClass<T>): boolean;
  create<T>(cls: TestClass<T>): T;
}

/**
 * Test or suite execution.
 * The `undefined` means execute as normal. 
 */
export type Execution = undefined | "pending" | "only" | "skip";

interface TestParams {
  execution?: Execution;
  name?: string;
  params: any;
}

export interface SuiteSettings {
  execution?: Execution,
  timeout?: number,
  slow?: number,
  retries?: number
}

export interface TestSettings {
  execution?: Execution,
  timeout?: number,
  slow?: number,
  retries?: number
}

export interface LifecycleSettings {
  timeout?: number,
  slow?: number
}

/**
 * An adapter for a test runner that is used by the class syntax decorators based test ui.
 * 
 * For example the test:
 * ```TypeScript
   @suite class MyClass {
       @test myTest() {
       }
   }
   ```
 * Will call declareSuite with the name "MyClass" and a cb.
 * When that cb is called it will further call declareTest with the "myTest" name and a test function.
 * The test function when called will instantiate MyClass and call the myTest on that instance.
 */
export interface TestRunner {
  suite(name: string, callback: () => void, settings?: SuiteSettings);
  test(name: string, callback: CallbackOptionallyAsync, settings?: TestSettings);

  beforeAll(name: string, callback: CallbackOptionallyAsync, settings?: LifecycleSettings);
  beforeEach(name: string, callback: CallbackOptionallyAsync, settings?: LifecycleSettings);
  afterEach(name: string, callback: CallbackOptionallyAsync, settings?: LifecycleSettings);
  afterAll(name: string, callback: CallbackOptionallyAsync, settings?: LifecycleSettings);
}

/**
 * Transfers the base's toString and name to the wrapping function.
 */
export function wrap<T extends Function>(wrap: T, base: Function): T {
  wrap.toString = () => base.toString();
  Object.defineProperty(wrap, "name", { value: base.name, writable: false });
  return wrap;
};