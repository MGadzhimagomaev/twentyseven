import SwiftUI

struct SetsView: View {
    @Environment(TrackerStore.self) private var store
    @State private var editingGroups = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                WeekHeader(week: store.week) {
                    GoalStepper(
                        title: "WEEKLY GOAL",
                        value: "\(store.goal)",
                        unit: "sets per group",
                        canLower: store.goal > Limits.goal.lowerBound,
                        canRaise: store.goal < Limits.goal.upperBound,
                        lower: { store.setGoal(store.goal - 1) },
                        raise: { store.setGoal(store.goal + 1) }
                    )
                }

                Board {
                    StatBand(
                        left: .init(label: "SETS", value: "\(store.totalSets)", suffix: "/\(store.goal * store.groups.count)"),
                        right: .init(label: "AT GOAL", value: "\(store.groupsAtGoal)", suffix: "/\(store.groups.count)")
                    )
                    if store.totalSets == 0 {
                        Text("Tap a muscle group each time you finish a set.")
                            .font(.subheadline)
                            .foregroundStyle(Palette.ink2)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(alignment: .bottom) {
                                Rectangle().fill(Palette.rule).frame(height: 1)
                            }
                    }
                    TileGrid()
                    Tray {
                        Button {
                            editingGroups = true
                        } label: {
                            Label("Edit groups", systemImage: "pencil")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.ink2)
                                .padding(.horizontal, 12)
                                .frame(height: 42)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(PressStyle(cornerRadius: 12))
                    }
                }

                Text("Counts reset every Monday at 00:00.")
                    .font(.footnote)
                    .foregroundStyle(Palette.ink2)
                    .padding(.horizontal, 2)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .background(Palette.wall.ignoresSafeArea())
        .sheet(isPresented: $editingGroups) {
            GroupEditor()
                .environment(store)
        }
    }
}

/// Two tiles per row; an odd last tile takes the whole row.
struct TileGrid: View {
    @Environment(TrackerStore.self) private var store

    private struct Row: Identifiable {
        let groups: [MuscleGroup]
        var id: String { groups.map(\.id).joined(separator: "|") }
    }

    private var rows: [Row] {
        let groups = store.groups
        return stride(from: 0, to: groups.count, by: 2).map { first in
            Row(groups: Array(groups[first..<min(first + 2, groups.count)]))
        }
    }

    var body: some View {
        VStack(spacing: 1) {
            ForEach(rows) { row in
                HStack(spacing: 1) {
                    ForEach(row.groups) { group in
                        GroupTile(group: group)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .background(Palette.rule)
    }
}
