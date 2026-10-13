/// A preview remains a local window; the camera is composed from its independent track.
public enum CameraCapturePolicy {
    public static let previewTitle = "小录摄像头"
    public static func excludesPreview(showOwnApp: Bool, owningPID: Int32?, parentPID: Int32, title: String?) -> Bool {
        showOwnApp && owningPID == parentPID && title == previewTitle
    }
}
