import SwiftUI

@main
struct TwentySevenApp: App {
    @State private var store = TrackerStore()
    @State private var steps = StepsModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(steps)
        }
    }
}
