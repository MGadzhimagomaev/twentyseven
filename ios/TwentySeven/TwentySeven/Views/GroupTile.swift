import SwiftUI

/// One muscle group. Tapping anywhere adds a set; the minus button takes one away.
struct GroupTile: View {
    @Environment(TrackerStore.self) private var store
    let group: MuscleGroup

    var body: some View {
        let count = store.count(group.id)
        let goal = store.goal
        ZStack(alignment: .topLeading) {
            Button {
                store.addSet(group.id)
            } label: {
                Rectangle()
                    .fill(count >= goal ? Palette.doneWash : Palette.board)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .buttonStyle(PressStyle(cornerRadius: 0))
            .accessibilityLabel("\(group.name), \(count) of \(goal) sets")
            .accessibilityHint("Adds a set")

            TileContent(
                group: group,
                count: count,
                goal: goal,
                fresh: store.fresh?.group == group.id ? store.fresh?.index : nil
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sensoryFeedback(trigger: count) { old, new in
            new > old ? SensoryFeedback.increase : SensoryFeedback.decrease
        }
    }
}

/// Everything drawn on a tile. Only the minus button takes touches, so taps elsewhere
/// reach the add button underneath.
private struct TileContent: View {
    @Environment(TrackerStore.self) private var store
    let group: MuscleGroup
    let count: Int
    let goal: Int
    let fresh: Int?

    var body: some View {
        let done = count >= goal
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Text(group.name.uppercased())
                    .font(Typeface.display(19, bold: true))
                    .tracking(0.9)
                    .foregroundStyle(done ? Palette.done : Palette.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
                if done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .heavy))
                        .foregroundStyle(Palette.done)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)

            HStack(alignment: .center, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(verbatim: "\(count)")
                        .font(Typeface.display(40))
                        .foregroundStyle(Palette.ink)
                    Text(verbatim: "/\(goal)")
                        .font(Typeface.display(18, bold: true))
                        .foregroundStyle(Palette.ink2)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)

                if count > goal {
                    Text(verbatim: "+\(count - goal)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Palette.over)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .overlay {
                            Capsule().strokeBorder(Palette.over, lineWidth: 1.5)
                        }
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }

                Spacer(minLength: 0)

                Button {
                    store.removeSet(group.id)
                } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.ink2)
                        .frame(width: 40, height: 40)
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(Palette.rule, lineWidth: 1)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle(cornerRadius: 12))
                .disabled(count == 0)
                .opacity(count == 0 ? 0.3 : 1)
                .accessibilityLabel("Remove a set from \(group.name)")
            }

            TallyMarks(count: count, goal: goal, seed: Tally.seed(for: group.id), fresh: fresh)
                .padding(.top, 2)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .padding(EdgeInsets(top: 11, leading: 12, bottom: 13, trailing: 12))
    }
}

/// Five-bar gates: faint pencil strokes for the goal, marker strokes for sets done,
/// orange for sets past the goal.
struct TallyMarks: View {
    let count: Int
    let goal: Int
    let seed: Int
    let fresh: Int?

    var body: some View {
        let bundles = (max(count, goal) + 4) / 5
        let layout = FlowLayout(spacing: 5, lineSpacing: 4)
        layout {
            ForEach(0..<bundles, id: \.self) { bundle in
                TallyBundle(bundle: bundle, count: count, goal: goal, seed: seed, fresh: fresh)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 22, alignment: .topLeading)
    }
}

private struct TallyBundle: View {
    let bundle: Int
    let count: Int
    let goal: Int
    let seed: Int
    let fresh: Int?

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(0..<5, id: \.self) { slot in
                stroke(at: bundle * 5 + slot)
            }
        }
        .frame(width: 26, height: 22, alignment: .topLeading)
    }

    @ViewBuilder
    private func stroke(at index: Int) -> some View {
        if index < max(count, goal) {
            let path = Tally.path(index: index, seed: seed)
            ZStack(alignment: .topLeading) {
                if index < goal {
                    path.stroke(Palette.ghost, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                }
                if index < count {
                    InkStroke(path: path, color: inkColor(index), animated: index == fresh)
                }
            }
        }
    }

    private func inkColor(_ index: Int) -> Color {
        if index >= goal {
            return Palette.over
        }
        return count >= goal ? Palette.done : Palette.mark
    }
}

/// A marker stroke; the newest one draws itself in.
private struct InkStroke: View {
    let path: Path
    let color: Color
    @State private var progress: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(path: Path, color: Color, animated: Bool) {
        self.path = path
        self.color = color
        _progress = State(initialValue: animated ? 0 : 1)
    }

    var body: some View {
        path
            .trim(from: 0, to: progress)
            .stroke(color, style: StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
            .onAppear {
                guard progress < 1 else { return }
                if reduceMotion {
                    progress = 1
                } else {
                    withAnimation(.easeOut(duration: 0.25)) {
                        progress = 1
                    }
                }
            }
    }
}

/// Hand-drawn looking strokes in a 26 x 22 box. The same index and seed always draw the
/// same line, so marks don't jump around between redraws.
enum Tally {
    static func seed(for groupID: String) -> Int {
        Int(GroupID.fnv1a(groupID) % 99_991) + 1
    }

    static func path(index: Int, seed: Int) -> Path {
        let slot = index % 5
        let s = seed + index * 31
        let x1: Double
        let y1: Double
        let x2: Double
        let y2: Double
        if slot < 4 {
            let x = 4.5 + 5 * Double(slot)
            x1 = x + jitter(s, 1, 0.45)
            y1 = 2.6 + jitter(s, 2, 0.7)
            x2 = x + jitter(s, 3, 0.55)
            y2 = 19.4 + jitter(s, 4, 0.6)
        } else {
            x1 = 1.4 + jitter(s, 1, 0.5)
            y1 = 16.4 + jitter(s, 2, 0.8)
            x2 = 24.6 + jitter(s, 3, 0.5)
            y2 = 5.4 + jitter(s, 4, 0.8)
        }
        let cx = (x1 + x2) / 2 + jitter(s, 5, 0.7)
        let cy = (y1 + y2) / 2 + jitter(s, 6, 0.5)
        var path = Path()
        path.move(to: CGPoint(x: x1, y: y1))
        path.addQuadCurve(to: CGPoint(x: x2, y: y2), control: CGPoint(x: cx, y: cy))
        return path
    }

    private static func jitter(_ s: Int, _ k: Int, _ amplitude: Double) -> Double {
        (random(s + k) - 0.5) * 2 * amplitude
    }

    private static func random(_ input: Int) -> Double {
        var n = UInt32(truncatingIfNeeded: input)
        n = (n ^ (n >> 16)) &* 0x45d9f3b
        n = (n ^ (n >> 16)) &* 0x45d9f3b
        n = n ^ (n >> 16)
        return Double(n) / 4_294_967_296
    }
}

/// Places fixed-size views left to right and wraps them onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 5
    var lineSpacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            widest = max(widest, x + size.width)
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: proposal.width ?? widest, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
