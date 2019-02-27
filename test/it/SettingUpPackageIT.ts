import { params, slow, suite, timeout } from "../../index";
import { AbstractPackageITBase, PackageTestParams } from "./AbstractPackageITBase";

@suite(timeout(200000), slow(10000))
class SettingUpPackageIT extends AbstractPackageITBase {

  @params({ fixture: "setting-up", installTypesMocha: false }, "readme followed custom ui")
  @params({ fixture: "setting-up", installTypesMocha: true }, "readme followed custom ui with @types/mocha")
  runTest(params: PackageTestParams) {

    super.runTest(params);
  }
}
