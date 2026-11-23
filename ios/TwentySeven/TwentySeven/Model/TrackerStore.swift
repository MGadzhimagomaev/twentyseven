import Foundation
import Observation

/// The newest tally stroke, so only that one draws itself in.
struct FreshMark: Equatable {
    let group: String
    let index: Int
}

/// Sets, goals and muscle groups, saved as one JSON file in the app's Application Support folder.
@Observable
final class TrackerStore {
    private(set) var data: TrackerData
    private(set) var week: WeekInfo
    private(set) var fresh: FreshMark? = nil

    private let fileURL: URL

    init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("twentyseven.json")
        let current = WeekInfo.current()
        fileURL = url
        week = current
        if let raw = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode(TrackerData.self, from: raw) {
            data = saved
        } else {
            var initial = TrackerData()
            WebImport.apply(to: &initial, currentWeek: current.id)
            data = initial
            save()
        }
    }

    var goal: Int { data.goal }
    var groups: [MuscleGroup] { data.groups }
    var stepGoal: Int { data.stepGoal }

    func count(_ group: String) -> Int {
        data.weeks[week.id]?[group] ?? 0
    }

    var totalSets: Int {
        groups.reduce(0) { $0 + count($1.id) }
    }

    var groupsAtGoal: Int {
        groups.filter { count($0.id) >= goal }.count
    }

    func addSet(_ group: String) {
        refreshWeek()
        let current = count(group)
        guard current < Limits.maxCount else { return }
        data.weeks[week.id, default: [:]][group] = current + 1
        fresh = FreshMark(group: group, index: current)
        save()
    }

    func removeSet(_ group: String) {
        refreshWeek()
        let current = count(group)
        guard current > 0 else { return }
        data.weeks[week.id, default: [:]][group] = current - 1
        fresh = nil
        save()
    }

    func setGoal(_ value: Int) {
        let clamped = min(Limits.goal.upperBound, max(Limits.goal.lowerBound, value))
        guard clamped != data.goal else { return }
        data.goal = clamped
        save()
    }

    func setStepGoal(_ value: Int) {
        let clamped = min(Limits.stepGoal.upperBound, max(Limits.stepGoal.lowerBound, value))
        guard clamped != data.stepGoal else { return }
        data.stepGoal = clamped
        save()
    }

    func setGroups(_ groups: [MuscleGroup]) {
        guard !groups.isEmpty, groups != data.groups else { return }
        data.groups = groups
        save()
    }

    /// Moves to a new week (or day) when the clock has passed midnight.
    func refreshWeek() {
        let now = WeekInfo.current()
        guard now != week else { return }
        week = now
        fresh = nil
    }

    private func save() {
        do {
            let raw = try JSONEncoder().encode(data)
            try raw.write(to: fileURL, options: .atomic)
        } catch {
            print("20/7: couldn't save:", error)
        }
    }
}
