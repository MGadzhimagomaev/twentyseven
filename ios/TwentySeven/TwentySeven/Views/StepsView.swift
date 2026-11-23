import Charts
import SwiftUI

struct StepsView: View {
    @Environment(TrackerStore.self) private var store
    @Environment(StepsModel.self) private var steps

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                WeekHeader(week: store.week) {
                    GoalStepper(
                        title: "DAILY GOAL",
                        value: Fmt.number(store.stepGoal),
                        unit: "steps a day",
                        canLower: store.stepGoal > Limits.stepGoal.lowerBound,
                        canRaise: store.stepGoal < Limits.stepGoal.upperBound,
                        lower: { store.setStepGoal(store.stepGoal - Limits.stepGoalStep) },
                        raise: { store.setStepGoal(store.stepGoal + Limits.stepGoalStep) }
                    )
                }

                content

                Text("Steps come from Apple Health. The week starts over every Monday.")
                    .font(.footnote)
                    .foregroundStyle(Palette.ink2)
                    .padding(.horizontal, 2)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .background(Palette.wall.ignoresSafeArea())
        .refreshable {
            steps.refresh()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch steps.access {
        case .checking:
            Board {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(28)
            }
        case .unavailable:
            Board {
                Notice(title: "Health isn't available", message: "This device doesn't have Apple Health, so there are no steps to show.")
            }
        case .needsPermission:
            Board {
                ConnectHealth()
            }
        case .failed(let message):
            Board {
                Notice(title: "Couldn't connect to Health", message: message)
            }
        case .granted:
            StepsBoard()
        }
    }
}

private struct StepsBoard: View {
    @Environment(TrackerStore.self) private var store
    @Environment(StepsModel.self) private var steps

    var body: some View {
        let goal = store.stepGoal
        let days = store.week.days
        let values = days.map { steps.steps(on: $0) }
        let summary = WeekSummary(days: days, values: values, goal: goal)
        Board {
            StatBand(
                left: .init(label: "AT GOAL", value: "\(summary.daysAtGoal)", suffix: "/7"),
                right: .init(label: "DAILY AVG", value: summary.average.map { Fmt.number($0) } ?? "–", suffix: "")
            )
            TodayCard(steps: steps.today, goal: goal)
            WeekChart(days: days, values: values, goal: goal)
            if steps.loaded && values.allSatisfy({ $0 == 0 }) {
                Text("No steps this week yet. If that's wrong, open the Health app, tap your profile picture, then Apps › 20/7, and turn on Steps.")
                    .font(.footnote)
                    .foregroundStyle(Palette.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) {
                        Rectangle().fill(Palette.rule).frame(height: 1)
                    }
            }
        }
    }
}

/// Days at goal and the average of days with steps, counting only days that have started.
private struct WeekSummary {
    let daysAtGoal: Int
    let average: Int?

    init(days: [Date], values: [Int], goal: Int) {
        let today = Calendar.current.startOfDay(for: Date())
        var elapsed: [Int] = []
        for (day, value) in zip(days, values) where day <= today {
            elapsed.append(value)
        }
        daysAtGoal = elapsed.filter { $0 >= goal }.count
        let logged = elapsed.filter { $0 > 0 }
        average = logged.isEmpty ? nil : logged.reduce(0, +) / logged.count
    }
}

private struct TodayCard: View {
    let steps: Int
    let goal: Int

    var body: some View {
        let done = steps >= goal
        VStack(alignment: .leading, spacing: 8) {
            Text("TODAY · \(Fmt.dayLabel(Date()).uppercased())")
                .font(.caption2.weight(.bold))
                .tracking(1)
                .foregroundStyle(Palette.ink2)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Fmt.number(steps))
                    .font(Typeface.display(56))
                    .foregroundStyle(done ? Palette.done : Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("/ \(Fmt.number(goal))")
                    .font(Typeface.display(20, bold: true))
                    .foregroundStyle(Palette.ink2)
                    .lineLimit(1)
            }
            Meter(fraction: Double(steps) / Double(max(goal, 1)), done: done)
            if done {
                let message: String = steps > goal ? "Goal reached, \(Fmt.number(steps - goal)) over" : "Goal reached"
                Label(message, systemImage: "checkmark")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.done)
            } else {
                Text("\(Fmt.number(goal - steps)) to go")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.ink2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.rule).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Progress toward today's goal, on a track of the same color.
private struct Meter: View {
    let fraction: Double
    let done: Bool

