# 20/7 for iPhone

A SwiftUI app for the 20-sets-per-muscle-group week, with steps from Apple Health.

- **Sets tab:** tap a group to log a set, tap − to undo. Weekly goal (20 by default). Counts reset every Monday at 00:00. *Edit groups* renames, reorders, adds and removes groups, with Simple (7) and Detailed (14) presets.
- **Steps tab:** daily totals read from Apple Health, updating while the app is open. Daily goal (10,000 by default), today's progress and a Monday-to-Sunday chart.
- Everything is stored on the phone only. Deleting the app deletes it.

## What you need

- A Mac with Xcode 15 or newer, with the iOS component installed
- An iPhone on iOS 17 or newer, and a cable for the first install
- An Apple Account (a free one works)

## Install

1. Unzip and open `TwentySeven.xcodeproj`. If Xcode asks whether to open a project downloaded from the internet, click **Open**.
2. In **Xcode › Settings › Accounts**, click **+** and sign in with your Apple Account.
3. Click the blue **TwentySeven** project at the top of the left sidebar, select the **TwentySeven** target, open **Signing & Capabilities** and choose your team under **Team**. A free account shows up as "Personal Team". If Xcode says the bundle identifier isn't available, change `com.marat.twentyseven` to something unique, such as `com.yourname.twentyseven`.
4. Connect the iPhone with a cable, unlock it and tap **Trust**. Then on the iPhone turn on **Settings › Privacy & Security › Developer Mode**, let it restart and confirm. The switch only appears after the iPhone has been connected to Xcode.
5. Choose the iPhone in the run destination menu at the top of the Xcode window and press **⌘R**. The first build and the first connection to the phone can take a few minutes.
6. If the app won't open and says "Untrusted Developer", go to **Settings › General › VPN & Device Management** on the iPhone, tap your Apple Account and tap **Trust**. Then open 20/7.
7. Open the **Steps** tab, tap **Allow access to steps** and turn on **Steps**.

## Good to know

- With a free Apple Account, the app stops opening after 7 days. Run it from Xcode again with ⌘R. Your data stays. After the first install, Xcode can usually reach the phone over Wi-Fi when both are on the same network.
- If signing fails with an error about HealthKit, your account needs the paid Apple Developer Program for that capability.
- If Steps shows nothing, open the Health app, tap your profile picture, go to **Apps › 20/7** and turn on **Steps**.
- The Simulator has no step data unless you add some in its Health app, so test Steps on the phone.

## Project layout

- `App/`: app entry point and tab bar
- `Model/`: week math, stored data, muscle-group presets
- `Health/StepsModel.swift`: HealthKit statistics query for the week's daily step totals
- `Views/`: Sets tab, tiles and tally marks, group editor, Steps tab, shared styles
- `Resources/Fonts/`: Big Shoulders Display (SIL Open Font License, see `OFL.txt`)
