import Foundation

/// An ISO week (Monday to Sunday) in the phone's time zone.
struct WeekInfo: Equatable {
    /// "2026-W43": the key set counts are stored under.
    let id: String
    let number: Int
    /// Monday 00:00.
    let start: Date
    /// The next Monday 00:00.
    let end: Date
    /// Days left including today: 7 on Monday, 1 on Sunday.
    let daysLeft: Int

    static func current(_ now: Date = Date()) -> WeekInfo {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone.current
        let interval = calendar.dateInterval(of: .weekOfYear, for: now)
        let start = interval?.start ?? calendar.startOfDay(for: now)
        let end = interval?.end ?? start.addingTimeInterval(7 * 24 * 3600)
        let parts = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: now)
        let year = parts.yearForWeekOfYear ?? 0
        let number = parts.weekOfYear ?? 0
        let elapsed = calendar.dateComponents([.day], from: start, to: calendar.startOfDay(for: now)).day ?? 0
        return WeekInfo(
            id: String(format: "%04ld-W%02ld", year, number),
            number: number,
            start: start,
            end: end,
            daysLeft: max(1, 7 - elapsed)
        )
    }

    /// Midnight of each day, Monday first.
    var days: [Date] {
        (0..<7).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: start) }
    }

    var sunday: Date {
        Calendar.current.date(byAdding: .day, value: 6, to: start) ?? start
    }

    /// "19–25 Oct · 4 days left"
    var subtitle: String {
        let range: String
        if Calendar.current.isDate(start, equalTo: sunday, toGranularity: .month) {
            range = "\(Fmt.day(start))–\(Fmt.day(sunday)) \(Fmt.month(sunday))"
        } else {
            range = "\(Fmt.day(start)) \(Fmt.month(start)) – \(Fmt.day(sunday)) \(Fmt.month(sunday))"
        }
        let left = daysLeft == 1 ? "resets tonight" : "\(daysLeft) days left"
        return "\(range) · \(left)"
    }
}