    var body: some View {
        let color = done ? Palette.done : Palette.mark
        GeometryReader { proxy in
            let filled: CGFloat = fraction > 0 ? max(10, proxy.size.width * CGFloat(min(1, fraction))) : 0
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(color.opacity(0.16))
                Capsule()
                    .fill(color)
                    .frame(width: filled)
            }
        }
        .frame(height: 10)
        .accessibilityHidden(true)
    }
}

/// Monday to Sunday with the goal as a dashed line. Each day's total sits on its bar.
private struct WeekChart: View {
    let days: [Date]
    let values: [Int]
    let goal: Int

    var body: some View {
        let top = Self.scaleTop(max(values.max() ?? 0, goal))
        let today = Calendar.current.startOfDay(for: Date())
        Chart {
            ForEach(days.indices, id: \.self) { index in
                bar(index, today: today)
            }
            RuleMark(y: .value("Goal", goal))
                .foregroundStyle(Palette.ink2)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .annotation(position: .top, alignment: .leading, spacing: 2) {
                    Text("Goal \(Fmt.compact(goal))")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Palette.ink2)
                }
        }
        .chartYScale(domain: 0...top)
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: days) { value in
                AxisValueLabel(centered: true) {
                    if let date = value.as(Date.self) {
                        Text(Fmt.weekday(date))
                            .font(.caption.weight(Calendar.current.isDateInToday(date) ? .bold : .regular))
                            .foregroundStyle(Calendar.current.isDateInToday(date) ? Palette.ink : Palette.ink2)
                    }
                }
            }
        }
        .frame(height: 190)
        .padding(.horizontal, 14)
        .padding(.top, 18)
        .padding(.bottom, 12)
    }

    /// One day's bar, green once it reaches the goal, with its total on top.
    private func bar(_ index: Int, today: Date) -> some ChartContent {
        let value = values[index]
        let isToday = days[index] == today
        return BarMark(
            x: .value("Day", days[index], unit: .day),
            y: .value("Steps", value),
            width: .fixed(22)
        )
        .foregroundStyle(value >= goal ? Palette.barDone : Palette.barMark)
        .cornerRadius(4)
        .annotation(position: .top, spacing: 3) {
            if value > 0 {
                Text(Fmt.compact(value))
                    .font(.caption2.weight(isToday ? .bold : .regular))
                    .foregroundStyle(isToday ? Palette.ink : Palette.ink2)
            }
        }
        .accessibilityLabel(Text(Fmt.weekday(days[index])))
        .accessibilityValue(Text("\(value) steps"))
    }

    /// Room above the tallest bar for its label, rounded up to a thousand.
    static func scaleTop(_ highest: Int) -> Int {
        let padded = Double(highest) * 1.18
        return max(1_000, Int((padded / 1_000).rounded(.up)) * 1_000)
    }
}

private struct ConnectHealth: View {
    @Environment(StepsModel.self) private var steps

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "figure.walk.circle.fill")
                .font(.system(size: 34))
                .foregroundStyle(Palette.mark)
            Text("CONNECT APPLE HEALTH")
                .font(Typeface.display(26))
                .foregroundStyle(Palette.ink)
            Text("20/7 reads your daily step count from Health to track your step goal. It never writes anything to Health.")
                .font(.subheadline)
                .foregroundStyle(Palette.ink2)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await steps.requestPermission() }
            } label: {
                Text("Allow access to steps")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.onMark)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(Palette.mark, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(PressStyle(cornerRadius: 12))
            .padding(.top, 4)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
