import Foundation

struct MuscleGroup: Codable, Hashable, Identifiable {
    var id: String
    var name: String
}

enum Preset: String, CaseIterable, Identifiable {
    case simple
    case detailed

    var id: String { rawValue }

    var label: String {
        switch self {
        case .simple: return "Simple"
        case .detailed: return "Detailed"
        }
    }

    var groups: [MuscleGroup] {
        let pairs: [(String, String)]
        switch self {
        case .simple:
            pairs = [
                ("legs", "Legs"), ("back", "Back"), ("chest", "Chest"), ("core", "Core"),
                ("biceps", "Biceps"), ("triceps", "Triceps"), ("delts", "Delts"),
            ]
        case .detailed:
            pairs = [
                ("chest", "Chest"), ("back", "Back"), ("front-delts", "Front delts"), ("side-delts", "Side delts"),
                ("rear-delts", "Rear delts"), ("traps", "Traps"), ("biceps", "Biceps"), ("triceps", "Triceps"),
                ("forearms", "Forearms"), ("abs", "Abs"), ("quads", "Quads"), ("hamstrings", "Hamstrings"),
                ("glutes", "Glutes"), ("calves", "Calves"),
            ]
        }
        return pairs.map { MuscleGroup(id: $0.0, name: $0.1) }
    }
}

enum Limits {
    static let goal = 1...50
    static let stepGoal = 1_000...50_000
    static let stepGoalStep = 500
    static let maxGroups = 30
    static let nameLength = 24
    static let maxCount = 999
}

/// Everything the app stores on the phone. Set counts are keyed by ISO week ("2026-W43"),
/// then by group id, so each Monday starts at zero on its own and past weeks are kept.
struct TrackerData: Codable {
    var goal: Int
    var groups: [MuscleGroup]
    var weeks: [String: [String: Int]]
    var stepGoal: Int

    private enum CodingKeys: String, CodingKey {
        case goal
        case groups
        case weeks
        case stepGoal
    }

    init() {
        goal = 20
        groups = Preset.simple.groups
        weeks = [:]
        stepGoal = 10_000
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        goal = try container.decodeIfPresent(Int.self, forKey: .goal) ?? 20
        groups = try container.decodeIfPresent([MuscleGroup].self, forKey: .groups) ?? Preset.simple.groups
        weeks = try container.decodeIfPresent([String: [String: Int]].self, forKey: .weeks) ?? [:]
        stepGoal = try container.decodeIfPresent(Int.self, forKey: .stepGoal) ?? 10_000
        if groups.isEmpty {
            groups = Preset.simple.groups
        }
    }
}
