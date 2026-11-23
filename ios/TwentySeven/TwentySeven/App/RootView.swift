import SwiftUI

struct RootView: View {
    enum Screen: String {
        case sets
        case steps
    }

    @Environment(TrackerStore.self) private var store
    @Environment(StepsModel.self) private var steps
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("selectedTab") private var tab: Screen = .sets

    var body: some View {
        TabView(selection: $tab) {
            SetsView()
                .tabItem { Label("Sets", systemImage: "dumbbell.fill") }
                .tag(Screen.sets)
            StepsView()
                .tabItem { Label("Steps", systemImage: "figure.walk") }
                .tag(Screen.steps)
        }
        .tint(Palette.mark)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            store.refreshWeek()
            steps.refresh()
        }
        .task {
            // Keeps the week, "days left" and the step query current while the app stays open.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                store.refreshWeek()
                steps.rollOverIfNeeded()
            }
        }
    }
}
