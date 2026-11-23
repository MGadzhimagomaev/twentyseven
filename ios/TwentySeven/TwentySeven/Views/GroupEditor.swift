import SwiftUI

/// Rename, reorder, add and remove muscle groups. Edits stay in a draft until Save.
struct GroupEditor: View {
    @Environment(TrackerStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draft: [MuscleGroup] = []
    @State private var newName = ""
    @State private var addMessage: String? = nil
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            List {
                presetSection
                groupsSection
                addSection
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Muscle groups")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .fontWeight(.semibold)
                        .disabled(problem != nil)
                }
            }
        }
        .tint(Palette.mark)
        .interactiveDismissDisabled(hasChanges)
        .onAppear {
            guard !loaded else { return }
            draft = store.groups
            loaded = true
        }
    }

    private var presetSection: some View {
        Section {
            ForEach(Preset.allCases) { preset in
                Button {
                    draft = preset.groups
                    addMessage = nil
                } label: {
                    HStack {
                        Text(preset.label)
                            .foregroundStyle(Palette.ink)
                        Text("\(preset.groups.count) groups")
                            .foregroundStyle(Palette.ink2)
                        Spacer()
                        if cleanedDraft == preset.groups {
                            Image(systemName: "checkmark")
                                .fontWeight(.semibold)
                                .foregroundStyle(Palette.mark)
                        }
                    }
                }
            }
        } header: {
            Text("Start from")
        } footer: {
            Text("A preset replaces the list below. Nothing changes until you tap Save.")
        }
    }

    private var groupsSection: some View {
        Section {
            ForEach($draft) { $group in
                VStack(alignment: .leading, spacing: 2) {
                    TextField("Group name", text: $group.name)
                        .font(Typeface.display(21, bold: true))
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                    let logged = store.count(group.id)
                    if logged > 0 {
                        Text(logged == 1 ? "1 set this week" : "\(logged) sets this week")
                            .font(.caption)
                            .foregroundStyle(Palette.ink2)
                    }
                }
                .deleteDisabled(draft.count <= 1)
            }
            .onMove { from, to in
                draft.move(fromOffsets: from, toOffset: to)
            }
            .onDelete { offsets in
                guard draft.count - offsets.count >= 1 else { return }
                draft.remove(atOffsets: offsets)
            }
        } header: {
            Text(draft.count == 1 ? "1 group" : "\(draft.count) groups")
        } footer: {
            if let problem {
                Text(problem)
                    .foregroundStyle(Palette.over)
            } else {
                Text("Sets you've logged stay with their group, also when you rename it.")
            }
        }
    }

    private var addSection: some View {
        Section {
            HStack(spacing: 10) {
                TextField("Add a group, e.g. Forearms", text: $newName)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit(addGroup)
                Button("Add", action: addGroup)
                    .fontWeight(.semibold)
                    .buttonStyle(.borderless)
                    .disabled(GroupID.clean(newName).isEmpty || draft.count >= Limits.maxGroups)
            }
            .onChange(of: newName) { _, _ in
                addMessage = nil
            }
        } footer: {
            if let addMessage {
                Text(addMessage)
                    .foregroundStyle(Palette.over)
            } else if draft.count >= Limits.maxGroups {
                Text("That's the maximum of \(Limits.maxGroups) groups.")
            }
        }
    }

    private var cleanedDraft: [MuscleGroup] {
        draft.map { MuscleGroup(id: $0.id, name: GroupID.clean($0.name)) }
    }

    private var problem: String? {
        let groups = cleanedDraft
        if groups.contains(where: { $0.name.isEmpty }) {
            return "Give every group a name."
        }
        var seen = Set<String>()
        for group in groups {
            let key = group.name.lowercased()
            if seen.contains(key) {
                return "Two groups are called \(group.name). Rename or remove one."
            }
            seen.insert(key)
        }
        return nil
    }

    private var hasChanges: Bool {
        loaded && cleanedDraft != store.groups
    }

    private func addGroup() {
        let name = GroupID.clean(newName)
        guard !name.isEmpty, draft.count < Limits.maxGroups else { return }
        if draft.contains(where: { GroupID.clean($0.name).lowercased() == name.lowercased() }) {
            addMessage = "\(name) is already on the list."
            return
        }
        let id = GroupID.make(for: name, taken: Set(draft.map(\.id)))
        draft.append(MuscleGroup(id: id, name: name))
        newName = ""
        addMessage = nil
    }

    private func save() {
        guard problem == nil else { return }
        store.setGroups(cleanedDraft)
        dismiss()
    }
}
