import Foundation

/// Sets logged this week in the web version of 20/7, copied in on the app's first launch.
/// Nothing happens once that week is over.
enum WebImport {
    static let week = "2026-W43"
    static let counts: [String: Int] = ["back": 6, "biceps": 17, "chest": 6, "core": 13, "delts": 21, "legs": 21, "triceps": 12]

    static func apply(to data: inout TrackerData, currentWeek: String) {
        guard currentWeek == week, !counts.isEmpty else { return }
        data.weeks[week] = counts
    }
}
