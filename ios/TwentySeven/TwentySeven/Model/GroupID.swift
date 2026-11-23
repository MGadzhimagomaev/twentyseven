import Foundation

enum GroupID {
    /// A new group's id comes from its name, so a group removed and added back under the same
    /// name finds its logged sets again. Renaming a group keeps its id.
    static func make(for name: String, taken: Set<String>) -> String {
        var base = slug(name)
        if base.isEmpty {
            base = "g" + String(fnv1a(name.lowercased()), radix: 36)
        }
        var id = base
        var suffix = 2
        while taken.contains(id) {
            id = "\(base)-\(suffix)"
            suffix += 1
        }
        return id
    }

    /// "Front Delts" -> "front-delts", "Bíceps" -> "biceps"
    static func slug(_ name: String) -> String {
        let folded = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en"))
        var out = ""
        for scalar in folded.lowercased().unicodeScalars {
            let value = scalar.value
            if (97...122).contains(value) || (48...57).contains(value) {
                out.append(Character(scalar))
            } else if !out.isEmpty && !out.hasSuffix("-") {
                out.append("-")
            }
            if out.count >= 32 {
                break
            }
        }
        while out.hasSuffix("-") {
            out.removeLast()
        }
        return out
    }

    static func fnv1a(_ text: String) -> UInt32 {
        var hash: UInt32 = 2_166_136_261
        for unit in text.utf16 {
            hash ^= UInt32(unit)
            hash = hash &* 16_777_619
        }
        return hash
    }

    /// Collapses runs of spaces and trims to the name length limit.
    static func clean(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace })
        return String(words.joined(separator: " ").prefix(Limits.nameLength))
    }
}
