import { only, pending, skip, slow, suite, test, timeout } from "../../index";

@suite @pending class Suite1 {
    @test test1() {}
}
@suite class Suite2 {
    @test test1() {}
}
