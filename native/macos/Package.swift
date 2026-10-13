// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "XiaoLuMac",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "XiaoLu.Capture", targets: ["XiaoLuCapture"]),
        .executable(name: "XiaoLu.CameraExtension", targets: ["CameraExtension"]),
        .executable(name: "XiaoLu.CameraBridge", targets: ["CameraBridge"]),
        .executable(name: "XiaoLu.Launch", targets: ["AppLaunch"])
    ],
    targets: [
        .target(name: "CaptureCore"),
        .target(name: "CameraCore"),
        .executableTarget(name: "AppLaunch"),
        .executableTarget(name: "CameraBridge", dependencies: ["CameraCore"]),
        .executableTarget(name: "CameraExtension", dependencies: ["CameraCore"]),
        .executableTarget(name: "XiaoLuCapture", dependencies: ["CaptureCore"]),
        .testTarget(name: "CaptureCoreTests", dependencies: ["CaptureCore", "XiaoLuCapture", "CameraCore"])
    ],
    swiftLanguageModes: [.v5]
)
