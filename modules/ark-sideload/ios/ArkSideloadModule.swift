// Bridges the installer's C interface (ark_sideload.h, sideload/src/ffi.rs) to JavaScript.
// Jobs run on their own threads in Rust; JavaScript polls them with next().
import ExpoModulesCore

public class ArkSideloadModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArkSideload")

    Function("start") { (command: String, requestJson: String) -> Double in
      Double(ark_start(command, requestJson))
    }

    Function("next") { (job: Double) -> String? in
      guard let p = ark_next(UInt64(job)) else { return nil }
      defer { ark_free(p) }
      return String(cString: p)
    }

    Function("answer") { (job: Double, answerJson: String) in
      ark_answer(UInt64(job), answerJson)
    }

    Function("cancel") { (job: Double) in
      ark_cancel(UInt64(job))
    }
  }
}
