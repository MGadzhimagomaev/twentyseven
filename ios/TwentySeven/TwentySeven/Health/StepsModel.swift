import Foundation
import HealthKit
import Observation

/// Daily step totals for the current week, read from Apple Health. HealthKit's statistics
/// merge iPhone and Apple Watch samples, so the totals match what the Health app shows.
@Observable
final class StepsModel {
    enum Access: Equatable {
        case checking
        case unavailable
        case needsPermission
        case granted
        case failed(String)
    }

    private(set) var access: Access = .checking
    /// Steps per day, keyed by each day's midnight.
    private(set) var daily: [Date: Int] = [:]
    private(set) var week: WeekInfo = WeekInfo.current()
    /// True once Health has answered at least once.
    private(set) var loaded = false

    private let health = HKHealthStore()
    private let stepType = HKQuantityType(.stepCount)
    @ObservationIgnored private var query: HKStatisticsCollectionQuery?

    init() {
        guard HKHealthStore.isHealthDataAvailable() else {
            access = .unavailable
            return
        }
        Task { await self.checkPermission() }
    }

    var today: Int { steps(on: Date()) }

    func steps(on day: Date) -> Int {
        daily[Calendar.current.startOfDay(for: day)] ?? 0
    }

    /// Health never says whether reading was allowed, only whether it still has to ask.
    @MainActor
    func checkPermission() async {
        let status = await requestStatus()
        if status == .unnecessary {
            access = .granted
            start()
        } else {
            access = .needsPermission
        }
    }

    @MainActor
    func requestPermission() async {
        do {
            try await health.requestAuthorization(toShare: [], read: [stepType])
            access = .granted
            start()
        } catch {
            access = .failed(error.localizedDescription)
        }
    }

    /// Re-reads the week, for example when the app comes back to the foreground.
    func refresh() {
        guard access == .granted else { return }
        start()
    }

    /// Starts a new query once Monday arrives.
    func rollOverIfNeeded() {
        guard access == .granted, WeekInfo.current().id != week.id else { return }
        start()
    }

    private func requestStatus() async -> HKAuthorizationRequestStatus {
        await withCheckedContinuation { continuation in
            health.getRequestStatusForAuthorization(toShare: [], read: [stepType]) { status, _ in
                continuation.resume(returning: status)
            }
        }
    }

    /// One query for Monday to Sunday in day-sized buckets. It keeps running and reports new
    /// steps as Health records them, until the next refresh replaces it.
    private func start() {
        if let running = query {
            health.stop(running)
        }
        let current = WeekInfo.current()
        week = current
        let from = current.start
        let to = current.end
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate)
        let newQuery = HKStatisticsCollectionQuery(
            quantityType: stepType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum,
            anchorDate: from,
            intervalComponents: DateComponents(day: 1)
        )
        newQuery.initialResultsHandler = { [weak self] _, collection, error in
            let totals = StepsModel.totals(in: collection)
            let failed = error != nil
            DispatchQueue.main.async { [weak self] in
                self?.apply(totals, failed: failed)
            }
        }
        newQuery.statisticsUpdateHandler = { [weak self] _, _, collection, error in
            let totals = StepsModel.totals(in: collection)
            let failed = error != nil
            DispatchQueue.main.async { [weak self] in
                self?.apply(totals, failed: failed)
            }
        }
        query = newQuery
        health.execute(newQuery)
    }

    private func apply(_ totals: [Date: Int], failed: Bool) {
        // A failed read (for example while the phone is locked) keeps what's on screen.
        if failed && totals.isEmpty {
            return
        }
        daily = totals
        loaded = true
    }

    /// Steps per day, keyed by each day's midnight. Days without any steps are left out.
    static func totals(in collection: HKStatisticsCollection?) -> [Date: Int] {
        guard let collection else { return [:] }
        var result: [Date: Int] = [:]
        for statistics in collection.statistics() {
            let value = statistics.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
            result[statistics.startDate] = Int(value.rounded())
        }
        return result
    }
}
