import SwiftUI

@main
struct OnCloudShareApp: App {
  @StateObject private var appModel = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(appModel)
        .preferredColorScheme(.dark)
    }
  }
}
