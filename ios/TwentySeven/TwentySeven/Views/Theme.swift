import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    /// A color with its own light and dark appearance.
    static func adaptive(_ light: UInt32, _ dark: UInt32, opacity: CGFloat = 1) -> Color {
        Color(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light, alpha: opacity)
        })
    }
}

/// A whiteboard: pencil-grey goals, marker-blue sets, green once a goal is met.
enum Palette {
    static let wall = Color.adaptive(0xE4E9ED, 0x0B1013)
    static let board = Color.adaptive(0xFBFCFD, 0x141C21)
    static let tray = Color.adaptive(0xEEF2F5, 0x10171B)
    static let ink = Color.adaptive(0x101B25, 0xECF0F2)
    static let ink2 = Color.adaptive(0x51606D, 0x96A4AF)
    static let ghost = Color.adaptive(0xC9D2D9, 0x34424B)
    static let rule = Color.adaptive(0xD6DDE3, 0x25313A)
    static let frame = Color.adaptive(0xB9C4CD, 0x2F3C46)
    static let mark = Color.adaptive(0x2346C0, 0x93AEFF)
    static let onMark = Color.adaptive(0xFFFFFF, 0x0B1013)
    static let done = Color.adaptive(0x12783A, 0x5CD192)
    static let doneWash = Color.adaptive(0xE7F3EB, 0x10261A)
    static let over = Color.adaptive(0xA8520A, 0xF1A452)
    static let press = Color.adaptive(0x101B25, 0xECF0F2, opacity: 0.08)
    static let shadow = Color.adaptive(0x101B25, 0x000000, opacity: 0.12)
    /// Chart bars, a step deeper in dark mode so they don't glare.
    static let barMark = Color.adaptive(0x2346C0, 0x6F8BED)
    static let barDone = Color.adaptive(0x12783A, 0x36AC62)
}

enum Typeface {
    /// Big Shoulders Display, the condensed face used for numbers and labels.
    static func display(_ size: CGFloat, bold: Bool = false) -> Font {
        .custom(bold ? "BigShouldersDisplay-Bold" : "BigShouldersDisplay-ExtraBold", size: size)
    }
}

/// Darkens a control while it's held down.
struct PressStyle: ButtonStyle {
    var cornerRadius: CGFloat = 12

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Palette.press)
                    .opacity(configuration.isPressed ? 1 : 0)
                    .allowsHitTesting(false)
            }
    }
}

/// The ruled whiteboard card each tab is built on.
struct Board<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity)
        .background(Palette.board)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Palette.frame, lineWidth: 1.5)
        }
        .shadow(color: Palette.shadow, radius: 12, x: 0, y: 8)
    }
}

/// The strip along the bottom of a board that holds its actions.
struct Tray<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 8) {
            content
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.tray)
        .overlay(alignment: .top) {
            Rectangle().fill(Palette.rule).frame(height: 1)
        }
    }
}

/// Two figures side by side at the top of a board.
struct StatBand: View {
    struct Item {
        let label: String
        let value: String
        let suffix: String
    }

    let left: Item
    let right: Item

    var body: some View {
        HStack(spacing: 0) {
            cell(left)
            Rectangle().fill(Palette.rule).frame(width: 1)
            cell(right)
        }
        .fixedSize(horizontal: false, vertical: true)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.rule).frame(height: 1)
        }
    }

    private func cell(_ item: Item) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(item.label)
                .font(.caption2.weight(.bold))
                .tracking(1)
                .foregroundStyle(Palette.ink2)
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(item.value)
                    .font(Typeface.display(24))
                    .foregroundStyle(Palette.ink)
                Text(item.suffix)
                    .font(Typeface.display(16, bold: true))
                    .foregroundStyle(Palette.ink2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// "20/7", the week number and what's left of it, with the tab's goal control on the right.
struct WeekHeader<Trailing: View>: View {
    let week: WeekInfo
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: "20/7")
                    .font(Typeface.display(15))
                    .tracking(1.2)
                    .foregroundStyle(Palette.mark)
                Text(verbatim: "WEEK \(week.number)")
                    .font(Typeface.display(46))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(week.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)
            }
            Spacer(minLength: 8)
            trailing
        }
    }
}

struct GoalStepper: View {
    let title: String
    let value: String
    let unit: String
    let canLower: Bool
    let canRaise: Bool
    let lower: () -> Void
    let raise: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 5) {
            Text(title)
                .font(.caption2.weight(.bold))
                .tracking(1)
                .foregroundStyle(Palette.ink2)
            HStack(spacing: 4) {
                StepButton(symbol: "minus", label: "Lower the \(title.lowercased())", enabled: canLower, action: lower)
                Text(value)
                    .font(Typeface.display(34))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
                    .frame(minWidth: 44)
                    .accessibilityLabel("\(title.lowercased()): \(value) \(unit)")
                StepButton(symbol: "plus", label: "Raise the \(title.lowercased())", enabled: canRaise, action: raise)
            }
            Text(unit)
                .font(.caption)
                .foregroundStyle(Palette.ink2)
        }
    }
}

struct StepButton: View {
    let symbol: String
    let label: String
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 40, height: 40)
                .background(Palette.board, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Palette.frame, lineWidth: 1.5)
                }
        }
        .buttonStyle(PressStyle(cornerRadius: 12))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityLabel(label)
    }
}

/// A short message in place of a board's content.
struct Notice: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(Typeface.display(24))
                .foregroundStyle(Palette.ink)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Palette.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
