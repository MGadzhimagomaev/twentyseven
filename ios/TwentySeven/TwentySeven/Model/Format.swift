import Foundation

/// Number and date text. The app's words are English, so dates and digits use one fixed locale.
enum Fmt {
    static let locale = Locale(identifier: "en_GB")

    /// 10000 -> "10,000"
    static func number(_ value: Int) -> String {
        value.formatted(.number.locale(locale))
    }

    /// 8432 -> "8.4K", 12000 -> "12K", 950 -> "950"
    static func compact(_ value: Int) -> String {
        guard value >= 1000 else { return "\(value)" }
        let thousands = Double(value) / 1000
        let text = thousands >= 10 ? String(format: "%.0f", thousands) : String(format: "%.1f", thousands)
        return (text.hasSuffix(".0") ? String(text.dropLast(2)) : text) + "K"
    }

    /// "22"
    static func day(_ date: Date) -> String {
        date.formatted(.dateTime.day().locale(locale))
    }

    /// "Oct"
    static func month(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).locale(locale))
    }

    /// "Thu"
    static func weekday(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated).locale(locale))
    }

    /// "Thu 22 Oct"
    static func dayLabel(_ date: Date) -> String {
        "\(weekday(date)) \(day(date)) \(month(date))"
    }
}
